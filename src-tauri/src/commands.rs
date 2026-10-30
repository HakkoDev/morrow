use std::{fs, path::Path, time::Duration};

use tauri::State;
use uuid::Uuid;

use crate::{
    credentials,
    db::Database,
    imap, mime,
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
pub async fn save_account(state: State<'_, AppState>, mut input: AccountInput) -> Result<Account, String> {
    validate_account(&input.account)?;
    let is_new = input.account.id.trim().is_empty();
    // Important: authenticate with both servers BEFORE storing the account or
    // credentials. Failed Gmail/IMAP passwords must never create a ghost account.
    let imap_password = password_for_test(&input.account.id, input.imap_password.as_deref(), true)?;
    let smtp_password = password_for_test(
        &input.account.id,
        input
            .smtp_password
            .as_deref()
            .filter(|value| !value.is_empty())
            .or(if is_new { input.imap_password.as_deref() } else { None }),
        false,
    )?;
    tokio::time::timeout(Duration::from_secs(35), imap::test(&input.account, &imap_password))
        .await
        .map_err(|_| "IMAP connection test timed out. Account not saved.".to_string())??;
    tokio::time::timeout(Duration::from_secs(35), smtp::test(&input.account, &smtp_password))
        .await
        .map_err(|_| "SMTP connection test timed out. Account not saved.".to_string())??;

    if is_new {
        input.account.id = Uuid::new_v4().to_string();
    }
    let id = input.account.id.clone();
    // DB errors must not leave valid-looking new accounts in the UI.
    // A new keychain entry is removed if writing the account fails.
    credentials::set_imap_password(&id, &imap_password)?;
    if let Err(error) = credentials::set_smtp_password(&id, &smtp_password) {
        if is_new {
            credentials::delete_credentials(&id);
        }
        return Err(error);
    }
    if let Err(error) = state.db.save_account(&input.account) {
        if is_new {
            credentials::delete_credentials(&id);
        }
        return Err(error);
    }
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
    let smtp_password = password_for_test(&input.account.id, input.smtp_password.as_deref().or(input.imap_password.as_deref()), false)?;
    tokio::time::timeout(Duration::from_secs(35), imap::test(&input.account, &imap_password))
        .await
        .map_err(|_| "IMAP connection test timed out".to_string())??;
    tokio::time::timeout(Duration::from_secs(35), smtp::test(&input.account, &smtp_password))
        .await
        .map_err(|_| "SMTP connection test timed out".to_string())??;
    Ok(ConnectionTestResult { imap: true, smtp: true })
}

#[tauri::command]
pub async fn list_folders(state: State<'_, AppState>, account_id: String) -> Result<Vec<FolderInfo>, String> {
    let account = state.db.get_account(&account_id)?;
    let password = credentials::get_imap_password(&account_id)?;
    let folders = tokio::time::timeout(Duration::from_secs(45), imap::list_folders(&account, &password))
        .await
        .map_err(|_| "IMAP folder discovery timed out".to_string())??;
    state.db.cache_folders(&account_id, &folders)?;
    Ok(folders)
}

#[tauri::command]
pub fn cached_folders(state: State<'_, AppState>, account_id: String) -> Result<Vec<FolderInfo>, String> {
    state.db.cached_folders(&account_id)
}

#[tauri::command]
pub async fn create_folder(state: State<'_, AppState>, account_id: String, name: String) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() || name.len() > 255 || name.chars().any(|c| matches!(c, '\r' | '\n' | '\0')) || name.eq_ignore_ascii_case("inbox") {
        return Err("Enter a valid folder name (not INBOX).".into());
    }
    let account = state.db.get_account(&account_id)?;
    let password = credentials::get_imap_password(&account_id)?;
    tokio::time::timeout(Duration::from_secs(45), imap::create_folder(&account, &password, name))
        .await
        .map_err(|_| "Folder creation timed out; refresh folders before retrying".to_string())??;
    Ok(())
}

