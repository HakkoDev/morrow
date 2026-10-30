// Source-contract tests run with Node alone. They catch changes to safety-critical
// configuration, not a substitute for cargo test or real-server smoke tests.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const config = JSON.parse(read("src-tauri/tauri.conf.json"));
const pkg = JSON.parse(read("package.json"));
const cap = JSON.parse(read("src-tauri/capabilities/default.json"));
const composeCap = JSON.parse(read("src-tauri/capabilities/compose.json"));
const cargo = read("src-tauri/Cargo.toml");
const imap = read("src-tauri/src/imap.rs");
const composer = read("src/components/mail/compose-window.tsx");
const opener = read("src/lib/open-compose.ts");

test("frontend, Tauri and Rust agree on release version", () => {
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
    assert.equal(config.version, pkg.version);
    assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"));
});
test("native compose windows can be created and use explicit ACLs", () => {
    assert.ok(cap.windows.includes("main"));
    assert.ok(composeCap.windows.includes("compose-*"));
    assert.ok(composeCap.permissions.includes("dialog:default"));
    assert.ok(composeCap.permissions.includes("core:window:allow-close"));
    assert.ok(!composeCap.permissions.includes("core:webview:allow-create-webview-window"));
    assert.ok(cap.permissions.includes("core:webview:allow-create-webview-window"));
    assert.match(opener, /new WebviewWindow\(/);
    assert.match(composer, /open as openFileDialog/);
});
test("IMAP never uses mailbox-wide EXPUNGE for a single message", () => {
    assert.doesNotMatch(imap, /session\.expunge\(/);
    assert.match(imap, /session\.uid_expunge\(/);
    assert.match(imap, /caps\.has_str\("UIDPLUS"\)/);
});
test("desktop only uses local-protocol provider backends", () => {
    assert.match(cargo, /async-imap/);
    assert.match(cargo, /lettre/);
    assert.match(read("src-tauri/src/lib.rs"), /AUTO_SYNC_INTERVAL.*from_secs\(60\)/);
});

test("Windows release binary does not open a terminal window", () => {
    assert.match(read("src-tauri/src/main.rs"), /#!\[cfg_attr\(not\(debug_assertions\), windows_subsystem = "windows"\)\]/);
});
test("signed updater is only available to main window", () => {
    assert.ok(cap.permissions.includes("updater:allow-check"));
    assert.ok(cap.permissions.includes("updater:allow-download-and-install"));
    assert.ok(cap.permissions.includes("process:allow-restart"));
    assert.ok(!composeCap.permissions.some((permission) => permission.startsWith("updater:") || permission.startsWith("process:")));
    assert.match(read("src-tauri/src/lib.rs"), /tauri_plugin_updater::Builder/);
    assert.match(read("src-tauri/src/lib.rs"), /updater_configuration/);
    assert.equal(config.plugins.updater.pubkey, "");
    assert.deepEqual(config.plugins.updater.endpoints, []);
    assert.equal(config.bundle.createUpdaterArtifacts ?? false, false);
});
test("GitHub release workflow publishes signed updater metadata", () => {
    const ci = read(".github/workflows/release.yml");
    const generator = read("scripts/prepare-release.mjs");
    assert.match(ci, /tauri-apps\/tauri-action@v1/);
    assert.match(ci, /uploadUpdaterJson: true/);
    assert.match(ci, /updaterJsonPreferNsis: true/);
    assert.match(ci, /TAURI_SIGNING_PRIVATE_KEY:/);
    assert.match(ci, /ubuntu-22\.04/);
    assert.match(ci, /windows-latest/);
    assert.match(ci, /max-parallel: 1/);
    assert.match(generator, /createUpdaterArtifacts: true/);
    assert.match(generator, /releases\/latest\/download\/latest\.json/);
    assert.doesNotMatch(generator, /privateKey\s*:/);
});

test("release overlay rejects unknown repository or signing key", async () => {
    const { releaseOverlay, validateTag } = await import("./prepare-release.mjs");
    assert.throws(() => releaseOverlay("NOT_A_REPO", "dW50cnVzdGVkIGNvbW1lbnQ6"), /GITHUB_REPOSITORY/);
    assert.throws(() => releaseOverlay("hakkodev/morrow", "YOUR_PUBLIC_KEY"), /TAURI_SIGNING_PUBLIC_KEY/);
    assert.throws(() => validateTag("v0.1.2", "0.1.4"), /must match/);
});

test("Tauri Rust API and CLI versions stay compatible and Windows runtime config is explicit", async () => {
    const { validateVersions } = await import("./verify-versions.mjs");
    assert.deepEqual(validateVersions(pkg, config, cargo), []);
    assert.equal(config.build.windows.staticVCRuntime, true);
    assert.match(read("src-tauri/src/lib.rs"), /config\(\)\.plugins\.0\.get\("updater"\)/);
});

test("release notes group conventional and direct commits sensibly", async () => {
    const { renderNotes, previousTag } = await import("./generate-release-notes.mjs");
    const text = renderNotes(
        "0.1.4",
        [
            { subject: "fix(imap): avoid duplicate deletion" },
            { subject: "feat: add feature" },
            { subject: "Small manual change" },
            { subject: "Merge branch main" },
        ],
        "v0.1.3",
    );
    assert.match(text, /### Bug fixes/);
    assert.match(text, /avoid duplicate deletion \(imap\)/);
    assert.match(text, /### New features/);
    assert.match(text, /### Other changes/);
    assert.doesNotMatch(text, /Merge branch main/);
    assert.equal(previousTag(["v0.1.3", "v0.1.1", "v0.2.0"], "0.1.4"), "v0.1.3");
});

test("asset verification rejects a partial or unsigned updater release", async () => {
    const { verifyRelease } = await import("./verify-release-assets.mjs");
    assert.match(
        verifyRelease(
            {
                version: "0.1.4",
                platforms: {
                    "windows-x86_64": { signature: "sig", url: "https://github.com/hakkodev/morrow/releases/download/v0.1.4/Morrow_0.1.4_x64-setup.exe" },
                },
            },
            ["Morrow_0.1.4_x64-setup.exe"],
        ).join(" "),
        /linux-x86_64/,
    );
});

test("Biome and Rust formatting share the project style", () => {
    const biome = JSON.parse(read("biome.json"));
    const rustfmt = read("rustfmt.toml");
    assert.equal(pkg.devDependencies["@biomejs/biome"], "2.5.15");
    assert.equal(biome.formatter.indentStyle, "space");
    assert.equal(biome.formatter.indentWidth, 4);
    assert.equal(biome.formatter.lineWidth, 160);
    assert.equal(biome.formatter.lineEnding, "lf");
    assert.equal(biome.assist.actions.source.organizeImports, "on");
    assert.equal(biome.linter.rules.preset, "recommended");
    assert.ok(!Object.hasOwn(biome.linter.rules, "recommended"), "Biome 2.5 deprecated recommended property must not be present");
    assert.equal(biome.css.parser.tailwindDirectives, true);
    assert.match(rustfmt, /max_width = 160/);
    assert.match(rustfmt, /tab_spaces = 4/);
    assert.match(rustfmt, /newline_style = "Unix"/);
    assert.match(pkg.scripts.format, /format:rust/);
    assert.match(pkg.scripts.quality, /biome:check/);
    assert.match(read(".github/workflows/build-windows.yml"), /bun run biome:check/);
    assert.match(read(".github/workflows/release.yml"), /cargo fmt .*--check/);
});

test("Biome accessibility and React lifecycle fixes remain present", () => {
    const app = read("src/App.tsx");
    const view = read("src/components/mail/message-view.tsx");
    const entry = read("src/main.tsx");
    const sidebar = read("src/components/mail/mail-sidebar.tsx");
    const accountDialog = read("src/components/mail/account-dialog.tsx");
    assert.match(app, /const loadCached = useCallback\(/);
    assert.match(app, /current\.current\.revision !== revision/);
    assert.doesNotMatch(app, /\[account\?\.id,/);
    // Biome may place key on a new line; JSX formatting must not break this guard.
    const keyedReader = /<MessageViewContent\s+key\s*=\s*\{\s*props\.message\?\.id\b/;
    assert.match(view, keyedReader);
    assert.match('<MessageViewContent\n    key={props.message?.id ?? "no-message"}\n    {...props}\n/>', keyedReader);
    assert.doesNotMatch(view, /useEffect\(/);
    assert.doesNotMatch(entry, /getElementById\("root"\)!/);
    assert.match(accountDialog, /<label htmlFor=\{id\}>/);
    assert.match(sidebar, /<button\s+type="button"/);
    assert.doesNotMatch(sidebar, /<label className=.*>Account<\/label>/);
});

test("cached messages and message details are isolated by account", () => {
    const app = read("src/App.tsx");
    const db = read("src-tauri/src/db.rs");
    const backend = read("src-tauri/src/commands.rs");
    assert.match(db, /FROM messages WHERE id=\?1 AND account_id=\?2/);
    assert.match(backend, /pub async fn save_account/);
    assert.match(backend, /imap::test\(&input\.account/);
    assert.match(backend, /smtp::test\(&input\.account/);
    assert.match(app, /rows\.some\(\(row\) => row\.accountId !== accountId/);
    assert.match(app, /summary\.accountId !== active\.accountId/);
});

test("mail context menu and folder tools use explicit account-scoped commands", () => {
    const app = read("src/App.tsx");
    const list = read("src/components/mail/message-list.tsx");
    const sidebar = read("src/components/mail/mail-sidebar.tsx");
    assert.match(app, /mailApi\.saveMessage\(active\.accountId/);
    assert.match(app, /mailApi\.createFolder\(active\.id/);
    assert.match(list, /event\.key\.toLowerCase\(\) === "a"/);
    assert.match(list, /onContextMenu/);
    assert.match(sidebar, /Manage accounts/);
});

test("empty message reader is centered in the reading pane", () => {
    const reader = read("src/components/mail/message-view.tsx");
    assert.match(reader, /relative h-full min-h-0 min-w-0 overflow-hidden/);
    assert.match(reader, /absolute inset-0 grid place-items-center/);
    assert.match(reader, /Select a message/);
});

test("keyboard select-all and account-scoped mail never hijack text inputs", () => {
    const app = read("src/App.tsx");
    assert.match(app, /event\.ctrlKey \|\| event\.metaKey/);
    assert.match(app, /target\.closest\('input, textarea, select/);
    assert.match(app, /setSelection\(messagesRef\.current\.map/);
    assert.match(app, /mailApi\.getMessage\(active\.accountId/);
});

test("mailbox and preferences retain Biome-compatible accessibility fixes", () => {
    const app = read("src/App.tsx");
    const sidebar = read("src/components/mail/mail-sidebar.tsx");
    const list = read("src/components/mail/message-list.tsx");
    const settings = read("src/components/settings/settings-dialog.tsx");

    assert.doesNotMatch(app, /function findFolder\(/);
    assert.doesNotMatch(app, /unlisteners\.forEach\(\(fn\) => fn\(\)\)/);
    assert.match(app, /for \(const unlisten of unlisteners\)/);

    assert.doesNotMatch(sidebar, /const escape\s*=/);
    assert.match(sidebar, /<nav[^>]*aria-label="Mail folders"/);
    assert.doesNotMatch(sidebar, /<nav[^>]*tabIndex=/);
    assert.match(sidebar, /role="menuitemradio"\s+aria-checked=/);
    assert.match(sidebar, /aria-hidden="true">✓/);

    assert.doesNotMatch(list, /const escape\s*=/);
    assert.match(list, /<section[^>]*aria-label="Message list\./);
    assert.doesNotMatch(list, /<section aria-label="Message list\.[^>]*tabIndex=/);
    assert.match(list, /event\.key\.toLowerCase\(\) === "a"/);
    assert.match(list, /event\.key === "Escape"/);

    assert.match(settings, /field:.*"emailDarkMode"/);
    assert.match(settings, /field="emailDarkMode"/);
});
