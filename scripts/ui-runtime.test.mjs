import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { transpileTs } from "./typescript-transpile.mjs";

test("shared UI controls support selection, toggles, dialog dismissal and keyboard menus", async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost", pretendToBeVisual: true });
    const previous = Object.getOwnPropertyDescriptors(globalThis);
    const globals = [
        "window",
        "document",
        "HTMLElement",
        "HTMLFormElement",
        "HTMLInputElement",
        "HTMLButtonElement",
        "Element",
        "Node",
        "NodeFilter",
        "CustomEvent",
        "Event",
        "MutationObserver",
        "getComputedStyle",
        "DocumentFragment",
    ];
    for (const name of globals) globalThis[name] = name === "getComputedStyle" ? dom.window[name].bind(dom.window) : dom.window[name];
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
    globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    dom.window.HTMLElement.prototype.scrollIntoView = () => {};
    dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
    dom.window.HTMLElement.prototype.setPointerCapture = () => {};
    dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
    let root;
    try {
        const { createRoot } = await import("react-dom/client");
        const imports = {
            "react/jsx-runtime": jsxRuntime,
            "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
            "lucide-react": await import("lucide-react"),
        };
        for (const name of ["dialog", "dropdown-menu", "select", "tabs", "checkbox", "switch", "collapsible", "context-menu"]) {
            imports[`@radix-ui/react-${name}`] = await import(`@radix-ui/react-${name}`);
        }
        const load = (name) => {
            const module = { exports: {} };
            vm.runInNewContext(transpileTs(`src/components/ui/${name}.tsx`), {
                module,
                exports: module.exports,
                require: (id) => {
                    assert.ok(Object.hasOwn(imports, id), id);
                    return imports[id];
                },
            });
            return module.exports;
        };
        const d = load("dialog"),
            m = load("dropdown-menu"),
            s = load("select"),
            t = load("tabs");
        const { Checkbox } = load("checkbox"),
            { Switch } = load("switch");
        const h = React.createElement;
        let selected = "",
            checked = false,
            switched = false,
            action = 0;
        const controls = h(
            React.Fragment,
            null,
            h(
                d.Dialog,
                null,
                h(d.DialogTrigger, null, "Open dialog"),
                h(d.DialogContent, null, h(d.DialogTitle, null, "Settings"), h(d.DialogDescription, null, "Edit settings")),
            ),
            h(
                m.DropdownMenu,
                null,
                h(m.DropdownMenuTrigger, null, "Actions"),
                h(
                    m.DropdownMenuContent,
                    null,
                    h(m.DropdownMenuItem, { onSelect: () => action++ }, "Run action"),
                    h(m.DropdownMenuItem, { disabled: true }, "Disabled action"),
                ),
            ),
            h(
                s.Select,
                {
                    defaultValue: "one",
                    onValueChange: (value) => {
                        selected = value;
                    },
                },
                h(s.SelectTrigger, { "aria-label": "Account" }, h(s.SelectValue)),
                h(s.SelectContent, null, h(s.SelectItem, { value: "one" }, "One"), h(s.SelectItem, { value: "two" }, "Two")),
            ),
            h(Checkbox, {
                "aria-label": "Check",
                onCheckedChange: (value) => {
                    checked = value;
                },
            }),
            h(Switch, {
                "aria-label": "Switch",
                onCheckedChange: (value) => {
                    switched = value;
                },
            }),
            h(
                t.Tabs,
                { defaultValue: "first" },
                h(t.TabsList, null, h(t.TabsTrigger, { value: "first" }, "First"), h(t.TabsTrigger, { value: "second" }, "Second")),
                h(t.TabsContent, { value: "first" }, "First panel"),
                h(t.TabsContent, { value: "second" }, "Second panel"),
            ),
        );
        root = createRoot(document.getElementById("root"));
        const flush = async (callback) =>
            React.act(async () => {
                callback();
                await new Promise((resolve) => setTimeout(resolve, 30));
            });
        const button = (text) => [...document.querySelectorAll("button")].find((element) => element.textContent === text);
        const key = (element, value) => element.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));
        await flush(() => root.render(controls));
        await flush(() => button("Open dialog").click());
        assert.ok(document.querySelector('[role="dialog"]'));
        await flush(() => document.querySelector('[aria-label="Close dialog"]').click());
        assert.equal(document.querySelector('[role="dialog"]'), null);
        await flush(() => button("Open dialog").click());
        await flush(() => key(document.activeElement, "Escape"));
        assert.equal(document.querySelector('[role="dialog"]'), null);
        assert.equal(document.activeElement, button("Open dialog"));
        await flush(() => key(button("Actions"), "ArrowDown"));
        assert.ok(document.querySelector('[role="menu"]'));
        assert.equal(document.querySelector('[aria-disabled="true"]').textContent, "Disabled action");
        await flush(() => key(document.querySelector('[role="menuitem"]'), "Enter"));
        assert.equal(action, 1);
        assert.equal(document.querySelector('[role="menu"]'), null);
        await flush(() => key(document.querySelector('[role="combobox"]'), "ArrowDown"));
        assert.ok(document.querySelector('[role="listbox"]'));
        const option = [...document.querySelectorAll('[role="option"]')].find((element) => element.textContent === "Two");
        await flush(() => key(option, "Enter"));
        assert.equal(selected, "two");
        await flush(() => document.querySelector('[role="checkbox"]').click());
        await flush(() => document.querySelector('[role="switch"]').click());
        assert.equal(checked, true);
        assert.equal(switched, true);
        await flush(() => button("Second").dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, button: 0 })));
        assert.equal(button("Second").getAttribute("aria-selected"), "true");
        assert.equal(document.querySelector('[role="tabpanel"][data-state="active"]').textContent, "Second panel");
    } finally {
        if (root) await React.act(async () => root.unmount());
        dom.window.close();
        for (const name of [...globals, "IS_REACT_ACT_ENVIRONMENT", "requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver"]) {
            if (previous[name]) Object.defineProperty(globalThis, name, previous[name]);
            else delete globalThis[name];
        }
    }
});
