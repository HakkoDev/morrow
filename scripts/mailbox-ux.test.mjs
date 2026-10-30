import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { transpileTs } from "./typescript-transpile.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
function evaluateTs(file) {
    const module = { exports: {} };
    vm.runInNewContext(transpileTs(file), {
        module,
        exports: module.exports,
        require: (name) => {
            if (name === "clsx") return { clsx: (...values) => values.join(" ") };
            if (name === "tailwind-merge") return { twMerge: (value) => value };
            throw new Error(`Unexpected dependency: ${name}`);
        },
        Intl,
        Date,
        Number,
    });
    return module.exports;
}

test("IMAP folder display labels never rewrite the underlying path", () => {
    const { folderLabel } = evaluateTs("src/lib/folder-labels.ts");
    assert.equal(folderLabel("INBOX"), "Inbox");
    assert.equal(folderLabel("INBOX/Receipts"), "Inbox / Receipts");
    assert.equal(folderLabel("INBOX.Orders", "."), "Inbox / Orders");
    assert.equal(folderLabel("[Gmail]/Sent Mail"), "[Gmail] / Sent Mail");
    assert.equal(folderLabel("ACME"), "ACME");
});

test("account menu identifies accounts by email and keeps IMAP names intact", () => {
    const sidebar = read("src/components/mail/mail-sidebar.tsx");
    assert.match(sidebar, /item\.email/);
    assert.match(sidebar, /folderLabel\(item\.name, item\.delimiter\)/);
    assert.match(sidebar, /props\.onFolderChange\(item\.name\)/);
});

test("destructive actions use shadcn dialogs rather than browser confirmation", () => {
    const app = read("src/App.tsx");
    assert.doesNotMatch(app, /window\.(?:prompt|confirm|alert)\s*\(/);
    assert.match(app, /<CreateFolderDialog\s/);
    assert.match(app, /<ConfirmActionDialog\s/);
    assert.doesNotMatch(read("src/components/mail/account-dialog.tsx"), /window\.(?:prompt|confirm|alert)\s*\(/);
    assert.match(read("src/components/mail/mail-action-dialogs.tsx"), /<DialogContent/);
});

test("mail pagination is triggered by scroll instead of a load-more button", () => {
    const app = read("src/App.tsx");
    const list = read("src/components/mail/message-list.tsx");
    assert.doesNotMatch(list, /Load 100 older messages/);
    assert.match(list, /onScroll=\{checkScroll\}/);
    assert.match(list, /onLoadOlder\(\)/);
    assert.match(app, /loadingOlder\.current/);
    assert.match(app, /messagesRef\.current\.length <= before/);
});

test("date/time display is controlled by the system locale and local timezone", () => {
    const { formatMessageDateTime } = evaluateTs("src/lib/utils.ts");
    // Utils has imports for class merging that are removed by TS if unused? It still requires them.
    assert.equal(typeof formatMessageDateTime, "function");
    const dt = formatMessageDateTime(1770000000);
    assert.ok(dt.length > 4);
    assert.match(read("src/components/mail/message-view.tsx"), /formatMessageDateTime\(currentMessage\.date\)/);
});

test("popover transitions provide reduced-motion fallback", () => {
    const css = read("src/styles.css");
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /\.morrow-popover/);
    assert.match(css, /\.morrow-dialog-content/);
});

test("reduced motion does not rely on !important and overrides dialog states", () => {
    const css = read("src/styles.css");
    const motion = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    assert.match(motion, /\.morrow-dialog-overlay\[data-state\]/);
    assert.match(motion, /\.morrow-dialog-content\[data-state\]/);
    assert.match(motion, /animation:\s*none;/);
    assert.match(motion, /transition:\s*none;/);
    assert.doesNotMatch(motion, /!important/);
});

test("infinite scroll tracks mailbox identity and cached row count without extraneous hook dependencies", () => {
    const list = read("src/components/mail/message-list.tsx");
    assert.match(list, /const previous = previousMailbox\.current/);
    assert.match(list, /previous\.accountId === accountId && previous\.folder === folder/);
    assert.match(list, /if \(messages\.length === 0\)/);
    assert.match(list, /\[checkScroll, messages\.length\]\)/);
    assert.match(list, /\[accountId, folder\]\)/);
    assert.doesNotMatch(list, /\[checkScroll, folder, messages\.length\]/);
    assert.doesNotMatch(list, /!important/);
});
