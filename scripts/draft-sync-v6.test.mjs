import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("draft sync migration refuses newer DBs and stores scoped compare-and-swap baselines", () => {
    const db = source("src-tauri/src/db.rs");
    assert.match(db, /schema_version > 6/);
    assert.match(db, /"user_version", 6/);
    assert.match(db, /PRIMARY KEY\(account_id, draft_id\)/);
    assert.match(db, /ON DELETE CASCADE/);
    assert.match(db, /fn replace_unedited_draft/);
    assert.match(db, /transaction\(\)/);
    assert.match(db, /draft_revision\)/);
    assert.match(db, /fn draft_sync_stamps\(/);
});

test("IMAP sync is bounded, UID-scoped, and verifies bytes before remote cleanup", () => {
    const imap = source("src-tauri/src/imap.rs");
    assert.match(imap, /uids\.len\(\) > 500/);
    assert.match(imap, /BODY\.PEEK\[HEADER\]/);
    assert.match(imap, /BODY\.PEEK\[\]/);
    assert.match(imap, /Sha256::digest\(bytes\)/);
    assert.match(imap, /caps\.has_str\("UIDPLUS"\)/);
    assert.match(imap, /session\.uid_expunge\(&set\)/);
    assert.doesNotMatch(imap, /session\.expunge\(/);
    assert.match(imap, /expected_remote_hash: Option<&str>/);
    assert.match(imap, /crate::mime::draft_has_attachments/);
});

test("reconciliation uses 3-way conflict logic and creates backups, not overwrites", () => {
    const sync = source("src-tauri/src/draft_sync.rs");
    assert.match(sync, /local_dirty, server_dirty/);
    assert.match(sync, /\(true, true\) =>/);
    assert.match(sync, /\[Server copy\]/);
    assert.match(sync, /\[Local backup\]/);
    assert.match(sync, /\[Server backup\]/);
    assert.match(sync, /replace_unedited_draft/);
    assert.match(sync, /remote-missing/);
    assert.match(sync, /current_editors\.contains/);
    assert.match(sync, /pub async fn resolve\(/);
    assert.match(sync, /status == "recovery"/);
});

test("composer autosave, background sync and conflict UI are wired to native commands", () => {
    const commands = source("src-tauri/src/commands.rs");
    const lib = source("src-tauri/src/lib.rs");
    const composer = source("src/components/mail/compose-window.tsx");
    const dialog = source("src/components/mail/local-drafts-dialog.tsx");
    for (const name of ["refresh_remote_drafts", "draft_sync_statuses", "set_draft_editor_active", "resolve_draft_conflict"]) {
        assert.ok(commands.includes(`fn ${name}(`), `Missing Rust command: ${name}`);
        assert.ok(lib.includes(`commands::${name}`), `Missing Tauri registration: ${name}`);
    }
    assert.match(composer, /mailApi\.setDraftEditorActive/);
    assert.match(composer, /mailApi\.syncRemoteDraft/);
    assert.match(lib, /Duration::from_secs\(180\)/);
    assert.match(dialog, /Keep local/);
    assert.match(dialog, /Use server/);
    assert.match(dialog, /Refresh Drafts/);
});

test("SQLite v6 draft state behaves correctly under cascade and account isolation", () => {
    const schema = source("src-tauri/src/db.rs");
    const table = schema.match(/CREATE TABLE IF NOT EXISTS draft_sync_state \([\s\S]*?\n {12}\);/);
    assert.ok(table);
    // Use the CI-pinned Node runtime's SQLite, not the runner's older Python SQLite.
    const db = new DatabaseSync(":memory:");
    try {
        db.exec("PRAGMA foreign_keys=ON; CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('a'),('b');");
        db.exec(table[0]);
        const insert = db.prepare("INSERT INTO draft_sync_state(account_id,draft_id,local_revision,remote_revision,remote_hash,status) VALUES(?,?,?,?,?,?)");
        insert.run("a", "draft-1", "base", "remote", "hash", "synced");
        insert.run("b", "draft-1", "other", "other", "hash2", "conflict");
        const local = db.prepare("SELECT local_revision, updated_at FROM draft_sync_state WHERE account_id='a'").get();
        assert.equal(local.local_revision, "base");
        assert.ok(Number.isInteger(local.updated_at) && local.updated_at > 0, "Schema timestamp default must execute successfully");
        assert.throws(() => insert.run("a", "draft-1", "duplicate", "remote", "hash", "synced"), /UNIQUE constraint failed/);
        assert.throws(() => insert.run("missing", "draft-1", "base", "remote", "hash", "synced"), /FOREIGN KEY constraint failed/);
        db.exec("DELETE FROM accounts WHERE id='a'");
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM draft_sync_state WHERE account_id='a'").get().count, 0);
        assert.equal(db.prepare("SELECT status FROM draft_sync_state WHERE account_id='b'").get().status, "conflict");
    } finally {
        db.close();
    }
});
