use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, ExitStatus, Stdio};
use std::sync::{mpsc, mpsc::Receiver, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use rand::RngCore;

const APP_SLUG: &str = "titleix-policy-tracker";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg(unix)]
const SHUTDOWN_GRACE: Duration = Duration::from_secs(3);

#[derive(Debug, PartialEq, Eq)]
enum StartupError {
    Timeout,
    EarlyExit,
}

impl std::fmt::Display for StartupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Timeout => write!(f, "startup timed out before READY"),
            Self::EarlyExit => write!(f, "exited before READY (stdout closed)"),
        }
    }
}

fn wait_for_ready(rx: &Receiver<String>, timeout: Duration) -> Result<(), StartupError> {
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .filter(|duration| !duration.is_zero())
            .ok_or(StartupError::Timeout)?;
        match rx.recv_timeout(remaining) {
            Ok(line) if line.contains("READY ") => return Ok(()),
            Ok(_) => continue,
            Err(mpsc::RecvTimeoutError::Timeout) => return Err(StartupError::Timeout),
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err(StartupError::EarlyExit),
        }
    }
}

fn read_stdout(stdout: ChildStdout) -> std::io::Result<Receiver<String>> {
    let (tx, rx) = mpsc::channel();
    thread::Builder::new()
        .name("local-server-stdout".into())
        .spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                // After READY the receiver is dropped. Keep draining anyway so
                // server logging cannot fill the pipe and block the child.
                let _ = tx.send(line);
            }
        })?;
    Ok(rx)
}

fn await_startup(child: &mut Child, timeout: Duration) -> Result<(), String> {
    let startup = child
        .stdout
        .take()
        .ok_or_else(|| "Missing stdout pipe from local server".to_string())
        .and_then(|stdout| {
            read_stdout(stdout)
                .map_err(|e| format!("Failed to start local server stdout reader: {e}"))
        })
        .and_then(|rx| wait_for_ready(&rx, timeout).map_err(|e| e.to_string()));

    if startup.is_err() {
        let _ = kill_and_reap(child);
    }
    startup
}

fn kill_and_reap(child: &mut Child) -> std::io::Result<ExitStatus> {
    // kill can fail if the child has already exited; still wait to reap it.
    let _ = child.kill();
    child.wait()
}

fn terminate_child(child: &mut Child) -> std::io::Result<ExitStatus> {
    #[cfg(unix)]
    if matches!(child.try_wait(), Ok(None)) {
        // SAFETY: Child owns this unreaped process, so its PID cannot be reused.
        let signaled = unsafe { libc::kill(child.id() as i32, libc::SIGTERM) } == 0;
        if signaled {
            let deadline = Instant::now() + SHUTDOWN_GRACE;
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => return child.wait(),
                    Ok(None) if Instant::now() < deadline => {
                        thread::sleep(
                            Duration::from_millis(50)
                                .min(deadline.saturating_duration_since(Instant::now())),
                        );
                    }
                    _ => break,
                }
            }
        }
    }
    // Non-Unix, failed signal/poll, or a child that exceeded its grace period.
    kill_and_reap(child)
}

#[cfg(unix)]
fn ensure_private_dir(dir: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))
        .map_err(|e| format!("Failed to chmod 0700 {}: {e}", dir.display()))?;
    Ok(())
}

#[cfg(not(unix))]
fn ensure_private_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))
}

pub fn resolve_socket_path() -> PathBuf {
    if let Ok(explicit) = std::env::var("TITLEIX_SOCKET_PATH") {
        if !explicit.trim().is_empty() {
            return PathBuf::from(explicit.trim());
        }
    }
    if let Ok(xdg_runtime) = std::env::var("XDG_RUNTIME_DIR") {
        if !xdg_runtime.trim().is_empty() {
            return PathBuf::from(xdg_runtime.trim())
                .join(APP_SLUG)
                .join("app.sock");
        }
    }
    let fallback_dir = std::env::temp_dir().join(format!("{APP_SLUG}-runtime"));
    fallback_dir.join("app.sock")
}

pub fn resolve_data_dir() -> Result<PathBuf, String> {
    if let Ok(explicit) = std::env::var("TITLEIX_DATA_DIR") {
        if !explicit.trim().is_empty() {
            return Ok(PathBuf::from(explicit.trim()));
        }
    }
    if let Ok(xdg_data) = std::env::var("XDG_DATA_HOME") {
        if !xdg_data.trim().is_empty() {
            return Ok(PathBuf::from(xdg_data.trim()).join(APP_SLUG));
        }
    }
    let base =
        dirs::data_local_dir().ok_or_else(|| "Could not resolve XDG_DATA_HOME".to_string())?;
    Ok(base.join(APP_SLUG))
}

