//! Conservative two-way reconciliation of Morrow-tagged IMAP Drafts.
//! SQLite is always the recoverable offline copy. Unrecognized provider drafts
//! are not imported, modified or deleted. This is deliberately not a generic
//! Gmail/Microsoft draft editor: providers may remove our ownership headers.
use crate::{
    db::{Database, DraftSyncStamp},
    imap::{self, RemoteOwnedDraft},
    models::{Account, LocalDraft},
    smtp,
};
use std::{
    collections::HashMap,
    sync::OnceLock,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

static SYNC_GATE: OnceLock<Mutex<()>> = OnceLock::new();
// Each native compose window holds its own renewable lease. A boolean per
// draft is unsafe: closing one of two windows would unlock the other window.
// Leases expire if the webview crashes without sending its close event.
const EDITOR_LEASE_TTL: Duration = Duration::from_secs(120);
type EditorLeases = HashMap<String, HashMap<String, Instant>>;
static EDITORS: OnceLock<Mutex<EditorLeases>> = OnceLock::new();
fn gate() -> &'static Mutex<()> {
    SYNC_GATE.get_or_init(|| Mutex::new(()))
}
fn editors() -> &'static Mutex<EditorLeases> {
    EDITORS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn editor_key(account: &str, id: &str) -> String {
    format!("{account}\0{id}")
}

fn prune_stale_editors(leases: &mut EditorLeases) {
    leases.retain(|_, windows| {
        windows.retain(|_, last_seen| last_seen.elapsed() < EDITOR_LEASE_TTL);
        !windows.is_empty()
    });
}

pub async fn set_editor_active(account: &str, id: &str, token: &str, active: bool) {
    let key = editor_key(account, id);
    let mut leases = editors().lock().await;
    prune_stale_editors(&mut leases);
    if active {
        leases.entry(key).or_default().insert(token.to_owned(), Instant::now());
    } else if let Some(windows) = leases.get_mut(&key) {
        windows.remove(token);
        if windows.is_empty() {
            leases.remove(&key);
        }
    }
}

async fn editor_active(account: &str, id: &str) -> bool {
    let mut leases = editors().lock().await;
    prune_stale_editors(&mut leases);
    leases.contains_key(&editor_key(account, id))
}

fn synced_stamp(local: &LocalDraft, remote: &RemoteOwnedDraft) -> DraftSyncStamp {
    DraftSyncStamp {
        local_revision: smtp::draft_revision(local),
        remote_revision: remote.revision.clone(),
        remote_hash: remote.hash.clone(),
        uid_validity: remote.uid_validity,
        remote_uid: remote.uid,
        status: "synced".into(),
        note: String::new(),
    }
}

fn remote_changed(remote: &RemoteOwnedDraft, stamp: &DraftSyncStamp) -> bool {
    stamp.uid_validity != remote.uid_validity || stamp.remote_hash != remote.hash || stamp.remote_revision != remote.revision
}

/// Push a local snapshot using a server-side compare-before-replace; no
/// overwrite unless the exact prior bytes still match the stored baseline.
/// Both UI and background calls serialize on the same gate.
pub async fn push(db: &Database, account: &Account, secret: &str, id: &str) -> Result<(), String> {
    let _guard = gate().lock().await;
    // Opening a recovery copy in the composer is an explicit request to
    // continue editing it, so allow its first upload as a NEW draft ID.
    if db.draft_sync_stamp(&account.id, id)?.is_some_and(|stamp| stamp.status == "recovery") {
        db.put_draft_sync_stamp(
            &account.id,
            id,
            &DraftSyncStamp {
                status: "synced".into(),
                ..Default::default()
            },
        )?;
    }
    push_locked(db, account, secret, id).await
}

