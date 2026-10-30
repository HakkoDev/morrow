import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("native composer leases are scoped to independent window tokens", () => {
    const server = source("src-tauri/src/draft_sync.rs");
    const commands = source("src-tauri/src/commands.rs");
    const api = source("src/lib/mail-api.ts");
    const composer = source("src/components/mail/compose-window.tsx");
    assert.match(server, /type EditorLeases = HashMap<String, HashMap<String, Instant>>/);
    assert.match(server, /const EDITOR_LEASE_TTL: Duration = Duration::from_secs\(120\)/);
    assert.match(server, /windows\.remove\(token\)/);
    assert.match(server, /fn prune_stale_editors/);
    assert.match(server, /fn editor_active\(/);
    assert.match(commands, /editor_token: String,\s*active: bool/);
    assert.match(commands, /Uuid::parse_str\(&editor_token\)/);
    assert.match(api, /editorToken: string, active: boolean/);
    assert.match(composer, /const editorToken = useRef\(crypto\.randomUUID\(\)\)/);
    assert.match(composer, /setInterval\(renew, 30_000\)/);
    assert.match(composer, /setDraftEditorActive\(accountId, id, token, false\)/);
    assert.doesNotMatch(server, /Mutex<HashSet<String>>/);
});

test("cleared drafts are still saved after a previous successful autosave", () => {
    const composer = source("src/components/mail/compose-window.tsx");
    assert.match(composer, /const hasSavedLocal = useRef\(Boolean\(existingDraftId\)\)/);
    assert.match(composer, /hasSavedLocal\.current = true;/);
    assert.match(composer, /const shouldPersist = hasContent \|\| hasSavedLocal\.current/);
    assert.match(composer, /if \(!account \|\| !\(hasContent \|\| hasSavedLocal\.current\)\) return true;/);
    assert.match(composer, /\[loading, account, busy, shouldPersist,/);
    assert.match(composer, /mailApi\.syncRemoteDraft\(account\.id, draftId\.current\)/);
});

test("release-stabilization path requires a reviewed lockfile and native test success", () => {
    const workflow = source(".github/workflows/refresh-lockfile.yml");
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /cargo generate-lockfile --manifest-path/);
    assert.match(workflow, /cargo check --manifest-path src-tauri\/Cargo\.toml --locked/);
    assert.match(workflow, /cargo test --manifest-path src-tauri\/Cargo\.toml --locked/);
    assert.match(workflow, /if: always\(\)/);
    assert.match(workflow, /git diff --cached --quiet/);
    assert.match(workflow, /gh pr create/);
    const release = source(".github/workflows/release.yml");
    assert.match(release, /bun run deps:check/);
    assert.match(release, /bun install --frozen-lockfile/);
});

test("project documentation and smoke tests are not silently ignored by Git", () => {
    const ignore = source(".gitignore");
    for (const name of ["UPDATER_SETUP.md", "SMOKE_TESTS.md", "CHANGELOG.md", "docs/mailbox-behavior.md", "docs/dependency-lockfiles.md"]) {
        assert.ok(!ignore.split("\n").includes(name), `Documentation ${name} is unexpectedly ignored`);
    }
    assert.match(source("docs/v0.2.0-smoke-tests.md"), /Reopen the same saved draft: focus its existing composer/);
});
