use keyring::v1::Entry;

const SERVICE: &str = "morrow-mail";

fn entry(account_id: &str, kind: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, &format!("{}:{}", kind, account_id)).map_err(|e| e.to_string())
}

pub fn set_imap_password(account_id: &str, password: &str) -> Result<(), String> {
    entry(account_id, "imap")?.set_password(password).map_err(|e| e.to_string())
}

pub fn set_smtp_password(account_id: &str, password: &str) -> Result<(), String> {
    entry(account_id, "smtp")?.set_password(password).map_err(|e| e.to_string())
}

pub fn get_imap_password(account_id: &str) -> Result<String, String> {
    entry(account_id, "imap")?
        .get_password()
        .map_err(|e| format!("No IMAP credential is stored for this account: {e}"))
}

pub fn get_smtp_password(account_id: &str) -> Result<String, String> {
    entry(account_id, "smtp")?
        .get_password()
        .map_err(|e| format!("No SMTP credential is stored for this account: {e}"))
}

pub fn delete_passwords(account_id: &str) {
    if let Ok(item) = entry(account_id, "imap") {
        let _ = item.delete_credential();
    }
    if let Ok(item) = entry(account_id, "smtp") {
        let _ = item.delete_credential();
    }
}

pub fn delete_credentials(account_id: &str) {
    if let Ok(item) = entry(account_id, "imap") {
        let _ = item.delete_credential();
    }
    if let Ok(item) = entry(account_id, "smtp") {
        let _ = item.delete_credential();
    }
    crate::oauth::delete_tokens(account_id);
}
