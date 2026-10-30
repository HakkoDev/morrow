//! OAuth2 authorization-code + PKCE for public desktop clients. No client secret,
//! access token, or refresh token is sent to the webview or SQLite.
use std::{
    collections::HashMap,
    sync::OnceLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use keyring::v1::Entry;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri_plugin_opener::OpenerExt;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::Mutex,
};
use url::Url;

use crate::models::{Account, SecurityMode};

const KEYCHAIN_SERVICE: &str = "morrow-mail";
const TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Clone)]
pub struct PendingAuth {
    pub email: String,
    pub provider: String,
    pub client_id: String,
    pub stored: StoredTokens,
    pub created: u64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct StoredTokens {
    pub refresh_token: String,
    pub access_token: String,
    pub expires_at: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default = "default_expires")]
    expires_in: u64,
}
fn default_expires() -> u64 {
    3600
}

fn validate_tokens(tokens: &TokenResponse) -> Result<(), String> {
    let valid_token = |value: &str| !value.is_empty() && value.len() <= 16384 && !value.chars().any(char::is_control);
    if !valid_token(&tokens.access_token)
        || tokens.refresh_token.as_deref().is_some_and(|value| !valid_token(value))
        || tokens.expires_in == 0
        || tokens.expires_in > 366 * 24 * 60 * 60
    {
        return Err("OAuth token server returned invalid credentials or expiration".into());
    }
    Ok(())
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn callback_result(raw: &str, host: &str, state: &str) -> Option<Result<String, String>> {
    let first = raw.lines().next()?;
    let path = first.strip_prefix("GET ")?.split_once(" HTTP/1.")?.0;
    if !path.starts_with('/') || path.contains('#') {
        return None;
    }
    let hosts = raw
        .lines()
        .skip(1)
        .filter_map(|line| line.split_once(':'))
        .filter(|(name, _)| name.eq_ignore_ascii_case("Host"))
        .collect::<Vec<_>>();
    let correct_host = hosts.len() == 1 && hosts[0].1.trim().eq_ignore_ascii_case(host);
    let parsed = Url::parse(&format!("http://localhost{path}")).ok()?;
    let valid_path = parsed.path() == "/callback";
    let pairs = parsed.query_pairs().into_owned().collect::<Vec<_>>();
    if pairs.iter().filter(|(key, _)| key == "state").count() != 1 || pairs.iter().filter(|(key, _)| key == "code").count() > 1 {
        return None;
    }
    let query = pairs.into_iter().collect::<HashMap<_, _>>();
    let valid_state = query.get("state").is_some_and(|value| value == state);
    let authorized = correct_host && valid_path && valid_state;
    if !authorized {
        return None;
    }
    Some(
        match query
            .get("code")
            .filter(|code| !code.is_empty() && code.len() <= 4096 && !query.contains_key("error"))
        {
            Some(code) => Ok(code.clone()),
            None => Err("OAuth authorization cancelled or denied".into()),
        },
    )
}

fn config(provider: &str) -> Result<(&'static str, &'static str, &'static str), String> {
    match provider {
        "google" => Ok((
            "https://accounts.google.com/o/oauth2/v2/auth",
            "https://oauth2.googleapis.com/token",
            "https://mail.google.com/",
        )),
        "microsoft" => Ok((
            "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            "offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send",
        )),
        _ => Err("Select Google or Microsoft to use OAuth2".into()),
    }
}

fn public_client_id(account: &Account) -> Result<String, String> {
    let env_id = match account.auth_method.as_str() {
        "google" => option_env!("MORROW_GOOGLE_CLIENT_ID"),
        "microsoft" => option_env!("MORROW_MICROSOFT_CLIENT_ID"),
        _ => None,
    };
    let id = if account.oauth_client_id.trim().is_empty() {
        env_id.unwrap_or("")
    } else {
        account.oauth_client_id.trim()
    };
    if id.is_empty() || id.len() > 256 || !id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
        return Err("OAuth application client ID is missing or invalid. Register a public desktop OAuth application and enter its client ID.".into());
    }
    Ok(id.to_string())
}