fn random_hex_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub struct ManagedLocalServer {
    pub socket_path: PathBuf,
    pub session_token: String,
    child: Mutex<Option<Child>>,
}

impl ManagedLocalServer {
    pub fn spawn(
        resource_dir: &Path,
        keyring_env: &HashMap<String, String>,
    ) -> Result<Self, String> {
        let socket_path = resolve_socket_path();
        if let Some(parent) = socket_path.parent() {
            ensure_private_dir(parent)?;
        }
        let data_dir = resolve_data_dir()?;
        ensure_private_dir(&data_dir)?;

        let session_token = random_hex_token();
        let auth_secret = random_hex_token();

        let bundled_dir = resource_dir.join("local-bundle");
        let (cwd, args): (PathBuf, Vec<String>) =
            if bundled_dir.join("local-server-entry.cjs").exists() {
                (
                    bundled_dir.clone(),
                    vec![bundled_dir
                        .join("local-server-entry.cjs")
                        .to_string_lossy()
                        .into_owned()],
                )
            } else {
                let repo_root = std::env::current_dir()
                    .map_err(|e| format!("Failed to read current_dir: {e}"))?;
                (
                    repo_root.clone(),
                    vec![
                        repo_root
                            .join("node_modules/tsx/dist/cli.mjs")
                            .to_string_lossy()
                            .into_owned(),
                        repo_root
                            .join("scripts/local-server.ts")
                            .to_string_lossy()
                            .into_owned(),
                    ],
                )
            };

        let node_bin = std::env::var("TITLEIX_NODE_BIN").unwrap_or_else(|_| "node".to_string());
        let mut cmd = Command::new(node_bin);
        cmd.args(&args)
            .current_dir(&cwd)
            .env("NODE_ENV", "production")
            .env("TITLEIX_LOCAL_MODE", "1")
            .env("TITLEIX_APP_DIR", &cwd)
            .env("TITLEIX_DATA_DIR", &data_dir)
            .env("TITLEIX_SOCKET_PATH", &socket_path)
            .env("TITLEIX_SESSION_TOKEN", &session_token)
            .env("AUTH_SECRET", &auth_secret)
            .env_remove("DATABASE_URL")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        for (k, v) in keyring_env {
            cmd.env(k, v);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn local Node server: {e}"))?;

        await_startup(&mut child, STARTUP_TIMEOUT)
            .map_err(|error| format!("Local server {error} on {}", socket_path.display()))?;

        Ok(Self {
            socket_path,
            session_token,
            child: Mutex::new(Some(child)),
        })
    }

    pub fn stop(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = terminate_child(&mut child);
            }
        }
        if self.socket_path.exists() {
            let _ = fs::remove_file(&self.socket_path);
        }
    }
}

impl Drop for ManagedLocalServer {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn readiness_accepts_ready_after_startup_logs() {
        let (tx, rx) = mpsc::channel();
        tx.send("Applying migrations".into()).unwrap();
        tx.send("READY /tmp/app.sock".into()).unwrap();
        assert_eq!(wait_for_ready(&rx, Duration::from_secs(1)), Ok(()));
    }

