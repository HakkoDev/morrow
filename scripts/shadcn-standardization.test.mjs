import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const pkg = JSON.parse(read("package.json"));

test("reusable shadcn controls use Radix primitives and semantic theme tokens", () => {
    for (const [name, dep] of Object.entries({
        checkbox: "checkbox",
        switch: "switch",
        label: "label",
        select: "select",
        "dropdown-menu": "dropdown-menu",
        "context-menu": "context-menu",
        tabs: "tabs",
        collapsible: "collapsible",
    })) {
        assert.match(read(`src/components/ui/${name}.tsx`), new RegExp(`@radix-ui/react-${name}`));
        assert.ok(pkg.dependencies[`@radix-ui/react-${dep}`]);
    }
    assert.match(read("src/components/ui/native-select.tsx"), /data-slot="native-select"/);
    assert.match(read("src/components/ui/button.tsx"), /buttonVariants/);
    assert.match(read("src/components/ui/dialog.tsx"), /morrow-dialog-content fixed left-1\/2 top-1\/2/);
});

test("account, mail and preferences use shared controls instead of one-off interactive implementations", () => {
    const account = read("src/components/mail/account-dialog.tsx");
    const settings = read("src/components/settings/settings-dialog.tsx");
    const sidebar = read("src/components/mail/mail-sidebar.tsx");
    const messages = read("src/components/mail/message-list.tsx");
    assert.match(account, /<NativeSelect/);
    assert.match(account, /<Checkbox/);
    assert.match(account, /<Collapsible/);
    assert.match(settings, /<Switch/);
    assert.match(settings, /<TabsContent\s+value="privacy"/);
    assert.match(sidebar, /<DropdownMenuRadioItem/);
    assert.match(messages, /<ContextMenuTrigger asChild>/);
    assert.match(messages, /<ContextMenuItem/);
    const components = join(import.meta.dirname, "../src/components");
    const sources = [];
    function walk(dir) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) walk(join(dir, entry.name));
            else if (entry.name.endsWith(".tsx") && basename(dir) !== "ui") sources.push(readFileSync(join(dir, entry.name), "utf8"));
        }
    }
    walk(components);
    for (const source of sources) {
        assert.doesNotMatch(source, /<(button|select|textarea|details|summary)\b/, "App UI should use shared primitives");
        assert.doesNotMatch(source, /<input\s+type="checkbox"/, "Checkboxes should use shared primitives");
    }
});
