use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rand::RngCore;

const APP_SLUG: &str = "titleix-policy-tracker";

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
    let base = dirs::data_local_dir().ok_or_else(|| "Could not resolve XDG_DATA_HOME".to_string())?;
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
        let (cwd, args): (PathBuf, Vec<String>) = if bundled_dir.join("local-server-entry.cjs").exists() {
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

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Missing stdout pipe from local server".to_string())?;

        let deadline = Instant::now() + Duration::from_secs(30);
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let mut ready = false;

        while Instant::now() < deadline {
            line.clear();
            let n = reader
                .read_line(&mut line)
                .map_err(|e| format!("Error reading local server readiness: {e}"))?;
            if n == 0 {
                break;
            }
            if line.contains("READY ") {
                ready = true;
                break;
            }
        }

        if !ready {
            let _ = child.kill();
            return Err(format!(
                "Local server did not signal READY on {}",
                socket_path.display()
            ));
        }

        Ok(Self {
            socket_path,
            session_token,
            child: Mutex::new(Some(child)),
        })
    }

    pub fn stop(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
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
