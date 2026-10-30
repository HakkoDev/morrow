import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { transpileTs } from "./typescript-transpile.mjs";

function load(file, imports, context = {}) {
    const module = { exports: {} };
    vm.runInNewContext(transpileTs(file), {
        module,
        exports: module.exports,
        require: (name) => {
            assert.ok(Object.hasOwn(imports, name), `Unexpected import ${name}`);
            return imports[name];
        },
        ...context,
    });
    return module.exports;
}

test("outgoing HTML keeps basic formatting but strips active HTML, URLs and all attributes", () => {
    const dom = new JSDOM("");
    try {
        const { sanitizeOutgoingHtml, escapeHtml } = load("src/lib/compose-html.ts", {
            dompurify: { __esModule: true, default: createDOMPurify(dom.window) },
        });
        const input =
            '<p onclick="alert(1)" style="background:url(https://tracker)"><b>Bold</b><i>Italic</i></p><ul><li>List</li></ul><script>alert(1)</script><img src="https://tracker" onerror="alert(1)"><iframe srcdoc="evil"></iframe><a href="javascript:alert(1)">Link text</a><span data-secret="x" aria-label="x">Text</span>';
        const result = sanitizeOutgoingHtml(input);
        assert.equal(result, "<p><b>Bold</b><i>Italic</i></p><ul><li>List</li></ul>Link text<span>Text</span>");
        assert.equal(sanitizeOutgoingHtml(result), result);
        assert.equal(escapeHtml('<img src="x"> & text'), "&lt;img src=&quot;x&quot;&gt; &amp; text");
    } finally {
        dom.window.close();
    }
});

test("composer recovers rich drafts, retains formatting on repeated mode selection and saves sanitized markup", async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/?accountId=a&draftId=draft" });
    const previous = Object.getOwnPropertyDescriptors(globalThis);
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const saves = [];
    let closed = false;
    let root;
    try {
        const { createRoot } = await import("react-dom/client");
        const html = load("src/lib/compose-html.ts", { dompurify: { __esModule: true, default: createDOMPurify(dom.window) } });
        const draft = {
            id: "draft",
            accountId: "a",
            to: "to@example.org",
            cc: "",
            bcc: "",
            subject: "Saved draft",
            body: "Rich text",
            htmlBody: '<p><b>Rich text</b><img src="https://tracker"></p>',
            attachments: [],
            updatedAt: 1,
        };
        const { ComposeWindow } = load(
            "src/components/mail/compose-window.tsx",
            {
                react: React,
                "react/jsx-runtime": jsxRuntime,
                "@tauri-apps/api/event": { emit: async () => {} },
                "@tauri-apps/api/window": {
                    getCurrentWindow: () => ({
                        close: async () => {
                            closed = true;
                        },
                    }),
                },
                "@tauri-apps/plugin-dialog": { open: async () => null },
                "lucide-react": Object.fromEntries(
                    ["Bold", "FilePlus2", "Italic", "List", "LoaderCircle", "Paperclip", "Send", "X"].map((name) => [name, () => null]),
                ),
                "@/components/ui/button": {
                    Button: ({ variant: _variant, size: _size, ...props }) => React.createElement("button", { type: "button", ...props }),
                },
                "@/components/ui/input": { Input: (props) => React.createElement("input", props) },
                "@/components/ui/textarea": { Textarea: (props) => React.createElement("textarea", props) },
                "@/lib/compose-html": html,
                "@/lib/mail-api": {
                    mailApi: {
                        listAccounts: async () => [{ id: "a", displayName: "Alice", email: "a@example.org" }],
                        listLocalDrafts: async () => [draft],
                        saveLocalDraft: async (saved) => {
                            saves.push(saved);
                        },
                    },
                },
            },
            { window: dom.window, document: dom.window.document, URLSearchParams, crypto: globalThis.crypto },
        );
        root = createRoot(dom.window.document.getElementById("root"));
        await React.act(async () => root.render(React.createElement(ComposeWindow)));
        const editor = dom.window.document.querySelector('[contenteditable="true"]');
        assert.ok(editor);
        assert.equal(editor.innerHTML, "<p><b>Rich text</b></p>");
        const richButton = [...dom.window.document.querySelectorAll("button")].find((button) => button.textContent === "Rich text");
        await React.act(async () => richButton.click());
        assert.equal(editor.innerHTML, "<p><b>Rich text</b></p>");
        let inserted;
        dom.window.document.execCommand = (command, _show, text) => {
            inserted = { command, text };
            return true;
        };
        const drop = new dom.window.Event("drop", { bubbles: true, cancelable: true });
        Object.defineProperty(drop, "dataTransfer", { value: { getData: (type) => (type === "text/plain" ? "safe text" : '<img src="https://tracker">') } });
        await React.act(async () => editor.dispatchEvent(drop));
        assert.equal(drop.defaultPrevented, true);
        assert.deepEqual(inserted, { command: "insertText", text: "safe text" });
        await React.act(async () => dom.window.document.querySelector('[title="Close composer"]').click());
        assert.equal(closed, true);
        assert.equal(saves.at(-1).htmlBody, "<p><b>Rich text</b></p>");
        assert.equal(saves.at(-1).body, "Rich text");
    } finally {
        if (root) await React.act(async () => root.unmount());
        dom.window.close();
        for (const key of ["window", "document", "IS_REACT_ACT_ENVIRONMENT"]) {
            if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
            else delete globalThis[key];
        }
    }
});

