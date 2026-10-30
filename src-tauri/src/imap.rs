use std::{fmt::Debug, pin::Pin, time::Duration};

use async_imap::{
    types::{Flag, NameAttribute},
    Client, Session,
};
use futures::TryStreamExt;
use tokio::{
    io::{AsyncRead, AsyncWrite},
    net::TcpStream,
};
use tokio_native_tls::TlsConnector;

use crate::{
    db::Database,
    mime::cache_message,
    models::{Account, FolderInfo, SecurityMode},
};

pub trait MailStream: AsyncRead + AsyncWrite + Unpin + Send + Debug {}
impl<T> MailStream for T where T: AsyncRead + AsyncWrite + Unpin + Send + Debug {}
type DynStream = Pin<Box<dyn MailStream>>;

struct XOAuth2 {
    username: String,
    token: String,
    responded: bool,
}
impl async_imap::Authenticator for XOAuth2 {
    type Response = String;
    fn process(&mut self, _: &[u8]) -> Self::Response {
        // RFC 7628: after an OAuth error challenge, respond with an empty
        // payload rather than repeatedly disclosing the same bearer token.
        if self.responded {
            return String::new();
        }
        self.responded = true;
        format!("user={}\x01auth=Bearer {}\x01\x01", self.username, self.token)
    }
}

pub async fn connect(account: &Account, password: &str) -> Result<Session<DynStream>, String> {
    // Without a connection deadline a dead endpoint can block manual account setup forever.
    let tcp = tokio::time::timeout(Duration::from_secs(15), TcpStream::connect((account.imap_host.as_str(), account.imap_port)))
        .await
        .map_err(|_| "IMAP connection timed out after 15 seconds".to_string())?
        .map_err(|e| format!("IMAP TCP connection failed: {e}"))?;

    let tls = TlsConnector::from(native_tls::TlsConnector::builder().build().map_err(|e| e.to_string())?);

    let (stream, needs_greeting): (DynStream, bool) = match account.imap_security {
        SecurityMode::Tls => {
            let stream = tls.connect(&account.imap_host, tcp).await.map_err(|e| format!("IMAP TLS failed: {e}"))?;
            (Box::pin(stream), true)
        }
        SecurityMode::StartTls => {
            let mut client = Client::new(tcp);
            client
                .read_response()
                .await
                .map_err(|e| format!("IMAP greeting failed: {e}"))?
                .ok_or_else(|| "IMAP server closed before greeting".to_string())?;
            client
                .run_command_and_check_ok("STARTTLS", None)
                .await
                .map_err(|e| format!("IMAP STARTTLS failed: {e}"))?;
            let tcp = client.into_inner();
            let stream = tls
                .connect(&account.imap_host, tcp)
                .await
                .map_err(|e| format!("IMAP STARTTLS handshake failed: {e}"))?;
            (Box::pin(stream), false)
        }
        SecurityMode::Plain => (Box::pin(tcp), true),
    };

    let mut client = Client::new(stream);
    if needs_greeting {
        client
            .read_response()
            .await
            .map_err(|e| format!("IMAP greeting failed: {e}"))?
            .ok_or_else(|| "IMAP server closed before greeting".to_string())?;
    }

    if account.auth_method == "password" {
        client
            .login(&account.imap_username, password)
            .await
            .map_err(|(e, _)| format!("IMAP authentication failed: {e}"))
    } else {
        client
            .authenticate(
                "XOAUTH2",
                XOAuth2 {
                    username: account.imap_username.clone(),
                    token: password.to_owned(),
                    responded: false,
                },
            )
            .await
            .map_err(|(e, _)| format!("IMAP OAuth2 authentication failed: {e}"))
    }
}

