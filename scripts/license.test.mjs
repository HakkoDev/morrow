import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("Morrow includes the complete GNU GPL v3 license text", () => {
    const license = read("LICENSE");
    assert.match(license, /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
    assert.match(license, /TERMS AND CONDITIONS/);
    assert.match(license, /END OF TERMS AND CONDITIONS/);
    assert.match(license, /How to Apply These Terms to Your New Programs/);
    assert.ok(license.length > 34000, "The full GPL text must be shipped, not a short notice");
});

test("Morrow uses one GPL-3.0-only SPDX identifier across its package metadata", () => {
    assert.equal(JSON.parse(read("package.json")).license, "GPL-3.0-only");
    assert.match(read("src-tauri/Cargo.toml"), /^license = "GPL-3\.0-only"$/m);
    assert.match(read("README.md"), /GPL-3\.0-only/);
});

test("GitHub binary releases include the GPLv3 license alongside installers", () => {
    const workflow = read(".github/workflows/release.yml");
    assert.match(workflow, /cp LICENSE release-assets\/LICENSE/);
    assert.match(workflow, /release-assets\/LICENSE --repo/);
});
