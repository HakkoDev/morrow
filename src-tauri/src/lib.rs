mod commands;
mod credentials;
mod db;
mod imap;
mod mime;
mod models;
mod oauth;
mod smtp;

use commands::AppState;
use db::Database;
use futures::future::join_all;
use std::time::Duration;
use std::{
    collections::HashMap,
    sync::{Arc, OnceLock},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use tokio::time::MissedTickBehavior;

const AUTO_SYNC_INTERVAL: Duration = Duration::from_secs(60);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let db = Database::new(&app_data_dir).map_err(std::io::Error::other)?;
            app.manage(AppState {
                db: db.clone(),
                pending_oauth: Arc::new(Mutex::new(HashMap::new())),
            });

            // The tray is an explicit Show/Quit control; closing the window
            // still exits normally, so there is no invisible background app.
            let show = MenuItem::with_id(app, "show", "Show Morrow", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Morrow", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::with_id("morrow-tray")
                .menu(&menu)
                .tooltip("Morrow")
                .on_menu_event(|handle, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => handle.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            let _ = tray.build(app)?;
            update_unread_indicators(&db, app.handle());

            // Keep one account-scoped IDLE watcher per saved account. An
            // unsupported or broken IDLE server falls back to the independent
            // 60-second poller below with exponential reconnect delays.
            let watcher_db = db.clone();
            let watcher_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut active = HashMap::<String, tauri::async_runtime::JoinHandle<()>>::new();
                let mut ticker = tokio::time::interval(Duration::from_secs(30));
                ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
                loop {
                    ticker.tick().await;
                    let Ok(accounts) = watcher_db.list_accounts() else { continue };
                    active.retain(|id, task| {
                        if task.inner().is_finished() || !accounts.iter().any(|account| &account.id == id) {
                            task.abort();
                            false
                        } else {
                            true
                        }
                    });
                    for account in accounts {
                        let id = account.id.clone();
                        if active.contains_key(&id) {
                            continue;
                        }
                        let task_id = id.clone();
                        let db = watcher_db.clone();
                        let app = watcher_app.clone();
                        let task = tauri::async_runtime::spawn(async move {
                            let mut backoff = 15u64;
                            while let Ok(current) = db.get_account(&id) {
                                let Ok(secret) = oauth::secret(&current, true).await else { break };
                                match imap::idle_inbox_once(&current, &secret).await {
                                    Ok(changed) => {
                                        backoff = 15;
                                        if changed {
                                            sync_inbox_and_emit(&db, &app, &current, &secret).await;
                                        }
                                        // A fresh connection is opened for each IDLE
                                        // cycle, preventing stale long-lived sessions.
                                    }
                                    Err(error) => {
                                        if error.starts_with("IMAP IDLE not supported") {
                                            tokio::time::sleep(Duration::from_secs(600)).await;
                                        } else {
                                            tokio::time::sleep(Duration::from_secs(backoff)).await;
                                            backoff = (backoff * 2).min(300);
                                        }
                                    }
                                }
                            }
                        });
                        active.insert(task_id, task);
                    }
                }
            });

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
                        let Ok(password) = oauth::secret(&account, true).await else { return };
                        let folders = match tokio::time::timeout(Duration::from_secs(40), imap::list_folders(&account, &password)).await {
                            Ok(Ok(folders)) => folders,
                            _ => return,
                        };
                        let _ = account_db.cache_folders(&account.id, &folders);
                        let _ = account_app.emit("mail:folders-updated", serde_json::json!({"accountId": account.id}));
                        // Fetch INBOX first, then at most 19 other folders.
                        // This is bounded and never blocks navigation in React.
                        for folder in folders.iter().filter(|folder| folder.selectable).take(20) {
                            let result =
                                tokio::time::timeout(Duration::from_secs(55), imap::sync_folder(&account_db, &account, &password, &folder.name, 100)).await;
                            if matches!(result, Ok(Ok(_))) {
                                let _ = account_app.emit("mail:synced", serde_json::json!({"accountId": account.id, "folder": folder.name}));
                            }
                        }
                    });
                }
            });

            // Draft synchronization runs outside webviews, including when
            // compose windows are closed. Offline and OAuth failures are
            // non-destructive; editors currently open are never overwritten.
            let draft_db = db.clone();
            let draft_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut ticker = tokio::time::interval(Duration::from_secs(180));
                ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
                loop {
                    ticker.tick().await;
                    let Ok(accounts) = draft_db.list_accounts() else { continue };
                    for account in accounts {
                        let account_db = draft_db.clone();
                        let handle = draft_app.clone();
                        tauri::async_runtime::spawn(async move {
                            let Ok(secret) = oauth::secret(&account, true).await else { return };
                            let result = tokio::time::timeout(Duration::from_secs(170), draft_sync::reconcile(&account_db, &account, &secret)).await;
                            if let Ok(Ok(_)) = result {
                                let _ = handle.emit("mail:drafts-updated", serde_json::json!({"accountId": account.id}));
                            }
                        });
                    }
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
                            let password = match oauth::secret(&account, true).await {
                                Ok(password) => password,
                                Err(_) => return,
                            };

                            sync_inbox_and_emit(&db, &app_handle, &account, &password).await;
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
            commands::authorize_oauth,
            commands::delete_account,
            commands::test_account,
            commands::list_folders,
            commands::save_message,
            commands::remove_folder,
            commands::create_folder,
            commands::cached_folders,
            commands::sync_folder,
            commands::list_messages,
            commands::unified_inbox,
            commands::unread_counts,
            commands::search_cached_messages,
            commands::conversation,
            commands::save_local_draft,
            commands::list_local_drafts,
            commands::delete_local_draft,
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
            && updater
                .get("endpoints")
                .and_then(|value| value.as_array())
                .is_some_and(|endpoints| !endpoints.is_empty())
    });
    serde_json::json!({ "configured": configured })
}

