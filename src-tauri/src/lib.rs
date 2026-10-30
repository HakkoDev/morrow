mod commands;
mod credentials;
mod db;
mod imap;
mod mime;
mod models;
mod smtp;

use commands::AppState;
use db::Database;
use std::time::Duration;
use futures::future::join_all;
use tauri::{Emitter, Manager};
use tokio::time::MissedTickBehavior;

const AUTO_SYNC_INTERVAL: Duration = Duration::from_secs(60);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let db = Database::new(&app_data_dir).map_err(std::io::Error::other)?;
            app.manage(AppState { db: db.clone() });

            // Warm the offline cache in Rust. Each account is independent and
            // failures stay in the background; cached messages remain readable.
            let preload_db = db.clone();
            let preload_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let Ok(accounts) = preload_db.list_accounts() else { return };
                // Preload accounts independently so a large or slow mailbox in
                // one account cannot delay the other accounts' cached Inboxes.
                for account in accounts {
                    let account_db = preload_db.clone();
                    let account_app = preload_app.clone();
                    tauri::async_runtime::spawn(async move {
                        let Ok(password) = credentials::get_imap_password(&account.id) else { return };
                        let folders = match tokio::time::timeout(Duration::from_secs(40), imap::list_folders(&account, &password)).await {
                            Ok(Ok(folders)) => folders,
                            _ => return,
                        };
                        let _ = account_db.cache_folders(&account.id, &folders);
                        let _ = account_app.emit("mail:folders-updated", serde_json::json!({"accountId": account.id}));
                        // Fetch INBOX first, then at most 19 other folders.
                        // This is bounded and never blocks navigation in React.
                        for folder in folders.iter().filter(|folder| folder.selectable).take(20) {
                            let result = tokio::time::timeout(
                                Duration::from_secs(55),
                                imap::sync_folder(&account_db, &account, &password, &folder.name, 100),
                            ).await;
                            if matches!(result, Ok(Ok(_))) {
                                let _ = account_app.emit("mail:synced", serde_json::json!({"accountId": account.id, "folder": folder.name}));
                            }
                        }
                    });
                }
            });

            // Keep mailbox polling in Rust instead of a browser timer so minimized or
            // background webviews do not stop receiving mail while the app is running.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut ticker = tokio::time::interval(AUTO_SYNC_INTERVAL);
                ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
                // Consume interval's immediate first tick. The React shell already performs
                // the first Inbox sync during startup, then this task owns periodic polling.
                ticker.tick().await;

                loop {
                    ticker.tick().await;

                    let accounts = match db.list_accounts() {
                        Ok(accounts) => accounts,
                        Err(_) => continue,
                    };

                    let jobs = accounts.into_iter().map(|account| {
                        let db = db.clone();
                        let app_handle = app_handle.clone();
                        async move {
                            let password = match credentials::get_imap_password(&account.id) {
                                Ok(password) => password,
                                Err(_) => return,
                            };

                            let sync = imap::sync_folder(&db, &account, &password, "INBOX", 100);
                            if matches!(tokio::time::timeout(Duration::from_secs(50), sync).await, Ok(Ok(_))) {
                                let _ = app_handle.emit(
                                    "mail:synced",
                                    serde_json::json!({
                                        "accountId": account.id,
                                        "folder": "INBOX"
                                    }),
                                );
                            }
                        }
                    });

                    join_all(jobs).await;
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            updater_configuration,
            commands::list_accounts,
            commands::save_account,
            commands::delete_account,
            commands::test_account,
            commands::list_folders,
            commands::save_message,
            commands::remove_folder,
            commands::create_folder,
            commands::cached_folders,
            commands::sync_folder,
            commands::list_messages,
            commands::get_message,
            commands::set_message_flag,
            commands::move_message,
            commands::delete_message,
            commands::send_message,
            commands::save_attachment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running mail client");
}

/// Exposes only whether signed GitHub updates have been configured in this
/// particular binary. It intentionally does not accept arbitrary URLs or keys
/// from the renderer; the trusted endpoint and public key are build-time data.
#[tauri::command]
fn updater_configuration(app: tauri::AppHandle) -> serde_json::Value {
    let config = app.config().plugins.0.get("updater");
    let configured = config.is_some_and(|updater| {
        updater.get("pubkey").and_then(|value| value.as_str()).is_some_and(|key| !key.trim().is_empty())
            && updater.get("endpoints").and_then(|value| value.as_array()).is_some_and(|endpoints| !endpoints.is_empty())
    });
    serde_json::json!({ "configured": configured })
}