#[tauri::command]
pub async fn remove_folder(state: State<'_, AppState>, account_id: String, name: String) -> Result<(), String> {
    let account = state.db.get_account(&account_id)?;
    let folders = state.db.cached_folders(&account_id)?;
    let name = name.trim();
    if name.eq_ignore_ascii_case("inbox")
        || [account.sent_folder.as_str(), account.drafts_folder.as_str(), account.trash_folder.as_str()]
            .iter()
            .any(|item| item.eq_ignore_ascii_case(name))
        || folders.iter().any(|item| {
            item.name == name
                && item
                    .attributes
                    .iter()
                    .any(|attr| matches!(attr.as_str(), "Sent" | "Drafts" | "Trash" | "Junk" | "Archive"))
        })
    {
        return Err("Cannot remove a protected system folder.".into());
    }
    if !folders.iter().any(|item| item.name == name && item.selectable) {
        return Err("Folder not found in the cached listing. Refresh folders first.".into());
    }
    let password = credentials::get_imap_password(&account_id)?;
    tokio::time::timeout(Duration::from_secs(45), imap::remove_folder(&account, &password, name))
        .await
        .map_err(|_| "Folder deletion timed out; refresh folders before retrying".to_string())??;
    state.db.remove_folder_cache_data(&account_id, name)?;
    Ok(())
}