/// Wait for a server-side INBOX change. This is one bounded IDLE cycle on a
/// dedicated connection, never the connection used by foreground commands.
/// Unsupported IDLE and any network failure are handled by the caller's
/// existing periodic polling fallback.
pub async fn idle_inbox_once(account: &Account, password: &str) -> Result<bool, String> {
    tokio::time::timeout(Duration::from_secs(180), idle_inbox_cycle(account, password))
        .await
        .map_err(|_| "IMAP IDLE session timed out".to_string())?
}

async fn idle_inbox_cycle(account: &Account, password: &str) -> Result<bool, String> {
    use async_imap::extensions::idle::IdleResponse;
    let mut session = connect(account, password).await?;
    let caps = session.capabilities().await.map_err(|e| e.to_string())?;
    if !caps.has_str("IDLE") {
        return Err("IMAP IDLE not supported; using polling".into());
    }
    session.select("INBOX").await.map_err(|e| format!("IDLE select failed: {e}"))?;
    let mut idle = session.idle();
    tokio::time::timeout(Duration::from_secs(20), idle.init())
        .await
        .map_err(|_| "IMAP IDLE start timed out".to_string())?
        .map_err(|e| e.to_string())?;
    // Bounded cycles prevent hanging connections, and allow account removal
    // to stop a watcher without retaining credentials indefinitely.
    let result = {
        let (response, _interrupt) = idle.wait_with_timeout(Duration::from_secs(110));
        tokio::time::timeout(Duration::from_secs(125), response)
            .await
            .map_err(|_| "IMAP IDLE wait timed out".to_string())?
            .map_err(|e| e.to_string())?
    };
    // Finish IDLE with DONE before reusing or closing the session.
    let mut session = tokio::time::timeout(Duration::from_secs(15), idle.done())
        .await
        .map_err(|_| "IMAP IDLE DONE timed out".to_string())?
        .map_err(|e| e.to_string())?;
    let _ = tokio::time::timeout(Duration::from_secs(5), session.logout()).await;
    Ok(matches!(result, IdleResponse::NewData(_)))
}

