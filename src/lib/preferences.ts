import { emit, listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import { type ThemeId, themePresets } from "./theme-presets";

export type AppearanceMode = "dark" | "light" | "system";
export type MailDensity = "comfortable" | "compact";

export interface Preferences {
    themeId: ThemeId;
    appearance: AppearanceMode;
    density: MailDensity;
    fontScale: number;
    showPreviews: boolean;
    markReadOnOpen: boolean;
    allowRemoteImages: boolean;
    emailDarkMode: boolean;
    loadOnlineFonts: boolean;
}

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
    themeId: "sage-garden",
    appearance: "dark",
    density: "comfortable",
    fontScale: 100,
    showPreviews: true,
    markReadOnOpen: true,
    allowRemoteImages: false,
    emailDarkMode: false,
    loadOnlineFonts: false,
});

export const PREFERENCES_KEY = "morrow.preferences.v1";
const EVENT = "morrow:preferences-changed";
const MODES = new Set(["dark", "light", "system"]);
const DENSITIES = new Set(["comfortable", "compact"]);

export function normalizePreferences(input: unknown): Preferences {
    const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    return {
        themeId: typeof value.themeId === "string" && Object.hasOwn(themePresets, value.themeId) ? (value.themeId as ThemeId) : DEFAULT_PREFERENCES.themeId,
        appearance: typeof value.appearance === "string" && MODES.has(value.appearance) ? (value.appearance as AppearanceMode) : DEFAULT_PREFERENCES.appearance,
        density: typeof value.density === "string" && DENSITIES.has(value.density) ? (value.density as MailDensity) : DEFAULT_PREFERENCES.density,
        fontScale:
            typeof value.fontScale === "number" && Number.isInteger(value.fontScale) && value.fontScale >= 85 && value.fontScale <= 125
                ? value.fontScale
                : DEFAULT_PREFERENCES.fontScale,
        showPreviews: typeof value.showPreviews === "boolean" ? value.showPreviews : DEFAULT_PREFERENCES.showPreviews,
        markReadOnOpen: typeof value.markReadOnOpen === "boolean" ? value.markReadOnOpen : DEFAULT_PREFERENCES.markReadOnOpen,
        allowRemoteImages: typeof value.allowRemoteImages === "boolean" ? value.allowRemoteImages : DEFAULT_PREFERENCES.allowRemoteImages,
        emailDarkMode: typeof value.emailDarkMode === "boolean" ? value.emailDarkMode : DEFAULT_PREFERENCES.emailDarkMode,
        loadOnlineFonts: typeof value.loadOnlineFonts === "boolean" ? value.loadOnlineFonts : DEFAULT_PREFERENCES.loadOnlineFonts,
    };
}

function read(): Preferences {
    try {
        const raw = window.localStorage.getItem(PREFERENCES_KEY);
        return raw ? normalizePreferences(JSON.parse(raw)) : { ...DEFAULT_PREFERENCES };
    } catch {
        return { ...DEFAULT_PREFERENCES };
    }
}

let current: Preferences = read();
let serialized = JSON.stringify(current);
const subscribers = new Set<() => void>();

function notify() {
    for (const subscriber of subscribers) subscriber();
}

function receive(value: unknown) {
    const next = normalizePreferences(value);
    const encoded = JSON.stringify(next);
    if (encoded === serialized) return;
    serialized = encoded;
    current = next;
    notify();
}

export function updatePreferences(patch: Partial<Preferences>) {
    const next = normalizePreferences({ ...current, ...patch });
    const encoded = JSON.stringify(next);
    if (encoded === serialized) return;
    serialized = encoded;
    current = next;
    try {
        window.localStorage.setItem(PREFERENCES_KEY, encoded);
    } catch {
        // Continue applying preferences for this session when storage is unavailable.
    }
    notify();
    void emit(EVENT, next).catch(() => undefined);
}

export function resetPreferences() {
    updatePreferences({ ...DEFAULT_PREFERENCES });
}

export function getPreferences(): Preferences {
    return current;
}
export function subscribePreferences(subscriber: () => void) {
    subscribers.add(subscriber);
    return () => {
        subscribers.delete(subscriber);
    };
}
export function usePreferences(): Preferences {
    return useSyncExternalStore(subscribePreferences, getPreferences, () => DEFAULT_PREFERENCES);
}

// Each Tauri webview owns a JS store, but shared preferences are synchronized by
// native events (plus storage events for browser previews). No per-window theme overrides.
let bridgeStarted = false;
export function startPreferencesBridge(): () => void {
    if (bridgeStarted) return () => undefined;
    bridgeStarted = true;
    let stopped = false;
    let unlisten: (() => void) | undefined;
    const onStorage = (event: StorageEvent) => {
        if (event.key !== PREFERENCES_KEY) return;
        try {
            receive(event.newValue ? JSON.parse(event.newValue) : DEFAULT_PREFERENCES);
        } catch {
            /* Ignore corrupt events. */
        }
    };
    window.addEventListener("storage", onStorage);
    void listen<Preferences>(EVENT, (event) => {
        receive(event.payload);
    })
        .then((fn) => {
            if (stopped) fn();
            else unlisten = fn;
        })
        .catch(() => undefined);
    return () => {
        stopped = true;
        bridgeStarted = false;
        unlisten?.();
        window.removeEventListener("storage", onStorage);
    };
}
