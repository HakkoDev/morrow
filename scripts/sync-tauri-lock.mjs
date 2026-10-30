#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * Reconcile Cargo.lock with the exact Tauri versions in Cargo.toml.
 * The Tauri CLI checks resolved versions before Cargo has a chance to refresh
 * a stale lockfile, so a build can otherwise fail with a misleading mismatch.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const manifest = resolve(projectRoot, "src-tauri/Cargo.toml");
const lockfile = resolve(projectRoot, "src-tauri/Cargo.lock");

export function lockedCargoVersion(contents, packageName) {
    for (const block of contents.split(/(?=^\[\[package\]\])/m)) {
        if (!block.startsWith("[[package]]")) continue;
        const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
        if (name === packageName) return /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1] ?? null;
    }
    return null;
}

export function requiredTauriVersions(contents) {
    function read(name) {
        const match = new RegExp(`^${name}\\s*=\\s*\\{\\s*version\\s*=\\s*"=([0-9]+\\.[0-9]+\\.[0-9]+)"`, "m").exec(contents);
        if (!match) throw new Error(`Pin ${name} to an exact version (e.g. version = "=2.12.3") in src-tauri/Cargo.toml`);
        return match[1];
    }
    const dialog = /^tauri-plugin-dialog\s*=\s*"=([0-9]+\.[0-9]+\.[0-9]+)"/m.exec(contents)?.[1];
    if (!dialog) throw new Error("Pin tauri-plugin-dialog to an exact version in src-tauri/Cargo.toml");
    return { tauri: read("tauri"), "tauri-build": read("tauri-build"), "tauri-plugin-dialog": dialog };
}

export function mismatches(lockedContents, required) {
    return Object.entries(required)
        .filter(([name, version]) => lockedCargoVersion(lockedContents, name) !== version)
        .map(([name, version]) => ({ name, expected: version, actual: lockedCargoVersion(lockedContents, name) }));
}

function cargo(...args) {
    const result = spawnSync("cargo", [...args, "--manifest-path", manifest], { cwd: projectRoot, stdio: "inherit", shell: false });
    if (result.error) throw new Error(`Could not execute cargo: ${result.error.message}. Install the Rust toolchain first.`);
    if (result.status !== 0) throw new Error(`cargo ${args.join(" ")} failed (exit ${result.status})`);
}

function run() {
    const sync = process.argv.includes("--sync");
    const required = requiredTauriVersions(readFileSync(manifest, "utf8"));
    const lock = existsSync(lockfile) ? readFileSync(lockfile, "utf8") : "";
    const missing = mismatches(lock, required);
    if (!missing.length) {
        console.log(`Cargo.lock is aligned: tauri ${required.tauri}, tauri-build ${required["tauri-build"]}.`);
        return;
    }
    for (const { name, expected, actual } of missing) {
        console.error(`Cargo.lock: ${name} is ${actual ?? "missing"}, requires ${expected}.`);
    }
    if (!sync) {
        console.error("Run: bun run deps:sync (then commit the updated bun.lock and src-tauri/Cargo.lock)");
        process.exitCode = 1;
        return;
    }
    if (!lock) cargo("generate-lockfile");
    else for (const { name, expected } of missing) cargo("update", "-p", name, "--precise", expected);
    const updated = readFileSync(lockfile, "utf8");
    const remaining = mismatches(updated, required);
    if (remaining.length) throw new Error(`Cargo dependency resolution is still mismatched: ${JSON.stringify(remaining)}`);
    console.log(`Cargo.lock refreshed: tauri ${required.tauri}, tauri-build ${required["tauri-build"]}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        run();
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exitCode = 1;
    }
}