    #[test]
    fn readiness_times_out_when_child_is_silent() {
        let (_tx, rx) = mpsc::channel();
        let timeout = Duration::from_millis(100);
        let start = Instant::now();
        assert_eq!(wait_for_ready(&rx, timeout), Err(StartupError::Timeout));
        assert!(start.elapsed() >= timeout);
        assert!(start.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn readiness_reports_early_exit_when_stdout_closes() {
        let (tx, rx) = mpsc::channel();
        tx.send("Starting".into()).unwrap();
        drop(tx);
        assert_eq!(
            wait_for_ready(&rx, Duration::from_secs(1)),
            Err(StartupError::EarlyExit)
        );
    }

    #[test]
    fn readiness_times_out_even_with_continuous_logs() {
        let (tx, rx) = mpsc::channel();
        let producer = std::thread::spawn(move || {
            while tx.send("Still starting".into()).is_ok() {
                std::thread::sleep(Duration::from_millis(1));
            }
        });
        let start = Instant::now();
        assert_eq!(
            wait_for_ready(&rx, Duration::from_millis(100)),
            Err(StartupError::Timeout)
        );
        drop(rx);
        producer.join().unwrap();
        assert!(start.elapsed() < Duration::from_secs(1));
    }

    #[cfg(unix)]
    mod unix {
        use super::*;
        use std::os::unix::process::ExitStatusExt;

        // Ensure a failed assertion cannot leave the fixture running.
        struct TestChild(Child);

        impl Drop for TestChild {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }

        fn armed_child(trap: &str) -> TestChild {
            // Short sleeps let sh service its trap promptly; a single sleep 30
            // defers the trap until that subprocess exits on some shells.
            let mut child = TestChild(
                Command::new("sh")
                    .arg("-c")
                    .arg(format!(
                        "trap '{trap}' TERM; printf 'ARMED\\n'; while :; do sleep 0.05; done"
                    ))
                    .stdout(Stdio::piped())
                    .spawn()
                    .unwrap(),
            );
            let mut armed = String::new();
            BufReader::new(child.0.stdout.take().unwrap())
                .read_line(&mut armed)
                .unwrap();
            assert_eq!(armed.trim(), "ARMED");
            child
        }

        fn assert_reaped(pid: u32) {
            let mut status = 0;
            // SAFETY: status points to valid writable memory.
            assert_eq!(
                unsafe { libc::waitpid(pid as i32, &mut status, libc::WNOHANG) },
                -1
            );
            assert_eq!(
                std::io::Error::last_os_error().raw_os_error(),
                Some(libc::ECHILD)
            );
        }

        #[test]
        fn startup_timeout_kills_and_reaps_silent_child() {
            let mut child = TestChild(
                Command::new("sleep")
                    .arg("30")
                    .stdout(Stdio::piped())
                    .spawn()
                    .unwrap(),
            );
            let pid = child.0.id();
            let start = Instant::now();
            let error = await_startup(&mut child.0, Duration::from_millis(100)).unwrap_err();
            assert!(error.contains("timed out"));
            assert!(start.elapsed() < Duration::from_secs(1));
            assert_reaped(pid);
        }

        #[test]
        fn startup_timeout_is_enforced_for_an_unterminated_line() {
            let mut child = TestChild(
                Command::new("sh")
                    .args(["-c", "printf 'partial startup log'; exec sleep 30"])
                    .stdout(Stdio::piped())
                    .spawn()
                    .unwrap(),
            );
            let pid = child.0.id();
            let start = Instant::now();
            let error = await_startup(&mut child.0, Duration::from_millis(100)).unwrap_err();
            assert!(error.contains("timed out"));
            assert!(start.elapsed() < Duration::from_secs(1));
            assert_reaped(pid);
        }

        #[test]
        fn startup_early_exit_is_reported_and_reaped() {
            let mut child = TestChild(
                Command::new("sh")
                    .args(["-c", "exit 7"])
                    .stdout(Stdio::piped())
                    .spawn()
                    .unwrap(),
            );
            let pid = child.0.id();
            let error = await_startup(&mut child.0, Duration::from_secs(1)).unwrap_err();
            assert!(error.contains("exited before READY"));
            assert_reaped(pid);
        }

        #[test]
        fn shutdown_sends_sigterm_and_reaps_cooperative_child() {
            let mut child = armed_child("exit 0");
            let pid = child.0.id();
            let start = Instant::now();
            assert!(terminate_child(&mut child.0).unwrap().success());
            assert!(start.elapsed() < Duration::from_secs(3));
            assert_reaped(pid);
        }

        #[test]
        fn shutdown_kills_and_reaps_child_after_grace_period() {
            let mut child = armed_child("");
            let pid = child.0.id();
            let start = Instant::now();
            let status = terminate_child(&mut child.0).unwrap();
            assert_eq!(status.signal(), Some(libc::SIGKILL));
            assert!(start.elapsed() >= Duration::from_secs(3));
            assert!(start.elapsed() < Duration::from_secs(5));
            assert_reaped(pid);
        }

        #[test]
        fn stdout_is_drained_after_readiness_receiver_is_dropped() {
            let mut child = TestChild(
                Command::new("sh")
                    .args([
                        "-c",
                        "printf 'READY /tmp/test.sock\\n'; head -c 1048576 /dev/zero; printf '\\n'",
                    ])
                    .stdout(Stdio::piped())
                    .spawn()
                    .unwrap(),
            );
            let rx = read_stdout(child.0.stdout.take().unwrap()).unwrap();
            assert_eq!(wait_for_ready(&rx, Duration::from_secs(1)), Ok(()));
            drop(rx);
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                if let Some(status) = child.0.try_wait().unwrap() {
                    assert!(status.success());
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "child blocked on a full stdout pipe"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
}
