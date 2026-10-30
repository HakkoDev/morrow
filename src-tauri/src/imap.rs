use std::{fmt::Debug, pin::Pin, time::Duration};

use async_imap::{
    types::{Flag, NameAttribute},
    Client, Session,
};
use futures::TryStreamExt;
use mailparse::{parse_mail, MailHeaderMap};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncRead, AsyncWrite},
    net::TcpStream,
};
use tokio_native_tls::TlsConnector;

use crate::{
    db::Database,
    mime::cache_message,
    models::{Account, FolderInfo, LocalDraft, SecurityMode},
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

/// A read-only description of a Drafts-folder message that Morrow does not
/// own. Imported copies get a new UUID; this UID is never used for deletion.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalDraftSummary {
    pub uid: u32,
    pub uid_validity: u32,
    pub subject: String,
    pub to: String,
    pub from: String,
}

pub async fn list_external_drafts(account: &Account, password: &str) -> Result<Vec<ExternalDraftSummary>, String> {
    let mut session = connect(account, password).await?;
    let selected = session.select(&account.drafts_folder).await.map_err(|e| e.to_string())?;
    let uid_validity = selected.uid_validity.ok_or("Drafts does not expose UIDVALIDITY")?;
    let uids = session.uid_search("ALL").await.map_err(|e| e.to_string())?;
    if uids.len() > 500 {
        return Err("Drafts contains more than 500 messages; manual import is paused to avoid incomplete results".into());
    }
    let mut sorted = uids.into_iter().collect::<Vec<_>>();
    sorted.sort_unstable_by(|a, b| b.cmp(a));
    let mut output = Vec::new();
    for batch in sorted.chunks(30) {
        let set = batch.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
        let items = {
            let stream = session.uid_fetch(&set, "(UID BODY.PEEK[HEADER])").await.map_err(|e| e.to_string())?;
            stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?
        };
        for item in items {
            let (Some(uid), Some(header)) = (item.uid, item.header()) else { continue };
            let Ok(parsed) = parse_mail(header) else { continue };
            let headers = parsed.get_headers();
            // Even malformed Morrow headers make this ineligible for external
            // import. They must be resolved in the owned-draft workflow.
            if headers.get_first_value("X-Morrow-Draft-ID").is_some() {
                continue;
            }
            output.push(ExternalDraftSummary {
                uid,
                uid_validity,
                subject: headers.get_first_value("Subject").unwrap_or_default(),
                to: headers.get_first_value("To").unwrap_or_default(),
                from: headers.get_first_value("From").unwrap_or_default(),
            });
        }
    }
    output.sort_unstable_by_key(|item| std::cmp::Reverse(item.uid));
    let _ = session.logout().await;
    Ok(output)
}

/// Fetch an external server draft for an explicit copy operation only.
/// UIDVALIDITY is required to prevent a stale UI selection resolving to a
/// completely different message after mailbox recreation.
pub async fn fetch_external_draft(account: &Account, password: &str, uid: u32, expected_uid_validity: u32) -> Result<Vec<u8>, String> {
    if uid == 0 || expected_uid_validity == 0 {
        return Err("Invalid IMAP draft identifier".into());
    }
    let mut session = connect(account, password).await?;
    let selected = session.select(&account.drafts_folder).await.map_err(|e| e.to_string())?;
    if selected.uid_validity != Some(expected_uid_validity) {
        return Err("Drafts mailbox UIDVALIDITY changed. Refresh the list before importing".into());
    }
    let items = {
        let stream = session.uid_fetch(uid.to_string(), "(UID BODY.PEEK[])").await.map_err(|e| e.to_string())?;
        stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?
    };
    if items.len() != 1 || items[0].uid != Some(uid) {
        return Err("Selected server draft no longer exists".into());
    }
    let bytes = items[0].body().ok_or("The server returned no draft body")?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Draft exceeds 8 MB import limit. Original remains on server".into());
    }
    let parsed = parse_mail(bytes).map_err(|e| e.to_string())?;
    if parsed.get_headers().get_first_value("X-Morrow-Draft-ID").is_some() {
        return Err("This server draft is Morrow-owned and must use the normal draft sync workflow".into());
    }
    let saved = bytes.to_vec();
    let _ = session.logout().await;
    Ok(saved)
}

// The sync reader intentionally handles only drafts tagged by Morrow. A
// generic Gmail/Outlook draft cannot safely be assumed to belong to a local
// record based on a matching subject or recipient alone.
#[derive(Debug, Clone)]
pub struct RemoteOwnedDraft {
    pub id: String,
    pub revision: String,
    pub hash: String,
    pub uid: u32,
    pub uid_validity: u32,
    pub draft: Option<LocalDraft>,
}

