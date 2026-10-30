use std::{fs, path::{Path, PathBuf}};

use rusqlite::{params, Connection, OptionalExtension};

use crate::models::{Account, FolderInfo, MessageSummary, SecurityMode};

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
        let schema_version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|e| e.to_string())?;
        if schema_version > 2 {
            return Err(format!("Mail cache schema version {schema_version} is newer than this Morrow build supports (2). Use a newer build to avoid corrupting your data."));
        }
        connection.execute_batch(
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
                save_sent_copy INTEGER NOT NULL DEFAULT 1
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
            CREATE TABLE IF NOT EXISTS folder_cache (
                account_id TEXT NOT NULL PRIMARY KEY,
                folders_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );
            "#,
        ).map_err(|e| e.to_string())?;
        // Upgrade databases created by early pre-0.1.1 builds. Do not ignore
        // arbitrary migration failures: an incompatible schema must fail early.
        let has_sent_copy = {
            let mut statement = connection.prepare("PRAGMA table_info(accounts)").map_err(|e| e.to_string())?;
            let columns = statement.query_map([], |row| row.get::<_, String>(1)).map_err(|e| e.to_string())?;
            let names = columns.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
            names.iter().any(|name| name == "save_sent_copy")
        };
        if !has_sent_copy {
            connection.execute("ALTER TABLE accounts ADD COLUMN save_sent_copy INTEGER NOT NULL DEFAULT 1", [])
                .map_err(|e| format!("Cannot upgrade legacy account schema: {e}"))?;
        }
        connection.pragma_update(None, "user_version", 2).map_err(|e| e.to_string())?;
        Ok(())
    }

    // Folder discovery is persisted to disk, not a renderer-only cache. Clicking
    // an account/folder can always show its previous snapshot while IMAP updates.
    pub fn cached_folders(&self, account_id: &str) -> Result<Vec<FolderInfo>, String> {
        let connection = self.connection()?;
        let value: Option<String> = connection.query_row(
            "SELECT folders_json FROM folder_cache WHERE account_id=?1", [account_id], |row| row.get(0),
        ).optional().map_err(|e| e.to_string())?;
        value.map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string()))
            .unwrap_or(Ok(Vec::new()))
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
        tx.execute("DELETE FROM messages WHERE account_id=?1 AND folder=?2", params![account_id, folder]).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM folder_state WHERE account_id=?1 AND folder=?2", params![account_id, folder]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn list_accounts(&self) -> Result<Vec<Account>, String> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, display_name, email, imap_host, imap_port, imap_security, imap_username, smtp_host, smtp_port, smtp_security, smtp_username, sent_folder, drafts_folder, trash_folder, save_sent_copy FROM accounts ORDER BY rowid"
        ).map_err(|e| e.to_string())?;
        let rows = statement.query_map([], |row| Ok(account_from_row(row)))
            .map_err(|e| e.to_string())?;
        rows.map(|row| row.map_err(|e| e.to_string())).collect()
    }

    pub fn get_account(&self, id: &str) -> Result<Account, String> {
        let connection = self.connection()?;
        connection.query_row(
            "SELECT id, display_name, email, imap_host, imap_port, imap_security, imap_username, smtp_host, smtp_port, smtp_security, smtp_username, sent_folder, drafts_folder, trash_folder, save_sent_copy FROM accounts WHERE id = ?1",
            [id],
            |row| Ok(account_from_row(row)),
        ).map_err(|e| e.to_string())
    }

    pub fn save_account(&self, account: &Account) -> Result<(), String> {
        let connection = self.connection()?;
        connection.execute(
            r#"INSERT INTO accounts (
                id, display_name, email, imap_host, imap_port, imap_security, imap_username,
                smtp_host, smtp_port, smtp_security, smtp_username, sent_folder, drafts_folder, trash_folder, save_sent_copy
            ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
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
                save_sent_copy=excluded.save_sent_copy"#,
            params![
                account.id, account.display_name, account.email, account.imap_host, account.imap_port,
                account.imap_security.as_str(), account.imap_username, account.smtp_host, account.smtp_port,
                account.smtp_security.as_str(), account.smtp_username, account.sent_folder,
                account.drafts_folder, account.trash_folder, account.save_sent_copy as i64
            ],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_account(&self, id: &str) -> Result<(), String> {
        let connection = self.connection()?;
        connection.execute("DELETE FROM accounts WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn upsert_message(&self, message: &CachedMessage) -> Result<(), String> {
        let connection = self.connection()?;
        connection.execute(
            r#"INSERT INTO messages (account_id, folder, uid, message_id, subject, sender, recipients, cc, date, preview, flags_json, raw)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
            ON CONFLICT(account_id, folder, uid) DO UPDATE SET
                message_id=excluded.message_id,
                subject=excluded.subject,
                sender=excluded.sender,
                recipients=excluded.recipients,
                cc=excluded.cc,
                date=excluded.date,
                preview=excluded.preview,
                flags_json=excluded.flags_json,
                raw=excluded.raw"#,
            params![
                message.account_id, message.folder, message.uid, message.message_id, message.subject,
                message.sender, message.recipients, message.cc, message.date, message.preview,
                serde_json::to_string(&message.flags).unwrap_or_else(|_| "[]".to_string()), message.raw
            ],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_messages(&self, account_id: &str, folder: &str, query: &str) -> Result<Vec<MessageSummary>, String> {
        let connection = self.connection()?;
        let like = format!("%{}%", query.trim());
        let sql = if query.trim().is_empty() {
            "SELECT id, account_id, folder, uid, message_id, subject, sender, recipients, date, preview, flags_json FROM messages WHERE account_id=?1 AND folder=?2 ORDER BY date DESC, uid DESC LIMIT 1000"
        } else {
            "SELECT id, account_id, folder, uid, message_id, subject, sender, recipients, date, preview, flags_json FROM messages WHERE account_id=?1 AND folder=?2 AND (subject LIKE ?3 OR sender LIKE ?3 OR recipients LIKE ?3 OR preview LIKE ?3) ORDER BY date DESC, uid DESC LIMIT 1000"
        };
        let mut statement = connection.prepare(sql).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        if query.trim().is_empty() {
            let rows = statement.query_map(params![account_id, folder], summary_from_row).map_err(|e| e.to_string())?;
            for row in rows { out.push(row.map_err(|e| e.to_string())?); }
        } else {
            let rows = statement.query_map(params![account_id, folder, like], summary_from_row).map_err(|e| e.to_string())?;
            for row in rows { out.push(row.map_err(|e| e.to_string())?); }
        }
        Ok(out)
    }

    pub fn get_message_record(&self, account_id: &str, message_id: i64) -> Result<StoredMessage, String> {
        let connection = self.connection()?;
        connection.query_row(
            "SELECT id, account_id, folder, uid, message_id, subject, sender, recipients, cc, date, preview, flags_json, raw FROM messages WHERE id=?1 AND account_id=?2",
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
        connection.execute(
            "UPDATE messages SET flags_json=?4 WHERE account_id=?1 AND folder=?2 AND uid=?3",
            params![account_id, folder, uid, serde_json::to_string(flags).unwrap_or_else(|_| "[]".into())],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_cached_message(&self, account_id: &str, folder: &str, uid: u32) -> Result<(), String> {
        let connection = self.connection()?;
        connection.execute("DELETE FROM messages WHERE account_id=?1 AND folder=?2 AND uid=?3", params![account_id, folder, uid]).map_err(|e| e.to_string())?;
        Ok(())
    }


    pub fn prepare_folder_sync(&self, account_id: &str, folder: &str, uid_validity: Option<u32>) -> Result<(), String> {
        // If UIDVALIDITY changes, purge old UIDs and record the new validity in
        // one transaction. A crash between these operations could otherwise
        // associate stale cached messages with the wrong server UIDs.
        let mut connection = self.connection()?;
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        let previous: Option<Option<i64>> = tx.query_row(
            "SELECT uid_validity FROM folder_state WHERE account_id=?1 AND folder=?2",
            params![account_id, folder],
            |row| row.get(0),
        ).optional().map_err(|e| e.to_string())?;
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
            let mut statement = tx.prepare("SELECT uid FROM messages WHERE account_id=?1 AND folder=?2").map_err(|e| e.to_string())?;
            let rows = statement.query_map(params![account_id, folder], |row| row.get::<_, i64>(0))
                .map_err(|e| e.to_string())?;
            let mut stale = Vec::new();
            for row in rows {
                let uid = row.map_err(|e| e.to_string())? as u32;
                if !server_uids.contains(&uid) { stale.push(uid); }
            }
            stale
        };
        for uid in stale {
            tx.execute("DELETE FROM messages WHERE account_id=?1 AND folder=?2 AND uid=?3", params![account_id, folder, uid])
                .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn has_cached_message(&self, account_id: &str, folder: &str, uid: u32) -> Result<bool, String> {
        let connection = self.connection()?;
        let exists: i64 = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM messages WHERE account_id=?1 AND folder=?2 AND uid=?3)",
            params![account_id, folder, uid],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        Ok(exists != 0)
    }

    pub fn cached_flags(&self, account_id: &str, folder: &str, uid: u32) -> Result<Vec<String>, String> {
        let connection = self.connection()?;
        let value: Option<String> = connection.query_row(
            "SELECT flags_json FROM messages WHERE account_id=?1 AND folder=?2 AND uid=?3",
            params![account_id, folder, uid],
            |row| row.get(0),
        ).optional().map_err(|e| e.to_string())?;
        Ok(value.and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default())
    }
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
    use uuid::Uuid;
    use std::collections::HashSet;

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
            self.db.save_account(&Account {
                id: "a".into(), display_name: "Alice".into(), email: "a@example.com".into(),
                imap_host: "imap.example.com".into(), imap_port: 993, imap_security: SecurityMode::Tls,
                imap_username: "a".into(), smtp_host: "smtp.example.com".into(), smtp_port: 465,
                smtp_security: SecurityMode::Tls, smtp_username: "a".into(), sent_folder: "Sent".into(),
                drafts_folder: "Drafts".into(), trash_folder: "Trash".into(), save_sent_copy: true,
            }).unwrap();
        }
        fn add(&self, uid: u32) {
            self.db.upsert_message(&CachedMessage {
                account_id: "a".into(), folder: "INBOX".into(), uid, message_id: None,
                subject: "subject".into(), sender: "sender".into(), recipients: "receiver".into(),
                cc: String::new(), date: 1, preview: "preview".into(), flags: vec![],
                raw: b"Subject: subject\r\n\r\nbody".to_vec(),
            }).unwrap();
        }
    }
    impl Drop for TestDatabase {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.dir); }
    }

    #[test]
    fn retains_uids_when_validity_unchanged_and_resets_when_changed() {
        let t = TestDatabase::new(); t.with_account();
        t.db.prepare_folder_sync("a", "INBOX", Some(100)).unwrap();
        t.add(1);
        t.db.prepare_folder_sync("a", "INBOX", Some(100)).unwrap();
        assert!(t.db.has_cached_message("a", "INBOX", 1).unwrap());
        t.db.prepare_folder_sync("a", "INBOX", Some(101)).unwrap();
        assert!(!t.db.has_cached_message("a", "INBOX", 1).unwrap());
    }

    #[test]
    fn pruning_deletes_only_missing_messages_in_selected_folder() {
        let t = TestDatabase::new(); t.with_account();
        t.add(1); t.add(2); t.add(3);
        t.db.prune_missing_uids("a", "INBOX", &HashSet::from([2,3])).unwrap();
        assert!(!t.db.has_cached_message("a", "INBOX", 1).unwrap());
        assert!(t.db.has_cached_message("a", "INBOX", 2).unwrap());
        assert!(t.db.has_cached_message("a", "INBOX", 3).unwrap());
    }

    #[test]
    fn flags_and_account_deletion_are_persisted() {
        let t = TestDatabase::new(); t.with_account(); t.add(5);
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
            connection.execute_batch(
                "CREATE TABLE accounts (
                    id TEXT PRIMARY KEY, display_name TEXT NOT NULL, email TEXT NOT NULL,
                    imap_host TEXT NOT NULL, imap_port INTEGER NOT NULL, imap_security TEXT NOT NULL,
                    imap_username TEXT NOT NULL, smtp_host TEXT NOT NULL, smtp_port INTEGER NOT NULL,
                    smtp_security TEXT NOT NULL, smtp_username TEXT NOT NULL,
                    sent_folder TEXT NOT NULL, drafts_folder TEXT NOT NULL, trash_folder TEXT NOT NULL
                );",
            ).unwrap();
        }
        let db = Database::new(&dir).expect("legacy schema upgraded");
        let connection = db.connection().unwrap();
        let mut statement = connection.prepare("PRAGMA table_info(accounts)").unwrap();
        let columns = statement.query_map([], |row| row.get::<_, String>(1)).unwrap()
            .collect::<Result<Vec<_>, _>>().unwrap();
        assert!(columns.contains(&"save_sent_copy".to_string()));
        drop(statement);
        drop(connection);
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
