pub mod constants;
pub mod keyring_env;
pub mod local_server;
pub mod security;
pub mod uds_proxy;
pub mod window_state;

use std::sync::Arc;

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::ShellExt;

use crate::constants::{LOCAL_APP_URL, LOCAL_HOST, LOCAL_SCHEME};
use crate::keyring_env::read_ingest_keys_from_keyring;
use crate::local_server::ManagedLocalServer;
use crate::security::{classify_url, is_safe_external_url, UrlAction};
use crate::uds_proxy::forward_over_unix_socket;

struct AppState {
    server: Arc<ManagedLocalServer>,
}

pub fn run() {
    tauri::Builder::default()
        // Defect D1 equivalent: single-instance lock focusing the existing main window
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .register_asynchronous_uri_scheme_protocol(LOCAL_SCHEME, |ctx, request, responder| {
            let uri_host = request.uri().host().unwrap_or("");
            if uri_host != LOCAL_HOST || request.uri().port_u16().is_some() {
                let forbidden = http::Response::builder()
                    .status(403)
                    .body(b"Forbidden".to_vec())
                    .unwrap();
                responder.respond(forbidden);
                return;
            }

            let state = ctx.app_handle().state::<AppState>();
            let socket_path = state.server.socket_path.clone();
            let session_token = state.server.session_token.clone();

            tauri::async_runtime::spawn(async move {
                match forward_over_unix_socket(&socket_path, request, &session_token).await {
                    Ok(response) => responder.respond(response),
                    Err(err) => {
                        let bad_gateway = http::Response::builder()
                            .status(502)
                            .header("content-type", "text/plain; charset=utf-8")
                            .body(format!("Local runtime unavailable: {err}").into_bytes())
                            .unwrap();
                        responder.respond(bad_gateway);
                    }
                }
            });
        })
        .setup(|app| {
            let resource_dir = app
                .path()
                .resource_dir()
                .unwrap_or_else(|_| std::env::current_dir().unwrap());
            let keyring_env = read_ingest_keys_from_keyring();
            let server = ManagedLocalServer::spawn(&resource_dir, &keyring_env)
                .map_err(|e| std::io::Error::other(e))?;

            app.manage(AppState {
                server: Arc::new(server),
            });

            if let Some(win) = app.get_webview_window("main") {
                let pkg_version = app.package_info().version.to_string();
                let platform = std::env::consts::OS;
                let init_js = format!(
                    "Object.defineProperty(window, 'titleIXDesktop', {{ value: Object.freeze({{ platform: '{platform}', version: '{pkg_version}' }}), configurable: false, writable: false }});"
                );
                let _ = win.eval(&init_js);
            }

            Ok(())
        })
        .on_page_load(|webview, _payload| {
            let pkg_version = webview.app_handle().package_info().version.to_string();
            let platform = std::env::consts::OS;
            let init_js = format!(
                "if (!window.titleIXDesktop) {{ Object.defineProperty(window, 'titleIXDesktop', {{ value: Object.freeze({{ platform: '{platform}', version: '{pkg_version}' }}), configurable: false, writable: false }}); }}"
            );
            let _ = webview.eval(&init_js);
        })
        .on_navigation(|webview, url| {
            let action = classify_url(url.as_str(), LOCAL_APP_URL, &[], false);
            match action {
                UrlAction::Allow => true,
                UrlAction::OpenExternal => {
                    if is_safe_external_url(url.as_str()) {
                        let _ = webview.app_handle().shell().open(url.as_str(), None);
                    }
                    false
                }
                UrlAction::Block => false,
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Title IX Policy Tracker Rust shell")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.server.stop();
                }
            }
        });
}
