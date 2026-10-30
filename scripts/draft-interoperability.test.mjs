import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("external IMAP import is explicitly read-only and UIDVALIDITY-bound", () => {
    const code = source("src-tauri/src/imap.rs");
    const start = code.indexOf("pub async fn fetch_external_draft(");
    const end = code.indexOf("// The sync reader intentionally", start);
    assert.ok(start >= 0 && end > start);
    const block = code.slice(start, end);
    assert.match(block, /expected_uid_validity/);
    assert.match(block, /BODY\.PEEK\[\]/);
    assert.match(block, /X-Morrow-Draft-ID/);
    assert.match(block, /8 \* 1024 \* 1024/);
    assert.doesNotMatch(block, /uid_expunge|uid_store|session\.append\(/);
});

test("import parser rejects encrypted MIME, bounds CID images, and persists attachments with safe names", () => {
    const code = source("src-tauri/src/draft_import.rs");
    assert.match(code, /multipart\/encrypted/);
    assert.match(code, /multipart\/signed/);
    assert.match(code, /MAX_INLINE_BYTES/);
    assert.match(code, /MAX_FILES/);
    assert.match(code, /unresolved CID references/);
    assert.match(code, /STANDARD\.encode/);
    assert.match(code, /rsplit\(\['\/', '\\\\'\]\)/);
    assert.match(code, /fs::write\(&path, bytes\)/);
    assert.match(code, /Original server message remains untouched|Original server draft/);
    assert.doesNotMatch(code, /delete_owned_draft|sync_owned_draft|uid_expunge/);
});

test("recipient-less drafts can be formatted without weakening send validation", () => {
    const code = source("src-tauri/src/smtp.rs");
    assert.match(code, /build_message_internal\(account, &input, false\)/);
    assert.match(code, /build_message_internal\(account, input, true\)/);
    assert.match(code, /builder\.keep_bcc\(\)/);
    assert.match(code, /Envelope::new/);
    assert.match(code, /if to\.is_empty\(\) && require_recipient/);
});

test("external provider import is wired through Tauri and explicitly offered in Drafts dialog", () => {
    const commands = source("src-tauri/src/commands.rs");
    const lib = source("src-tauri/src/lib.rs");
    const api = source("src/lib/mail-api.ts");
    const dialog = source("src/components/mail/local-drafts-dialog.tsx");
    for (const name of ["list_external_drafts", "import_external_draft"]) {
        assert.ok(commands.includes(`fn ${name}(`));
        assert.ok(lib.includes(`commands::${name}`));
        assert.ok(api.includes(`"${name}"`));
    }
    assert.match(dialog, /Import copy/);
    assert.match(dialog, /original server draft was not changed/);
});