async fn push_locked(db: &Database, account: &Account, secret: &str, id: &str) -> Result<(), String> {
    let local = db
        .local_drafts(&account.id)?
        .into_iter()
        .find(|d| d.id == id)
        .ok_or("Local draft does not exist")?;
    let stamp = db.draft_sync_stamp(&account.id, id)?;
    if let Some(previous) = &stamp {
        if previous.status != "synced" {
            return Err(format!("Draft sync is paused ({}): {}", previous.status, previous.note));
        }
    }
    let remote = imap::list_remote_owned_drafts(account, secret).await?;
    let mut matching = remote.iter().filter(|d| d.id == id);
    let only = matching.next();
    if matching.next().is_some() {
        return Err("Multiple server versions found; no copy was overwritten".into());
    }
    match (&stamp, only) {
        (None, Some(server)) if server.revision != smtp::draft_revision(&local) => {
            db.mark_draft_sync_issue(
                &account.id,
                id,
                "conflict",
                "An existing server version has no established baseline; use the Drafts dialog to review it",
            )?;
            return Err("Existing server version differs. Nothing overwritten".into());
        }
        (Some(previous), Some(server)) if remote_changed(server, previous) => {
            db.mark_draft_sync_issue(
                &account.id,
                id,
                "conflict",
                "Draft changed remotely since the last sync. Both copies were preserved",
            )?;
            return Err("Remote draft changed: upload cancelled".into());
        }
        (Some(previous), None) if !previous.remote_hash.is_empty() => {
            db.mark_draft_sync_issue(
                &account.id,
                id,
                "remote-missing",
                "Draft was removed on the server. Local recovery copy retained",
            )?;
            return Err("Draft removed on server: no automatic resurrection".into());
        }
        _ => {}
    }
    // A separate MIME builder permits recipient-less server Drafts while the
    // actual SMTP send path still requires recipients.
    let (raw, revision) = smtp::build_draft_message(account, &local).await?;
    let previous_hash = only.map(|remote| remote.hash.as_str());
    tokio::time::timeout(
        Duration::from_secs(90),
        imap::sync_owned_draft(account, secret, id, &raw, &revision, previous_hash),
    )
    .await
    .map_err(|_| "Draft upload timed out. State unknown; nothing was deleted locally".to_string())??;
    let after = imap::list_remote_owned_drafts(account, secret).await?;
    let copies = after.iter().filter(|d| d.id == id).collect::<Vec<_>>();
    if copies.len() != 1 || copies[0].revision != revision {
        return Err("Upload could not be verified as a single server version; local copy retained".into());
    }
    let now_local = db.local_drafts(&account.id)?.into_iter().find(|d| d.id == id);
    if now_local.is_some() {
        db.put_draft_sync_stamp(&account.id, id, &synced_stamp(&local, copies[0]))?;
    }
    // Record the uploaded snapshot even if editing continued during APPEND.
    // Its older local baseline keeps newer edits dirty without mistaking our
    // own successful upload for a conflicting remote edit on the next retry.
    Ok(())
}

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSyncReport {
    pub uploaded: usize,
    pub downloaded: usize,
    pub conflicts: usize,
    pub skipped: usize,
}

