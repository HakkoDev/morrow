#!/usr/bin/env node
/** Validate one combined signed GitHub updater manifest after both platform uploads. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export function verifyRelease(manifest, assets) {
    const errors = [];
    if (!/^\d+\.\d+\.\d+/.test(manifest.version ?? "")) errors.push("Missing SemVer in latest.json");
    const platforms = manifest.platforms ?? {};
    const allNames = new Set(assets);
    for (const platform of ["windows-x86_64", "linux-x86_64"]) {
        const key = Object.keys(platforms).find((k) => k === platform || k.startsWith(`${platform}-`));
        if (!key) {
            errors.push(`Missing ${platform} updater entry`);
            continue;
        }
        const entry = platforms[key];
        if (!entry.signature || typeof entry.signature !== "string") errors.push(`Missing ${key} signature`);
        try {
            const u = new URL(entry.url);
            if (u.protocol !== "https:" || u.hostname !== "github.com" || !u.pathname.startsWith("/hakkodev/morrow/releases/download/"))
                errors.push(`Unsafe ${key} URL`);
            const filename = decodeURIComponent(u.pathname.split("/").at(-1));
            if (!allNames.has(filename)) errors.push(`Missing update asset ${filename}`);
            if (platform.startsWith("linux") && !/\.AppImage(?:\.tar\.gz)?$/.test(filename)) errors.push(`Linux updater must use AppImage, got ${filename}`);
            if (platform.startsWith("windows") && !/\.exe$|\.nsis\.zip$/.test(filename)) errors.push(`Windows updater must use NSIS, got ${filename}`);
        } catch {
            errors.push(`Invalid ${key} update URL`);
        }
    }
    if (!assets.some((name) => name.endsWith(".deb"))) errors.push("Missing Linux .deb release asset");
    if (!assets.some((name) => name.endsWith(".AppImage"))) errors.push("Missing Linux AppImage release asset");
    if (!assets.some((name) => /-setup\.exe$/.test(name))) errors.push("Missing Windows NSIS setup executable");
    return errors;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [manifestFile, assetsFile] = process.argv.slice(2);
    if (!manifestFile || !assetsFile) {
        console.error("Usage: node scripts/verify-release-assets.mjs latest.json assets.txt");
        process.exit(2);
    }
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    const assets = readFileSync(assetsFile, "utf8").trim().split(/\r?\n/).filter(Boolean);
    const errors = verifyRelease(manifest, assets);
    if (errors.length) {
        errors.forEach((e) => {
            console.error("ERROR:", e);
        });
        process.exitCode = 1;
    } else console.log(`Validated ${manifest.version}: Windows x64 NSIS and Linux x64 AppImage/DEB and signed updater entries.`);
}