fn parse_owned_draft(account: &Account, id: &str, raw: &[u8]) -> Option<LocalDraft> {
    let parsed = parse_mail(raw).ok()?;
    // No lossy imports: regular attachments, CID images and exotic MIME must
    // remain server-side until the editor supports round-tripping the bytes.
    fn has_non_text_part(part: &mailparse::ParsedMail<'_>) -> bool {
        if part.subparts.is_empty() {
            return !matches!(part.ctype.mimetype.as_str(), "text/plain" | "text/html");
        }
        part.subparts.iter().any(has_non_text_part)
    }
    if has_non_text_part(&parsed) || crate::mime::draft_has_attachments(&parsed) {
        return None;
    }
    let headers = parsed.get_headers();
    let (body, html_body) = crate::mime::draft_bodies(&parsed);
    Some(LocalDraft {
        id: id.to_owned(),
        account_id: account.id.clone(),
        to: headers.get_first_value("To").unwrap_or_default(),
        cc: headers.get_first_value("Cc").unwrap_or_default(),
        bcc: headers.get_first_value("Bcc").unwrap_or_default(),
        subject: headers.get_first_value("Subject").unwrap_or_default(),
        body,
        html_body,
        in_reply_to: headers.get_first_value("In-Reply-To"),
        references: headers.get_first_value("References"),
        attachments: Vec::new(),
        updated_at: 0,
    })
}

/// A bounded complete scan, not a partial mailbox window. Missing items may
/// only be acted on after an exhaustive read of a manageable Drafts folder.
/// No server message is marked Seen (BODY.PEEK only).
pub async fn list_remote_owned_drafts(account: &Account, password: &str) -> Result<Vec<RemoteOwnedDraft>, String> {
    let mut session = connect(account, password).await?;
    let selection = session.select(&account.drafts_folder).await.map_err(|e| e.to_string())?;
    let uid_validity = selection
        .uid_validity
        .ok_or("Drafts folder did not provide UIDVALIDITY; safe synchronization disabled")?;
    let uids = session.uid_search("ALL").await.map_err(|e| e.to_string())?;
    if uids.len() > 500 {
        return Err("Over 500 messages in Drafts; automatic draft reconciliation paused to avoid a partial scan".into());
    }
    let mut found = Vec::<(u32, String, String)>::new();
    let mut sorted = uids.into_iter().collect::<Vec<_>>();
    sorted.sort_unstable();
    for batch in sorted.chunks(30) {
        let set = batch.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
        let items = {
            let stream = session.uid_fetch(&set, "(UID BODY.PEEK[HEADER])").await.map_err(|e| e.to_string())?;
            stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?
        };
        for item in items {
            let (Some(uid), Some(header)) = (item.uid, item.header()) else { continue };
            let parsed = match parse_mail(header) {
                Ok(parsed) => parsed,
                Err(_) => continue,
            };
            let id = parsed.get_headers().get_first_value("X-Morrow-Draft-ID").unwrap_or_default();
            let Ok(normalized) = uuid::Uuid::parse_str(id.trim()) else { continue };
            let id = normalized.to_string();
            if let Some(revision) = owned_draft_headers(header, &id) {
                found.push((uid, id, revision));
            }
        }
    }
    if found.len() > 100 {
        return Err("Over 100 Morrow-owned Drafts; refusing an unbounded download".into());
    }
    let mut output = Vec::new();
    for (uid, id, revision) in found {
        let entries = {
            let stream = session.uid_fetch(uid.to_string(), "(UID BODY.PEEK[])").await.map_err(|e| e.to_string())?;
            stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?
        };
        if entries.len() != 1 {
            return Err("Draft changed during remote scan; will retry".into());
        }
        let item = &entries[0];
        let bytes = item.body().ok_or("IMAP server did not return draft body")?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err("A remote Morrow draft exceeds the 8 MB sync safety cap".into());
        }
        if owned_draft_headers(bytes, &id).as_deref() != Some(&revision) {
            return Err("Draft changed while being fetched; will retry".into());
        }
        output.push(RemoteOwnedDraft {
            uid,
            id: id.clone(),
            revision,
            hash: format!("{:x}", Sha256::digest(bytes)),
            uid_validity,
            draft: parse_owned_draft(account, &id, bytes),
        });
    }
    let _ = session.logout().await;
    Ok(output)
}