/// Reconcile in both directions. A partial or failed server scan returns an
/// error BEFORE changing local state. UIDVALIDITY changes are treated as
/// conflicts, not permission to expunge or delete a local recovery copy.
pub async fn reconcile(db: &Database, account: &Account, secret: &str) -> Result<DraftSyncReport, String> {
    let _guard = gate().lock().await;
    let remote = tokio::time::timeout(Duration::from_secs(90), imap::list_remote_owned_drafts(account, secret))
        .await
        .map_err(|_| "Drafts scan timed out. Local copies remain unchanged".to_string())??;
    let mut groups: HashMap<String, Vec<RemoteOwnedDraft>> = HashMap::new();
    for entry in remote {
        groups.entry(entry.id.clone()).or_default().push(entry);
    }
    let stamps = db.draft_sync_stamps(&account.id)?;
    let locals = db.local_drafts(&account.id)?;
    let mut local_by_id: HashMap<String, LocalDraft> = locals.into_iter().map(|d| (d.id.clone(), d)).collect();
    let current_editors = {
        let mut leases = editors().lock().await;
        prune_stale_editors(&mut leases);
        leases.keys().cloned().collect::<std::collections::HashSet<_>>()
    };
    let mut report = DraftSyncReport::default();
    for (id, versions) in &groups {
        // Duplicated IMAP drafts are not chosen by timestamp: when distinct
        // edits exist, there is no safe automatic winner.
        if versions.len() != 1 {
            db.mark_draft_sync_issue(&account.id, id, "conflict", "Multiple server copies; inspect Drafts in your provider")?;
            report.conflicts += 1;
            continue;
        }
        let server = &versions[0];
        let stamp = stamps.get(id);
        let local = local_by_id.remove(id);
        if stamp.is_some_and(|s| s.status != "synced") {
            report.skipped += 1;
            continue;
        }
        if current_editors.contains(&editor_key(&account.id, id)) {
            report.skipped += 1;
            continue;
        }
        let local_revision = local.as_ref().map(smtp::draft_revision);
        match (local, stamp) {
            (None, Some(_)) => {
                // Local-only deletion is intentional. Don't re-import or expunge.
                report.skipped += 1;
            }
            (None, None) => {
                if let Some(import) = &server.draft {
                    if editor_active(&account.id, id).await {
                        report.skipped += 1;
                        continue;
                    }
                    if db.replace_unedited_draft(import, None)? {
                        db.put_draft_sync_stamp(&account.id, id, &synced_stamp(import, server))?;
                        report.downloaded += 1;
                    }
                } else {
                    report.skipped += 1;
                }
            }
            (Some(local), None) => {
                if local_revision.as_deref() == Some(server.revision.as_str()) {
                    db.put_draft_sync_stamp(&account.id, id, &synced_stamp(&local, server))?;
                } else {
                    db.mark_draft_sync_issue(&account.id, id, "conflict", "Untracked local and server versions differ. Both copies retained")?;
                    report.conflicts += 1;
                }
            }
            (Some(_local), Some(previous)) => {
                let local_dirty = local_revision.as_deref() != Some(previous.local_revision.as_str());
                let server_dirty = remote_changed(server, previous);
                match (local_dirty, server_dirty) {
                    (false, false) => {}
                    (true, false) => match push_locked(db, account, secret, id).await {
                        Ok(()) => report.uploaded += 1,
                        Err(_) => {
                            report.skipped += 1;
                        }
                    },
                    (false, true) => {
                        if let Some(import) = &server.draft {
                            if editor_active(&account.id, id).await {
                                report.skipped += 1;
                                continue;
                            }
                            if db.replace_unedited_draft(import, local_revision.as_deref())? {
                                db.put_draft_sync_stamp(&account.id, id, &synced_stamp(import, server))?;
                                report.downloaded += 1;
                            } else {
                                db.mark_draft_sync_issue(&account.id, id, "conflict", "Local draft changed while fetching the server version")?;
                                report.conflicts += 1;
                            }
                        } else {
                            db.mark_draft_sync_issue(
                                &account.id,
                                id,
                                "conflict",
                                "Remote draft contains attachments or MIME that cannot be imported losslessly",
                            )?;
                            report.conflicts += 1;
                        }
                    }
                    (true, true) => {
                        // Save a separate server recovery copy, not a replacement
                        // of the local unsent work. It is not automatically pushed.
                        if let Some(import) = &server.draft {
                            let mut recovery = import.clone();
                            recovery.id = uuid::Uuid::new_v4().to_string();
                            recovery.subject = format!("[Server copy] {}", recovery.subject);
                            let _ = db.replace_unedited_draft(&recovery, None)?;
                            db.mark_draft_sync_issue(
                                &account.id,
                                &recovery.id,
                                "recovery",
                                "Independent local recovery copy; open in composer to continue editing",
                            )?;
                        }
                        db.mark_draft_sync_issue(&account.id, id, "conflict", "Both devices edited the draft. Server and local copies preserved")?;
                        report.conflicts += 1;
                    }
                }
            }
        }
    }
    for (id, local) in &local_by_id {
        if current_editors.contains(&editor_key(&account.id, id)) {
            report.skipped += 1;
            continue;
        }
        if let Some(previous) = stamps.get(id) {
            if previous.remote_hash.is_empty() && previous.status != "synced" {
                continue;
            }
            db.mark_draft_sync_issue(
                &account.id,
                id,
                "remote-missing",
                "Remote draft removed. Local recovery copy retained; no automatic re-upload",
            )?;
            report.skipped += 1;
            continue;
        }
        if local.to.trim().is_empty()
            && local.cc.trim().is_empty()
            && local.bcc.trim().is_empty()
            && local.body.trim().is_empty()
            && local.subject.trim().is_empty()
            && local.html_body.as_deref().unwrap_or("").is_empty()
            && local.attachments.is_empty()
        {
            report.skipped += 1;
            continue;
        }
        match push_locked(db, account, secret, id).await {
            Ok(()) => report.uploaded += 1,
            Err(_) => report.skipped += 1,
        }
    }
    Ok(report)
}