function notifier() {
    const sent = [];
    const preferences = { desktopNotifications: true, mutedAccounts: [] };
    let permission = async () => true;
    const { notifyNewMail } = load("src/components/mail/desktop-notifications.tsx", {
        "@tauri-apps/api/event": { listen: () => Promise.resolve(() => {}) },
        "@tauri-apps/plugin-notification": {
            isPermissionGranted: () => permission(),
            sendNotification: (notice) => sent.push(notice),
        },
        react: { useEffect: () => {} },
        "@/lib/preferences": { getPreferences: () => preferences },
    });
    return {
        sent,
        preferences,
        notify: (payload, disposed = () => false) => notifyNewMail(payload, disposed),
        permission: (callback) => {
            permission = callback;
        },
    };
}

test("notifications are opt-in, per-account muted, permission-gated and private", async () => {
    const n = notifier();
    const payload = { accountId: "a", count: 2, sender: "private@example.org", subject: "Private content" };
    n.preferences.desktopNotifications = false;
    await n.notify(payload);
    n.preferences.desktopNotifications = true;
    n.preferences.mutedAccounts = ["a"];
    await n.notify(payload);
    n.preferences.mutedAccounts = [];
    n.permission(async () => false);
    await n.notify(payload);
    assert.equal(n.sent.length, 0);
    n.permission(async () => true);
    await n.notify(payload);
    assert.equal(n.sent.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(n.sent[0])), { title: "Morrow", body: "You have 2 new messages." });
});

test("muting an account or disposing the listener during permission lookup suppresses delivery", async () => {
    const n = notifier();
    n.permission(async () => {
        n.preferences.mutedAccounts = ["a"];
        return true;
    });
    await n.notify({ accountId: "a", count: 1 });
    assert.equal(n.sent.length, 0);
    n.preferences.mutedAccounts = [];
    let disposed = false;
    n.permission(async () => {
        disposed = true;
        return true;
    });
    await n.notify({ accountId: "a", count: 1 }, () => disposed);
    assert.equal(n.sent.length, 0);
});

test("notification errors and invalid counts cannot interrupt mailbox updates", async () => {
    const n = notifier();
    for (const count of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) await n.notify({ accountId: "a", count });
    assert.equal(n.sent.length, 0);
    n.permission(async () => {
        throw new Error("Permission unavailable");
    });
    await assert.doesNotReject(n.notify({ accountId: "a", count: 1 }));
    assert.equal(n.sent.length, 0);
});