/// Emits only generic new-mail metadata, never sender/subject/body text. A
/// historical backfill or a first-time sync must not trigger notifications.
async fn sync_inbox_and_emit(db: &Database, app: &tauri::AppHandle, account: &models::Account, password: &str) {
    // IDLE and periodic polling may wake simultaneously. Only one refresh per
    // account should calculate unread changes and emit notifications at a time.
    static ACTIVE_SYNC: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    let active = ACTIVE_SYNC.get_or_init(|| Mutex::new(HashMap::new()));
    let lock = active.lock().await.entry(account.id.clone()).or_default().clone();
    let Ok(_guard) = lock.try_lock_owned() else { return };
    // The owned guard also releases on task cancellation/account removal.
    let (Ok(before), Ok(validity)) = (db.max_cached_uid(&account.id, "INBOX"), db.inbox_uid_validity(&account.id)) else {
        return;
    };
    let result = tokio::time::timeout(Duration::from_secs(55), imap::sync_folder(db, account, password, "INBOX", 100)).await;
    if let Ok(Ok(synced)) = result {
        let _ = app.emit("mail:synced", serde_json::json!({"accountId": account.id, "folder": "INBOX"}));
        let count = db.new_unread_count(&account.id, before, validity).unwrap_or(0);
        if count > 0 && synced > 0 {
            let _ = app.emit("mail:new", serde_json::json!({"accountId": account.id, "count": count.min(100)}));
        }
        update_unread_indicators(db, app);
    }
}

/// Display aggregate unread mail without showing message content. Badges are
/// updated from the same cached SQLite counts used by the mailbox UI.
pub(crate) fn update_unread_indicators(db: &Database, app: &tauri::AppHandle) {
    let Ok(counts) = db.unread_counts() else { return };
    let count: usize = counts.values().sum();
    if let Some(tray) = app.tray_by_id("morrow-tray") {
        let _ = tray.set_tooltip(Some(format!("Morrow Â· {count} unread")));
    }
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(target_os = "windows")]
        {
            // Windows does not implement set_badge_count. The overlay API
            // supports a compact 1..9 / 9+ count instead.
            let icon = match count.min(10) {
                1 => Some(tauri::include_image!("icons/unread-1.png")),
                2 => Some(tauri::include_image!("icons/unread-2.png")),
                3 => Some(tauri::include_image!("icons/unread-3.png")),
                4 => Some(tauri::include_image!("icons/unread-4.png")),
                5 => Some(tauri::include_image!("icons/unread-5.png")),
                6 => Some(tauri::include_image!("icons/unread-6.png")),
                7 => Some(tauri::include_image!("icons/unread-7.png")),
                8 => Some(tauri::include_image!("icons/unread-8.png")),
                9 => Some(tauri::include_image!("icons/unread-9.png")),
                10 => Some(tauri::include_image!("icons/unread-10.png")),
                _ => None,
            };
            let _ = window.set_overlay_icon(icon);
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = window.set_badge_count(if count == 0 { None } else { Some(count as i64) });
        }
    }
}
