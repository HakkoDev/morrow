export type ThemeMode = "light" | "dark";

export interface ThemeStyle {
    fontSans: string;
    fontSerif: string;
    fontMono: string;
    radius: string;
    shadowColor: string;
    shadowOpacity: number;
    shadowBlur: string;
    shadowSpread: string;
    shadowOffsetX: string;
    shadowOffsetY: string;
    letterSpacing: string;
    spacing: string;
}

export type ThemeStyleOverrides = Partial<ThemeStyle>;

export const DEFAULT_THEME_STYLE: ThemeStyle = {
    fontSans: "Inter, ui-sans-serif, system-ui, sans-serif",
    fontSerif: "Source Serif 4, ui-serif, Georgia, serif",
    fontMono: "JetBrains Mono, ui-monospace, monospace",
    radius: "0.5rem",
    shadowColor: "hsl(0 0% 0%)",
    shadowOpacity: 0.1,
    shadowBlur: "3px",
    shadowSpread: "0px",
    shadowOffsetX: "0px",
    shadowOffsetY: "1px",
    letterSpacing: "0em",
    spacing: "0.25rem",
};

export interface ThemePalette {
    background: string;
    foreground: string;
    card: string;
    cardForeground: string;
    popover: string;
    popoverForeground: string;
    primary: string;
    primaryForeground: string;
    secondary: string;
    secondaryForeground: string;
    muted: string;
    mutedForeground: string;
    accent: string;
    accentForeground: string;
    destructive: string;
    destructiveForeground: string;
    border: string;
    input: string;
    ring: string;
    sidebar: string;
    sidebarForeground: string;
    sidebarPrimary: string;
    sidebarPrimaryForeground: string;
    sidebarAccent: string;
    sidebarAccentForeground: string;
    sidebarBorder: string;
    sidebarRing: string;
    charts: readonly [string, string, string, string, string];

    // Additional Morrow surface aliases derived from the canonical semantic palette.
    panel: string;
    surface: string;
    surfaceHover: string;
    primaryHover: string;
    primarySoft: string;
    overlay: string;
    success: string;
    successSoft: string;
    destructiveHover: string;
    destructiveSoft: string;
    destructiveText: string;
    warning: string;
    warningSoft: string;
    style: ThemeStyle;
}

interface PaletteSeed {
    background: string;
    foreground: string;
    primary: string;
    secondary: string;
    mutedForeground: string;
    accent: string;
    border: string;
    card?: string;
    cardForeground?: string;
    popover?: string;
    popoverForeground?: string;
    primaryForeground?: string;
    secondaryForeground?: string;
    muted?: string;
    accentForeground?: string;
    destructive?: string;
    destructiveForeground?: string;
    input?: string;
    ring?: string;
    charts?: readonly [string, string, string, string, string];
    sidebar?: string;
    sidebarForeground?: string;
    sidebarPrimary?: string;
    sidebarPrimaryForeground?: string;
    sidebarAccent?: string;
    sidebarAccentForeground?: string;
    sidebarBorder?: string;
    sidebarRing?: string;
}

export interface ThemePreset {
    label: string;
    light: ThemePalette;
    dark: ThemePalette;
}

function hexToRgb(value: string): [number, number, number] {
    const normalized = value.replace("#", "");
    const hex =
        normalized.length === 3
            ? normalized
                  .split("")
                  .map((character) => `${character}${character}`)
                  .join("")
            : normalized;

    return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
}

function rgbToHex(red: number, green: number, blue: number): string {
    return `#${[red, green, blue]
        .map((channel) =>
            Math.max(0, Math.min(255, Math.round(channel)))
                .toString(16)
                .padStart(2, "0"),
        )
        .join("")}`;
}

function mixHex(base: string, overlay: string, amount: number): string {
    const [baseRed, baseGreen, baseBlue] = hexToRgb(base);
    const [overlayRed, overlayGreen, overlayBlue] = hexToRgb(overlay);
    return rgbToHex(baseRed + (overlayRed - baseRed) * amount, baseGreen + (overlayGreen - baseGreen) * amount, baseBlue + (overlayBlue - baseBlue) * amount);
}

function readableText(background: string): string {
    const [red, green, blue] = hexToRgb(background);
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    return luminance > 0.58 ? "#0a0a0a" : "#ffffff";
}

function palette(mode: ThemeMode, seed: PaletteSeed): ThemePalette {
    const dark = mode === "dark";
    const card = seed.card ?? mixHex(seed.background, seed.foreground, dark ? 0.06 : 0.015);
    const cardForeground = seed.cardForeground ?? seed.foreground;
    const popover = seed.popover ?? card;
    const popoverForeground = seed.popoverForeground ?? cardForeground;
    const primaryForeground = seed.primaryForeground ?? readableText(seed.primary);
    const secondaryForeground = seed.secondaryForeground ?? readableText(seed.secondary);
    const muted = seed.muted ?? mixHex(seed.background, seed.foreground, dark ? 0.075 : 0.055);
    const accentForeground = seed.accentForeground ?? readableText(seed.accent);
    const destructive = seed.destructive ?? (dark ? "#f87171" : "#dc3545");
    const destructiveForeground = seed.destructiveForeground ?? readableText(destructive);
    const input = seed.input ?? seed.border;
    const ring = seed.ring ?? seed.primary;
    const sidebar = seed.sidebar ?? mixHex(seed.background, dark ? "#000000" : seed.foreground, dark ? 0.12 : 0.025);
    const sidebarForeground = seed.sidebarForeground ?? seed.foreground;
    const sidebarPrimary = seed.sidebarPrimary ?? seed.primary;
    const sidebarPrimaryForeground = seed.sidebarPrimaryForeground ?? primaryForeground;
    const sidebarAccent = seed.sidebarAccent ?? seed.accent;
    const sidebarAccentForeground = seed.sidebarAccentForeground ?? accentForeground;
    const sidebarBorder = seed.sidebarBorder ?? seed.border;
    const sidebarRing = seed.sidebarRing ?? ring;
    const primaryHover = mixHex(seed.primary, dark ? "#ffffff" : "#000000", dark ? 0.12 : 0.08);
    const destructiveHover = mixHex(destructive, dark ? "#ffffff" : "#000000", dark ? 0.1 : 0.08);
    const charts = seed.charts ?? [
        seed.primary,
        seed.accent,
        mixHex(seed.primary, seed.accent, 0.5),
        mixHex(seed.primary, dark ? "#ffffff" : "#000000", 0.22),
        mixHex(seed.accent, dark ? "#ffffff" : "#000000", 0.22),
    ];

    return {
        background: seed.background,
        foreground: seed.foreground,
        card,
        cardForeground,
        popover,
        popoverForeground,
        primary: seed.primary,
        primaryForeground,
        secondary: seed.secondary,
        secondaryForeground,
        muted,
        mutedForeground: seed.mutedForeground,
        accent: seed.accent,
        accentForeground,
        destructive,
        destructiveForeground,
        border: seed.border,
        input,
        ring,
        sidebar,
        sidebarForeground,
        sidebarPrimary,
        sidebarPrimaryForeground,
        sidebarAccent,
        sidebarAccentForeground,
        sidebarBorder,
        sidebarRing,
        charts,

        panel: card,
        surface: muted,
        surfaceHover: mixHex(muted, seed.foreground, dark ? 0.07 : 0.045),
        primaryHover,
        primarySoft: mixHex(seed.background, seed.primary, dark ? 0.24 : 0.12),
        overlay: dark ? "rgba(0, 0, 0, 0.72)" : "rgba(15, 23, 42, 0.32)",
        success: dark ? "#45c486" : "#177a52",
        successSoft: mixHex(seed.background, dark ? "#45c486" : "#177a52", dark ? 0.18 : 0.1),
        destructiveHover,
        destructiveSoft: mixHex(seed.background, destructive, dark ? 0.2 : 0.1),
        destructiveText: destructiveForeground,
        warning: dark ? "#f0be5a" : "#9a6511",
        warningSoft: mixHex(seed.background, dark ? "#f0be5a" : "#9a6511", dark ? 0.17 : 0.1),
        style: { ...DEFAULT_THEME_STYLE },
    };
}

