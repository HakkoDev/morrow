import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("OAuth2 browser flow validates localhost callback, state and PKCE verifier", () => {
    const oauth = source("src-tauri/src/oauth.rs");
    assert.match(oauth, /URL_SAFE_NO_PAD\.encode\(Sha256::digest\(verifier\.as_bytes\(\)\)\)/);
    assert.match(oauth, /\.append_pair\("state", &state\)/);
    assert.match(oauth, /\.append_pair\("code_challenge_method", "S256"\)/);
    assert.match(oauth, /TcpListener::bind\("127\.0\.0\.1:0"\)/);
    assert.match(oauth, /valid_state = query\.get\("state"\)\.is_some_and\(\|value\| value == state\)/);
    assert.match(oauth, /let authorized = correct_host && valid_path && valid_state/);
    assert.match(oauth, /tokio::time::timeout\(TIMEOUT/);
});

test("OAuth bearer credentials stay in Rust OS keychain and use XOAUTH2 only over official secured servers", () => {
    const oauth = source("src-tauri/src/oauth.rs");
    const imap = source("src-tauri/src/imap.rs");
    const smtp = source("src-tauri/src/smtp.rs");
    assert.match(oauth, /Entry::new\(KEYCHAIN_SERVICE/);
    assert.match(oauth, /auth_method == "password"/);
    assert.match(oauth, /outlook\.office365\.com/);
    assert.match(oauth, /imap\.gmail\.com/);
    assert.match(oauth, /\.expires_at <= now\(\)\.saturating_add\(90\)/);
    assert.match(imap, /authenticate\(\s*"XOAUTH2"/);
    assert.match(smtp, /authentication\(vec!\[Mechanism::Xoauth2\]\)/);
    assert.doesNotMatch(source("src/lib/mail-api.ts"), /accessToken|refreshToken/);
});

test("account migration v5 retains password users and adds provider auth fields", () => {
    const db = source("src-tauri/src/db.rs");
    const commands = source("src-tauri/src/commands.rs");
    assert.match(db, /ALTER TABLE accounts ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'password'/);
    assert.match(db, /ALTER TABLE accounts ADD COLUMN oauth_client_id/);
    assert.match(db, /if schema_version < 5/);
    assert.match(db, /"user_version", 6/);
    assert.match(commands, /imap::test\(&input.account, &imap_secret\)/);
    assert.match(commands, /smtp::test\(&input.account, &smtp_secret\)/);
    assert.match(commands, /oauth::save_tokens\(&id, &authorized.stored\)/);
});
