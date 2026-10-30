import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("IMAP uses capability-gated IDLE with bounded sessions and polling fallback", () => {
    const imap = read("src-tauri/src/imap.rs");
    const app = read("src-tauri/src/lib.rs");
    assert.match(imap, /caps\.has_str\("IDLE"\)/);
    assert.match(imap, /\.wait_with_timeout\(Duration::from_secs\(110\)\)/);
    assert.match(imap, /idle\.done\(\)/);
    assert.match(app, /AUTO_SYNC_INTERVAL: Duration = Duration::from_secs\(60\)/);
    assert.match(app, /idle_inbox_once/);
    assert.match(app, /backoff = \(backoff \* 2\)\.min\(300\)/);
    assert.match(app, /task\.abort\(\)/);
    assert.match(app, /try_lock_owned\(\)/);
    assert.match(imap, /timeout\(Duration::from_secs\(180\), idle_inbox_cycle/);
});

test("new-mail notifications are opt-in, account-mutable and contain no message content", () => {
    const app = read("src-tauri/src/lib.rs");
    const ui = read("src/components/mail/desktop-notifications.tsx");
    const pref = read("src/lib/preferences.ts");
    assert.match(app, /new_unread_count\(&account\.id, before, validity\)/);
    assert.match(app, /count > 0 && synced > 0/);
    assert.match(app, /app\.emit\("mail:new"/);
    assert.match(ui, /getPreferences\(\)\.desktopNotifications/);
    assert.match(ui, /getPreferences\(\)\.mutedAccounts\.includes/);
    assert.doesNotMatch(ui, /payload\.(sender|subject|body)/);
    assert.match(pref, /desktopNotifications: false/);
    assert.match(pref, /mutedAccounts: \[\]/);
});

test("tray and native notification permission are available only to the main webview", () => {
    const app = read("src-tauri/src/lib.rs");
    const main = JSON.parse(read("src-tauri/capabilities/default.json"));
    const composer = JSON.parse(read("src-tauri/capabilities/compose.json"));
    assert.match(app, /TrayIconBuilder::with_id\("morrow-tray"\)/);
    assert.match(app, /tauri_plugin_notification::init\(\)/);
    assert.ok(main.permissions.includes("notification:allow-notify"));
    assert.ok(!composer.permissions.some((permission) => permission.startsWith("notification:")));
});

test("rich HTML draft format survives local migration and creates MIME multipart alternative", () => {
    const db = read("src-tauri/src/db.rs");
    const smtp = read("src-tauri/src/smtp.rs");
    const compose = read("src/components/mail/compose-window.tsx");
    assert.match(db, /ALTER TABLE local_drafts ADD COLUMN html_body TEXT/);
    assert.match(db, /connection\.pragma_update\(None, "user_version", 6\)/);
    assert.match(smtp, /MultiPart::alternative\(\)/);
    assert.match(smtp, /ContentType::TEXT_HTML/);
    assert.match(compose, /sanitizeOutgoingHtml\(htmlBody\)/);
    assert.match(compose, /onPaste=\{/);
});

test("filtered SQLite search uses bound parameters and validates date operators", () => {
    const db = read("src-tauri/src/db.rs");
    for (const op of ["from:", "in:", "after:", "before:"]) assert.ok(db.includes(`strip_prefix("${op}")`));
    assert.match(db, /params!\[expression, account_id, sender_like, folder, after, before\]/);
    assert.match(db, /fn valid_iso_date\(/);
    assert.match(db, /fn escape_like\(/);
});
