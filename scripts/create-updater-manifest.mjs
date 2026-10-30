#!/usr/bin/env node
/**
 * Create one Tauri v2 updater manifest after both platform builds finish.
 * Signatures come directly from the Tauri CLI's .sig files, not from GitHub metadata.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRelease } from "./verify-release-assets.mjs";

function selectSignedBundle(files, signatureSuffix, platform) {
    const matches = files.filter((name) => name.endsWith(signatureSuffix));
    if (matches.length !== 1) throw new Error(`Expected exactly one ${platform} ${signatureSuffix}, found ${matches.length}`);
    const signatureFile = matches[0];
    const binary = signatureFile.slice(0, -4);
    if (!files.includes(binary)) throw new Error(`Missing signed installer for ${signatureFile}`);
    return { binary, signatureFile };
}

export function generateUpdaterManifest({ files, readSignature, repo, tag, version, notes = "", pubDate = new Date().toISOString() }) {
    // GitHub repository names are case-insensitive; GITHUB_REPOSITORY preserves
    // the owner's capitalization. Canonicalize URLs for verifyRelease as well.
    repo = repo?.toLowerCase();
    if (repo !== "hakkodev/morrow") throw new Error("Updater assets must be hosted in hakkodev/morrow");
    if (!/^\d+\.\d+\.\d+$/.test(version) || tag !== `v${version}`) throw new Error(`Tag ${tag} does not match v${version}`);
    if (!files.some((name) => name.endsWith(".deb"))) throw new Error("Missing Linux DEB installer");

    const windows = selectSignedBundle(files, "-setup.exe.sig", "Windows NSIS");
    const linux = selectSignedBundle(files, ".AppImage.sig", "Linux AppImage");
    const entry = ({ binary, signatureFile }) => {
        const signature = readSignature(signatureFile).trim();
        if (signature.length < 40 || signature.includes("REPLACE") || signature.includes("YOUR_")) {
            throw new Error(`Missing or invalid Tauri updater signature in ${signatureFile}`);
        }
        return {
            signature,
            url: `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(binary)}`,
        };
    };
    const manifest = {
        version,
        notes: notes.trim().slice(0, 4000),
        pub_date: pubDate,
        platforms: {
            "windows-x86_64": entry(windows),
            "linux-x86_64": entry(linux),
        },
    };
    const errors = verifyRelease(manifest, files);
    if (errors.length) throw new Error(errors.join("; "));
    return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [directory, repo, tag, notesPath, outputPath] = process.argv.slice(2);
    if (!directory || !repo || !tag || !notesPath || !outputPath) {
        console.error("Usage: node scripts/create-updater-manifest.mjs ASSETS_DIR OWNER/REPO vVERSION NOTES_FILE OUTPUT_JSON");
        process.exit(2);
    }
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const files = readdirSync(directory);
    const manifest = generateUpdaterManifest({
        files,
        readSignature: (name) => readFileSync(resolve(directory, name), "utf8"),
        repo,
        tag,
        version: pkg.version,
        notes: readFileSync(notesPath, "utf8"),
    });
    writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Created latest.json with signed Windows and Linux updates for ${tag}.`);
}