/// Protect bearer tokens from exfiltration through user-specified mail hosts.
/// TLS is mandatory for XOAUTH2, even if the user previously allowed plaintext passwords.
pub fn validate_oauth_account(account: &Account) -> Result<(), String> {
    if account.auth_method == "password" {
        return Ok(());
    }
    config(&account.auth_method)?;
    let _ = public_client_id(account)?;
    if matches!(account.imap_security, SecurityMode::Plain) || matches!(account.smtp_security, SecurityMode::Plain) {
        return Err("OAuth2 requires encrypted IMAP and SMTP connections".into());
    }
    let imap_ok = match account.auth_method.as_str() {
        "google" => account.imap_host.eq_ignore_ascii_case("imap.gmail.com") && account.imap_port == 993 && matches!(account.imap_security, SecurityMode::Tls),
        "microsoft" => {
            account.imap_host.eq_ignore_ascii_case("outlook.office365.com") && account.imap_port == 993 && matches!(account.imap_security, SecurityMode::Tls)
        }
        _ => false,
    };
    let smtp_ok = match account.auth_method.as_str() {
        "google" => {
            account.smtp_host.eq_ignore_ascii_case("smtp.gmail.com")
                && ((account.smtp_port == 465 && matches!(account.smtp_security, SecurityMode::Tls))
                    || (account.smtp_port == 587 && matches!(account.smtp_security, SecurityMode::StartTls)))
        }
        "microsoft" => {
            (account.smtp_host.eq_ignore_ascii_case("smtp.office365.com") || account.smtp_host.eq_ignore_ascii_case("smtp-mail.outlook.com"))
                && account.smtp_port == 587
                && matches!(account.smtp_security, SecurityMode::StartTls)
        }
        _ => false,
    };
    if !imap_ok || !smtp_ok {
        return Err("OAuth2 requires the official provider IMAP/SMTP servers with their secure ports. Apply the provider preset first.".into());
    }
    if !account.imap_username.eq_ignore_ascii_case(&account.email) || !account.smtp_username.eq_ignore_ascii_case(&account.email) {
        return Err("For OAuth2, the IMAP and SMTP usernames must match the email address".into());
    }
    Ok(())
}

fn token_entry(account_id: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, &format!("oauth:{account_id}")).map_err(|e| e.to_string())
}

pub fn save_tokens(account_id: &str, tokens: &StoredTokens) -> Result<(), String> {
    token_entry(account_id)?
        .set_password(&serde_json::to_string(tokens).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Could not store OAuth tokens in OS credential vault: {e}"))
}

pub fn delete_tokens(account_id: &str) {
    if let Ok(entry) = token_entry(account_id) {
        let _ = entry.delete_credential();
    }
}

pub async fn token_for(account: &Account) -> Result<String, String> {
    validate_oauth_account(account)?;
    // Serialize refresh-token rotation across parallel IDLE, polling and foreground jobs.
    static TOKEN_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let _guard = TOKEN_LOCK.get_or_init(|| Mutex::new(())).lock().await;
    let serialized = token_entry(&account.id)?
        .get_password()
        .map_err(|_| "OAuth sign-in is required. Reconnect this account in Settings.".to_string())?;
    let mut stored: StoredTokens =
        serde_json::from_str(&serialized).map_err(|_| "Invalid stored OAuth credentials; please reconnect the account".to_string())?;
    if stored.expires_at <= now().saturating_add(90) {
        let refreshed = exchange(
            &account.auth_method,
            &public_client_id(account)?,
            &[("grant_type", "refresh_token"), ("refresh_token", stored.refresh_token.as_str())],
        )
        .await?;
        if let Some(rotated) = refreshed.refresh_token {
            stored.refresh_token = rotated;
        }
        stored.access_token = refreshed.access_token;
        stored.expires_at = now().saturating_add(refreshed.expires_in);
        save_tokens(&account.id, &stored)?;
    }
    Ok(stored.access_token)
}

pub async fn secret(account: &Account, imap: bool) -> Result<String, String> {
    if account.auth_method == "password" {
        if imap {
            crate::credentials::get_imap_password(&account.id)
        } else {
            crate::credentials::get_smtp_password(&account.id)
        }
    } else {
        token_for(account).await
    }
}

async fn exchange(provider: &str, client_id: &str, parameters: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let (_, endpoint, _) = config(provider)?;
    let mut form = vec![("client_id", client_id)];
    form.extend_from_slice(parameters);
    let mut response = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|_| "Could not initialize OAuth HTTPS transport".to_string())?
        .post(endpoint)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("OAuth token server could not be reached: {e}"))?;
    if !response.status().is_success() {
        // Do not expose server response bodies: they may contain token or account information.
        return Err(format!(
            "OAuth token request rejected (HTTP {}). Please reauthorize or check application registration.",
            response.status().as_u16()
        ));
    }
    // Token endpoints are trusted destinations, but response allocation is still bounded.
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Could not read OAuth token response")? {
        if body.len() + chunk.len() > 65536 {
            return Err("OAuth token response exceeds the size limit".into());
        }
        body.extend_from_slice(&chunk);
    }
    let tokens: TokenResponse = serde_json::from_slice(&body).map_err(|_| "OAuth token server returned an invalid response")?;
    validate_tokens(&tokens)?;
    Ok(tokens)
}

