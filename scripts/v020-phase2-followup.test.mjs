import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("remote drafts use immutable UUID headers, confirm APPEND, require UIDPLUS and expunge by UID", () => {
    const imap = source("src-tauri/src/imap.rs");
    const smtp = source("src-tauri/src/smtp.rs");
    const commands = source("src-tauri/src/commands.rs");
    assert.match(imap, /caps\.has_str\("UIDPLUS"\)/);
    assert.match(imap, /HEADER X-Morrow-Draft-ID/);
    assert.match(imap, /BODY\.PEEK\[HEADER\]/);
    assert.match(imap, /reselected\.uid_validity != Some\(initial_validity\)/);
    assert.match(imap, /if !confirmed\.iter\(\)\.any/);
    assert.match(imap, /session\.uid_expunge\(&set\)/);
    assert.doesNotMatch(imap.slice(imap.indexOf("pub async fn sync_owned_draft")), /session\.expunge\(\)/);
    assert.match(smtp, /Uuid::parse_str\(&draft.id\)/);
    assert.match(smtp, /X-Morrow-Draft-Revision/);
    assert.match(commands, /sync_remote_draft/);
    assert.match(commands, /delete_remote_draft/);
});

test("inline images are explicitly selected, bounded, sanitized and CID-embedded", () => {
    const compose = source("src/components/mail/compose-window.tsx");
    const smtp = source("src-tauri/src/smtp.rs");
    assert.match(compose, /image\.src = dataUrl/);
    assert.match(compose, /file\.size > 2 \* 1024 \* 1024/);
    assert.match(source("src/lib/compose-html.ts"), /image\.remove\(\)/);
    assert.match(compose, /event\.clipboardData\.getData\("text\/plain"\)/);
    assert.match(smtp, /fn extract_inline_images/);
    assert.match(smtp, /MultiPart::related\(\)/);
    assert.match(smtp, /Attachment::new_inline\(cid\)/);
    assert.match(smtp, /decode_image_base64\(encoded\)/);
});

test("unread badge is platform-specific and produced from SQLite counts", () => {
    const app = source("src-tauri/src/lib.rs");
    assert.match(app, /update_unread_indicators\(&db, app.handle\(\)\)/);
    assert.match(app, /counts\.values\(\)\.sum\(\)/);
    assert.match(app, /set_overlay_icon\(icon\)/);
    assert.match(app, /set_badge_count/);
    assert.match(app, /#\[cfg\(target_os = "windows"\)\]/);
    for (let i = 1; i <= 10; i++) assert.ok(existsSync(new URL(`../src-tauri/icons/unread-${i}.png`, import.meta.url)));
});

test("draft autosaves are serialized, and a network error never clears the SQLite recovery copy", () => {
    const compose = source("src/components/mail/compose-window.tsx");
    assert.match(compose, /lastSave\.current\s*\.catch\(\(\) => undefined\)\s*\.then\(async \(\) =>/);
    assert.match(compose, /await mailApi\.saveLocalDraft\(snapshot\)/);
    assert.match(compose, /if \(!\(await saveDraft\(\)\)\)/);
    assert.match(compose, /await mailApi\.syncRemoteDraft/);
    assert.match(compose, /Could not sync Drafts folder/);
});