/// Explicit conflict resolution. This never runs automatically and preserves
/// the losing version in local SQLite before replacing anything.
pub async fn resolve(db: &Database, account: &Account, secret: &str, id: &str, choice: &str) -> Result<(), String> {
    let _guard = gate().lock().await;
    if editor_active(&account.id, id).await {
        return Err("Close the draft editor before resolving a conflict".into());
    }
    let stamp = db.draft_sync_stamp(&account.id, id)?.ok_or("No conflicting draft recorded")?;
    if stamp.status != "conflict" && stamp.status != "remote-missing" {
        return Err("Draft does not have a conflict requiring resolution".into());
    }
    let remote = imap::list_remote_owned_drafts(account, secret).await?;
    let copies = remote.iter().filter(|d| d.id == id).collect::<Vec<_>>();
    if copies.len() > 1 {
        return Err("Multiple versions exist on server. Resolve duplicates in your mail provider first".into());
    }
    let server = copies.first().copied();
    let local = db.local_drafts(&account.id)?.into_iter().find(|d| d.id == id);
    match choice {
        "keepLocal" => {
            let current = local.ok_or("Local draft not found")?;
            if let Some(remote) = server {
                let backup_source = remote
                    .draft
                    .as_ref()
                    .ok_or("Cannot replace server draft: remote attachments cannot be backed up safely")?;
                let mut backup = backup_source.clone();
                backup.id = uuid::Uuid::new_v4().to_string();
                backup.subject = format!("[Server backup] {}", backup.subject);
                db.replace_unedited_draft(&backup, None)?;
                db.mark_draft_sync_issue(&account.id, &backup.id, "recovery", "Backup made before keeping the local version")?;
            }
            let (raw, revision) = smtp::build_draft_message(account, &current).await?;
            imap::sync_owned_draft(account, secret, id, &raw, &revision, server.map(|r| r.hash.as_str())).await?;
            let verified = imap::list_remote_owned_drafts(account, secret).await?;
            let copies = verified.iter().filter(|d| d.id == id).collect::<Vec<_>>();
            if copies.len() != 1 || copies[0].revision != revision {
                return Err("Could not verify the resolved server copy".into());
            }
            db.put_draft_sync_stamp(&account.id, id, &synced_stamp(&current, copies[0]))?;
        }
        "keepServer" => {
            let server = server.ok_or("Remote draft was deleted; cannot restore it")?;
            let import = server
                .draft
                .as_ref()
                .ok_or("Server MIME has images or attachments and cannot be imported losslessly")?;
            if let Some(old) = &local {
                let mut backup = old.clone();
                backup.id = uuid::Uuid::new_v4().to_string();
                backup.subject = format!("[Local backup] {}", backup.subject);
                db.replace_unedited_draft(&backup, None)?;
                db.mark_draft_sync_issue(
                    &account.id,
                    &backup.id,
                    "recovery",
                    "Saved before adopting server version; edit to create a new independent draft",
                )?;
            }
            if !db.replace_unedited_draft(import, local.as_ref().map(smtp::draft_revision).as_deref())? {
                return Err("Local draft changed during conflict resolution; preserved both copies".into());
            }
            db.put_draft_sync_stamp(&account.id, id, &synced_stamp(import, server))?;
        }
        "keepLocalOffline" if stamp.status == "remote-missing" => {
            // User deliberately opts in to recreating a deleted server draft.
            // Clear the tombstone before pushing. The APPEND logic still uses
            // UIDPLUS, ownership checks, and server validation.
            db.put_draft_sync_stamp(
                &account.id,
                id,
                &DraftSyncStamp {
                    status: "synced".into(),
                    ..Default::default()
                },
            )?;
            push_locked(db, account, secret, id).await?;
        }
        _ => return Err("Unsupported conflict resolution option".into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_change_includes_changed_mime_with_unchanged_custom_revision() {
        let previous = DraftSyncStamp {
            remote_revision: "aa".into(),
            remote_hash: "old".into(),
            uid_validity: 42,
            ..Default::default()
        };
        let remote = RemoteOwnedDraft {
            id: "id".into(),
            revision: "aa".into(),
            hash: "new".into(),
            uid: 13,
            uid_validity: 42,
            draft: None,
        };
        assert!(remote_changed(&remote, &previous));
    }
}

#[cfg(test)]
mod editor_lease_tests {
    use super::*;

    #[test]
    fn one_window_closing_must_not_release_another_window() {
        let key = editor_key("account-1", "draft-1");
        let mut leases = EditorLeases::new();
        let windows = leases.entry(key.clone()).or_default();
        windows.insert("window-a".into(), Instant::now());
        windows.insert("window-b".into(), Instant::now());
        windows.remove("window-a");
        prune_stale_editors(&mut leases);
        assert!(leases.get(&key).is_some_and(|windows| windows.contains_key("window-b")));
    }

    #[test]
    fn expired_window_leases_do_not_block_future_sync() {
        let key = editor_key("account-1", "draft-1");
        let mut leases = EditorLeases::new();
        leases
            .entry(key.clone())
            .or_default()
            .insert("dead-window".into(), Instant::now() - EDITOR_LEASE_TTL - Duration::from_secs(1));
        prune_stale_editors(&mut leases);
        assert!(!leases.contains_key(&key));
    }
}