pub async fn test(account: &Account, password: &str) -> Result<(), String> {
    let mut session = connect(account, password).await?;
    session.noop().await.map_err(|e| e.to_string())?;
    session.logout().await.map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn list_folders(account: &Account, password: &str) -> Result<Vec<FolderInfo>, String> {
    let mut session = connect(account, password).await?;
    let folders = {
        let stream = session.list(None, Some("*")).await.map_err(|e| e.to_string())?;
        stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?
    };
    let mut output = folders
        .into_iter()
        .map(|folder| {
            let selectable = !folder.attributes().iter().any(|attribute| matches!(attribute, &NameAttribute::NoSelect));
            FolderInfo {
                name: folder.name().to_string(),
                delimiter: folder.delimiter().map(ToString::to_string),
                attributes: folder.attributes().iter().map(attribute_name).collect(),
                selectable,
            }
        })
        .collect::<Vec<_>>();
    output.sort_by(|a, b| {
        folder_rank(a)
            .cmp(&folder_rank(b))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    let _ = session.logout().await;
    Ok(output)
}

pub async fn create_folder(account: &Account, password: &str, name: &str) -> Result<(), String> {
    let mut session = connect(account, password).await?;
    session.create(name).await.map_err(|e| format!("Could not create folder: {e}"))?;
    let _ = session.logout().await;
    Ok(())
}

pub async fn remove_folder(account: &Account, password: &str, name: &str) -> Result<(), String> {
    let mut session = connect(account, password).await?;
    session.delete(name).await.map_err(|e| format!("Could not delete folder: {e}"))?;
    let _ = session.logout().await;
    Ok(())
}

pub async fn special_folder(account: &Account, password: &str, attribute: &str) -> Result<Option<String>, String> {
    let folders = list_folders(account, password).await?;
    Ok(folders
        .into_iter()
        .find(|folder| folder.selectable && folder.attributes.iter().any(|value| value.eq_ignore_ascii_case(attribute)))
        .map(|folder| folder.name))
}

pub async fn sync_folder(db: &Database, account: &Account, password: &str, folder: &str, limit: u32) -> Result<usize, String> {
    let mut session = connect(account, password).await?;
    let mailbox = session.select(folder).await.map_err(|e| format!("Could not select {folder}: {e}"))?;
    db.prepare_folder_sync(&account.id, folder, mailbox.uid_validity)?;

    let server_uids = session.uid_search("ALL").await.map_err(|e| e.to_string())?;
    db.prune_missing_uids(&account.id, folder, &server_uids)?;
    if server_uids.is_empty() {
        let _ = session.logout().await;
        return Ok(0);
    }

    let limit = limit.clamp(1, 1000) as usize;
    let mut target_uids = server_uids.iter().copied().collect::<Vec<_>>();
    target_uids.sort_unstable();
    if target_uids.len() > limit {
        target_uids.drain(..target_uids.len() - limit);
    }

    let uid_set = target_uids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    let metadata = {
        let stream = session.uid_fetch(&uid_set, "(UID FLAGS)").await.map_err(|e| e.to_string())?;
        stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?
    };

    let mut missing = Vec::new();
    for fetch in metadata {
        let Some(uid) = fetch.uid else { continue };
        let flags = fetch.flags().map(|flag| flag_name(&flag)).collect::<Vec<_>>();
        if db.has_cached_message(&account.id, folder, uid)? {
            db.set_cached_flags(&account.id, folder, uid, &flags)?;
        } else {
            missing.push(uid);
        }
    }

    let mut synced = 0usize;
    if !missing.is_empty() {
        let missing_set = missing.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
        let messages = {
            let stream = session.uid_fetch(&missing_set, "(UID FLAGS BODY.PEEK[])").await.map_err(|e| e.to_string())?;
            stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?
        };

        for fetch in messages {
            let Some(uid) = fetch.uid else { continue };
            let Some(raw) = fetch.body() else { continue };
            let flags = fetch.flags().map(|flag| flag_name(&flag)).collect::<Vec<_>>();
            if let Ok(parsed) = cache_message(raw, &account.id, folder, uid, flags) {
                db.upsert_message(&parsed)?;
                synced += 1;
            }
        }
    }

    let _ = session.logout().await;
    Ok(synced)
}

pub async fn set_flag(account: &Account, password: &str, folder: &str, uid: u32, flag: &str, enabled: bool) -> Result<(), String> {
    let mut session = connect(account, password).await?;
    session.select(folder).await.map_err(|e| e.to_string())?;
    let operation = if enabled { "+FLAGS.SILENT" } else { "-FLAGS.SILENT" };
    let query = format!("{operation} ({flag})");
    {
        let stream = session.uid_store(uid.to_string(), query).await.map_err(|e| e.to_string())?;
        stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?;
    }
    // The requested mutation already succeeded. A failed LOGOUT must not
    // invite the caller to repeat a potentially non-idempotent action.
    let _ = session.logout().await;
    Ok(())
}

/// Move exactly one UID. Never run mailbox-wide EXPUNGE as a fallback: it can
/// delete unrelated messages that another client has flagged as \Deleted.
pub async fn move_message(account: &Account, password: &str, folder: &str, uid: u32, destination: &str) -> Result<(), String> {
    if folder.eq_ignore_ascii_case(destination) {
        return Err("Source and destination folders are the same".into());
    }
    let mut session = connect(account, password).await?;
    session.select(folder).await.map_err(|e| e.to_string())?;
    let caps = session.capabilities().await.map_err(|e| e.to_string())?;
    if caps.has_str("MOVE") {
        // If an advertised MOVE fails, do not blindly copy and risk duplicates.
        session.uid_mv(uid.to_string(), destination).await.map_err(|e| e.to_string())?;
    } else if caps.has_str("UIDPLUS") {
        session
            .uid_copy(uid.to_string(), destination)
            .await
            .map_err(|e| format!("IMAP copy failed: {e}"))?;
        {
            let stream = session
                .uid_store(uid.to_string(), "+FLAGS.SILENT (\\Deleted)")
                .await
                .map_err(|e| format!("Message copied, but marking the original deleted failed: {e}. Check destination before retrying."))?;
            stream
                .try_collect::<Vec<_>>()
                .await
                .map_err(|e| format!("Message copied, but deletion failed: {e}. Check destination before retrying."))?;
        }
        {
            let stream = session
                .uid_expunge(uid.to_string())
                .await
                .map_err(|e| format!("Message copied, but UID-scoped expunge failed: {e}. Check destination before retrying."))?;
            stream
                .try_collect::<Vec<_>>()
                .await
                .map_err(|e| format!("Message copied, but UID-scoped expunge failed: {e}. Check destination before retrying."))?;
        }
    } else {
        return Err(
            "This IMAP server supports neither MOVE nor UIDPLUS. Morrow will not use unsafe mailbox-wide EXPUNGE; move the message in another client.".into(),
        );
    }
    // The requested mutation already succeeded. A failed LOGOUT must not
    // invite the caller to repeat a potentially non-idempotent action.
    let _ = session.logout().await;
    Ok(())
}

/// Permanent deletion is deliberately restricted to UIDPLUS servers. Normal
/// EXPUNGE would remove *every* deleted message in this folder.
pub async fn permanently_delete(account: &Account, password: &str, folder: &str, uid: u32) -> Result<(), String> {
    let mut session = connect(account, password).await?;
    session.select(folder).await.map_err(|e| e.to_string())?;
    let caps = session.capabilities().await.map_err(|e| e.to_string())?;
    if !caps.has_str("UIDPLUS") {
        return Err("Safe permanent deletion requires IMAP UIDPLUS. No messages were deleted.".into());
    }
    {
        let stream = session
            .uid_store(uid.to_string(), "+FLAGS.SILENT (\\Deleted)")
            .await
            .map_err(|e| e.to_string())?;
        stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?;
    }
    {
        let stream = session.uid_expunge(uid.to_string()).await.map_err(|e| e.to_string())?;
        stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?;
    }
    // The requested mutation already succeeded. A failed LOGOUT must not
    // invite the caller to repeat a potentially non-idempotent action.
    let _ = session.logout().await;
    Ok(())
}

pub async fn append(account: &Account, password: &str, folder: &str, raw: &[u8], flags: Option<&str>) -> Result<(), String> {
    let mut session = connect(account, password).await?;
    session
        .append(folder, flags, None, raw)
        .await
        .map_err(|e| format!("Could not append message to {folder}: {e}"))?;
    // The requested mutation already succeeded. A failed LOGOUT must not
    // invite the caller to repeat a potentially non-idempotent action.
    let _ = session.logout().await;
    Ok(())
}

fn flag_name(flag: &Flag<'_>) -> String {
    match flag {
        Flag::Seen => "Seen".into(),
        Flag::Answered => "Answered".into(),
        Flag::Flagged => "Flagged".into(),
        Flag::Deleted => "Deleted".into(),
        Flag::Draft => "Draft".into(),
        Flag::Recent => "Recent".into(),
        Flag::MayCreate => "MayCreate".into(),
        Flag::Custom(value) => value.to_string(),
    }
}

fn attribute_name(attribute: &NameAttribute<'_>) -> String {
    match attribute {
        NameAttribute::NoInferiors => "NoInferiors".into(),
        NameAttribute::NoSelect => "NoSelect".into(),
        NameAttribute::Marked => "Marked".into(),
        NameAttribute::Unmarked => "Unmarked".into(),
        NameAttribute::All => "All".into(),
        NameAttribute::Archive => "Archive".into(),
        NameAttribute::Drafts => "Drafts".into(),
        NameAttribute::Flagged => "Flagged".into(),
        NameAttribute::Junk => "Junk".into(),
        NameAttribute::Sent => "Sent".into(),
        NameAttribute::Trash => "Trash".into(),
        NameAttribute::Extension(value) => value.to_string(),
        _ => "Other".into(),
    }
}

fn folder_rank(folder: &FolderInfo) -> u8 {
    let name = folder.name.to_lowercase();
    if name == "inbox" {
        0
    } else if folder.attributes.iter().any(|v| v == "Flagged") {
        1
    } else if folder.attributes.iter().any(|v| v == "Drafts") {
        2
    } else if folder.attributes.iter().any(|v| v == "Sent") {
        3
    } else if folder.attributes.iter().any(|v| v == "Archive") {
        4
    } else if folder.attributes.iter().any(|v| v == "Junk") {
        5
    } else if folder.attributes.iter().any(|v| v == "Trash") {
        6
    } else {
        20
    }
}

#[cfg(test)]
mod idle_tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;

    async fn exercise_idle(supported: bool, disconnect: bool) -> Result<bool, String> {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut stream = BufReader::new(stream);
            stream.get_mut().write_all(b"* OK test server ready\r\n").await.unwrap();
            let mut idle_tag = String::new();
            loop {
                let mut line = String::new();
                if stream.read_line(&mut line).await.unwrap() == 0 {
                    break;
                }
                let mut words = line.split_whitespace();
                let tag = words.next().unwrap_or("");
                let command = words.next().unwrap_or("").to_ascii_uppercase();
                let response = if tag == "DONE" {
                    format!("{idle_tag} OK idle finished\r\n")
                } else {
                    match command.as_str() {
                        "LOGIN" => format!("{tag} OK logged in\r\n"),
                        "CAPABILITY" => format!("* CAPABILITY IMAP4rev1{}\r\n{tag} OK capabilities\r\n", if supported { " IDLE" } else { "" }),
                        "SELECT" => format!("* 0 EXISTS\r\n* OK [UIDVALIDITY 1]\r\n{tag} OK selected\r\n"),
                        "IDLE" => {
                            if disconnect {
                                break;
                            }
                            idle_tag = tag.to_string();
                            "+ idling\r\n* 1 EXISTS\r\n".to_string()
                        }
                        "LOGOUT" => format!("* BYE\r\n{tag} OK logout\r\n"),
                        _ => panic!("Unexpected command: {line}"),
                    }
                };
                stream.get_mut().write_all(response.as_bytes()).await.unwrap();
                if command == "LOGOUT" {
                    break;
                }
            }
        });
        let account = Account {
            auth_method: "password".into(),
            oauth_client_id: String::new(),
            id: "test".into(),
            display_name: "Test".into(),
            email: "test@example.org".into(),
            imap_host: "127.0.0.1".into(),
            imap_port: port,
            imap_security: SecurityMode::Plain,
            imap_username: "test".into(),
            smtp_host: "127.0.0.1".into(),
            smtp_port: 25,
            smtp_security: SecurityMode::Plain,
            smtp_username: "test".into(),
            sent_folder: "Sent".into(),
            drafts_folder: "Drafts".into(),
            trash_folder: "Trash".into(),
            save_sent_copy: false,
        };
        let result = tokio::time::timeout(Duration::from_secs(5), idle_inbox_once(&account, "test-password"))
            .await
            .expect("IDLE fixture must finish");
        tokio::time::timeout(Duration::from_secs(5), server).await.unwrap().unwrap();
        result
    }

    #[tokio::test]
    async fn idle_receives_mail_and_finishes_with_done_before_logout() {
        assert!(exercise_idle(true, false).await.unwrap());
    }

    #[tokio::test]
    async fn unsupported_idle_returns_the_polling_fallback_signal() {
        assert!(exercise_idle(false, false).await.unwrap_err().starts_with("IMAP IDLE not supported"));
    }

    #[tokio::test]
    async fn disconnected_idle_session_errors_and_a_later_connection_can_recover() {
        assert!(exercise_idle(true, true).await.is_err());
        assert!(exercise_idle(true, false).await.unwrap());
    }
}
