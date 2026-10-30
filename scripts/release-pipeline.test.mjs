import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { generateUpdaterManifest } from "./create-updater-manifest.mjs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sig = `untrusted comment: signature from Tauri\n${"x".repeat(90)}`;
const version = JSON.parse(source("package.json")).version;
const files = [
    `Morrow_${version}_amd64.AppImage`,
    `Morrow_${version}_amd64.AppImage.sig`,
    `Morrow_${version}_amd64.deb`,
    `Morrow_${version}_x64-setup.exe`,
    `Morrow_${version}_x64-setup.exe.sig`,
];

function create(options = {}) {
    return generateUpdaterManifest({
        files,
        readSignature: () => sig,
        repo: "hakkodev/morrow",
        tag: `v${version}`,
        version,
        notes: "Fixed mailbox navigation",
        pubDate: "2026-10-29T20:00:00.000Z",
        ...options,
    });
}

test("one manifest contains both signed Windows and Linux downloads", () => {
    const result = create();
    assert.equal(result.version, version);
    assert.equal(result.notes, "Fixed mailbox navigation");
    assert.equal(result.platforms["windows-x86_64"].signature, sig);
    assert.equal(result.platforms["linux-x86_64"].signature, sig);
    assert.match(result.platforms["windows-x86_64"].url, /-setup\.exe$/);
    assert.match(result.platforms["linux-x86_64"].url, /\.AppImage$/);
});

test("manifest accepts GitHub's actual repository capitalization and preserves each signature", () => {
    const signatures = {
        [files[1]]: Buffer.from("linux signature\n".repeat(8)).toString("base64"),
        [files[4]]: Buffer.from("windows signature\n".repeat(8)).toString("base64"),
    };
    const result = create({ repo: "HakkoDev/morrow", readSignature: (name) => `${signatures[name]}\n` });
    assert.equal(result.platforms["windows-x86_64"].signature, signatures[files[4]]);
    assert.equal(result.platforms["linux-x86_64"].signature, signatures[files[1]]);
    assert.match(result.platforms["windows-x86_64"].url, /^https:\/\/github.com\/hakkodev\/morrow\//);
});

test("refuse partial, unsigned or cross-repository releases", () => {
    assert.throws(() => create({ files: files.filter((file) => !file.endsWith(".AppImage.sig")) }), /Linux AppImage/);
    assert.throws(() => create({ files: files.filter((file) => !file.endsWith(".exe")) }), /Missing signed installer/);
    assert.throws(() => create({ files: files.filter((file) => !file.endsWith(".deb")) }), /Missing Linux DEB/);
    assert.throws(() => create({ readSignature: () => "" }), /signature/);
    assert.throws(() => create({ repo: "someone/other" }), /hakkodev\/morrow/);
    assert.throws(() => create({ tag: "v0.0.0" }), /does not match/);
    assert.throws(() => create({ files: [...files, "another-setup.exe.sig"] }), /exactly one Windows/);
});

test("manifest CLI generates metadata accepted by the release verifier", () => {
    const directory = mkdtempSync(join(tmpdir(), "morrow-release-test-"));
    const root = fileURLToPath(new URL("../", import.meta.url));
    try {
        for (const file of files) writeFileSync(join(directory, file), file.endsWith(".sig") ? `${sig}\n` : "fixture");
        const notesPath = join(directory, "notes.md");
        const outputPath = join(directory, "latest.json");
        const assetsPath = join(directory, "assets.txt");
        writeFileSync(notesPath, "Release notes\n");
        writeFileSync(assetsPath, files.join("\n"));
        execFileSync(process.execPath, ["scripts/create-updater-manifest.mjs", directory, "HakkoDev/morrow", `v${version}`, notesPath, outputPath], {
            cwd: root,
            stdio: "pipe",
        });
        execFileSync(process.execPath, ["scripts/verify-release-assets.mjs", outputPath, assetsPath], { cwd: root, stdio: "pipe" });
        const manifest = JSON.parse(readFileSync(outputPath, "utf8"));
        assert.equal(manifest.notes, "Release notes");
        assert.equal(manifest.platforms["windows-x86_64"].signature, sig);
        assert.equal(manifest.platforms["linux-x86_64"].signature, sig);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("release builds run concurrently and manifest uploads last", () => {
    const workflow = source(".github/workflows/release.yml");
    assert.doesNotMatch(workflow, /max-parallel:\s*1/);
    assert.match(workflow, /needs: \[prepare, build\]/);
    assert.match(workflow, /merge-multiple: true/);
    assert.match(workflow, /Upload installers and signatures before manifest/);
    assert.match(workflow, /Upload latest\.json last/);
    assert.match(workflow, /bun run biome:check/);
    assert.match(workflow, /bun run typecheck/);
    assert.match(source("src-tauri/Cargo.toml"), /lto = "thin"\ncodegen-units = 8/);
    assert.match(source(".github/workflows/build-windows.yml"), /shared-key: morrow-windows/);
});

test("push and PR verification package installers only on explicit manual request", () => {
    const workflow = source(".github/workflows/build-windows.yml");
    assert.match(workflow, /pull_request:/);
    assert.match(workflow, /branches: \[main, master\]/);
    assert.match(workflow, /build_installer:\s*description: [^\n]+\s*type: boolean\s*default: false/);
    for (const name of ["Build Windows NSIS installer", "Confirm installer produced", "Upload Windows installer"]) {
        const step = workflow.split(`- name: ${name}\n`)[1]?.split(/\n\s*- (?:name:|uses:)/)[0];
        assert.ok(step, `Missing packaging step: ${name}`);
        assert.match(step, /if: github\.event_name == 'workflow_dispatch' && inputs\.build_installer/);
    }
    for (const command of ["bun run test:source", "bun run build", "cargo check", "cargo test", "cargo clippy"]) {
        assert.ok(workflow.includes(command), `Verification must retain ${command}`);
    }
});

test("release platforms validate the tagged native source before signed packaging", () => {
    const workflow = source(".github/workflows/release.yml");
    const build = workflow.split("\n  build:\n")[1]?.split("\n  finalize:\n")[0];
    assert.ok(build);
    assert.match(build, /components: rustfmt, clippy/);
    const validation = build.indexOf("- name: Validate tagged native source before packaging");
    const packaging = build.indexOf("- name: Build signed packages");
    assert.ok(validation >= 0 && packaging > validation);
    const checks = build.slice(validation, build.indexOf("- name: Generate signed release configuration", validation));
    assert.doesNotMatch(checks, /if:|continue-on-error:/);
    assert.match(checks, /cargo fmt --manifest-path src-tauri\/Cargo\.toml --all -- --check/);
    assert.match(checks, /cargo check --manifest-path src-tauri\/Cargo\.toml --locked/);
    assert.match(checks, /cargo test --manifest-path src-tauri\/Cargo\.toml --locked/);
    assert.match(checks, /cargo clippy --manifest-path src-tauri\/Cargo\.toml --all-targets --locked -- -D warnings/);
});
