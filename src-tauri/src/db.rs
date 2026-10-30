use std::{
    fs,
    path::{Path, PathBuf},
};

use rusqlite::{params, Connection, OptionalExtension};

use crate::models::{Account, FolderInfo, LocalDraft, MessageSummary, SecurityMode};

#[derive(Clone)]
pub struct Database {
    path: PathBuf,
}

impl Database {
    pub fn new(app_data_dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
        let path = app_data_dir.join("mail.sqlite3");
        let db = Self { path };
        db.init()?;
        Ok(db)
    }

    fn connection(&self) -> Result<Connection, String> {
        let connection = Connection::open(&self.path).map_err(|e| e.to_string())?;
        connection.pragma_update(None, "foreign_keys", "ON").map_err(|e| e.to_string())?;
        connection.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
        Ok(connection)
    }

    fn init(&self) -> Result<(), String> {
        let connection = self.connection()?;
        let schema_version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|e| e.to_string())?;
        if schema_version > 5 {
            return Err(format!(
                "Mail cache schema version {schema_version} is newer than this Morrow build supports (4). Use a newer build to avoid corrupting your data."
            ));
        }
        connection
            .execute_batch(
                r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                email TEXT NOT NULL,
                imap_host TEXT NOT NULL,
                imap_port INTEGER NOT NULL,
                imap_security TEXT NOT NULL,
                imap_username TEXT NOT NULL,
                smtp_host TEXT NOT NULL,
                smtp_port INTEGER NOT NULL,
                smtp_security TEXT NOT NULL,
                smtp_username TEXT NOT NULL,
                sent_folder TEXT NOT NULL DEFAULT 'Sent',
                drafts_folder TEXT NOT NULL DEFAULT 'Drafts',
                trash_folder TEXT NOT NULL DEFAULT 'Trash',
                save_sent_copy INTEGER NOT NULL DEFAULT 1,
                auth_method TEXT NOT NULL DEFAULT 'password',
                oauth_client_id TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id TEXT NOT NULL,
                folder TEXT NOT NULL,
                uid INTEGER NOT NULL,
                message_id TEXT,
                subject TEXT NOT NULL DEFAULT '',
                sender TEXT NOT NULL DEFAULT '',
                recipients TEXT NOT NULL DEFAULT '',
                cc TEXT NOT NULL DEFAULT '',
                date INTEGER NOT NULL DEFAULT 0,
                preview TEXT NOT NULL DEFAULT '',
                flags_json TEXT NOT NULL DEFAULT '[]',
                raw BLOB NOT NULL,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                UNIQUE(account_id, folder, uid)
            );

            CREATE INDEX IF NOT EXISTS idx_messages_folder_date
            ON messages(account_id, folder, date DESC);

