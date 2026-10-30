#!/usr/bin/env node
/**
 * Generate a Tauri config overlay for signed GitHub Releases.
 * Never hardcode an unknown repository or ship a fake signing key.
 * The release CI supplies GITHUB_REPOSITORY and TAURI_SIGNING_PUBLIC_KEY.
 * TAURI_SIGNING_PRIVATE_KEY is consumed by Tauri itself, NOT this script.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function releaseOverlay(repo, pubkey) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) {
        throw new Error("GITHUB_REPOSITORY must be set to OWNER/REPO (expected: hakkodev/morrow).");
    }
    if (repo.toLowerCase() !== "hakkodev/morrow") {
        throw new Error("Releases are restricted to hakkodev/morrow.");
    }
    const key = (pubkey ?? "").trim();
    if (key.length < 40 || key.includes("REPLACE") || key.includes("YOUR_") || key.includes("PRIVATE KEY")) {
        throw new Error("TAURI_SIGNING_PUBLIC_KEY must contain your real Tauri signer public key (contents of .pub).");
    }
    return {
        bundle: { createUpdaterArtifacts: true },
        plugins: {
            updater: {
                pubkey: key,
                endpoints: [`https://github.com/${repo}/releases/latest/download/latest.json`],
                windows: { installMode: "passive" },
            },
        },
    };
}

export function validateTag(tag, version) {
    if (tag !== `v${version}`) {
        throw new Error(`GitHub tag ${tag || "(unset)"} must match package version v${version}.`);
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    if (process.env.GITHUB_REF_TYPE === "tag") validateTag(process.env.GITHUB_REF_NAME, pkg.version);
    const overlay = releaseOverlay(process.env.GITHUB_REPOSITORY, process.env.TAURI_SIGNING_PUBLIC_KEY);
    const target = fileURLToPath(new URL("../src-tauri/tauri.release.conf.json", import.meta.url));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(overlay, null, 2)}\n`, { mode: 0o600 });
    console.log(`Prepared release updater endpoint for ${process.env.GITHUB_REPOSITORY} (private key not handled by this script).`);
}