// Morrow only mutates copies tagged with its own unique draft UUID. IMAP
// UIDPLUS is required because mailbox-wide EXPUNGE can delete unrelated mail.
// APPEND is followed by a fresh SEARCH before old versions are deleted: if
// the connection disappears after APPEND the old copy remains recoverable.
fn owned_draft_headers(header: &[u8], id: &str) -> Option<String> {
    let (headers, _) = mailparse::parse_headers(header).ok()?;
    let ids = headers
        .iter()
        .filter(|header| header.get_key().eq_ignore_ascii_case("X-Morrow-Draft-ID"))
        .collect::<Vec<_>>();
    let revisions = headers
        .iter()
        .filter(|header| header.get_key().eq_ignore_ascii_case("X-Morrow-Draft-Revision"))
        .collect::<Vec<_>>();
    if ids.len() != 1 || revisions.len() != 1 || !ids[0].get_value().trim().eq_ignore_ascii_case(id) {
        return None;
    }
    let revision = revisions[0].get_value();
    let revision = revision.trim();
    (revision.len() == 16 && revision.bytes().all(|c| c.is_ascii_hexdigit())).then(|| revision.to_ascii_lowercase())
}

fn draft_operation_guard(account_id: &str, draft_id: &str) -> Result<tokio::sync::OwnedMutexGuard<()>, String> {
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex, OnceLock},
    };
    type Locks = HashMap<(String, String), Arc<tokio::sync::Mutex<()>>>;
    static LOCKS: OnceLock<Mutex<Locks>> = OnceLock::new();
    let lock = LOCKS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|error| error.to_string())?
        .entry((account_id.to_owned(), draft_id.to_owned()))
        .or_default()
        .clone();
    lock.try_lock_owned()
        .map_err(|_| "A server operation for this draft is already running; retry after it finishes".into())
}

async fn find_owned_drafts(session: &mut Session<DynStream>, id: &str) -> Result<Vec<(u32, String)>, String> {
    let uids = session
        .uid_search(format!("HEADER X-Morrow-Draft-ID \"{id}\""))
        .await
        .map_err(|e| e.to_string())?;
    if uids.len() > 50 {
        return Err("More than 50 matching draft messages; refusing bulk modification".into());
    }
    if uids.is_empty() {
        return Ok(Vec::new());
    }
    let set = uids.into_iter().map(|uid| uid.to_string()).collect::<Vec<_>>().join(",");
    let stream = session.uid_fetch(set, "(UID BODY.PEEK[HEADER])").await.map_err(|e| e.to_string())?;
    let fetched = stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?;
    Ok(fetched
        .iter()
        .filter_map(|item| {
            let uid = item.uid?;
            let revision = owned_draft_headers(item.header()?, id)?;
            Some((uid, revision))
        })
        .collect())
}

