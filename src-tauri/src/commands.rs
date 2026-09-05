use std::{fs, path::Path};

use tauri::State;
use uuid::Uuid;

use crate::{
    credentials,
    db::Database,
    imap,
    mime,
    models::{Account, AccountInput, ConnectionTestResult, FolderInfo, MessageDetail, MessageSummary, SendMessageInput},
    smtp,
};

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
}

#[tauri::command]
pub fn list_accounts(state: State<'_, AppState>) -> Result<Vec<Account>, String> {
    state.db.list_accounts()
}

#[tauri::command]
pub fn save_account(state: State<'_, AppState>, mut input: AccountInput) -> Result<Account, String> {
    validate_account(&input.account)?;
    let is_new = input.account.id.trim().is_empty();
    if is_new && input.imap_password.as_deref().unwrap_or_default().is_empty() {
        return Err("An IMAP password is required for a new account".into());
    }
    if is_new {
        input.account.id = Uuid::new_v4().to_string();
    }
    let id = input.account.id.clone();

    if let Some(password) = input.imap_password.as_deref().filter(|value| !value.is_empty()) {
        credentials::set_imap_password(&id, password)?;
    }
    if let Some(password) = input.smtp_password.as_deref().filter(|value| !value.is_empty()) {
        credentials::set_smtp_password(&id, password)?;
    } else if is_new {
        if let Some(password) = input.imap_password.as_deref().filter(|value| !value.is_empty()) {
            credentials::set_smtp_password(&id, password)?;
        }
    }

    state.db.save_account(&input.account)?;
    Ok(input.account)
}

#[tauri::command]
pub fn delete_account(state: State<'_, AppState>, account_id: String) -> Result<(), String> {
    state.db.delete_account(&account_id)?;
    credentials::delete_credentials(&account_id);
    Ok(())
}

#[tauri::command]
pub async fn test_account(input: AccountInput) -> Result<ConnectionTestResult, String> {
    validate_account(&input.account)?;
    let imap_password = password_for_test(&input.account.id, input.imap_password.as_deref(), true)?;
    let smtp_password = password_for_test(
        &input.account.id,
        input.smtp_password.as_deref().or(input.imap_password.as_deref()),
        false,
    )?;
    imap::test(&input.account, &imap_password).await?;
    smtp::test(&input.account, &smtp_password).await?;
    Ok(ConnectionTestResult { imap: true, smtp: true })
}

#[tauri::command]
pub async fn list_folders(state: State<'_, AppState>, account_id: String) -> Result<Vec<FolderInfo>, String> {
    let account = state.db.get_account(&account_id)?;
    let password = credentials::get_imap_password(&account_id)?;
    imap::list_folders(&account, &password).await
}

#[tauri::command]
pub async fn sync_folder(state: State<'_, AppState>, account_id: String, folder: String, limit: u32) -> Result<usize, String> {
    let account = state.db.get_account(&account_id)?;
    let password = credentials::get_imap_password(&account_id)?;
    imap::sync_folder(&state.db, &account, &password, &folder, limit).await
}

#[tauri::command]
pub fn list_messages(state: State<'_, AppState>, account_id: String, folder: String, query: String) -> Result<Vec<MessageSummary>, String> {
    state.db.list_messages(&account_id, &folder, &query)
}

#[tauri::command]
pub fn get_message(state: State<'_, AppState>, message_id: i64) -> Result<MessageDetail, String> {
    let stored = state.db.get_message_record(message_id)?;
    mime::message_detail(stored.summary, stored.cc, &stored.raw)
}

#[tauri::command]
pub async fn set_message_flag(
    state: State<'_, AppState>,
    account_id: String,
    folder: String,
    uid: u32,
    flag: String,
    enabled: bool,
) -> Result<(), String> {
    let account = state.db.get_account(&account_id)?;
    let password = credentials::get_imap_password(&account_id)?;
    let normalized = flag.trim_start_matches('\\');
    if !matches!(normalized, "Seen" | "Flagged" | "Answered" | "Draft") {
        return Err("Unsupported message flag".into());
    }
    let protocol_flag = format!("\\{normalized}");
    imap::set_flag(&account, &password, &folder, uid, &protocol_flag, enabled).await?;

    let mut flags = state.db.cached_flags(&account_id, &folder, uid)?;
    let normalized = normalized.to_string();
    flags.retain(|current| current.trim_start_matches('\\') != normalized);
    if enabled { flags.push(normalized); }
    state.db.set_cached_flags(&account_id, &folder, uid, &flags)?;
    Ok(())
}

