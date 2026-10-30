import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// TypeScript 7 no longer exposes the in-process transpileModule API, so the
// source-contract tests use the compiler CLI to emit CommonJS into a temp dir.
const root = fileURLToPath(new URL("../", import.meta.url));
const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
const cache = new Map();

function findJavaScript(directory) {
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...findJavaScript(path));
        else if (entry.name.endsWith(".js")) files.push(path);
    }
    return files;
}

export function transpileTs(relativePath) {
    if (cache.has(relativePath)) return cache.get(relativePath);
    const outDir = mkdtempSync(join(tmpdir(), "morrow-ts-"));
    try {
        execFileSync(
            process.execPath,
            [
                tsc,
                relativePath,
                "--ignoreConfig",
                "--module",
                "commonjs",
                "--target",
                "es2022",
                "--jsx",
                "react-jsx",
                "--noResolve",
                "--noCheck",
                "--skipLibCheck",
                "--outDir",
                outDir,
            ],
            { cwd: root, stdio: "pipe" },
        );
        const files = findJavaScript(outDir);
        if (files.length !== 1) throw new Error(`Expected one compiled file for ${relativePath}, found ${files.length}`);
        const output = readFileSync(files[0], "utf8");
        cache.set(relativePath, output);
        return output;
    } finally {
        rmSync(outDir, { recursive: true, force: true });
    }
}
