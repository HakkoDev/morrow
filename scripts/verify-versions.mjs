#!/usr/bin/env node
/** Prevent a version-skewed Tauri release/tag before any native build begins. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");
export function validateVersions(pkg, config, cargo, tag = "") {
    const errors = [];
    const rustVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
    const rustTauri = /^tauri\s*=\s*\{\s*version\s*=\s*"=?([^" ]+)"/m.exec(cargo)?.[1];
    const parts = (x) => (/^\d+\.\d+\.\d+$/.test(x ?? "") ? x.split(".").slice(0, 2).join(".") : "");
    if (pkg.version !== config.version || pkg.version !== rustVersion) errors.push("package.json, tauri.conf.json and Cargo.toml must share app version");
    if (!parts(rustTauri)) errors.push("Pin exact Rust tauri crate version in Cargo.toml");
    if (pkg.dependencies["@tauri-apps/api"] !== rustTauri) errors.push("Pin @tauri-apps/api to exactly the same version as the Rust tauri crate");
    const cli = pkg.devDependencies["@tauri-apps/cli"];
    if (!parts(cli) || parts(cli) !== parts(rustTauri)) errors.push("Tauri CLI and API must share a major.minor release");
    if (tag && tag !== `v${pkg.version}`) errors.push(`Tag ${tag} does not match app version v${pkg.version}`);
    if (config.build?.windows?.staticVCRuntime !== true) errors.push("Explicit build.windows.staticVCRuntime must be true");
    return errors;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const pkg = JSON.parse(read("package.json"));
    const cfg = JSON.parse(read("src-tauri/tauri.conf.json"));
    const problems = validateVersions(pkg, cfg, read("src-tauri/Cargo.toml"), process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : "");
    if (problems.length) {
        for (const error of problems) console.error(`ERROR: ${error}`);
        process.exitCode = 1;
    } else
        console.log(`Morrow v${pkg.version}: Tauri Rust/API pinned to ${pkg.dependencies["@tauri-apps/api"]}, CLI ${pkg.devDependencies["@tauri-apps/cli"]}.`);
}
