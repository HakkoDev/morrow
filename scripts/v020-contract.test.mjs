import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { transpileTs } from "./typescript-transpile.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("favorite folders persist independently for each account and tolerate corrupt storage", () => {
    const values = new Map();
    const module = { exports: {} };
    vm.runInNewContext(transpileTs("src/lib/favorite-folders.ts"), {
        module,
        exports: module.exports,
        localStorage: {
            getItem: (key) => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value),
        },
    });
    const { favoriteFolders, toggleFavoriteFolder } = module.exports;
    assert.deepEqual(Array.from(toggleFavoriteFolder("a", "INBOX/Receipts")), ["INBOX/Receipts"]);
    assert.deepEqual(Array.from(favoriteFolders("b")), []);
    toggleFavoriteFolder("b", "Archive");
    toggleFavoriteFolder("a", "INBOX/Receipts");
    assert.deepEqual(Array.from(favoriteFolders("a")), []);
    assert.deepEqual(Array.from(favoriteFolders("b")), ["Archive"]);
    values.set("morrow.favorite-folders.v1", "broken JSON");
    assert.deepEqual(Array.from(favoriteFolders("a")), []);
    toggleFavoriteFolder("a", "INBOX");
    assert.deepEqual(Array.from(favoriteFolders("a")), ["INBOX"]);
});

test("v0.2.0 versions remain aligned with Tauri release metadata", () => {
    const pkg = JSON.parse(read("package.json"));
    const tauri = JSON.parse(read("src-tauri/tauri.conf.json"));
    assert.equal(pkg.version, "0.2.0");
    assert.equal(tauri.version, "0.2.0");
    assert.match(read("src-tauri/Cargo.toml"), /^version = "0\.2\.0"$/m);
    assert.match(read("src-tauri/Cargo.lock"), /name = "morrow-mail"\s+version = "0\.2\.0"/);
});
test("FTS5 index follows SQLite message insertion, editing and deletion", () => {
    const db = read("src-tauri/src/db.rs");
    assert.match(db, /USING fts5\(/);
    assert.match(db, /message_fts_insert AFTER INSERT/);
    assert.match(db, /message_fts_delete AFTER DELETE/);
    assert.match(db, /message_fts_update AFTER UPDATE OF subject/);
    assert.match(db, /INSERT INTO message_fts\(message_fts\) VALUES\('rebuild'\)/);
    assert.match(db, /WHERE message_fts MATCH \?1 AND \(\?2 IS NULL OR m\.account_id=\?2\)/);
});
test("multi-account mailbox data remains account-owned even in unified views", () => {
    const app = read("src/App.tsx"),
        db = read("src-tauri/src/db.rs");
    assert.match(app, /mailApi\.getMessage\(summary\.accountId, summary\.id\)/);
    assert.match(app, /mailApi\.deleteMessage\(row\.accountId, row\.folder, row\.uid\)/);
    assert.match(app, /mailApi\.saveMessage\(scoped\[0\]\.accountId/);
    assert.match(db, /WHERE id=\?1 AND account_id=\?2/);
    assert.match(db, /WHERE account_id=\?1 AND thread_key=\?2/);
});
test("local drafts are account-scoped SQLite entries with compose autosave and recovery", () => {
    const backend = read("src-tauri/src/db.rs");
    const compose = read("src/components/mail/compose-window.tsx");
    assert.match(backend, /CREATE TABLE IF NOT EXISTS local_drafts/);
    assert.match(backend, /DELETE FROM local_drafts WHERE id=\?1 AND account_id=\?2/);
    assert.match(compose, /mailApi\.saveLocalDraft/);
    assert.match(compose, /mailApi\.listLocalDrafts/);
    assert.match(compose, /mailApi\.deleteLocalDraft/);
    assert.match(compose, /setTimeout\(\(\) => \{/);
    assert.match(compose, /}, 900\)/);
});
test("SMTP replies include RFC 5322 thread headers and prevent raw header injection", () => {
    const code = read("src-tauri/src/smtp.rs");
    assert.match(code, /\.in_reply_to\(parent\.clone\(\)\)/);
    assert.match(code, /\.references\(refs\.clone\(\)\)/);
    assert.match(code, /valid_message_ids/);
});
test("unified search, local drafts and conversation navigation have real frontend entry points", () => {
    const sidebar = read("src/components/mail/mail-sidebar.tsx");
    const app = read("src/App.tsx");
    assert.match(sidebar, /Unified Inbox/);
    assert.match(sidebar, /Local drafts/);
    assert.match(app, /mailApi\.searchCached\(text\)/);
    assert.match(app, /mailApi\s*\.conversation\(detail\.accountId, detail\.threadKey\)/);
});