function preset(label: string, light: PaletteSeed, dark: PaletteSeed): ThemePreset {
    return {
        label,
        light: palette("light", light),
        dark: palette("dark", dark),
    };
}

// TweakCN preset identities rendered as semantic design tokens.
const tweakcnPresets = {
    "modern-minimal": preset(
        "Modern Minimal",
        {
            background: "#ffffff",
            foreground: "#333333",
            primary: "#3b82f6",
            secondary: "#f3f4f6",
            mutedForeground: "#6b7280",
            accent: "#e0f2fe",
            accentForeground: "#1e3a8a",
            border: "#e5e7eb",
            card: "#ffffff",
        },
        {
            background: "#171717",
            foreground: "#e5e5e5",
            primary: "#3b82f6",
            secondary: "#262626",
            mutedForeground: "#a3a3a3",
            accent: "#1e3a8a",
            accentForeground: "#bfdbfe",
            border: "#404040",
            card: "#262626",
        },
    ),
    "violet-bloom": preset(
        "Violet Bloom",
        {
            background: "#fdfdfd",
            foreground: "#000000",
            primary: "#7033ff",
            secondary: "#edf0f4",
            mutedForeground: "#525252",
            accent: "#e2ebff",
            accentForeground: "#1e69dc",
            border: "#e7e7ee",
            card: "#fdfdfd",
            charts: ["#4ac885", "#7033ff", "#fd822b", "#3276e4", "#747474"],
        },
        {
            background: "#1a1b1e",
            foreground: "#f0f0f0",
            primary: "#8c5cff",
            secondary: "#2a2c33",
            mutedForeground: "#a0a0a0",
            accent: "#1e293b",
            accentForeground: "#79c0ff",
            border: "#33353a",
            card: "#222327",
            charts: ["#4ade80", "#8c5cff", "#fca5a5", "#5993f4", "#a0a0a0"],
        },
    ),
    "t3-chat": preset(
        "T3 Chat",
        {
            background: "#faf5fa",
            foreground: "#501854",
            primary: "#a84370",
            secondary: "#f1c4e6",
            mutedForeground: "#834588",
            accent: "#f1c4e6",
            accentForeground: "#77347c",
            border: "#efbdeb",
            card: "#faf5fa",
        },
        {
            background: "#221d27",
            foreground: "#d2c4de",
            primary: "#a3004c",
            primaryForeground: "#efc0d8",
            secondary: "#362d3d",
            mutedForeground: "#c2b6cf",
            accent: "#463753",
            accentForeground: "#f8f1f5",
            border: "#3b3237",
            card: "#2c2632",
        },
    ),
    twitter: preset(
        "Twitter",
        {
            background: "#ffffff",
            foreground: "#0f1419",
            primary: "#1e9df1",
            secondary: "#0f1419",
            mutedForeground: "#536471",
            accent: "#e3ecf6",
            accentForeground: "#1e9df1",
            border: "#e1eaef",
            card: "#f7f8f8",
            charts: ["#1e9df1", "#00b87a", "#f7b928", "#17bf63", "#e0245e"],
        },
        {
            background: "#000000",
            foreground: "#e7e9ea",
            primary: "#1c9cf0",
            secondary: "#16181c",
            mutedForeground: "#71767b",
            accent: "#061622",
            accentForeground: "#1c9cf0",
            border: "#242628",
            card: "#17181c",
            charts: ["#1e9df1", "#00b87a", "#f7b928", "#17bf63", "#e0245e"],
        },
    ),
    "mocha-mousse": preset(
        "Mocha Mousse",
        {
            background: "#f1f0e5",
            foreground: "#56453f",
            primary: "#a37764",
            secondary: "#baab92",
            mutedForeground: "#8a655a",
            accent: "#e4c7b8",
            accentForeground: "#56453f",
            border: "#baab92",
            card: "#f1f0e5",
        },
        {
            background: "#2d2521",
            foreground: "#f1f0e5",
            primary: "#c39e88",
            secondary: "#8a655a",
            mutedForeground: "#c5aa9b",
            accent: "#baab92",
            accentForeground: "#2d2521",
            border: "#56453f",
            card: "#3c332e",
            destructive: "#e57373",
        },
    ),
    bubblegum: preset(
        "Bubblegum",
        {
            background: "#f6e6ee",
            foreground: "#5b5b5b",
            primary: "#d04f99",
            secondary: "#8acfd1",
            mutedForeground: "#7a7a7a",
            accent: "#fbe2a7",
            accentForeground: "#333333",
            border: "#d04f99",
            card: "#fdedc9",
            destructive: "#f96f70",
        },
        {
            background: "#12242e",
            foreground: "#f3e3ea",
            primary: "#fbe2a7",
            primaryForeground: "#12242e",
            secondary: "#e4a2b1",
            mutedForeground: "#e4a2b1",
            accent: "#c67b96",
            accentForeground: "#f3e3ea",
            border: "#324859",
            card: "#1c2e38",
            destructive: "#e35ea4",
        },
    ),
    "amethyst-haze": preset(
        "Amethyst Haze",
        {
            background: "#f8f7fa",
            foreground: "#3d3c4f",
            primary: "#8a79ab",
            secondary: "#dfd9ec",
            mutedForeground: "#6b6880",
            accent: "#e6a5b8",
            accentForeground: "#4b2e36",
            border: "#cec9d9",
            card: "#ffffff",
            destructive: "#d95c5c",
        },
        {
            background: "#1a1823",
            foreground: "#e0ddef",
            primary: "#a995c9",
            primaryForeground: "#1a1823",
            secondary: "#5a5370",
            mutedForeground: "#a09aad",
            accent: "#372e3f",
            accentForeground: "#f2b8c6",
            border: "#302c40",
            card: "#232030",
            destructive: "#e57373",
        },
    ),
    notebook: preset(
        "Notebook",
        {
            background: "#f9f9f9",
            foreground: "#3a3a3a",
            primary: "#606060",
            secondary: "#dedede",
            mutedForeground: "#505050",
            accent: "#f3eac8",
            accentForeground: "#5d4037",
            border: "#747272",
            card: "#ffffff",
            destructive: "#c87a7a",
        },
        {
            background: "#2b2b2b",
            foreground: "#dcdcdc",
            primary: "#b0b0b0",
            primaryForeground: "#2b2b2b",
            secondary: "#5a5a5a",
            mutedForeground: "#a0a0a0",
            accent: "#e0e0e0",
            accentForeground: "#333333",
            border: "#4f4f4f",
            card: "#333333",
            destructive: "#d9afaf",
        },
    ),
    "doom-64": preset(
        "Doom 64",
        {
            background: "#cccccc",
            foreground: "#1f1f1f",
            card: "#b0b0b0",
            cardForeground: "#1f1f1f",
            popover: "#b0b0b0",
            popoverForeground: "#1f1f1f",
            primary: "#b71c1c",
            primaryForeground: "#ffffff",
            secondary: "#556b2f",
            secondaryForeground: "#ffffff",
            muted: "#b8b8b8",
            mutedForeground: "#4a4a4a",
            accent: "#4682b4",
            accentForeground: "#ffffff",
            destructive: "#ff6f00",
            destructiveForeground: "#000000",
            border: "#505050",
            input: "#505050",
            ring: "#b71c1c",
            charts: ["#b71c1c", "#556b2f", "#4682b4", "#ff6f00", "#8d6e63"],
            sidebar: "#b0b0b0",
            sidebarForeground: "#1f1f1f",
            sidebarPrimary: "#b71c1c",
            sidebarPrimaryForeground: "#ffffff",
            sidebarAccent: "#4682b4",
            sidebarAccentForeground: "#ffffff",
            sidebarBorder: "#505050",
            sidebarRing: "#b71c1c",
        },
        {
            background: "#1a1a1a",
            foreground: "#e0e0e0",
            card: "#2a2a2a",
            cardForeground: "#e0e0e0",
            popover: "#2a2a2a",
            popoverForeground: "#e0e0e0",
            primary: "#e53935",
            primaryForeground: "#ffffff",
            secondary: "#689f38",
            secondaryForeground: "#000000",
            muted: "#252525",
            mutedForeground: "#a0a0a0",
            accent: "#64b5f6",
            accentForeground: "#000000",
            destructive: "#ffa000",
            destructiveForeground: "#000000",
            border: "#4a4a4a",
            input: "#4a4a4a",
            ring: "#e53935",
            charts: ["#e53935", "#689f38", "#64b5f6", "#ffa000", "#a1887f"],
            sidebar: "#141414",
            sidebarForeground: "#e0e0e0",
            sidebarPrimary: "#e53935",
            sidebarPrimaryForeground: "#ffffff",
            sidebarAccent: "#64b5f6",
            sidebarAccentForeground: "#000000",
            sidebarBorder: "#4a4a4a",
            sidebarRing: "#e53935",
        },
    ),
    catppuccin: preset(
        "Catppuccin",
        {
            background: "#eff1f5",
            foreground: "#4c4f69",
            primary: "#8839ef",
            secondary: "#ccd0da",
            mutedForeground: "#6c6f85",
            accent: "#04a5e5",
            accentForeground: "#ffffff",
            border: "#bcc0cc",
            card: "#ffffff",
            destructive: "#d20f39",
        },
        {
            background: "#181825",
            foreground: "#cdd6f4",
            primary: "#cba6f7",
            primaryForeground: "#1e1e2e",
            secondary: "#585b70",
            mutedForeground: "#a6adc8",
            accent: "#89dceb",
            accentForeground: "#1e1e2e",
            border: "#313244",
            card: "#1e1e2e",
            destructive: "#f38ba8",
        },
    ),
    graphite: preset(
        "Graphite",
        {
            background: "#f0f0f0",
            foreground: "#333333",
            primary: "#606060",
            secondary: "#e0e0e0",
            mutedForeground: "#666666",
            accent: "#c0c0c0",
            accentForeground: "#333333",
            border: "#d0d0d0",
            card: "#f5f5f5",
            destructive: "#cc3333",
        },
        {
            background: "#1a1a1a",
            foreground: "#d9d9d9",
            primary: "#a0a0a0",
            primaryForeground: "#1a1a1a",
            secondary: "#303030",
            mutedForeground: "#a6a6a6",
            accent: "#404040",
            accentForeground: "#d9d9d9",
            border: "#353535",
            card: "#202020",
            destructive: "#e06666",
        },
    ),
    perpetuity: preset(
        "Perpetuity",
        {
            background: "#e8f0f0",
            foreground: "#0a4a55",
            primary: "#06858e",
            secondary: "#d9eaea",
            mutedForeground: "#427a7e",
            accent: "#c9e5e7",
            accentForeground: "#0a4a55",
            border: "#cde0e2",
            card: "#f2f7f7",
            destructive: "#d13838",
        },
        {
            background: "#0a1a20",
            foreground: "#4de8e8",
            primary: "#4de8e8",
            primaryForeground: "#0a1a20",
            secondary: "#164955",
            mutedForeground: "#86b8ba",
            accent: "#164955",
            accentForeground: "#4de8e8",
            border: "#164955",
            card: "#0c2025",
            destructive: "#e83c3c",
        },
    ),
    "kodama-grove": preset(
        "Kodama Grove",
        {
            background: "#e4d7b0",
            foreground: "#5c4b3e",
            primary: "#8d9d4f",
            secondary: "#decea0",
            mutedForeground: "#85766a",
            accent: "#dbc894",
            accentForeground: "#5c4b3e",
            border: "#b19681",
            card: "#e7dbbf",
            destructive: "#d98b7e",
        },
        {
            background: "#3a3529",
            foreground: "#ede4d4",
            primary: "#8a9f7b",
            primaryForeground: "#2a2521",
            secondary: "#5a5345",
            mutedForeground: "#b9ad9a",
            accent: "#a18f5c",
            accentForeground: "#2a2521",
            border: "#5a5345",
            card: "#413c33",
            destructive: "#b5766a",
        },
    ),
    "cosmic-night": preset(
        "Cosmic Night",
        {
            background: "#f5f5ff",
            foreground: "#2a2a4a",
            primary: "#6e56cf",
            secondary: "#e4dfff",
            mutedForeground: "#6c6c8a",
            accent: "#d8e6ff",
            accentForeground: "#2a2a4a",
            border: "#e0e0f0",
            card: "#ffffff",
            destructive: "#ff5470",
        },
        {
            background: "#0f0f1a",
            foreground: "#e2e2f5",
            primary: "#a48fff",
            primaryForeground: "#0f0f1a",
            secondary: "#2d2b55",
            mutedForeground: "#aaa9c9",
            accent: "#303060",
            accentForeground: "#e2e2f5",
            border: "#303052",
            card: "#1a1a2e",
            destructive: "#ff5470",
        },
    ),
    tangerine: preset(
        "Tangerine",
        {
            background: "#e8ebed",
            foreground: "#333333",
            primary: "#e05d38",
            secondary: "#f3f4f6",
            mutedForeground: "#6b7280",
            accent: "#d6e4f0",
            accentForeground: "#1e3a8a",
            border: "#dcdfe2",
            card: "#ffffff",
        },
        {
            background: "#1c2433",
            foreground: "#e5e5e5",
            primary: "#e05d38",
            secondary: "#2a303e",
            mutedForeground: "#a3a8b4",
            accent: "#2a3656",
            accentForeground: "#bfdbfe",
            border: "#3d4354",
            card: "#2a3040",
        },
    ),
    "quantum-rose": preset(
        "Quantum Rose",
        {
            background: "#fff0f8",
            foreground: "#91185c",
            primary: "#e6067a",
            secondary: "#ffd6ff",
            mutedForeground: "#c04283",
            accent: "#ffc1e3",
            accentForeground: "#91185c",
            border: "#ffc7e6",
            card: "#fff7fc",
            destructive: "#d13869",
        },
        {
            background: "#1a0922",
            foreground: "#ffb3ff",
            primary: "#ff6bef",
            primaryForeground: "#180518",
            secondary: "#46204f",
            mutedForeground: "#d78ad3",
            accent: "#5a1f5d",
            accentForeground: "#ffb3ff",
            border: "#4a1b5f",
            card: "#2a1435",
            destructive: "#ff2876",
        },
    ),
    nature: preset(
        "Nature",
        {
            background: "#f8f5f0",
            foreground: "#3e2723",
            primary: "#2e7d32",
            secondary: "#e8f5e9",
            mutedForeground: "#6d4c41",
            accent: "#c8e6c9",
            accentForeground: "#1b5e20",
            border: "#e0d6c9",
            card: "#f8f5f0",
            destructive: "#c62828",
        },
        {
            background: "#1c2a1f",
            foreground: "#f0ebe5",
            primary: "#4caf50",
            primaryForeground: "#0a1f0c",
            secondary: "#3e4a3d",
            mutedForeground: "#d7cfc4",
            accent: "#388e3c",
            accentForeground: "#f0ebe5",
            border: "#3e4a3d",
            card: "#2d3a2e",
            destructive: "#c62828",
        },
    ),
    "bold-tech": preset(
        "Bold Tech",
        {
            background: "#ffffff",
            foreground: "#312e81",
            primary: "#8b5cf6",
            secondary: "#f3f0ff",
            mutedForeground: "#7c3aed",
            accent: "#dbeafe",
            accentForeground: "#1e40af",
            border: "#e0e7ff",
            card: "#ffffff",
        },
        {
            background: "#0f172a",
            foreground: "#e0e7ff",
            primary: "#8b5cf6",
            secondary: "#1e1b4b",
            mutedForeground: "#c4b5fd",
            accent: "#4338ca",
            accentForeground: "#e0e7ff",
            border: "#2e1065",
            card: "#1e1b4b",
        },
    ),
    "elegant-luxury": preset(
        "Elegant Luxury",
        {
            background: "#faf7f5",
            foreground: "#1a1a1a",
            primary: "#9b2c2c",
            secondary: "#fdf2d6",
            mutedForeground: "#57534e",
            accent: "#fef3c7",
            accentForeground: "#7f1d1d",
            border: "#f5e8d2",
            card: "#faf7f5",
            destructive: "#991b1b",
        },
        {
            background: "#1c1917",
            foreground: "#f5f5f4",
            primary: "#b91c1c",
            secondary: "#92400e",
            mutedForeground: "#a8a29e",
            accent: "#b45309",
            accentForeground: "#fef3c7",
            border: "#44403c",
            card: "#292524",
            destructive: "#ef4444",
        },
    ),
    "amber-minimal": preset(
        "Amber Minimal",
        {
            background: "#ffffff",
            foreground: "#262626",
            primary: "#f59e0b",
            primaryForeground: "#000000",
            secondary: "#f3f4f6",
            mutedForeground: "#6b7280",
            accent: "#fffbeb",
            accentForeground: "#92400e",
            border: "#e5e7eb",
            card: "#ffffff",
        },
        {
            background: "#171717",
            foreground: "#e5e5e5",
            primary: "#f59e0b",
            primaryForeground: "#000000",
            secondary: "#262626",
            mutedForeground: "#a3a3a3",
            accent: "#92400e",
            accentForeground: "#fde68a",
            border: "#404040",
            card: "#262626",
        },
    ),
    supabase: preset(
        "Supabase",
        {
            background: "#fcfcfc",
            foreground: "#171717",
            primary: "#72e3ad",
            primaryForeground: "#1e2723",
            secondary: "#fdfdfd",
            mutedForeground: "#202020",
            accent: "#ededed",
            accentForeground: "#202020",
            border: "#dfdfdf",
            card: "#fcfcfc",
            destructive: "#ca3214",
        },
        {
            background: "#121212",
            foreground: "#e2e8f0",
            primary: "#006239",
            primaryForeground: "#dde8e3",
            secondary: "#242424",
            mutedForeground: "#a9a9a9",
            accent: "#313131",
            accentForeground: "#fafafa",
            border: "#292929",
            card: "#171717",
            destructive: "#e54d2e",
        },
    ),
    "neo-brutalism": preset(
        "Neo Brutalism",
        {
            background: "#ffffff",
            foreground: "#000000",
            primary: "#ff3333",
            secondary: "#ffff00",
            mutedForeground: "#333333",
            accent: "#0066ff",
            accentForeground: "#ffffff",
            border: "#000000",
            card: "#ffffff",
            destructive: "#000000",
        },
        {
            background: "#000000",
            foreground: "#ffffff",
            primary: "#ff6666",
            primaryForeground: "#000000",
            secondary: "#ffff33",
            mutedForeground: "#cccccc",
            accent: "#3399ff",
            accentForeground: "#000000",
            border: "#ffffff",
            card: "#333333",
            destructive: "#ffffff",
        },
    ),
    "solar-dusk": preset(
        "Solar Dusk",
        {
            background: "#fdfbf7",
            foreground: "#4a3b33",
            primary: "#b45309",
            secondary: "#e4c090",
            mutedForeground: "#78716c",
            accent: "#f2daba",
            accentForeground: "#57534e",
            border: "#e4d9bc",
            card: "#f8f4ee",
            destructive: "#991b1b",
        },
        {
            background: "#1c1917",
            foreground: "#f5f5f4",
            primary: "#f97316",
            primaryForeground: "#ffffff",
            secondary: "#57534e",
            mutedForeground: "#a8a29e",
            accent: "#0ea5e9",
            accentForeground: "#e0f2fe",
            border: "#44403c",
            card: "#292524",
            destructive: "#ef4444",
        },
    ),
    claymorphism: preset(
        "Claymorphism",
        {
            background: "#e7e5e4",
            foreground: "#1e293b",
            primary: "#6366f1",
            secondary: "#d6d3d1",
            mutedForeground: "#6b7280",
            accent: "#f3e5f5",
            accentForeground: "#374151",
            border: "#d6d3d1",
            card: "#f5f5f4",
        },
        {
            background: "#1e1b18",
            foreground: "#e2e8f0",
            primary: "#818cf8",
            primaryForeground: "#1e1b18",
            secondary: "#3a3633",
            mutedForeground: "#9ca3af",
            accent: "#484441",
            accentForeground: "#d1d5db",
            border: "#3a3633",
            card: "#2c2825",
        },
    ),
    cyberpunk: preset(
        "Cyberpunk",
        {
            background: "#f8f9fa",
            foreground: "#0c0c1d",
            primary: "#ff00c8",
            secondary: "#f0f0ff",
            mutedForeground: "#50506a",
            accent: "#00ffcc",
            accentForeground: "#0c0c1d",
            border: "#dfe6e9",
            card: "#ffffff",
            destructive: "#ff3d00",
        },
        {
            background: "#0c0c1d",
            foreground: "#eceff4",
            primary: "#ff00c8",
            secondary: "#1e1e3f",
            mutedForeground: "#a0a0c0",
            accent: "#00ffcc",
            accentForeground: "#0c0c1d",
            border: "#2e2e5e",
            card: "#1e1e3f",
            destructive: "#ff3d00",
        },
    ),
    "pastel-dreams": preset(
        "Pastel Dreams",
        {
            background: "#f7f3f9",
            foreground: "#374151",
            primary: "#a78bfa",
            secondary: "#e9d8fd",
            mutedForeground: "#6b7280",
            accent: "#f3e5f5",
            accentForeground: "#374151",
            border: "#e9d8fd",
            card: "#ffffff",
            destructive: "#fca5a5",
        },
        {
            background: "#1c1917",
            foreground: "#e0e7ff",
            primary: "#c0aafd",
            primaryForeground: "#1c1917",
            secondary: "#3f324a",
            mutedForeground: "#b9aec5",
            accent: "#4a3d5a",
            accentForeground: "#d1d5db",
            border: "#3f324a",
            card: "#2d2535",
            destructive: "#fca5a5",
        },
    ),
    "clean-slate": preset(
        "Clean Slate",
        {
            background: "#f8fafc",
            foreground: "#1e293b",
            primary: "#6366f1",
            secondary: "#e5e7eb",
            mutedForeground: "#6b7280",
            accent: "#e0e7ff",
            accentForeground: "#374151",
            border: "#d1d5db",
            card: "#ffffff",
        },
        {
            background: "#0f172a",
            foreground: "#e2e8f0",
            primary: "#818cf8",
            primaryForeground: "#0f172a",
            secondary: "#2d3748",
            mutedForeground: "#9ca3af",
            accent: "#374151",
            accentForeground: "#d1d5db",
            border: "#4b5563",
            card: "#1e293b",
        },
    ),
    caffeine: preset(
        "Caffeine",
        {
            background: "#f9f9f9",
            foreground: "#202020",
            primary: "#644a40",
            secondary: "#ffdfb5",
            mutedForeground: "#646464",
            accent: "#e8e8e8",
            accentForeground: "#202020",
            border: "#d8d8d8",
            card: "#fcfcfc",
            destructive: "#e54d2e",
        },
        {
            background: "#111111",
            foreground: "#eeeeee",
            primary: "#ffe0c2",
            primaryForeground: "#081a1b",
            secondary: "#393028",
            mutedForeground: "#b4b4b4",
            accent: "#2a2a2a",
            accentForeground: "#eeeeee",
            border: "#201e18",
            card: "#191919",
            destructive: "#e54d2e",
        },
    ),
    "ocean-breeze": preset(
        "Ocean Breeze",
        {
            background: "#f0f8ff",
            foreground: "#374151",
            primary: "#22c55e",
            secondary: "#e0f2fe",
            mutedForeground: "#6b7280",
            accent: "#d1fae5",
            accentForeground: "#374151",
            border: "#e5e7eb",
            card: "#ffffff",
        },
        {
            background: "#0f172a",
            foreground: "#d1d5db",
            primary: "#34d399",
            primaryForeground: "#0f172a",
            secondary: "#1e293b",
            mutedForeground: "#9ca3af",
            accent: "#374151",
            accentForeground: "#d1d5db",
            border: "#4b5563",
            card: "#1e293b",
        },
    ),
    "retro-arcade": preset(
        "Retro Arcade",
        {
            background: "#fdf6e3",
            foreground: "#073642",
            primary: "#d33682",
            secondary: "#2aa198",
            mutedForeground: "#586e75",
            accent: "#cb4b16",
            accentForeground: "#ffffff",
            border: "#839496",
            card: "#eee8d5",
            destructive: "#dc322f",
            charts: ["#268bd2", "#2aa198", "#d33682", "#cb4b16", "#dc322f"],
        },
        {
            background: "#002b36",
            foreground: "#93a1a1",
            primary: "#d33682",
            secondary: "#2aa198",
            mutedForeground: "#839496",
            accent: "#cb4b16",
            accentForeground: "#ffffff",
            border: "#586e75",
            card: "#073642",
            destructive: "#dc322f",
            charts: ["#268bd2", "#2aa198", "#d33682", "#cb4b16", "#dc322f"],
        },
    ),
    "midnight-bloom": preset(
        "Midnight Bloom",
        {
            background: "#f9f9f9",
            foreground: "#333333",
            primary: "#6c5ce7",
            secondary: "#a1c9f2",
            mutedForeground: "#6e6e6e",
            accent: "#8b9467",
            accentForeground: "#ffffff",
            border: "#d4d4d4",
            card: "#ffffff",
        },
        {
            background: "#1a1d23",
            foreground: "#e5e5e5",
            primary: "#6c5ce7",
            secondary: "#2f3436",
            mutedForeground: "#a3a3a3",
            accent: "#6495ed",
            accentForeground: "#e5e5e5",
            border: "#444444",
            card: "#2f3436",
        },
    ),
    candyland: preset(
        "Candyland",
        {
            background: "#f7f9fa",
            foreground: "#333333",
            primary: "#ffc0cb",
            primaryForeground: "#000000",
            secondary: "#87ceeb",
            mutedForeground: "#6e6e6e",
            accent: "#ffff00",
            accentForeground: "#000000",
            border: "#d4d4d4",
            card: "#ffffff",
        },
        {
            background: "#1a1d23",
            foreground: "#e5e5e5",
            primary: "#ff99cc",
            primaryForeground: "#000000",
            secondary: "#33cc33",
            mutedForeground: "#a3a3a3",
            accent: "#87ceeb",
            accentForeground: "#000000",
            border: "#444444",
            card: "#2f3436",
        },
    ),
    "northern-lights": preset(
        "Northern Lights",
        {
            background: "#f9f9fa",
            foreground: "#333333",
            primary: "#34a85a",
            secondary: "#6495ed",
            mutedForeground: "#6e6e6e",
            accent: "#66d9ef",
            accentForeground: "#333333",
            border: "#d4d4d4",
            card: "#ffffff",
        },
        {
            background: "#1a1d23",
            foreground: "#e5e5e5",
            primary: "#34a85a",
            secondary: "#4682b4",
            mutedForeground: "#a3a3a3",
            accent: "#6495ed",
            accentForeground: "#e5e5e5",
            border: "#444444",
            card: "#2f3436",
        },
    ),
    "vintage-paper": preset(
        "Vintage Paper",
        {
            background: "#f5f1e6",
            foreground: "#4a3f35",
            primary: "#a67c52",
            secondary: "#e2d8c3",
            mutedForeground: "#7d6b56",
            accent: "#d4c8aa",
            accentForeground: "#4a3f35",
            border: "#dbd0ba",
            card: "#fffcf5",
            destructive: "#b54a35",
        },
        {
            background: "#2d2621",
            foreground: "#ece5d8",
            primary: "#c0a080",
            primaryForeground: "#2d2621",
            secondary: "#4a4039",
            mutedForeground: "#c5bcac",
            accent: "#59493e",
            accentForeground: "#ece5d8",
            border: "#4a4039",
            card: "#3a322c",
            destructive: "#b54a35",
        },
    ),
    "sunset-horizon": preset(
        "Sunset Horizon",
        {
            background: "#fff9f5",
            foreground: "#3d3436",
            primary: "#ff7e5f",
            secondary: "#ffedea",
            mutedForeground: "#78716c",
            accent: "#feb47b",
            accentForeground: "#3d3436",
            border: "#ffe0d6",
            card: "#ffffff",
            destructive: "#e63946",
        },
        {
            background: "#2a2024",
            foreground: "#f2e9e4",
            primary: "#ff7e5f",
            secondary: "#463a41",
            mutedForeground: "#b7a9ad",
            accent: "#feb47b",
            accentForeground: "#2a2024",
            border: "#463a41",
            card: "#392f35",
            destructive: "#ff6b6b",
        },
    ),
    "starry-night": preset(
        "Starry Night",
        {
            background: "#f5f7fa",
            foreground: "#1a2238",
            primary: "#3a5ba0",
            primaryForeground: "#fffbe6",
            secondary: "#f7c873",
            mutedForeground: "#3a5ba0",
            accent: "#6ea3c1",
            accentForeground: "#fffbe6",
            border: "#b0b8c1",
            card: "#e3eaf2",
            destructive: "#2d1e2f",
        },
        {
            background: "#181a24",
            foreground: "#e6eaf3",
            primary: "#3a5ba0",
            primaryForeground: "#ffe066",
            secondary: "#2d2e3e",
            mutedForeground: "#9da8bf",
            accent: "#ffe066",
            accentForeground: "#23243a",
            border: "#2d2e3e",
            card: "#23243a",
            destructive: "#a04a6c",
        },
    ),
    claude: preset(
        "Claude",
        {
            background: "#faf9f5",
            foreground: "#3d3929",
            primary: "#c96442",
            secondary: "#e9e6dc",
            mutedForeground: "#83827d",
            accent: "#e9e6dc",
            accentForeground: "#28261b",
            border: "#dad9d4",
            card: "#faf9f5",
            destructive: "#141413",
        },
        {
            background: "#262624",
            foreground: "#c3c0b6",
            primary: "#d97757",
            secondary: "#343434",
            mutedForeground: "#9c9a91",
            accent: "#0f0f0e",
            accentForeground: "#c3c0b6",
            border: "#454541",
            card: "#262624",
            destructive: "#ef4444",
        },
    ),
    vercel: preset(
        "Vercel",
        {
            background: "#fcfcfc",
            foreground: "#000000",
            primary: "#000000",
            primaryForeground: "#ffffff",
            secondary: "#eeeeee",
            mutedForeground: "#5f5f5f",
            accent: "#eeeeee",
            accentForeground: "#000000",
            border: "#e3e3e3",
            card: "#ffffff",
            destructive: "#e5484d",
            charts: ["#e9a23b", "#3e63dd", "#ababab", "#e3e3e3", "#787878"],
        },
        {
            background: "#000000",
            foreground: "#ffffff",
            primary: "#ffffff",
            primaryForeground: "#000000",
            secondary: "#303030",
            mutedForeground: "#ababab",
            accent: "#454545",
            accentForeground: "#ffffff",
            border: "#323232",
            card: "#161616",
            destructive: "#ff6369",
            charts: ["#e9a23b", "#4069e5", "#787878", "#5f5f5f", "#e3e3e3"],
        },
    ),
    darkmatter: preset(
        "Darkmatter",
        {
            background: "#ffffff",
            foreground: "#111827",
            primary: "#d87943",
            secondary: "#527575",
            mutedForeground: "#6b7280",
            accent: "#eeeeee",
            accentForeground: "#111827",
            border: "#e5e7eb",
            card: "#ffffff",
            charts: ["#5f8787", "#e78a53", "#fbcb97", "#888888", "#999999"],
        },
        {
            background: "#121113",
            foreground: "#c1c1c1",
            primary: "#e78a53",
            primaryForeground: "#121113",
            secondary: "#5f8787",
            mutedForeground: "#888888",
            accent: "#333333",
            accentForeground: "#c1c1c1",
            border: "#222222",
            card: "#121212",
            destructive: "#5f8787",
            charts: ["#5f8787", "#e78a53", "#fbcb97", "#888888", "#999999"],
        },
    ),
    mono: preset(
        "Mono",
        {
            background: "#ffffff",
            foreground: "#0a0a0a",
            primary: "#737373",
            secondary: "#f5f5f5",
            mutedForeground: "#717171",
            accent: "#f5f5f5",
            accentForeground: "#171717",
            border: "#e5e5e5",
            card: "#ffffff",
            destructive: "#e7000b",
            charts: ["#737373", "#737373", "#737373", "#737373", "#737373"],
        },
        {
            background: "#0a0a0a",
            foreground: "#fafafa",
            primary: "#737373",
            secondary: "#262626",
            mutedForeground: "#a3a3a3",
            accent: "#404040",
            accentForeground: "#fafafa",
            border: "#383838",
            card: "#191919",
            destructive: "#ff6467",
            charts: ["#737373", "#737373", "#737373", "#737373", "#737373"],
        },
    ),
    "soft-pop": preset(
        "Soft Pop",
        {
            background: "#f7f9f3",
            foreground: "#000000",
            primary: "#4f46e5",
            secondary: "#14b8a6",
            mutedForeground: "#333333",
            accent: "#f59e0b",
            accentForeground: "#000000",
            border: "#000000",
            card: "#ffffff",
        },
        {
            background: "#000000",
            foreground: "#ffffff",
            primary: "#818cf8",
            primaryForeground: "#000000",
            secondary: "#2dd4bf",
            mutedForeground: "#cccccc",
            accent: "#fcd34d",
            accentForeground: "#000000",
            border: "#545454",
            card: "#1a212b",
            destructive: "#f87171",
        },
    ),
    "sage-garden": preset(
        "Sage Garden",
        {
            background: "#f8f7f4",
            foreground: "#1a1f2e",
            primary: "#7c9082",
            secondary: "#ced4bf",
            mutedForeground: "#6b7280",
            accent: "#bfc9bb",
            accentForeground: "#1a1f2e",
            border: "#e8e6e1",
            card: "#ffffff",
            destructive: "#c73e3a",
        },
        {
            background: "#0a0a0a",
            foreground: "#f5f5f5",
            primary: "#7c9082",
            primaryForeground: "#000000",
            secondary: "#1a1a1a",
            mutedForeground: "#a0a0a0",
            accent: "#36443a",
            accentForeground: "#f5f5f5",
            border: "#2a2a2a",
            card: "#121212",
            destructive: "#ef4444",
        },
    ),
} satisfies Record<string, ThemePreset>;

