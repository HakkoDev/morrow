use std::{fmt::Debug, pin::Pin};

use async_imap::{types::{Flag, NameAttribute}, Client, Session};
use futures::TryStreamExt;
use tokio::{io::{AsyncRead, AsyncWrite}, net::TcpStream};
use tokio_native_tls::TlsConnector;

use crate::{db::Database, mime::cache_message, models::{Account, FolderInfo, SecurityMode}};

pub trait MailStream: AsyncRead + AsyncWrite + Unpin + Send + Debug {}
impl<T> MailStream for T where T: AsyncRead + AsyncWrite + Unpin + Send + Debug {}
type DynStream = Pin<Box<dyn MailStream>>;

pub async fn connect(account: &Account, password: &str) -> Result<Session<DynStream>, String> {
    let tcp = TcpStream::connect((account.imap_host.as_str(), account.imap_port))
        .await
        .map_err(|e| format!("IMAP TCP connection failed: {e}"))?;

    let tls = TlsConnector::from(native_tls::TlsConnector::builder().build().map_err(|e| e.to_string())?);

    let (stream, needs_greeting): (DynStream, bool) = match account.imap_security {
        SecurityMode::Tls => {
            let stream = tls.connect(&account.imap_host, tcp).await.map_err(|e| format!("IMAP TLS failed: {e}"))?;
            (Box::pin(stream), true)
        }
        SecurityMode::StartTls => {
            let mut client = Client::new(tcp);
            client.read_response().await.map_err(|e| format!("IMAP greeting failed: {e}"))?
                .ok_or_else(|| "IMAP server closed before greeting".to_string())?;
            client.run_command_and_check_ok("STARTTLS", None).await.map_err(|e| format!("IMAP STARTTLS failed: {e}"))?;
            let tcp = client.into_inner();
            let stream = tls.connect(&account.imap_host, tcp).await.map_err(|e| format!("IMAP STARTTLS handshake failed: {e}"))?;
            (Box::pin(stream), false)
        }
        SecurityMode::Plain => (Box::pin(tcp), true),
    };

    let mut client = Client::new(stream);
    if needs_greeting {
        client.read_response().await.map_err(|e| format!("IMAP greeting failed: {e}"))?
            .ok_or_else(|| "IMAP server closed before greeting".to_string())?;
    }

    client.login(&account.imap_username, password).await
        .map_err(|(e, _)| format!("IMAP authentication failed: {e}"))
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
    let mut output = folders.into_iter().map(|folder| {
        let selectable = !folder.attributes().iter().any(|attribute| matches!(attribute, &NameAttribute::NoSelect));
        FolderInfo {
            name: folder.name().to_string(),
            delimiter: folder.delimiter().map(ToString::to_string),
            attributes: folder.attributes().iter().map(attribute_name).collect(),
            selectable,
        }
    }).collect::<Vec<_>>();
    output.sort_by(|a, b| folder_rank(a).cmp(&folder_rank(b)).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    session.logout().await.map_err(|e| e.to_string())?;
    Ok(output)
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
        session.logout().await.map_err(|e| e.to_string())?;
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

    session.logout().await.map_err(|e| e.to_string())?;
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
    session.logout().await.map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn move_message(account: &Account, password: &str, folder: &str, uid: u32, destination: &str) -> Result<(), String> {
    let mut session = connect(account, password).await?;
    session.select(folder).await.map_err(|e| e.to_string())?;
    if session.uid_mv(uid.to_string(), destination).await.is_err() {
        session.uid_copy(uid.to_string(), destination).await.map_err(|e| e.to_string())?;
        {
            let stream = session.uid_store(uid.to_string(), "+FLAGS.SILENT (\\Deleted)").await.map_err(|e| e.to_string())?;
            stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?;
        }
        {
            let stream = session.expunge().await.map_err(|e| e.to_string())?;
            stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?;
        }
    }
    session.logout().await.map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn permanently_delete(account: &Account, password: &str, folder: &str, uid: u32) -> Result<(), String> {
    let mut session = connect(account, password).await?;
    session.select(folder).await.map_err(|e| e.to_string())?;
    {
        let stream = session.uid_store(uid.to_string(), "+FLAGS.SILENT (\\Deleted)").await.map_err(|e| e.to_string())?;
        stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?;
    }
    {
        let stream = session.expunge().await.map_err(|e| e.to_string())?;
        stream.try_collect::<Vec<_>>().await.map_err(|e| e.to_string())?;
    }
    session.logout().await.map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn append(account: &Account, password: &str, folder: &str, raw: &[u8], flags: Option<&str>) -> Result<(), String> {
    let mut session = connect(account, password).await?;
    session.append(folder, flags, None, raw).await.map_err(|e| format!("Could not append message to {folder}: {e}"))?;
    session.logout().await.map_err(|e| e.to_string())?;
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
    if name == "inbox" { 0 }
    else if folder.attributes.iter().any(|v| v == "Flagged") { 1 }
    else if folder.attributes.iter().any(|v| v == "Drafts") { 2 }
    else if folder.attributes.iter().any(|v| v == "Sent") { 3 }
    else if folder.attributes.iter().any(|v| v == "Archive") { 4 }
    else if folder.attributes.iter().any(|v| v == "Junk") { 5 }
    else if folder.attributes.iter().any(|v| v == "Trash") { 6 }
    else { 20 }
}