/// One browser authorization at a time per command, with an OS-assigned
/// loopback port, CSRF state and S256 PKCE challenge. No redirect server is exposed
/// to the LAN, and callbacks are accepted only on this listener.
pub async fn authorize(app: &tauri::AppHandle, account: &Account) -> Result<PendingAuth, String> {
    validate_oauth_account(account)?;
    let client_id = public_client_id(account)?;
    let (authorization_endpoint, _, scope) = config(&account.auth_method)?;
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Could not open local OAuth callback: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let hostname = if account.auth_method == "microsoft" { "localhost" } else { "127.0.0.1" };
    let redirect = format!("http://{hostname}:{port}/callback");
    let verifier = format!(
        "{}{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let mut url = Url::parse(authorization_endpoint).map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", &redirect)
        .append_pair("scope", scope)
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("login_hint", &account.email);
    if account.auth_method == "google" {
        url.query_pairs_mut().append_pair("access_type", "offline").append_pair("prompt", "consent");
    }
    // Only Rust can open this URL; the webview gets no arbitrary URL opener privilege.
    app.opener()
        .open_url(url.to_string(), None::<&str>)
        .map_err(|e| format!("Could not launch system browser: {e}"))?;

    let code = tokio::time::timeout(TIMEOUT, async {
        loop {
            let (mut stream, peer) = listener.accept().await.map_err(|e| e.to_string())?;
            if !peer.ip().is_loopback() { continue; }
            // TCP reads may split the request. Bound both header size and time;
            // an unrelated local connection must not abort a valid browser flow.
            let request = tokio::time::timeout(Duration::from_secs(5), async {
                let mut bytes = Vec::new();
                while bytes.len() < 8192 {
                    let mut chunk = [0u8; 1024];
                    let size = stream.read(&mut chunk).await?;
                    if size == 0 { break; }
                    bytes.extend_from_slice(&chunk[..size]);
                    if bytes.windows(4).any(|part| part == b"\r\n\r\n") { return Ok::<_, std::io::Error>(Some(bytes)); }
                }
                Ok(None)
            }).await;
            let Ok(Ok(Some(bytes))) = request else { continue };
            let raw = String::from_utf8_lossy(&bytes);
            let result = callback_result(&raw, &format!("{hostname}:{port}"), &state);
            let authorized = result.is_some();
            let success = result.as_ref().is_some_and(Result::is_ok);
            let response = if success { "Authorization received. Return to Morrow to finish connecting your account." }
                else if authorized { "Authorization was declined. Return to Morrow." }
                else { "Invalid authorization callback." };
            let status = if authorized { "200 OK" } else { "400 Bad Request" };
            let body = format!("<!doctype html><html><head><meta charset=\"utf-8\"></head><body><p>{response}</p></body></html>");
            let http = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Security-Policy: default-src 'none'\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len());
            let _ = tokio::time::timeout(Duration::from_secs(2), stream.write_all(http.as_bytes())).await;
            if let Some(result) = result { return result; }
        }
    }).await.map_err(|_| "OAuth authorization timed out after three minutes".to_string())??;

    let tokens = exchange(
        &account.auth_method,
        &client_id,
        &[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &redirect),
            ("code_verifier", &verifier),
        ],
    )
    .await?;
    let refresh_token = tokens
        .refresh_token
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "OAuth provider did not issue a refresh token. Reauthorize and grant offline access.".to_string())?;
    Ok(PendingAuth {
        email: account.email.clone(),
        provider: account.auth_method.clone(),
        client_id,
        stored: StoredTokens {
            refresh_token,
            access_token: tokens.access_token,
            expires_at: now().saturating_add(tokens.expires_in),
        },
        created: now(),
    })
}