async fn remove_owned_draft_uids(session: &mut Session<DynStream>, uids: &[u32]) -> Result<(), String> {
    if uids.is_empty() {
        return Ok(());
    }
    let set = uids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    {
        let stream = session.uid_store(&set, "+FLAGS.SILENT (\\Deleted)").await.map_err(|e| e.to_string())?;
        stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?;
    }
    {
        let stream = session.uid_expunge(&set).await.map_err(|e| e.to_string())?;
        stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn sync_owned_draft(
    account: &Account,
    password: &str,
    draft_id: &str,
    raw: &[u8],
    revision: &str,
    expected_remote_hash: Option<&str>,
) -> Result<(), String> {
    let id = uuid::Uuid::parse_str(draft_id)
        .map_err(|_| "Invalid Morrow draft UUID".to_string())?
        .to_string();
    let _guard = draft_operation_guard(&account.id, &id)?;
    let mut session = connect(account, password).await?;
    let caps = session.capabilities().await.map_err(|e| e.to_string())?;
    if !caps.has_str("UIDPLUS") {
        return Err("Safe Drafts synchronization requires IMAP UIDPLUS; the local draft is unchanged".into());
    }
    let selected = session
        .select(&account.drafts_folder)
        .await
        .map_err(|e| format!("Select Drafts folder failed: {e}"))?;
    let initial_validity = selected.uid_validity.ok_or("Drafts folder did not provide UIDVALIDITY")?;
    let existing = find_owned_drafts(&mut session, &id).await?;
    // Check the exact remote bytes, not just Morrow's original revision header:
    // third-party editors sometimes preserve custom headers when editing text.
    match (expected_remote_hash, existing.as_slice()) {
        (None, []) => {}
        (Some(expected), [only]) => {
            let stream = session.uid_fetch(only.0.to_string(), "(UID BODY.PEEK[])").await.map_err(|e| e.to_string())?;
            let items = stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?;
            if items.len() != 1 || items[0].body().map(|bytes| format!("{:x}", Sha256::digest(bytes))).as_deref() != Some(expected) {
                return Err("Draft was modified remotely. Upload cancelled to preserve both versions".into());
            }
        }
        _ => return Err("Draft remote baseline changed or contains duplicate versions; refusing an unsafe overwrite".into()),
    }
    if !existing.iter().any(|(_, saved)| saved == revision) {
        session
            .append(&account.drafts_folder, Some("(\\Draft)"), None, raw)
            .await
            .map_err(|e| format!("Draft APPEND may have succeeded: {e}. Check the Drafts folder before retrying."))?;
    }
    // Re-select to obtain current UIDVALIDITY and verify the new revision.
    let reselected = session.select(&account.drafts_folder).await.map_err(|e| e.to_string())?;
    if reselected.uid_validity != Some(initial_validity) {
        return Err("Drafts UIDVALIDITY changed; no old copies were removed".into());
    }
    let confirmed = find_owned_drafts(&mut session, &id).await?;
    if !confirmed.iter().any(|(_, saved)| saved == revision) {
        return Err("Could not verify the draft on the server; no older copies were deleted".into());
    }
    // The server may have received a simultaneous edit while APPEND ran.
    // Refuse to expunge any unexpected revision, even when our new copy exists.
    if confirmed
        .iter()
        .any(|(_, saved)| saved != revision && !existing.iter().any(|(_, old)| old == saved))
    {
        return Err("A different draft revision arrived during upload; both copies were preserved".into());
    }
    let mut kept_current = false;
    let obsolete = confirmed
        .into_iter()
        .filter_map(|(uid, saved)| {
            if saved == revision && !kept_current {
                kept_current = true;
                None
            } else {
                Some(uid)
            }
        })
        .collect::<Vec<_>>();
    if let Some(expected) = expected_remote_hash {
        for uid in &obsolete {
            let entries = {
                let stream = session.uid_fetch(uid.to_string(), "(UID BODY.PEEK[])").await.map_err(|e| e.to_string())?;
                stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?
            };
            if entries.len() != 1 || entries[0].body().map(|bytes| format!("{:x}", Sha256::digest(bytes))).as_deref() != Some(expected) {
                return Err("Remote draft changed while uploading; both copies were preserved".into());
            }
        }
    }
    remove_owned_draft_uids(&mut session, &obsolete).await?;
    let _ = tokio::time::timeout(Duration::from_secs(5), session.logout()).await;
    Ok(())
}

pub async fn delete_owned_draft(account: &Account, password: &str, draft_id: &str, expected_hash: &str) -> Result<(), String> {
    let id = uuid::Uuid::parse_str(draft_id)
        .map_err(|_| "Invalid Morrow draft UUID".to_string())?
        .to_string();
    let _guard = draft_operation_guard(&account.id, &id)?;
    let mut session = connect(account, password).await?;
    let caps = session.capabilities().await.map_err(|e| e.to_string())?;
    if !caps.has_str("UIDPLUS") {
        return Err("Safe Drafts deletion requires IMAP UIDPLUS".into());
    }
    let selected = session.select(&account.drafts_folder).await.map_err(|e| e.to_string())?;
    if selected.uid_validity.is_none() {
        return Err("Drafts server did not provide UIDVALIDITY; no messages were deleted".into());
    }
    let copies = find_owned_drafts(&mut session, &id).await?;
    if copies.len() != 1 {
        return Err("Remote draft has changed or duplicates; cleanup left to user".into());
    }
    let uid = copies[0].0;
    let fetched = {
        let stream = session.uid_fetch(uid.to_string(), "(UID BODY.PEEK[])").await.map_err(|e| e.to_string())?;
        stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?
    };
    if fetched.len() != 1 || fetched[0].body().map(|bytes| format!("{:x}", Sha256::digest(bytes))).as_deref() != Some(expected_hash) {
        return Err("Server draft was edited since last sync; refusing deletion".into());
    }
    remove_owned_draft_uids(&mut session, &[uid]).await?;
    let _ = session.logout().await;
    Ok(())
}

#[cfg(test)]
mod owned_draft_tests {
    use super::owned_draft_headers;
    #[test]
    fn draft_headers_require_exact_ownership_and_revision() {
        let id = "7cb7f94a-6933-4e11-a8d5-bd83293257f7";
        let h = format!("From: a@b.test\r\nX-Morrow-Draft-ID: {id}\r\nX-Morrow-Draft-Revision: 1234567890abcdef\r\n\r\n");
        assert_eq!(owned_draft_headers(h.as_bytes(), id).as_deref(), Some("1234567890abcdef"));
        assert_eq!(owned_draft_headers(h.as_bytes(), "different"), None);
        assert_eq!(owned_draft_headers(b"X-Morrow-Draft-ID: x\r\n", "x"), None);
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
