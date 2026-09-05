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
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let db = Database::new(&app_data_dir).map_err(std::io::Error::other)?;
            app.manage(AppState { db: db.clone() });

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
            commands::list_accounts,
            commands::save_account,
            commands::delete_account,
            commands::test_account,
            commands::list_folders,
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
