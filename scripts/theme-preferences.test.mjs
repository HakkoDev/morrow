import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { transpileTs } from "./typescript-transpile.mjs";

function loadTypeScript(relativePath, imports = {}, context = {}) {
    const module = { exports: {} };
    vm.runInNewContext(
        transpileTs(relativePath),
        {
            module,
            exports: module.exports,
            require: (name) => {
                if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
                return imports[name];
            },
            console,
            Set,
            Map,
            JSON,
            Object,
            String,
            Number,
            Math,
            ...context,
        },
        { filename: relativePath },
    );
    return module.exports;
}

function newPreferences(localStorageData = new Map(), presetExports) {
    const handlers = new Map();
    const storage = {
        getItem: (key) => localStorageData.get(key) ?? null,
        setItem: (key, value) => localStorageData.set(key, value),
    };
    const window = {
        localStorage: storage,
        addEventListener: (name, cb) => handlers.set(name, cb),
        removeEventListener: (name) => handlers.delete(name),
    };
    const module = loadTypeScript(
        "src/lib/preferences.ts",
        {
            react: { useSyncExternalStore: () => undefined },
            "@tauri-apps/api/event": { emit: async () => {}, listen: async () => () => {} },
            "./theme-presets": presetExports,
        },
        { window },
    );
    return { module, localStorageData, handlers };
}

const themes = loadTypeScript("src/lib/theme-presets.ts");

test("ships all 42 supplied TweakCN presets without SCFD, custom tints, or accents", () => {
    assert.equal(Object.keys(themes.themePresets).length, 42);
    assert.ok(!Object.keys(themes.themePresets).some((id) => /scuffed|scfd/i.test(id)));
    for (const theme of Object.values(themes.themePresets)) {
        for (const mode of ["light", "dark"]) {
            assert.match(theme[mode].background, /^#[0-9a-f]{6}$/i);
            assert.ok(theme[mode].style.radius);
            assert.ok(theme[mode].style.fontSans);
            assert.equal(theme[mode].charts.length, 5);
        }
    }
});

test("preferences validate persisted data instead of trusting localStorage JSON", () => {
    const { module } = newPreferences(
        new Map([
            [
                "morrow.preferences.v1",
                JSON.stringify({
                    themeId: "scuffed",
                    appearance: "garbage",
                    density: "invalid",
                    fontScale: 500,
                    allowRemoteImages: "yes",
                    markReadOnOpen: false,
                }),
            ],
        ]),
        themes,
    );
    const result = module.getPreferences();
    assert.equal(result.themeId, "sage-garden");
    assert.equal(result.appearance, "dark");
    assert.equal(result.density, "comfortable");
    assert.equal(result.fontScale, 100);
    assert.equal(result.allowRemoteImages, false);
    assert.equal(result.markReadOnOpen, false);
});

test("preferences persist updates, notify subscribers, and reset defaults", () => {
    const { module, localStorageData } = newPreferences(new Map(), themes);
    let count = 0;
    const stop = module.subscribePreferences(() => {
        count += 1;
    });
    module.updatePreferences({ themeId: "catppuccin", appearance: "system", density: "compact", showPreviews: false });
    assert.equal(module.getPreferences().themeId, "catppuccin");
    assert.equal(JSON.parse(localStorageData.get("morrow.preferences.v1")).showPreviews, false);
    assert.equal(count, 1);
    module.updatePreferences({ themeId: "catppuccin" });
    assert.equal(count, 1);
    module.resetPreferences();
    assert.equal(module.getPreferences().themeId, "sage-garden");
    assert.equal(count, 2);
    stop();
});

test("TweakCN CSS tokens apply to the root, following system mode and without forcing online fonts", () => {
    const declarations = new Map();
    const classes = new Set();
    const appended = [];
    const root = {
        dataset: {},
        style: { setProperty: (key, value) => declarations.set(key, value), colorScheme: "", fontSize: "" },
        classList: { toggle: (key, enabled) => (enabled ? classes.add(key) : classes.delete(key)) },
    };
    const document = {
        documentElement: root,
        querySelectorAll: () => [],
        createElement: () => ({ dataset: {}, rel: "", href: "" }),
        head: { append: (node) => appended.push(node) },
    };
    const window = { matchMedia: () => ({ matches: false }) };
    const { module: prefs } = newPreferences(new Map(), themes);
    const { applyPreferences } = loadTypeScript(
        "src/lib/theme.ts",
        {
            "./theme-presets": themes,
            "./preferences": prefs,
        },
        { window, document },
    );
    applyPreferences({ ...prefs.DEFAULT_PREFERENCES, themeId: "catppuccin", appearance: "system", fontScale: 110 });
    assert.equal(root.dataset.theme, "catppuccin");
    assert.equal(root.dataset.themeMode, "light");
    assert.equal(declarations.get("--primary"), themes.themePresets.catppuccin.light.primary);
    assert.equal(declarations.get("--radius"), themes.themePresets.catppuccin.light.style.radius);
    assert.equal(root.style.fontSize, "110%");
    assert.equal(appended.length, 0);
});
