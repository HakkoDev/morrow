#!/usr/bin/env node
/**
 * Build human-readable GitHub Release notes from conventional commit subjects.
 * Works with direct commits as well as squash-merged PRs. Needs full git history.
 * Never invents work that wasn't committed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = "hakkodev/morrow";
const headings = {
    breaking: "Breaking changes",
    feat: "New features",
    fix: "Bug fixes",
    perf: "Performance",
    security: "Security",
    refactor: "Improvements",
    docs: "Documentation",
    test: "Testing",
    build: "Build & packaging",
    ci: "Build & packaging",
    chore: "Maintenance",
    other: "Other changes",
};
const order = ["breaking", "feat", "fix", "security", "perf", "refactor", "build", "ci", "docs", "test", "chore", "other"];
const get = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 }).trim();

export function classify(subject, body = "") {
    const conventional = /^(feat|fix|perf|security|refactor|docs|test|build|ci|chore)(\([^)]+\))?(!)?:\s*(.+)$/i.exec(subject);
    if (conventional) {
        const [, type, scope, breaking, title] = conventional;
        const normalized = title.trim();
        return {
            type: breaking || /BREAKING CHANGE:/i.test(body) ? "breaking" : type.toLowerCase(),
            text: scope ? `${normalized} (${scope.slice(1, -1)})` : normalized,
        };
    }
    if (/^merge (pull request|branch)\b/i.test(subject)) return null;
    return { type: "other", text: subject.trim() };
}

export function renderNotes(version, commits, previousTag = null) {
    const groups = new Map();
    for (const { subject, body = "" } of commits) {
        const value = classify(subject, body);
        if (!value?.text) continue;
        const list = groups.get(value.type) ?? [];
        if (!list.includes(value.text)) list.push(value.text);
        groups.set(value.type, list);
    }
    const sections = [
        `# Morrow v${version}`,
        "",
        "A desktop email client built with Tauri, Rust, React and shadcn/ui.",
        "",
        "## Downloads",
        "",
        "| Platform | File |",
        "| --- | --- |",
        "| Windows (x64) | `Morrow_*_x64-setup.exe` (NSIS installer) |",
        "| Linux (x64) | `morrow_*.AppImage` (portable app bundle) or `morrow_*.deb` (Debian/Ubuntu package) |",
        "",
        "## Changes",
        "",
    ];
    let any = false;
    for (const key of order) {
        const list = groups.get(key);
        if (!list?.length) continue;
        any = true;
        sections.push(`### ${headings[key]}`, "", ...list.map((s) => `- ${s}`), "");
    }
    if (!any) sections.push("Initial release or no new commit subjects were found.", "");
    sections.push(
        "## Updating",
        "",
        "Morrow checks published GitHub Releases and validates updater signatures before installing updates. Linux `.deb` installations should be updated with a new package; the in-app updater is designed for AppImage and Windows NSIS installs.",
        "",
    );
    if (previousTag) sections.push(`[Full changelog](https://github.com/${repo}/compare/${previousTag}...v${version})`, "");
    return sections.join("\n");
}

export function previousTag(tags, version) {
    const semver = /^v(\d+)\.(\d+)\.(\d+)$/;
    const asNum = (t) => t.match(semver)?.slice(1).map(Number);
    const current = asNum(`v${version}`);
    if (!current) throw new Error(`Invalid stable SemVer: ${version}`);
    const eligible = tags
        .filter((t) => asNum(t))
        .filter((t) => {
            const num = asNum(t);
            for (let i = 0; i < 3; i++) if (num[i] !== current[i]) return num[i] < current[i];
            return false;
        });
    eligible.sort((a, b) => {
        const x = asNum(a),
            y = asNum(b);
        for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i];
        return 0;
    });
    return eligible[0] ?? null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const version = pkg.version;
    const current = `v${version}`;
    const available = get("tag", "--merged", "HEAD", "--list", "v*").split(/\r?\n/).filter(Boolean);
    if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== current) {
        throw new Error(`Expected tag ${current}, got ${process.env.GITHUB_REF_NAME}`);
    }
    const previous = previousTag(available, version);
    const range = previous ? `${previous}..HEAD` : "HEAD";
    const entries = get("log", range, "--format=%s%x1f%b%x1e")
        .split("\x1e")
        .filter(Boolean)
        .map((entry) => {
            const [subject = "", body = ""] = entry.trim().split("\x1f");
            return { subject: subject.trim(), body: body.trim() };
        });
    const notes = renderNotes(version, entries, previous);
    const out = process.argv.indexOf("--output");
    if (out >= 0 && process.argv[out + 1]) {
        writeFileSync(resolve(process.argv[out + 1]), notes, "utf8");
        console.log(`Wrote release notes for ${current} (${entries.length} commits, previous: ${previous ?? "none"}).`);
    } else process.stdout.write(notes);
}