            CREATE TABLE IF NOT EXISTS folder_state (
                account_id TEXT NOT NULL,
                folder TEXT NOT NULL,
                uid_validity INTEGER,
                PRIMARY KEY(account_id, folder),
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS local_drafts (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                to_address TEXT NOT NULL DEFAULT '',
                cc TEXT NOT NULL DEFAULT '',
                bcc TEXT NOT NULL DEFAULT '',
                subject TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                html_body TEXT,
                in_reply_to TEXT,
                references_header TEXT,
                attachments_json TEXT NOT NULL DEFAULT '[]',
                updated_at INTEGER NOT NULL DEFAULT (unixepoch())
            );
            CREATE INDEX IF NOT EXISTS idx_local_drafts_account ON local_drafts(account_id, updated_at DESC);
            CREATE TABLE IF NOT EXISTS folder_cache (
                account_id TEXT NOT NULL PRIMARY KEY,
                folders_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );
            "#,
            )
            .map_err(|e| e.to_string())?;
        // Upgrade databases created by early pre-0.1.1 builds. Do not ignore
        // arbitrary migration failures: an incompatible schema must fail early.
        let has_sent_copy = {
            let mut statement = connection.prepare("PRAGMA table_info(accounts)").map_err(|e| e.to_string())?;
            let columns = statement.query_map([], |row| row.get::<_, String>(1)).map_err(|e| e.to_string())?;
            let names = columns.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
            names.iter().any(|name| name == "save_sent_copy")
        };
        if !has_sent_copy {
            connection
                .execute("ALTER TABLE accounts ADD COLUMN save_sent_copy INTEGER NOT NULL DEFAULT 1", [])
                .map_err(|e| format!("Cannot upgrade legacy account schema: {e}"))?;
        }
        if schema_version < 3 {
            let column_names = {
                let mut statement = connection.prepare("PRAGMA table_info(messages)").map_err(|e| e.to_string())?;
                let rows = statement.query_map([], |row| row.get::<_, String>(1)).map_err(|e| e.to_string())?;
                rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
            };
            if !column_names.iter().any(|name| name == "body_text") {
                connection
                    .execute("ALTER TABLE messages ADD COLUMN body_text TEXT NOT NULL DEFAULT ''", [])
                    .map_err(|e| e.to_string())?;
            }
            if !column_names.iter().any(|name| name == "thread_key") {
                connection
                    .execute("ALTER TABLE messages ADD COLUMN thread_key TEXT NOT NULL DEFAULT ''", [])
                    .map_err(|e| e.to_string())?;
            }
            // Populate the index for cached messages created by older builds.
            // The only source is each account's existing MIME data, never remote fetches.
            let existing = {
                let mut stmt = connection
                    .prepare("SELECT id, account_id, folder, uid, raw FROM messages")
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)? as u32,
                            row.get::<_, Vec<u8>>(4)?,
                        ))
                    })
                    .map_err(|e| e.to_string())?;
                rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
            };
            for (id, account, folder, uid, raw) in existing {
                if let Ok(parsed) = crate::mime::cache_message(&raw, &account, &folder, uid, Vec::new()) {
                    connection
                        .execute(
                            "UPDATE messages SET body_text=?2, thread_key=?3 WHERE id=?1",
                            params![id, parsed.body_text, parsed.thread_key],
                        )
                        .map_err(|e| e.to_string())?;
                }
            }
        }
        if schema_version < 4 {
            let has_html = {
                let mut statement = connection.prepare("PRAGMA table_info(local_drafts)").map_err(|e| e.to_string())?;
                let columns = statement.query_map([], |row| row.get::<_, String>(1)).map_err(|e| e.to_string())?;
                columns
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?
                    .iter()
                    .any(|name| name == "html_body")
            };
            if !has_html {
                connection
                    .execute("ALTER TABLE local_drafts ADD COLUMN html_body TEXT", [])
                    .map_err(|e| e.to_string())?;
            }
        }
        if schema_version < 5 {
            let mut stmt = connection.prepare("PRAGMA table_info(accounts)").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(1)).map_err(|e| e.to_string())?;
            let names = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
            if !names.iter().any(|n| n == "auth_method") {
                connection
                    .execute("ALTER TABLE accounts ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'password'", [])
                    .map_err(|e| e.to_string())?;
            }
            if !names.iter().any(|n| n == "oauth_client_id") {
                connection
                    .execute("ALTER TABLE accounts ADD COLUMN oauth_client_id TEXT NOT NULL DEFAULT ''", [])
                    .map_err(|e| e.to_string())?;
            }
        }
        connection
            .execute_batch(
                r#"
            CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(subject, sender, recipients, preview, body_text, content='messages', content_rowid='id');
            CREATE TRIGGER IF NOT EXISTS message_fts_insert AFTER INSERT ON messages BEGIN
                INSERT INTO message_fts(rowid, subject, sender, recipients, preview, body_text)
                VALUES (new.id, new.subject, new.sender, new.recipients, new.preview, new.body_text);
            END;
            CREATE TRIGGER IF NOT EXISTS message_fts_delete AFTER DELETE ON messages BEGIN
                INSERT INTO message_fts(message_fts, rowid, subject, sender, recipients, preview, body_text)
                VALUES ('delete', old.id, old.subject, old.sender, old.recipients, old.preview, old.body_text);
            END;
            CREATE TRIGGER IF NOT EXISTS message_fts_update AFTER UPDATE OF subject, sender, recipients, preview, body_text ON messages BEGIN
                INSERT INTO message_fts(message_fts, rowid, subject, sender, recipients, preview, body_text)
                VALUES ('delete', old.id, old.subject, old.sender, old.recipients, old.preview, old.body_text);
                INSERT INTO message_fts(rowid, subject, sender, recipients, preview, body_text)
                VALUES (new.id, new.subject, new.sender, new.recipients, new.preview, new.body_text);
            END;
        "#,
            )
            .map_err(|e| e.to_string())?;
        if schema_version < 3 {
            connection
                .execute("INSERT INTO message_fts(message_fts) VALUES('rebuild')", [])
                .map_err(|e| e.to_string())?;
        }
        connection.pragma_update(None, "user_version", 5).map_err(|e| e.to_string())?;
        Ok(())
    }

    // Folder discovery is persisted to disk, not a renderer-only cache. Clicking
    // an account/folder can always show its previous snapshot while IMAP updates.
    pub fn cached_folders(&self, account_id: &str) -> Result<Vec<FolderInfo>, String> {
        let connection = self.connection()?;
        let value: Option<String> = connection
            .query_row("SELECT folders_json FROM folder_cache WHERE account_id=?1", [account_id], |row| row.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        value.map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string())).unwrap_or(Ok(Vec::new()))
    }

    pub fn cache_folders(&self, account_id: &str, folders: &[FolderInfo]) -> Result<(), String> {
        let connection = self.connection()?;
        let payload = serde_json::to_string(folders).map_err(|e| e.to_string())?;
        connection.execute(
            "INSERT INTO folder_cache(account_id, folders_json, updated_at) VALUES(?1,?2,strftime('%s','now')) ON CONFLICT(account_id) DO UPDATE SET folders_json=excluded.folders_json, updated_at=excluded.updated_at",
            params![account_id, payload],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_folder_cache_data(&self, account_id: &str, folder: &str) -> Result<(), String> {
        let mut connection = self.connection()?;
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM messages WHERE account_id=?1 AND folder=?2", params![account_id, folder])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM folder_state WHERE account_id=?1 AND folder=?2", params![account_id, folder])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn list_accounts(&self) -> Result<Vec<Account>, String> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, display_name, email, imap_host, imap_port, imap_security, imap_username, smtp_host, smtp_port, smtp_security, smtp_username, sent_folder, drafts_folder, trash_folder, save_sent_copy, auth_method, oauth_client_id FROM accounts ORDER BY rowid"
        ).map_err(|e| e.to_string())?;
        let rows = statement.query_map([], |row| Ok(account_from_row(row))).map_err(|e| e.to_string())?;
        rows.map(|row| row.map_err(|e| e.to_string())).collect()
    }

    pub fn get_account(&self, id: &str) -> Result<Account, String> {
        let connection = self.connection()?;
        connection.query_row(
            "SELECT id, display_name, email, imap_host, imap_port, imap_security, imap_username, smtp_host, smtp_port, smtp_security, smtp_username, sent_folder, drafts_folder, trash_folder, save_sent_copy, auth_method, oauth_client_id FROM accounts WHERE id = ?1",
            [id],
            |row| Ok(account_from_row(row)),
        ).map_err(|e| e.to_string())
    }

    pub fn save_account(&self, account: &Account) -> Result<(), String> {
        let connection = self.connection()?;
        connection
            .execute(
                r#"INSERT INTO accounts (
                id, display_name, email, imap_host, imap_port, imap_security, imap_username,
                smtp_host, smtp_port, smtp_security, smtp_username, sent_folder, drafts_folder, trash_folder, save_sent_copy, auth_method, oauth_client_id
            ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)
            ON CONFLICT(id) DO UPDATE SET
                display_name=excluded.display_name,
                email=excluded.email,
                imap_host=excluded.imap_host,
                imap_port=excluded.imap_port,
                imap_security=excluded.imap_security,
                imap_username=excluded.imap_username,
                smtp_host=excluded.smtp_host,
                smtp_port=excluded.smtp_port,
                smtp_security=excluded.smtp_security,
                smtp_username=excluded.smtp_username,
                sent_folder=excluded.sent_folder,
                drafts_folder=excluded.drafts_folder,
                trash_folder=excluded.trash_folder,
                save_sent_copy=excluded.save_sent_copy,
                auth_method=excluded.auth_method,
                oauth_client_id=excluded.oauth_client_id"#,
                params![
                    account.id,
                    account.display_name,
                    account.email,
                    account.imap_host,
                    account.imap_port,
                    account.imap_security.as_str(),
                    account.imap_username,
                    account.smtp_host,
                    account.smtp_port,
                    account.smtp_security.as_str(),
                    account.smtp_username,
                    account.sent_folder,
                    account.drafts_folder,
                    account.trash_folder,
                    account.save_sent_copy as i64,
                    account.auth_method,
                    account.oauth_client_id
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_account(&self, id: &str) -> Result<(), String> {
        let connection = self.connection()?;
        connection.execute("DELETE FROM accounts WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn upsert_message(&self, message: &CachedMessage) -> Result<(), String> {
        let connection = self.connection()?;
        connection
            .execute(
                r#"INSERT INTO messages (account_id, folder, uid, message_id, subject, sender, recipients, cc, date, preview, flags_json, raw, body_text, thread_key)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
            ON CONFLICT(account_id, folder, uid) DO UPDATE SET
                message_id=excluded.message_id,
                subject=excluded.subject,
                sender=excluded.sender,
                recipients=excluded.recipients,
                cc=excluded.cc,
                date=excluded.date,
                preview=excluded.preview,
                flags_json=excluded.flags_json,
                raw=excluded.raw,
                body_text=excluded.body_text,
                thread_key=excluded.thread_key"#,
                params![
                    message.account_id,
                    message.folder,
                    message.uid,
                    message.message_id,
                    message.subject,
                    message.sender,
                    message.recipients,
                    message.cc,
                    message.date,
                    message.preview,
                    serde_json::to_string(&message.flags).unwrap_or_else(|_| "[]".to_string()),
                    message.raw,
                    message.body_text,
                    message.thread_key
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_messages(&self, account_id: &str, folder: &str, query: &str) -> Result<Vec<MessageSummary>, String> {
        if !query.trim().is_empty() {
            return self.search_messages_scoped(query, Some(account_id), Some(folder));
        }
        let connection = self.connection()?;
        let sql = "SELECT id, account_id, folder, uid, message_id, subject, sender, recipients, date, preview, flags_json, thread_key FROM messages WHERE account_id=?1 AND folder=?2 ORDER BY date DESC, uid DESC LIMIT 1000";
        let mut statement = connection.prepare(sql).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        let rows = statement.query_map(params![account_id, folder], summary_from_row).map_err(|e| e.to_string())?;
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn get_message_record(&self, account_id: &str, message_id: i64) -> Result<StoredMessage, String> {
        let connection = self.connection()?;
        connection.query_row(
            "SELECT id, account_id, folder, uid, message_id, subject, sender, recipients, cc, date, preview, flags_json, raw, thread_key FROM messages WHERE id=?1 AND account_id=?2",
            params![message_id, account_id],
            |row| {
                let flags_json: String = row.get(11)?;
                Ok(StoredMessage {
                    summary: MessageSummary {
                        id: row.get(0)?,
                        account_id: row.get(1)?,
                        folder: row.get(2)?,
                        uid: row.get::<_, i64>(3)? as u32,
                        message_id: row.get(4)?,
                        thread_key: row.get(13)?,
                        subject: row.get(5)?,
                        sender: row.get(6)?,
                        recipients: row.get(7)?,
                        date: row.get(9)?,
                        preview: row.get(10)?,
                        flags: serde_json::from_str(&flags_json).unwrap_or_default(),
                    },
                    cc: row.get(8)?,
                    raw: row.get(12)?,
                })
            }
        ).map_err(|e| e.to_string())
    }

    pub fn set_cached_flags(&self, account_id: &str, folder: &str, uid: u32, flags: &[String]) -> Result<(), String> {
        let connection = self.connection()?;
        connection
            .execute(
                "UPDATE messages SET flags_json=?4 WHERE account_id=?1 AND folder=?2 AND uid=?3",
                params![account_id, folder, uid, serde_json::to_string(flags).unwrap_or_else(|_| "[]".into())],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_cached_message(&self, account_id: &str, folder: &str, uid: u32) -> Result<(), String> {
        let connection = self.connection()?;
        connection
            .execute(
                "DELETE FROM messages WHERE account_id=?1 AND folder=?2 AND uid=?3",
                params![account_id, folder, uid],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn prepare_folder_sync(&self, account_id: &str, folder: &str, uid_validity: Option<u32>) -> Result<(), String> {
        // If UIDVALIDITY changes, purge old UIDs and record the new validity in
        // one transaction. A crash between these operations could otherwise
        // associate stale cached messages with the wrong server UIDs.
        let mut connection = self.connection()?;
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        let previous: Option<Option<i64>> = tx
            .query_row(
                "SELECT uid_validity FROM folder_state WHERE account_id=?1 AND folder=?2",
                params![account_id, folder],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let current = uid_validity.map(i64::from);
        if let Some(previous) = previous {
            if previous != current && previous.is_some() && current.is_some() {
                tx.execute("DELETE FROM messages WHERE account_id=?1 AND folder=?2", params![account_id, folder])
                    .map_err(|e| e.to_string())?;
            }
        }
        tx.execute(
            "INSERT INTO folder_state(account_id, folder, uid_validity) VALUES(?1,?2,?3) ON CONFLICT(account_id,folder) DO UPDATE SET uid_validity=excluded.uid_validity",
            params![account_id, folder, current],
        ).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn prune_missing_uids(&self, account_id: &str, folder: &str, server_uids: &std::collections::HashSet<u32>) -> Result<(), String> {
        let mut connection = self.connection()?;
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        let stale = {
            let mut statement = tx
                .prepare("SELECT uid FROM messages WHERE account_id=?1 AND folder=?2")
                .map_err(|e| e.to_string())?;
            let rows = statement
                .query_map(params![account_id, folder], |row| row.get::<_, i64>(0))
                .map_err(|e| e.to_string())?;
            let mut stale = Vec::new();
            for row in rows {
                let uid = row.map_err(|e| e.to_string())? as u32;
                if !server_uids.contains(&uid) {
                    stale.push(uid);
                }
            }
            stale
        };
        for uid in stale {
            tx.execute(
                "DELETE FROM messages WHERE account_id=?1 AND folder=?2 AND uid=?3",
                params![account_id, folder, uid],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn has_cached_message(&self, account_id: &str, folder: &str, uid: u32) -> Result<bool, String> {
        let connection = self.connection()?;
        let exists: i64 = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM messages WHERE account_id=?1 AND folder=?2 AND uid=?3)",
                params![account_id, folder, uid],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(exists != 0)
    }

    pub fn max_cached_uid(&self, account_id: &str, folder: &str) -> Result<u32, String> {
        let connection = self.connection()?;
        let max: i64 = connection
            .query_row(
                "SELECT COALESCE(MAX(uid), 0) FROM messages WHERE account_id=?1 AND folder=?2 COLLATE NOCASE",
                params![account_id, folder],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(max.max(0) as u32)
    }

    pub fn inbox_uid_validity(&self, account_id: &str) -> Result<Option<i64>, String> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT uid_validity FROM folder_state WHERE account_id=?1 AND folder='INBOX' COLLATE NOCASE",
                [account_id],
                |row| row.get::<_, Option<i64>>(0),
            )
            .optional()
            .map(Option::flatten)
            .map_err(|error| error.to_string())
    }

    pub fn new_unread_count(&self, account_id: &str, previous_uid: u32, previous_validity: Option<i64>) -> Result<usize, String> {
        // First syncs and UIDVALIDITY resets are historical backfills, not new mail.
        if previous_validity.is_none() || previous_validity != self.inbox_uid_validity(account_id)? {
            return Ok(0);
        }
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT flags_json FROM messages WHERE account_id=?1 AND folder='INBOX' COLLATE NOCASE AND uid>?2")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(params![account_id, previous_uid], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut count = 0;
        for row in rows {
            let flags: Vec<String> = serde_json::from_str(&row.map_err(|e| e.to_string())?).unwrap_or_default();
            if !flags.iter().any(|flag| flag.trim_start_matches('\\').eq_ignore_ascii_case("Seen")) {
                count += 1;
            }
        }
        Ok(count)
    }

    pub fn unread_counts(&self) -> Result<std::collections::HashMap<String, usize>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT account_id, flags_json FROM messages WHERE folder='INBOX' COLLATE NOCASE")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut counts = std::collections::HashMap::new();
        for row in rows {
            let (account_id, flags) = row.map_err(|e| e.to_string())?;
            let flags: Vec<String> = serde_json::from_str(&flags).unwrap_or_default();
            if !flags.iter().any(|flag| flag.trim_start_matches('\\').eq_ignore_ascii_case("Seen")) {
                *counts.entry(account_id).or_insert(0) += 1;
            }
        }
        Ok(counts)
    }

    pub fn unified_inbox(&self) -> Result<Vec<MessageSummary>, String> {
        let connection = self.connection()?;
        let mut statement = connection.prepare("SELECT id, account_id, folder, uid, message_id, subject, sender, recipients, date, preview, flags_json, thread_key FROM messages WHERE folder='INBOX' COLLATE NOCASE ORDER BY date DESC, id DESC LIMIT 1000")
            .map_err(|e| e.to_string())?;
        let rows = statement.query_map([], summary_from_row).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn search_messages(&self, query: &str, account_id: Option<&str>) -> Result<Vec<MessageSummary>, String> {
        self.search_messages_scoped(query, account_id, None)
    }

    fn search_messages_scoped(&self, query: &str, account_id: Option<&str>, scope_folder: Option<&str>) -> Result<Vec<MessageSummary>, String> {
        // Search operators are parsed into bound SQLite parameters. No part
        // of a user's query is ever interpolated into the SQL statement.
        let mut terms = Vec::new();
        let mut sender = None;
        let mut folder = scope_folder.map(str::to_owned);
        let mut after = None;
        let mut before = None;
        for token in query.split_whitespace().take(32) {
            if let Some(value) = token.strip_prefix("from:") {
                if !value.is_empty() {
                    sender = Some(value.to_string());
                }
            } else if let Some(value) = token.strip_prefix("in:") {
                if !value.is_empty() {
                    if let Some(scope) = scope_folder {
                        if !scope.eq_ignore_ascii_case(value) {
                            return Ok(Vec::new());
                        }
                    } else {
                        folder = Some(value.to_string());
                    }
                }
            } else if let Some(value) = token.strip_prefix("after:") {
                if !valid_iso_date(value) {
                    return Err("Invalid after: date; use a real YYYY-MM-DD UTC date".into());
                }
                after = Some(value.to_string());
            } else if let Some(value) = token.strip_prefix("before:") {
                if !valid_iso_date(value) {
                    return Err("Invalid before: date; use a real YYYY-MM-DD UTC date".into());
                }
                before = Some(value.to_string());
            } else if !token.is_empty() {
                terms.push(format!("\"{}\"", token.replace('"', "\"\"")));
            }
        }
        if terms.is_empty() && sender.is_none() && folder.is_none() && after.is_none() && before.is_none() {
            return Ok(Vec::new());
        }
        let expression = terms.join(" AND ");
        let sender_like = sender.as_ref().map(|value| format!("%{}%", escape_like(value)));
        let connection = self.connection()?;
        let sql = if terms.is_empty() {
            "SELECT m.id, m.account_id, m.folder, m.uid, m.message_id, m.subject, m.sender, m.recipients, m.date, m.preview, m.flags_json, m.thread_key FROM messages m WHERE (?1 IS NOT NULL) AND (?2 IS NULL OR m.account_id=?2) AND (?3 IS NULL OR m.sender LIKE ?3 ESCAPE '!') AND (?4 IS NULL OR m.folder=?4 COLLATE NOCASE) AND (?5 IS NULL OR date(m.date, 'unixepoch') >= ?5) AND (?6 IS NULL OR date(m.date, 'unixepoch') < ?6) ORDER BY m.date DESC, m.id DESC LIMIT 500"
        } else {
            "SELECT m.id, m.account_id, m.folder, m.uid, m.message_id, m.subject, m.sender, m.recipients, m.date, m.preview, m.flags_json, m.thread_key FROM message_fts JOIN messages m ON m.id=message_fts.rowid WHERE message_fts MATCH ?1 AND (?2 IS NULL OR m.account_id=?2) AND (?3 IS NULL OR m.sender LIKE ?3 ESCAPE '!') AND (?4 IS NULL OR m.folder=?4 COLLATE NOCASE) AND (?5 IS NULL OR date(m.date, 'unixepoch') >= ?5) AND (?6 IS NULL OR date(m.date, 'unixepoch') < ?6) ORDER BY m.date DESC, m.id DESC LIMIT 500"
        };
        let mut statement = connection.prepare(sql).map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(params![expression, account_id, sender_like, folder, after, before], summary_from_row)
            .map_err(|e| e.to_string())?;
        let rows = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .filter(|message| scope_folder.is_none_or(|scope| message.folder == scope))
            .collect())
    }

    pub fn conversation(&self, account_id: &str, thread_key: &str) -> Result<Vec<MessageSummary>, String> {
        if thread_key.is_empty() {
            return Ok(Vec::new());
        }
        let connection = self.connection()?;
        let mut statement = connection.prepare("SELECT id, account_id, folder, uid, message_id, subject, sender, recipients, date, preview, flags_json, thread_key FROM messages WHERE account_id=?1 AND thread_key=?2 ORDER BY date ASC LIMIT 100")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(params![account_id, thread_key], summary_from_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn save_local_draft(&self, draft: &LocalDraft) -> Result<(), String> {
        let connection = self.connection()?;
        // The SELECT guarantees an existing account; the ID is scoped to it.
        connection.execute(
            "INSERT INTO local_drafts(id,account_id,to_address,cc,bcc,subject,body,html_body,in_reply_to,references_header,attachments_json,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,unixepoch()) ON CONFLICT(id) DO UPDATE SET to_address=excluded.to_address,cc=excluded.cc,bcc=excluded.bcc,subject=excluded.subject,body=excluded.body,html_body=excluded.html_body,in_reply_to=excluded.in_reply_to,references_header=excluded.references_header,attachments_json=excluded.attachments_json,updated_at=unixepoch() WHERE local_drafts.account_id=excluded.account_id",
            params![draft.id,draft.account_id,draft.to,draft.cc,draft.bcc,draft.subject,draft.body,draft.html_body,draft.in_reply_to,draft.references,serde_json::to_string(&draft.attachments).map_err(|e| e.to_string())?]
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn local_drafts(&self, account_id: &str) -> Result<Vec<LocalDraft>, String> {
        let connection = self.connection()?;
        let mut statement = connection.prepare("SELECT id,account_id,to_address,cc,bcc,subject,body,html_body,in_reply_to,references_header,attachments_json,updated_at FROM local_drafts WHERE account_id=?1 ORDER BY updated_at DESC, id LIMIT 200").map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([account_id], |row| {
                let attachments: String = row.get(10)?;
                Ok(LocalDraft {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    to: row.get(2)?,
                    cc: row.get(3)?,
                    bcc: row.get(4)?,
                    subject: row.get(5)?,
                    body: row.get(6)?,
                    html_body: row.get(7)?,
                    in_reply_to: row.get(8)?,
                    references: row.get(9)?,
                    attachments: serde_json::from_str(&attachments).unwrap_or_default(),
                    updated_at: row.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn delete_local_draft(&self, account_id: &str, id: &str) -> Result<(), String> {
        let connection = self.connection()?;
        connection
            .execute("DELETE FROM local_drafts WHERE id=?1 AND account_id=?2", params![id, account_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn cached_flags(&self, account_id: &str, folder: &str, uid: u32) -> Result<Vec<String>, String> {
        let connection = self.connection()?;
        let value: Option<String> = connection
            .query_row(
                "SELECT flags_json FROM messages WHERE account_id=?1 AND folder=?2 AND uid=?3",
                params![account_id, folder, uid],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(value.and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default())
    }
}

fn valid_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' || !bytes.iter().enumerate().all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit()) {
        return false;
    }
    let year = value[..4].parse::<u32>().unwrap_or(0);
    let month = value[5..7].parse::<u32>().unwrap_or(0);
    let day = value[8..10].parse::<u32>().unwrap_or(0);
    let days = match month {
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => 0,
    };
    year > 0 && day > 0 && day <= days
}

fn escape_like(value: &str) -> String {
    value.replace('!', "!!").replace('%', "!%").replace('_', "!_")
}

fn account_from_row(row: &rusqlite::Row<'_>) -> Account {
    let imap_security: String = row.get(5).unwrap_or_else(|_| "tls".into());
    let smtp_security: String = row.get(9).unwrap_or_else(|_| "tls".into());
    Account {
        id: row.get(0).unwrap_or_default(),
        display_name: row.get(1).unwrap_or_default(),
        email: row.get(2).unwrap_or_default(),
        imap_host: row.get(3).unwrap_or_default(),
        imap_port: row.get::<_, i64>(4).unwrap_or(993) as u16,
        imap_security: SecurityMode::from_str(&imap_security),
        imap_username: row.get(6).unwrap_or_default(),
        smtp_host: row.get(7).unwrap_or_default(),
        smtp_port: row.get::<_, i64>(8).unwrap_or(465) as u16,
        smtp_security: SecurityMode::from_str(&smtp_security),
        smtp_username: row.get(10).unwrap_or_default(),
        sent_folder: row.get(11).unwrap_or_else(|_| "Sent".into()),
        drafts_folder: row.get(12).unwrap_or_else(|_| "Drafts".into()),
        trash_folder: row.get(13).unwrap_or_else(|_| "Trash".into()),
        save_sent_copy: row.get::<_, i64>(14).unwrap_or(1) != 0,
        auth_method: row.get(15).unwrap_or_else(|_| "password".into()),
        oauth_client_id: row.get(16).unwrap_or_default(),
    }
}

fn summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MessageSummary> {
    let flags_json: String = row.get(10)?;
    Ok(MessageSummary {
        id: row.get(0)?,
        account_id: row.get(1)?,
        folder: row.get(2)?,
        uid: row.get::<_, i64>(3)? as u32,
        message_id: row.get(4)?,
        thread_key: row.get(11)?,
        subject: row.get(5)?,
        sender: row.get(6)?,
        recipients: row.get(7)?,
        date: row.get(8)?,
        preview: row.get(9)?,
        flags: serde_json::from_str(&flags_json).unwrap_or_default(),
    })
}

pub struct CachedMessage {
    pub account_id: String,
    pub folder: String,
    pub uid: u32,
    pub message_id: Option<String>,
    pub thread_key: String,
    pub body_text: String,
    pub subject: String,
    pub sender: String,
    pub recipients: String,
    pub cc: String,
    pub date: i64,
    pub preview: String,
    pub flags: Vec<String>,
    pub raw: Vec<u8>,
}

pub struct StoredMessage {
    pub summary: MessageSummary,
    pub cc: String,
    pub raw: Vec<u8>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use uuid::Uuid;

    struct TestDatabase {
        db: Database,
        dir: PathBuf,
    }
    impl TestDatabase {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("morrow-db-test-{}", Uuid::new_v4()));
            let db = Database::new(&dir).expect("open new database");
            Self { db, dir }
        }
        fn with_account(&self) {
            self.db
                .save_account(&Account {
                    id: "a".into(),
                    display_name: "Alice".into(),
                    email: "a@example.com".into(),
                    imap_host: "imap.example.com".into(),
                    imap_port: 993,
                    imap_security: SecurityMode::Tls,
                    imap_username: "a".into(),
                    smtp_host: "smtp.example.com".into(),
                    smtp_port: 465,
                    smtp_security: SecurityMode::Tls,
                    smtp_username: "a".into(),
                    sent_folder: "Sent".into(),
                    drafts_folder: "Drafts".into(),
                    trash_folder: "Trash".into(),
                    save_sent_copy: true,
                    auth_method: "password".into(),
                    oauth_client_id: String::new(),
                })
                .unwrap();
        }
        fn add(&self, uid: u32) {
            self.db
                .upsert_message(&CachedMessage {
                    account_id: "a".into(),
                    folder: "INBOX".into(),
                    uid,
                    message_id: None,
                    thread_key: "root".into(),
                    body_text: "a body with searchable terminology".into(),
                    subject: "subject".into(),
                    sender: "sender".into(),
                    recipients: "receiver".into(),
                    cc: String::new(),
                    date: 1,
                    preview: "preview".into(),
                    flags: vec![],
                    raw: b"Subject: subject\r\n\r\nbody".to_vec(),
                })
                .unwrap();
        }
    }
    impl Drop for TestDatabase {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn fts_search_and_unified_inbox_are_account_scoped() {
        let t = TestDatabase::new();
        t.with_account();
        t.add(21);
        assert_eq!(t.db.search_messages("searchable terminology", None).unwrap().len(), 1);
        assert_eq!(t.db.search_messages("searchable", Some("wrong-account")).unwrap().len(), 0);
        assert_eq!(t.db.unified_inbox().unwrap().len(), 1);
        assert_eq!(t.db.conversation("a", "root").unwrap().len(), 1);
        assert_eq!(t.db.search_messages("from:sender", Some("a")).unwrap().len(), 1);
        assert_eq!(t.db.search_messages("in:INBOX", Some("a")).unwrap().len(), 1);
        assert!(t.db.search_messages("from:sender", Some("wrong-account")).unwrap().is_empty());
        assert_eq!(t.db.conversation("wrong-account", "root").unwrap().len(), 0);
        t.db.remove_cached_message("a", "INBOX", 21).unwrap();
        assert!(t.db.search_messages("searchable", None).unwrap().is_empty());
    }

    #[test]
    fn advanced_search_filters_are_offline_account_scoped_and_use_real_utc_dates() {
        let t = TestDatabase::new();
        t.with_account();
        let connection = t.db.connection().unwrap();
        for (uid, folder, date, sender) in [
            (1, "INBOX", "2026-10-01", "billing@example.com"),
            (2, "Sent", "2026-10-30", "billing@example.com"),
            (3, "INBOX", "2026-09-30", "github.com"),
        ] {
            let mut message = crate::mime::cache_message(b"Subject: invoice\r\n\r\nbody", "a", folder, uid, vec![]).unwrap();
            message.sender = sender.into();
            message.date = connection.query_row("SELECT unixepoch(?1)", [date], |row| row.get(0)).unwrap();
            t.db.upsert_message(&message).unwrap();
        }
        assert_eq!(t.db.search_messages("from:github.com", None).unwrap().len(), 1);
        assert_eq!(t.db.search_messages("in:INBOX invoice", None).unwrap().len(), 2);
        assert_eq!(t.db.search_messages("after:2026-10-01", None).unwrap().len(), 2);
        let found = t.db.search_messages("from:billing@example.com before:2026-10-30", Some("a")).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].uid, 1);
        assert!(t.db.search_messages("in:INBOX invoice", Some("other")).unwrap().is_empty());
        assert!(t.db.search_messages("from:%", None).unwrap().is_empty());
        assert!(t.db.search_messages("from:_", None).unwrap().is_empty());
        assert_eq!(t.db.list_messages("a", "INBOX", "from:billing@example.com after:2026-10-01").unwrap().len(), 1);
        assert!(t.db.list_messages("a", "INBOX", "in:Sent invoice").unwrap().is_empty());
        for query in ["after:2026-02-30", "before:2026-13-01", "after:2026-10-00", "before:invalid"] {
            assert!(t.db.search_messages(query, None).is_err(), "{query}");
        }
        assert!(valid_iso_date("2024-02-29"));
        assert!(!valid_iso_date("2026-02-29"));
    }

    #[test]
    fn notification_counts_exclude_initial_backfill_seen_messages_and_uid_resets() {
        let t = TestDatabase::new();
        t.with_account();
        t.db.prepare_folder_sync("a", "INBOX", Some(7)).unwrap();
        let validity = t.db.inbox_uid_validity("a").unwrap();
        t.add(10);
        assert_eq!(t.db.new_unread_count("a", 0, None).unwrap(), 0);
        // An established empty inbox may notify its first genuinely new message.
        assert_eq!(t.db.new_unread_count("a", 0, validity).unwrap(), 1);
        t.add(5);
        t.add(11);
        assert_eq!(t.db.new_unread_count("a", 10, validity).unwrap(), 1);
        t.db.set_cached_flags("a", "INBOX", 11, &["\\Seen".into()]).unwrap();
        assert_eq!(t.db.new_unread_count("a", 10, validity).unwrap(), 0);
        t.db.prepare_folder_sync("a", "INBOX", Some(8)).unwrap();
        t.add(30);
        assert_eq!(t.db.new_unread_count("a", 10, validity).unwrap(), 0);
    }

    #[test]
    fn schema_three_drafts_migrate_without_losing_plain_text_or_fts_data() {
        let t = TestDatabase::new();
        t.with_account();
        t.add(1);
        let draft = LocalDraft {
            id: "legacy".into(),
            account_id: "a".into(),
            to: "to@example.org".into(),
            cc: String::new(),
            bcc: String::new(),
            subject: "Legacy".into(),
            body: "plain draft".into(),
            html_body: None,
            in_reply_to: None,
            references: None,
            attachments: vec![],
            updated_at: 0,
        };
        t.db.save_local_draft(&draft).unwrap();
        t.db.connection()
            .unwrap()
            .execute_batch("ALTER TABLE local_drafts DROP COLUMN html_body; PRAGMA user_version = 3;")
            .unwrap();
        let migrated = Database::new(&t.dir).unwrap();
        let mut recovered = migrated.local_drafts("a").unwrap().remove(0);
        assert_eq!(recovered.body, "plain draft");
        assert!(recovered.html_body.is_none());
        assert_eq!(migrated.search_messages("terminology", None).unwrap().len(), 1);
        recovered.html_body = Some("<p><b>rich draft</b></p>".into());
        migrated.save_local_draft(&recovered).unwrap();
        assert_eq!(Database::new(&t.dir).unwrap().local_drafts("a").unwrap()[0].html_body, recovered.html_body);
    }

    #[test]
    fn fts_updates_and_unread_counts_follow_cached_message_changes() {
        let t = TestDatabase::new();
        t.with_account();
        t.add(1);
        assert_eq!(t.db.unread_counts().unwrap().get("a"), Some(&1));
        let raw = b"Subject: Updated\r\nMessage-ID: <updated@example.org>\r\n\r\nreplacementbody";
        let updated = crate::mime::cache_message(raw, "a", "INBOX", 1, vec!["\\Seen".into()]).unwrap();
        t.db.upsert_message(&updated).unwrap();
        assert!(t.db.search_messages("terminology", None).unwrap().is_empty());
        assert_eq!(t.db.search_messages("replacementbody", Some("a")).unwrap().len(), 1);
        assert_eq!(t.db.unified_inbox().unwrap().len(), 1);
        assert_eq!(t.db.unread_counts().unwrap().get("a").copied().unwrap_or(0), 0);
        t.db.delete_account("a").unwrap();
        assert!(t.db.search_messages("replacementbody", None).unwrap().is_empty());
    }

    #[test]
    fn unified_inbox_preserves_ownership_across_real_accounts_and_excludes_other_folders() {
        let t = TestDatabase::new();
        t.with_account();
        let mut second = t.db.get_account("a").unwrap();
        second.id = "b".into();
        second.email = "b@example.org".into();
        t.db.save_account(&second).unwrap();
        let raw = b"Subject: sharedterm\r\nMessage-ID: <root@example.org>\r\n\r\nbody";
        for (account, folder, uid) in [("a", "INBOX", 1), ("b", "Inbox", 1), ("b", "Sent", 2)] {
            t.db.upsert_message(&crate::mime::cache_message(raw, account, folder, uid, vec![]).unwrap())
                .unwrap();
        }
        let inbox = t.db.unified_inbox().unwrap();
        assert_eq!(inbox.len(), 2);
        assert!(inbox.iter().any(|row| row.account_id == "a"));
        assert!(inbox.iter().any(|row| row.account_id == "b"));
        let a_message = inbox.iter().find(|row| row.account_id == "a").unwrap();
        assert!(t.db.get_message_record("b", a_message.id).is_err());
        assert_eq!(t.db.search_messages("sharedterm", Some("a")).unwrap().len(), 1);
        assert_eq!(t.db.search_messages("sharedterm", Some("b")).unwrap().len(), 2);
        assert_eq!(t.db.conversation("a", "<root@example.org>").unwrap().len(), 1);
        assert_eq!(t.db.conversation("b", "<root@example.org>").unwrap().len(), 2);
    }

    #[test]
    fn schema_two_cache_migration_indexes_existing_mime_bodies_and_conversations() {
        let t = TestDatabase::new();
        t.with_account();
        t.add(1);
        {
            let connection = t.db.connection().unwrap();
            connection
                .execute(
                    "UPDATE messages SET raw=?1",
                    [b"Subject: legacy\r\nMessage-ID: <legacy@example.org>\r\n\r\nlegacybodytoken".as_slice()],
                )
                .unwrap();
            connection
                .execute_batch(
                    "DROP TRIGGER message_fts_insert;
                 DROP TRIGGER message_fts_delete;
                 DROP TRIGGER message_fts_update;
                 DROP TABLE message_fts;
                 ALTER TABLE messages DROP COLUMN body_text;
                 ALTER TABLE messages DROP COLUMN thread_key;
                 PRAGMA user_version = 2;",
                )
                .unwrap();
        }
        let reopened = Database::new(&t.dir).unwrap();
        assert_eq!(reopened.search_messages("legacybodytoken", Some("a")).unwrap().len(), 1);
        assert_eq!(reopened.conversation("a", "<legacy@example.org>").unwrap().len(), 1);
        // Reopening must not duplicate or corrupt the external-content index.
        assert_eq!(Database::new(&t.dir).unwrap().search_messages("legacybodytoken", None).unwrap().len(), 1);
    }

    #[test]
    fn local_drafts_are_persistent_and_cannot_cross_accounts() {
        let t = TestDatabase::new();
        t.with_account();
        let draft = LocalDraft {
            id: "draft-1".into(),
            account_id: "a".into(),
            to: "recipient@example.org".into(),
            cc: String::new(),
            bcc: String::new(),
            subject: "saved".into(),
            body: "not sent".into(),
            html_body: Some("<p>not sent</p>".into()),
            in_reply_to: None,
            references: None,
            attachments: vec![],
            updated_at: 0,
        };
        t.db.save_local_draft(&draft).unwrap();
        let entries = t.db.local_drafts("a").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].body, "not sent");
        assert_eq!(entries[0].html_body.as_deref(), Some("<p>not sent</p>"));
        assert!(t.db.local_drafts("other").unwrap().is_empty());
        t.db.delete_local_draft("other", "draft-1").unwrap();
        assert_eq!(t.db.local_drafts("a").unwrap().len(), 1);
        t.db.delete_local_draft("a", "draft-1").unwrap();
        assert!(t.db.local_drafts("a").unwrap().is_empty());
    }

    #[test]
    fn retains_uids_when_validity_unchanged_and_resets_when_changed() {
        let t = TestDatabase::new();
        t.with_account();
        t.db.prepare_folder_sync("a", "INBOX", Some(100)).unwrap();
        t.add(1);
        t.db.prepare_folder_sync("a", "INBOX", Some(100)).unwrap();
        assert!(t.db.has_cached_message("a", "INBOX", 1).unwrap());
        t.db.prepare_folder_sync("a", "INBOX", Some(101)).unwrap();
        assert!(!t.db.has_cached_message("a", "INBOX", 1).unwrap());
    }

    #[test]
    fn pruning_deletes_only_missing_messages_in_selected_folder() {
        let t = TestDatabase::new();
        t.with_account();
        t.add(1);
        t.add(2);
        t.add(3);
        t.db.prune_missing_uids("a", "INBOX", &HashSet::from([2, 3])).unwrap();
        assert!(!t.db.has_cached_message("a", "INBOX", 1).unwrap());
        assert!(t.db.has_cached_message("a", "INBOX", 2).unwrap());
        assert!(t.db.has_cached_message("a", "INBOX", 3).unwrap());
    }

    #[test]
    fn flags_and_account_deletion_are_persisted() {
        let t = TestDatabase::new();
        t.with_account();
        t.add(5);
        t.db.set_cached_flags("a", "INBOX", 5, &["Seen".into(), "Flagged".into()]).unwrap();
        assert_eq!(t.db.cached_flags("a", "INBOX", 5).unwrap(), vec!["Seen", "Flagged"]);
        t.db.delete_account("a").unwrap();
        assert!(!t.db.has_cached_message("a", "INBOX", 5).unwrap());
    }
}

#[cfg(test)]
mod schema_forward_compatibility_test {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn refuses_newer_database_schema_without_modifying_version() {
        let directory = std::env::temp_dir().join(format!("morrow-schema-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("mail.sqlite3");
        {
            let db = Connection::open(&path).unwrap();
            db.pragma_update(None, "user_version", 999).unwrap();
        }
        let result = Database::new(&directory);
        assert!(result.is_err());
        {
            let db = Connection::open(&path).unwrap();
            let version: i64 = db.pragma_query_value(None, "user_version", |row| row.get(0)).unwrap();
            assert_eq!(version, 999);
        }
        let _ = std::fs::remove_dir_all(&directory);
    }
}

#[cfg(test)]
mod legacy_upgrade_test {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn adds_sent_copy_to_legacy_account_database() {
        let dir = std::env::temp_dir().join(format!("morrow-legacy-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        {
            let connection = Connection::open(dir.join("mail.sqlite3")).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE accounts (
                    id TEXT PRIMARY KEY, display_name TEXT NOT NULL, email TEXT NOT NULL,
                    imap_host TEXT NOT NULL, imap_port INTEGER NOT NULL, imap_security TEXT NOT NULL,
                    imap_username TEXT NOT NULL, smtp_host TEXT NOT NULL, smtp_port INTEGER NOT NULL,
                    smtp_security TEXT NOT NULL, smtp_username TEXT NOT NULL,
                    sent_folder TEXT NOT NULL, drafts_folder TEXT NOT NULL, trash_folder TEXT NOT NULL
                );",
                )
                .unwrap();
        }
        let db = Database::new(&dir).expect("legacy schema upgraded");
        let connection = db.connection().unwrap();
        let mut statement = connection.prepare("PRAGMA table_info(accounts)").unwrap();
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(columns.contains(&"save_sent_copy".to_string()));
        drop(statement);
        drop(connection);
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
