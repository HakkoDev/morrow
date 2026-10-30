import type { AppearanceMode, Preferences } from "./preferences";
import { type ThemePalette, type ThemeStyle, themePresets } from "./theme-presets";

const TOKENS: Partial<Record<keyof ThemePalette, string>> = {
    background: "--background",
    foreground: "--foreground",
    card: "--card",
    cardForeground: "--card-foreground",
    popover: "--popover",
    popoverForeground: "--popover-foreground",
    primary: "--primary",
    primaryForeground: "--primary-foreground",
    secondary: "--secondary",
    secondaryForeground: "--secondary-foreground",
    muted: "--muted",
    mutedForeground: "--muted-foreground",
    accent: "--accent",
    accentForeground: "--accent-foreground",
    destructive: "--destructive",
    destructiveForeground: "--destructive-foreground",
    border: "--border",
    input: "--input",
    ring: "--ring",
    sidebar: "--sidebar",
    sidebarForeground: "--sidebar-foreground",
    sidebarPrimary: "--sidebar-primary",
    sidebarPrimaryForeground: "--sidebar-primary-foreground",
    sidebarAccent: "--sidebar-accent",
    sidebarAccentForeground: "--sidebar-accent-foreground",
    sidebarBorder: "--sidebar-border",
    sidebarRing: "--sidebar-ring",
    panel: "--panel",
    surface: "--surface",
    surfaceHover: "--surface-hover",
    primaryHover: "--primary-hover",
    primarySoft: "--primary-soft",
    overlay: "--overlay",
    success: "--success",
    successSoft: "--success-soft",
    destructiveHover: "--destructive-hover",
    destructiveSoft: "--destructive-soft",
    destructiveText: "--destructive-text",
    warning: "--warning",
    warningSoft: "--warning-soft",
};

function radius(value: string, px: number) {
    const match = /^(\d*\.?\d+)(rem|em|px)$/.exec(value);
    if (!match) return value;
    const amount = Number(match[1]);
    const step = match[2] === "px" ? px : px / 16;
    return `${Math.max(0, Number((amount + step).toFixed(4)))}${match[2]}`;
}

function shadowColor(style: ThemeStyle, opacityFactor = 1) {
    const opacity = Math.max(0, Math.min(1, style.shadowOpacity * opacityFactor));
    return `color-mix(in srgb, ${style.shadowColor} ${opacity * 100}%, transparent)`;
}

function applyStyle(root: HTMLElement, style: ThemeStyle) {
    const values: Record<string, string> = {
        "--font-sans": style.fontSans,
        "--font-serif": style.fontSerif,
        "--font-mono": style.fontMono,
        "--font-heading": style.fontSans,
        "--radius": style.radius,
        "--radius-sm": radius(style.radius, -4),
        "--radius-md": radius(style.radius, -2),
        "--radius-lg": style.radius,
        "--radius-xl": radius(style.radius, 4),
        "--radius-2xl": radius(style.radius, 8),
        "--radius-3xl": radius(style.radius, 12),
        "--radius-4xl": radius(style.radius, 16),
        "--tracking-normal": style.letterSpacing,
        "--spacing": style.spacing,
    };
    const base = (factor = 1) => `${style.shadowOffsetX} ${style.shadowOffsetY} ${style.shadowBlur} ${style.shadowSpread} ${shadowColor(style, factor)}`;
    const auxiliary = (offsetY: string, blur: string) => `0px ${offsetY} ${blur} -1px ${shadowColor(style)}`;
    for (const name of ["--shadow-2xs", "--shadow-xs"]) values[name] = base(0.5);
    for (const name of ["--shadow-sm", "--shadow"]) values[name] = `${base()}, ${auxiliary("1px", "2px")}`;
    values["--shadow-md"] = `${base()}, ${auxiliary("2px", "4px")}`;
    values["--shadow-lg"] = `${base()}, ${auxiliary("4px", "6px")}`;
    values["--shadow-xl"] = `${base()}, ${auxiliary("8px", "10px")}`;
    values["--shadow-2xl"] = base(2.5);
    for (const [name, value] of Object.entries(values)) root.style.setProperty(name, value);
}

// Only these known preset font families can trigger external requests.
const FONT_FAMILIES = new Set([
    "Antic",
    "Architects Daughter",
    "DM Sans",
    "Fira Code",
    "Geist",
    "Geist Mono",
    "IBM Plex Mono",
    "Inter",
    "JetBrains Mono",
    "Libre Baskerville",
    "Lora",
    "Merriweather",
    "Montserrat",
    "Open Sans",
    "Outfit",
    "Oxanium",
    "Playfair Display",
    "Plus Jakarta Sans",
    "Poppins",
    "Quicksand",
    "Roboto",
    "Roboto Mono",
    "Source Code Pro",
    "Source Serif 4",
    "Space Mono",
    "Ubuntu Mono",
]);

function syncOnlineFonts(style: ThemeStyle, enabled: boolean) {
    document.querySelectorAll<HTMLLinkElement>("link[data-morrow-theme-font]").forEach((link) => {
        link.remove();
    });
    if (!enabled) return;
    const families = new Set(
        [style.fontSans, style.fontSerif, style.fontMono].map((stack) =>
            stack
                .split(",", 1)[0]
                .trim()
                .replace(/^["']|["']$/g, ""),
        ),
    );
    for (const family of families) {
        if (!FONT_FAMILIES.has(family)) continue;
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.dataset.morrowThemeFont = family;
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;500;600;700&display=swap`;
        document.head.append(link);
    }
}

export function effectiveMode(mode: AppearanceMode): "light" | "dark" {
    if (mode !== "system") return mode;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let lastFonts = "";
export function applyPreferences(preferences: Preferences) {
    const root = document.documentElement;
    const mode = effectiveMode(preferences.appearance);
    const palette = themePresets[preferences.themeId][mode];
    root.dataset.theme = preferences.themeId;
    root.dataset.themeMode = mode;
    root.dataset.density = preferences.density;
    root.dataset.motion = "normal";
    root.classList.toggle("dark", mode === "dark");
    root.style.colorScheme = mode;
    root.style.fontSize = `${preferences.fontScale}%`;
    for (const [key, name] of Object.entries(TOKENS)) {
        if (name) root.style.setProperty(name, String(palette[key as keyof ThemePalette]));
    }
    palette.charts.forEach((color, index) => {
        root.style.setProperty(`--chart-${index + 1}`, color);
    });
    applyStyle(root, palette.style);
    const fontKey = JSON.stringify([preferences.themeId, mode, preferences.loadOnlineFonts]);
    if (fontKey !== lastFonts) {
        lastFonts = fontKey;
        syncOnlineFonts(palette.style, preferences.loadOnlineFonts);
    }
}
