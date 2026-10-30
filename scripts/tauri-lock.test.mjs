import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { lockedCargoVersion, mismatches, requiredTauriVersions } from "./sync-tauri-lock.mjs";

const manifest = readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const cargoLock = `version = 4\n\n[[package]]\nname = "tauri"\nversion = "2.11.5"\n\n[[package]]\nname = "tauri-build"\nversion = "2.6.3"\n`;

test("Tauri manifest pins match the JavaScript core API without changing the app version", () => {
    const versions = requiredTauriVersions(manifest);
    assert.equal(versions.tauri, pkg.dependencies["@tauri-apps/api"]);
    assert.equal(pkg.version, "0.1.5");
});

test("detect stale Cargo.lock instead of trusting the manifest alone", () => {
    assert.equal(lockedCargoVersion(cargoLock, "tauri"), "2.11.5");
    assert.equal(lockedCargoVersion(cargoLock, "tauri-build"), "2.6.3");
    assert.deepEqual(mismatches(cargoLock, { tauri: "2.12.3", "tauri-build": "2.7.2" }), [
        { name: "tauri", expected: "2.12.3", actual: "2.11.5" },
        { name: "tauri-build", expected: "2.7.2", actual: "2.6.3" },
    ]);
});

test("Windows and Linux build scripts repair stale Rust dependency locks before invoking Tauri", () => {
    for (const name of ["tauri:build:windows", "tauri:build:linux", "tauri:dev", "tauri:build:signed"]) {
        assert.match(pkg.scripts[name], /^node scripts\/sync-tauri-lock\.mjs --sync && /);
    }
});