interface ThemeStyleModes {
    light?: ThemeStyleOverrides;
    dark?: ThemeStyleOverrides;
}

// Non-color tokens mirror TweakCN's preset metadata. Dark mode inherits the
// theme's light-mode typography/layout tokens unless the upstream preset
// explicitly supplies a dark-mode override.
const tweakcnStyleMetadata: Partial<Record<keyof typeof tweakcnPresets, ThemeStyleModes>> = {
    "modern-minimal": {
        light: {
            fontSans: "Inter, sans-serif",
            fontSerif: "Source Serif 4, serif",
            fontMono: "JetBrains Mono, monospace",
            radius: "0.375rem",
        },
    },
    "violet-bloom": {
        light: {
            fontSans: "Plus Jakarta Sans, sans-serif",
            fontSerif: "Lora, serif",
            fontMono: "IBM Plex Mono, monospace",
            radius: "1.4rem",
            shadowColor: "hsl(0 0% 0%)",
            shadowOpacity: 0.16,
            shadowBlur: "3px",
            shadowSpread: "0px",
            shadowOffsetX: "0px",
            shadowOffsetY: "2px",
            letterSpacing: "-0.025em",
            spacing: "0.27rem",
        },
    },
    "t3-chat": {
        light: {
            radius: "0.5rem",
        },
    },
    twitter: {
        light: {
            fontSans: "Open Sans, sans-serif",
            fontSerif: "Georgia, serif",
            fontMono: "Menlo, monospace",
            radius: "1.3rem",
            shadowColor: "rgba(29,161,242,0.15)",
            shadowOpacity: 0,
            shadowBlur: "0px",
            shadowSpread: "0px",
            shadowOffsetX: "0px",
            shadowOffsetY: "2px",
        },
        dark: {
            shadowColor: "rgba(29,161,242,0.25)",
        },
    },
    "mocha-mousse": {
        light: {
            fontSans: "DM Sans, sans-serif",
            fontSerif: "Georgia, serif",
            fontMono: "Menlo, monospace",
            radius: "0.5rem",
            shadowColor: "hsl(20 18% 51% / 0.4)",
            shadowOpacity: 0.11,
            shadowBlur: "0px",
            shadowSpread: "0px",
            shadowOffsetX: "2px",
            shadowOffsetY: "2px",
        },
        dark: {
            shadowColor: "hsl(20 18% 30% / 0.5)",
        },
    },
    bubblegum: {
        light: {
            fontSans: "Poppins, sans-serif",
            fontSerif: "Lora, serif",
            fontMono: "Fira Code, monospace",
            radius: "0.4rem",
            shadowColor: "hsl(325.78 58.18% 56.86% / 0.5)",
            shadowOpacity: 1,
            shadowBlur: "0px",
            shadowSpread: "0px",
            shadowOffsetX: "3px",
            shadowOffsetY: "3px",
        },
        dark: {
            shadowColor: "#324859",
        },
    },
    "amethyst-haze": {
        light: {
            fontSans: "Geist, sans-serif",
            fontSerif: '"Lora", Georgia, serif',
            fontMono: '"Fira Code", "Courier New", monospace',
            radius: "0.5rem",
            shadowColor: "hsl(0 0% 0%)",
            shadowOpacity: 0.06,
            shadowBlur: "5px",
            shadowSpread: "1px",
            shadowOffsetX: "1px",
            shadowOffsetY: "2px",
            letterSpacing: "0em",
            spacing: "0.25rem",
        },
    },
    notebook: {
        light: {
            fontSans: "Architects Daughter, sans-serif",
            fontSerif: '"Times New Roman", Times, serif',
            fontMono: '"Courier New", Courier, monospace',
            radius: "0.625rem",
            shadowColor: "#000000",
            shadowOpacity: 0.03,
            shadowBlur: "5px",
            shadowSpread: "0px",
            shadowOffsetX: "1px",
            shadowOffsetY: "4px",
            letterSpacing: "0.5px",
            spacing: "0.25rem",
        },
        dark: {
            fontSerif: "Georgia, serif",
            fontMono: '"Fira Code", "Courier New", monospace',
        },
    },
    "doom-64": {
        light: {
            fontSans: '"Oxanium", sans-serif',
            fontSerif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
            fontMono: '"Source Code Pro", monospace',
            radius: "0px",
            shadowColor: "hsl(0 0% 0%)",
            shadowOpacity: 0.4,
            shadowBlur: "4px",
            shadowSpread: "0px",
            shadowOffsetX: "0px",
            shadowOffsetY: "2px",
            letterSpacing: "0em",
            spacing: "0.25rem",
        },
        dark: {
            shadowOpacity: 0.6,
            shadowBlur: "5px",
        },
    },
    catppuccin: {
        light: {
            fontSans: "Montserrat, sans-serif",
            fontSerif: "Georgia, serif",
            fontMono: "Fira Code, monospace",
            radius: "0.35rem",
            shadowColor: "hsl(240 30% 25%)",
            shadowOpacity: 0.12,
            shadowBlur: "6px",
            shadowSpread: "0px",
            shadowOffsetX: "0px",
            shadowOffsetY: "4px",
        },
    },
    graphite: {
        light: {
            fontSans: "Montserrat, sans-serif",
            fontSerif: "Georgia, serif",
            fontMono: "Fira Code, monospace",
            radius: "0.35rem",
            shadowColor: "hsl(0 0% 20% / 0.1)",
            shadowOpacity: 0.15,
            shadowBlur: "0px",
            shadowSpread: "0px",
            shadowOffsetX: "0px",
            shadowOffsetY: "2px",
        },
        dark: {
            fontSans: "Inter, sans-serif",
        },
    },
    perpetuity: {
        light: {
            fontSans: "Courier New, monospace",
            fontSerif: "Courier New, monospace",
            fontMono: "Courier New, monospace",
            radius: "0.125rem",
            shadowColor: "hsl(185 70% 30% / 0.15)",
            shadowOpacity: 0.15,
            shadowBlur: "2px",
            shadowSpread: "0px",
            shadowOffsetX: "1px",
            shadowOffsetY: "1px",
        },
        dark: {
            fontSans: "Source Code Pro, monospace",
            fontSerif: "Source Code Pro, monospace",
            fontMono: "Source Code Pro, monospace",
            shadowColor: "hsl(180 70% 60% / 0.2)",
            shadowOpacity: 0.2,
        },
    },
    "kodama-grove": {
        light: {
            fontSans: "Merriweather, serif",
            fontSerif: "Source Serif 4, serif",
            fontMono: "JetBrains Mono, monospace",
            radius: "0.425rem",
            shadowColor: "hsl(88 22% 35% / 0.15)",
            shadowOpacity: 0.15,
            shadowBlur: "2px",
            shadowSpread: "0px",
            shadowOffsetX: "3px",
            shadowOffsetY: "3px",
        },
    },
    "cosmic-night": {
        light: {
            fontSans: "Inter, sans-serif",
            fontSerif: "Georgia, serif",
            fontMono: "JetBrains Mono, monospace",
            radius: "0.5rem",
            shadowColor: "hsl(240 30% 25%)",
            shadowOpacity: 0.12,
            shadowBlur: "10px",
            shadowSpread: "0px",
            shadowOffsetX: "0px",
            shadowOffsetY: "4px",
        },
    },
    tangerine: {
        light: {
            fontSans: "Inter, sans-serif",
            fontSerif: "Source Serif 4, serif",
            fontMono: "JetBrains Mono, monospace",
            radius: "0.75rem",
            shadowColor: "hsl(0 0% 0%)",
            shadowOpacity: 0.1,
            shadowBlur: "3px",
            shadowSpread: "0px",
            shadowOffsetX: "0px",
            shadowOffsetY: "1px",
        },
    },
    "quantum-rose": {
        light: {
            fontSans: "Poppins, sans-serif",
            fontSerif: "Playfair Display, serif",
            fontMono: "Space Mono, monospace",
            radius: "0.5rem",
            shadowColor: "hsl(330 70% 30% / 0.12)",
            shadowOpacity: 0.18,
            shadowBlur: "0px",
            shadowSpread: "0px",
            shadowOffsetX: "0px",
            shadowOffsetY: "3px",
        },
        dark: {
            fontSans: "Quicksand, sans-serif",
            shadowColor: "hsl(300 80% 50% / 0.25)",
        },
    },
    nature: {
        light: {
            fontSans: "Montserrat, sans-serif",
            fontSerif: "Merriweather, serif",
            fontMono: "Source Code Pro, monospace",
            radius: "0.5rem",
        },
    },
    "bold-tech": {
        light: {
            fontSans: "Roboto, sans-serif",
            fontSerif: "Playfair Display, serif",
            fontMono: "Fira Code, monospace",
            radius: "0.625rem",
            shadowColor: "hsl(255 86% 66%)",
            shadowOpacity: 0.2,
            shadowBlur: "4px",
            shadowSpread: "0px",
            shadowOffsetX: "2px",
            shadowOffsetY: "2px",
        },
    },
    "elegant-luxury": {
        light: {
            fontSans: "Poppins, sans-serif",
            fontSerif: "Libre Baskerville, serif",
            fontMono: "IBM Plex Mono, monospace",
            radius: "0.375rem",
            shadowColor: "hsl(0 63% 18%)",
            shadowOpacity: 0.12,
            shadowBlur: "16px",
            shadowSpread: "-2px",
            shadowOffsetX: "1px",
            shadowOffsetY: "1px",
        },
    },
    "amber-minimal": {
        light: {
            fontSans: "Inter, sans-serif",
            fontSerif: "Source Serif 4, serif",
            fontMono: "JetBrains Mono, monospace",
            radius: "0.375rem",
            shadowColor: "hsl(0 0% 0%)",
            shadowOpacity: 0.1,
            shadowBlur: "8px",
            shadowSpread: "-1px",
            shadowOffsetX: "0px",
            shadowOffsetY: "4px",
            letterSpacing: "0em",
            spacing: "0.25rem",
        },
    },
    supabase: {
        light: {
            fontSans: "Outfit, sans-serif",
            fontSerif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
            fontMono: "monospace",
            radius: "0.5rem",
            shadowColor: "#000000",
            shadowOpacity: 0.17,
            shadowBlur: "3px",
            shadowSpread: "0px",
            shadowOffsetX: "0px",
            shadowOffsetY: "1px",
            letterSpacing: "0.025em",
        },
    },
    "neo-brutalism": {
        light: {
            fontSans: "DM Sans, sans-serif",
            fontMono: "Space Mono, monospace",
            radius: "0px",
            shadowColor: "hsl(0 0% 0%)",
            shadowOpacity: 1,
            shadowBlur: "0px",
            shadowSpread: "0px",
            shadowOffsetX: "4px",
            shadowOffsetY: "4px",
        },
    },
    "solar-dusk": {
        light: {
            fontSans: "Oxanium, sans-serif",
            fontSerif: "Merriweather, serif",
            fontMono: "Fira Code, monospace",
            radius: "0.3rem",
            shadowColor: "hsl(28 18% 25%)",
            shadowOpacity: 0.18,
            shadowBlur: "3px",
            shadowSpread: "0px",
            shadowOffsetX: "0px",
            shadowOffsetY: "2px",
        },
        dark: {
            shadowColor: "hsl(0 0% 5%)",
        },
    },
    claymorphism: {
        light: {
            fontSans: "Plus Jakarta Sans, sans-serif",
            fontSerif: "Lora, serif",
            fontMono: "Roboto Mono, monospace",
            radius: "1.25rem",
            shadowColor: "hsl(240 4% 60%)",
            shadowOpacity: 0.18,
            shadowBlur: "10px",
            shadowSpread: "4px",
            shadowOffsetX: "2px",
            shadowOffsetY: "2px",
        },
        dark: {
            shadowColor: "hsl(0 0% 0%)",
        },
    },
    cyberpunk: {
        light: {
            fontSans: "Outfit, sans-serif",
            fontMono: "Fira Code, monospace",
            radius: "0.5rem",
            shadowColor: "hsl(0 0% 0%)",
            shadowOpacity: 0.1,
            shadowBlur: "8px",
            shadowSpread: "-2px",
            shadowOffsetX: "0px",
            shadowOffsetY: "4px",
        },
    },
    "pastel-dreams": {
        light: {
            fontSans: "Open Sans, sans-serif",
            fontSerif: "Source Serif 4, serif",
            fontMono: "IBM Plex Mono, monospace",
            radius: "1.5rem",
            shadowColor: "hsl(0 0% 0%)",
            shadowOpacity: 0.08,
            shadowBlur: "16px",
            shadowSpread: "-4px",
            shadowOffsetX: "0px",
            shadowOffsetY: "8px",
        },
    },
    "clean-slate": {
        light: {
            fontSans: "Inter, sans-serif",
            fontSerif: "Merriweather, serif",
            fontMono: "JetBrains Mono, monospace",
            radius: "0.5rem",
            shadowColor: "hsl(0 0% 0%)",
            shadowOpacity: 0.1,
            shadowBlur: "8px",
            shadowSpread: "-1px",
            shadowOffsetX: "0px",
            shadowOffsetY: "4px",
        },
    },
    caffeine: {
        light: {
            radius: "0.5rem",
        },
    },
    "ocean-breeze": {
        light: {
            fontSans: "DM Sans, sans-serif",
            fontSerif: "Lora, serif",
            fontMono: "IBM Plex Mono, monospace",
            radius: "0.5rem",
            shadowColor: "hsl(0 0% 0%)",
            shadowOpacity: 0.1,
            shadowBlur: "8px",
            shadowSpread: "-1px",
            shadowOffsetX: "0px",
            shadowOffsetY: "4px",
        },
    },
    "retro-arcade": {
        light: {
            fontSans: "Outfit, sans-serif",
            fontMono: "Space Mono, monospace",
            radius: "0.25rem",
            shadowColor: "hsl(196 83% 10%)",
            shadowOpacity: 0.15,
            shadowBlur: "4px",
            shadowSpread: "0px",
            shadowOffsetX: "2px",
            shadowOffsetY: "2px",
        },
    },
    "midnight-bloom": {
        light: {
            fontSans: "Montserrat, sans-serif",
            fontSerif: "Playfair Display, serif",
            fontMono: "Source Code Pro, monospace",
            radius: "0.5rem",
            shadowColor: "hsl(0 0% 0%)",
            shadowOpacity: 0.1,
            shadowBlur: "10px",
            shadowSpread: "-2px",
            shadowOffsetX: "0px",
            shadowOffsetY: "5px",
        },
    },
    candyland: {
        light: {
            fontSans: "Poppins, sans-serif",
            fontMono: "Roboto Mono, monospace",
            radius: "0.5rem",
        },
    },
    "northern-lights": {
        light: {
            fontSans: "Plus Jakarta Sans, sans-serif",
            fontSerif: "Source Serif 4, serif",
            fontMono: "JetBrains Mono, monospace",
            radius: "0.5rem",
        },
    },
    "vintage-paper": {
        light: {
            fontSans: "Libre Baskerville, serif",
            fontSerif: "Lora, serif",
            fontMono: "IBM Plex Mono, monospace",
            radius: "0.25rem",
            shadowColor: "hsl(28 13% 20%)",
            shadowOpacity: 0.12,
            shadowBlur: "5px",
            shadowSpread: "0px",
            shadowOffsetX: "2px",
            shadowOffsetY: "3px",
        },
    },
    "sunset-horizon": {
        light: {
            fontSans: "Montserrat, sans-serif",
            fontSerif: "Merriweather, serif",
            fontMono: "Ubuntu Mono, monospace",
            radius: "0.625rem",
            shadowColor: "hsl(0 0% 0%)",
            shadowOpacity: 0.09,
            shadowBlur: "12px",
            shadowSpread: "-3px",
            shadowOffsetX: "0px",
            shadowOffsetY: "6px",
        },
    },
    "starry-night": {
        light: {
            fontSans: "Libre Baskerville, serif",
            radius: "0.5rem",
        },
    },
    claude: {
        light: {
            radius: "0.5rem",
        },
    },
    vercel: {
        light: {
            fontSans: "Geist, sans-serif",
            fontSerif: "Georgia, serif",
            fontMono: "Geist Mono, monospace",
            radius: "0.5rem",
            shadowColor: "hsl(0 0% 0%)",
            shadowOpacity: 0.18,
            shadowBlur: "2px",
            shadowSpread: "0px",
            shadowOffsetX: "0px",
            shadowOffsetY: "1px",
        },
    },
    darkmatter: {
        light: {
            fontSans: "Geist Mono, ui-monospace, monospace",
            fontSerif: "serif",
            fontMono: "JetBrains Mono, monospace",
            radius: "0.75rem",
            shadowColor: "#000000",
            shadowOpacity: 0.05,
            shadowBlur: "4px",
            shadowSpread: "0px",
            shadowOffsetX: "0px",
            shadowOffsetY: "1px",
            letterSpacing: "0rem",
            spacing: "0.25rem",
        },
        dark: {
            shadowColor: "#000000",
        },
    },
    mono: {
        light: {
            fontSans: "Geist Mono, monospace",
            fontSerif: "Geist Mono, monospace",
            fontMono: "Geist Mono, monospace",
            radius: "0rem",
            shadowColor: "hsl(0 0% 0%)",
            shadowOpacity: 0,
            shadowBlur: "0px",
            shadowSpread: "0px",
            shadowOffsetX: "0px",
            shadowOffsetY: "1px",
        },
    },
    "soft-pop": {
        light: {
            fontSans: "DM Sans, sans-serif",
            fontSerif: "DM Sans, sans-serif",
            fontMono: "Space Mono, monospace",
            radius: "1rem",
            shadowColor: "#1a1a1a",
            shadowOpacity: 0.05,
            shadowBlur: "0px",
            shadowSpread: "0px",
            shadowOffsetX: "0px",
            shadowOffsetY: "0px",
            letterSpacing: "normal",
            spacing: "0.25rem",
        },
    },
    "sage-garden": {
        light: {
            fontSans: "Antic, ui-sans-serif, sans-serif, system-ui",
            fontSerif: "Signifier, Georgia, serif",
            fontMono: "JetBrains Mono, Courier New, monospace",
            radius: "0.35rem",
            shadowColor: "#1a1f2e",
            shadowOpacity: 0.04,
            shadowBlur: "2px",
            shadowSpread: "0px",
            shadowOffsetX: "0px",
            shadowOffsetY: "1px",
            letterSpacing: "0em",
            spacing: "0.23rem",
        },
        dark: {
            shadowColor: "#000000",
        },
    },
};

function withThemeStyle(preset: ThemePreset, styles?: ThemeStyleModes): ThemePreset {
    const lightStyle = { ...DEFAULT_THEME_STYLE, ...styles?.light };
    const darkStyle = { ...lightStyle, ...styles?.dark };

    return {
        ...preset,
        light: { ...preset.light, style: lightStyle },
        dark: { ...preset.dark, style: darkStyle },
    };
}

const styledTweakcnPresets = Object.fromEntries(
    Object.entries(tweakcnPresets).map(([id, theme]) => [id, withThemeStyle(theme, tweakcnStyleMetadata[id as keyof typeof tweakcnPresets])]),
) as Record<keyof typeof tweakcnPresets, ThemePreset>;

export const themePresets = styledTweakcnPresets;

export type ThemeId = keyof typeof themePresets;
export const themeIds = Object.keys(themePresets) as ThemeId[];