pub fn validate_pending(pending: &PendingAuth, account: &Account) -> Result<(), String> {
    if pending.created.saturating_add(600) < now()
        || pending.email != account.email
        || pending.provider != account.auth_method
        || pending.client_id != public_client_id(account)?
    {
        return Err("This OAuth authorization has expired or belongs to a different account. Sign in again.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn callback(target: &str, headers: &str) -> String {
        format!("GET {target} HTTP/1.1\r\n{headers}\r\n\r\n")
    }

    #[test]
    fn callback_requires_unique_host_state_and_code() {
        let host = "127.0.0.1:4321";
        let headers = format!("Host: {host}");
        let valid = callback("/callback?state=secret&code=a%2Bb", &headers);
        assert_eq!(callback_result(&valid, host, "secret"), Some(Ok("a+b".into())));
        for target in [
            "/callback?state=wrong&code=a",
            "/other?state=secret&code=a",
            "/callback?state=secret&state=secret&code=a",
            "/callback?state=secret&code=a&code=b",
            "http://localhost/callback?state=secret&code=a",
            "/callback?state=secret&code=a#fragment",
        ] {
            assert!(callback_result(&callback(target, &headers), host, "secret").is_none(), "{target}");
        }
        assert!(callback_result(&valid, "localhost:4321", "secret").is_none());
        assert!(callback_result(&callback("/callback?state=secret&code=a", &format!("{headers}\r\n{headers}")), host, "secret").is_none());
        for query in ["state=secret&error=access_denied", "state=secret&code=", "state=secret&code=a&error=denied"] {
            assert!(callback_result(&callback(&format!("/callback?{query}"), &headers), host, "secret")
                .unwrap()
                .is_err());
        }
    }

    #[test]
    fn token_response_rejects_invalid_values_and_expiration() {
        let mut tokens = TokenResponse {
            access_token: "access".into(),
            refresh_token: Some("refresh".into()),
            expires_in: 3600,
        };
        assert!(validate_tokens(&tokens).is_ok());
        for expiration in [0, u64::MAX] {
            tokens.expires_in = expiration;
            assert!(validate_tokens(&tokens).is_err());
        }
        tokens.expires_in = 3600;
        for access in ["".to_string(), "secret\r\n".into(), "a".repeat(16385)] {
            tokens.access_token = access;
            assert!(validate_tokens(&tokens).is_err());
        }
        tokens.access_token = "access".into();
        tokens.refresh_token = Some(String::new());
        assert!(validate_tokens(&tokens).is_err());
    }
    #[test]
    fn providers_and_scopes_are_locked_down() {
        assert!(config("example").is_err());
        assert!(config("google").unwrap().2.contains("mail.google.com"));
        assert!(config("microsoft").unwrap().2.contains("SMTP.Send"));
    }
    #[test]
    fn pkce_s256_is_url_safe() {
        let encoded = URL_SAFE_NO_PAD.encode(Sha256::digest(b"test verifier"));
        assert_eq!(encoded.len(), 43);
        assert!(!encoded.contains('+'));
    }
}