#[tauri::command]
pub fn save_message(state: State<'_, AppState>, account_id: String, message_id: i64, path: String) -> Result<(), String> {
    let stored = state.db.get_message_record(&account_id, message_id)?;
    let destination = Path::new(&path);
    if !destination.is_absolute()
        || destination
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| !ext.eq_ignore_ascii_case("eml"))
            .unwrap_or(true)
    {
        return Err("Choose an absolute .eml file path".into());
    }
    fs::write(destination, stored.raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_folder(state: State<'_, AppState>, account_id: String, folder: String, limit: u32) -> Result<usize, String> {
    let account = state.db.get_account(&account_id)?;
    let password = credentials::get_imap_password(&account_id)?;
    tokio::time::timeout(Duration::from_secs(120), imap::sync_folder(&state.db, &account, &password, &folder, limit))
        .await
        .map_err(|_| "IMAP folder synchronization timed out".to_string())?
}

#[tauri::command]
pub fn list_messages(state: State<'_, AppState>, account_id: String, folder: String, query: String) -> Result<Vec<MessageSummary>, String> {
    state.db.list_messages(&account_id, &folder, &query)
}

#[tauri::command]
pub fn get_message(state: State<'_, AppState>, account_id: String, message_id: i64) -> Result<MessageDetail, String> {
    let stored = state.db.get_message_record(&account_id, message_id)?;
    mime::message_detail(stored.summary, stored.cc, &stored.raw)
}

#[tauri::command]
pub async fn set_message_flag(state: State<'_, AppState>, account_id: String, folder: String, uid: u32, flag: String, enabled: bool) -> Result<(), String> {
    let account = state.db.get_account(&account_id)?;
    let password = credentials::get_imap_password(&account_id)?;
    let normalized = flag.trim_start_matches('\\');
    if !matches!(normalized, "Seen" | "Flagged" | "Answered" | "Draft") {
        return Err("Unsupported message flag".into());
    }
    let protocol_flag = format!("\\{normalized}");
    tokio::time::timeout(
        Duration::from_secs(45),
        imap::set_flag(&account, &password, &folder, uid, &protocol_flag, enabled),
    )
    .await
    .map_err(|_| "IMAP flag update timed out".to_string())??;

    let mut flags = state.db.cached_flags(&account_id, &folder, uid)?;
    let normalized = normalized.to_string();
    flags.retain(|current| current.trim_start_matches('\\') != normalized);
    if enabled {
        flags.push(normalized);
    }
    state.db.set_cached_flags(&account_id, &folder, uid, &flags)?;
    Ok(())
}

#[tauri::command]
pub async fn move_message(state: State<'_, AppState>, account_id: String, folder: String, uid: u32, destination: String) -> Result<(), String> {
    let account = state.db.get_account(&account_id)?;
    let password = credentials::get_imap_password(&account_id)?;
    tokio::time::timeout(Duration::from_secs(50), imap::move_message(&account, &password, &folder, uid, &destination))
        .await
        .map_err(|_| "IMAP move timed out; check the destination before retrying".to_string())??;
    state.db.remove_cached_message(&account_id, &folder, uid)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_message(state: State<'_, AppState>, account_id: String, folder: String, uid: u32) -> Result<(), String> {
    let account = state.db.get_account(&account_id)?;
    let password = credentials::get_imap_password(&account_id)?;
    // Resolve the Trash destination *before* moving. Retrying a failed MOVE
    // against another folder can duplicate mail when the first move succeeded
    // on the server but its network response was lost.
    let target = tokio::time::timeout(Duration::from_secs(45), imap::list_folders(&account, &password))
        .await
        .map_err(|_| "IMAP Trash discovery timed out".to_string())??;
    let trash = target
        .iter()
        .find(|item| item.selectable && item.name.eq_ignore_ascii_case(&account.trash_folder))
        .or_else(|| {
            target
                .iter()
                .find(|item| item.selectable && item.attributes.iter().any(|attr| attr.eq_ignore_ascii_case("Trash")))
        })
        .map(|item| item.name.clone())
        .ok_or_else(|| "No selectable Trash folder was found; configure one in account settings".to_string())?;
    if folder.eq_ignore_ascii_case(&trash) {
        tokio::time::timeout(Duration::from_secs(50), imap::permanently_delete(&account, &password, &folder, uid))
            .await
            .map_err(|_| "IMAP permanent deletion timed out; check server state before retrying".to_string())??;
    } else {
        tokio::time::timeout(Duration::from_secs(50), imap::move_message(&account, &password, &folder, uid, &trash))
            .await
            .map_err(|_| "Moving to Trash timed out; check destination before retrying".to_string())??;
    }
    state.db.remove_cached_message(&account_id, &folder, uid)?;
    Ok(())
}

#[tauri::command]
pub async fn send_message(state: State<'_, AppState>, input: SendMessageInput) -> Result<(), String> {
    let account = state.db.get_account(&input.account_id)?;
    let smtp_password = credentials::get_smtp_password(&input.account_id)?;
    let raw = tokio::time::timeout(Duration::from_secs(90), smtp::send(&account, &smtp_password, &input))
        .await
        .map_err(|_| "SMTP send timed out; delivery status is unknown. Check Sent before retrying to avoid duplicates.".to_string())??;

    // SMTP has already accepted the message. A Sent-folder archive failure must never
    // make the caller retry the SMTP send and accidentally deliver a duplicate.
    if account.save_sent_copy {
        if let Ok(imap_password) = credentials::get_imap_password(&input.account_id) {
            let primary = imap::append(&account, &imap_password, &account.sent_folder, &raw, Some("(\\Seen)")).await;

            if primary.is_err() {
                if let Ok(Some(sent)) = imap::special_folder(&account, &imap_password, "Sent").await {
                    if !sent.eq_ignore_ascii_case(&account.sent_folder) {
                        let _ = imap::append(&account, &imap_password, &sent, &raw, Some("(\\Seen)")).await;
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn save_attachment(state: State<'_, AppState>, account_id: String, message_id: i64, attachment_index: usize, path: String) -> Result<(), String> {
    let stored = state.db.get_message_record(&account_id, message_id)?;
    let (_, bytes) = mime::attachment_bytes(&stored.raw, attachment_index)?;
    let destination = Path::new(&path);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(destination, bytes).map_err(|e| e.to_string())
}

fn validate_account(account: &Account) -> Result<(), String> {
    if account.email.trim().is_empty() || !account.email.contains('@') {
        return Err("A valid email address is required".into());
    }
    if account.imap_host.trim().is_empty() || account.smtp_host.trim().is_empty() {
        return Err("IMAP and SMTP hostnames are required".into());
    }
    if account.imap_port == 0 || account.smtp_port == 0 {
        return Err("IMAP and SMTP ports must be non-zero".into());
    }
    if account.imap_username.trim().is_empty() || account.smtp_username.trim().is_empty() {
        return Err("IMAP and SMTP usernames are required".into());
    }
    Ok(())
}

fn password_for_test(account_id: &str, supplied: Option<&str>, imap_password: bool) -> Result<String, String> {
    if let Some(value) = supplied.filter(|value| !value.is_empty()) {
        return Ok(value.to_string());
    }
    if account_id.trim().is_empty() {
        return Err("A password is required to test a new account".into());
    }
    if imap_password {
        credentials::get_imap_password(account_id)
    } else {
        credentials::get_smtp_password(account_id)
    }
}