#[tauri::command]
pub async fn move_message(
    state: State<'_, AppState>,
    account_id: String,
    folder: String,
    uid: u32,
    destination: String,
) -> Result<(), String> {
    let account = state.db.get_account(&account_id)?;
    let password = credentials::get_imap_password(&account_id)?;
    imap::move_message(&account, &password, &folder, uid, &destination).await?;
    state.db.remove_cached_message(&account_id, &folder, uid)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_message(state: State<'_, AppState>, account_id: String, folder: String, uid: u32) -> Result<(), String> {
    let account = state.db.get_account(&account_id)?;
    let password = credentials::get_imap_password(&account_id)?;
    if folder.eq_ignore_ascii_case(&account.trash_folder) {
        imap::permanently_delete(&account, &password, &folder, uid).await?;
    } else if imap::move_message(&account, &password, &folder, uid, &account.trash_folder).await.is_err() {
        let trash = imap::special_folder(&account, &password, "Trash")
            .await?
            .ok_or_else(|| format!("Trash folder '{}' was not found on the server", account.trash_folder))?;
        if folder.eq_ignore_ascii_case(&trash) {
            imap::permanently_delete(&account, &password, &folder, uid).await?;
        } else {
            imap::move_message(&account, &password, &folder, uid, &trash).await?;
        }
    }
    state.db.remove_cached_message(&account_id, &folder, uid)?;
    Ok(())
}

#[tauri::command]
pub async fn send_message(state: State<'_, AppState>, input: SendMessageInput) -> Result<(), String> {
    let account = state.db.get_account(&input.account_id)?;
    let smtp_password = credentials::get_smtp_password(&input.account_id)?;
    let raw = smtp::send(&account, &smtp_password, &input).await?;

    // SMTP has already accepted the message. A Sent-folder archive failure must never
    // make the caller retry the SMTP send and accidentally deliver a duplicate.
    if account.save_sent_copy {
        if let Ok(imap_password) = credentials::get_imap_password(&input.account_id) {
            let primary = imap::append(
                &account,
                &imap_password,
                &account.sent_folder,
                &raw,
                Some("(\\Seen)"),
            )
            .await;

            if primary.is_err() {
                if let Ok(Some(sent)) = imap::special_folder(&account, &imap_password, "Sent").await {
                    if !sent.eq_ignore_ascii_case(&account.sent_folder) {
                        let _ = imap::append(
                            &account,
                            &imap_password,
                            &sent,
                            &raw,
                            Some("(\\Seen)"),
                        )
                        .await;
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn save_attachment(state: State<'_, AppState>, message_id: i64, attachment_index: usize, path: String) -> Result<(), String> {
    let stored = state.db.get_message_record(message_id)?;
    let (_, bytes) = mime::attachment_bytes(&stored.raw, attachment_index)?;
    let destination = Path::new(&path);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(destination, bytes).map_err(|e| e.to_string())
}

fn validate_account(account: &Account) -> Result<(), String> {
    if account.email.trim().is_empty() || !account.email.contains('@') { return Err("A valid email address is required".into()); }
    if account.imap_host.trim().is_empty() || account.smtp_host.trim().is_empty() { return Err("IMAP and SMTP hostnames are required".into()); }
    if account.imap_port == 0 || account.smtp_port == 0 { return Err("IMAP and SMTP ports must be non-zero".into()); }
    if account.imap_username.trim().is_empty() || account.smtp_username.trim().is_empty() { return Err("IMAP and SMTP usernames are required".into()); }
    Ok(())
}

fn password_for_test(account_id: &str, supplied: Option<&str>, imap_password: bool) -> Result<String, String> {
    if let Some(value) = supplied.filter(|value| !value.is_empty()) { return Ok(value.to_string()); }
    if account_id.trim().is_empty() { return Err("A password is required to test a new account".into()); }
    if imap_password { credentials::get_imap_password(account_id) } else { credentials::get_smtp_password(account_id) }
}
