# Appearance and preferences

Morrow ships the 42 TweakCN presets from the theme data supplied for the project. The SCFD theme and custom tint/accent modifiers are not included.

The **Settings** button in the mailbox sidebar opens the Appearance, Mail and Privacy sections. Themes are previewed and applied immediately; no application restart is necessary.

Preferences are stored locally under `morrow.preferences.v1`. They do not include passwords or access tokens and are validated on load; corrupt/unknown values fall back to defaults. Tauri events (`morrow:preferences-changed`) synchronize settings across main and compose windows, with the browser `storage` event as a secondary fallback. No cloud account/profile sync is implied.

## Theme implementation

- `src/lib/theme-presets.ts`: TweakCN themes and style metadata. Preset colors and style values are the source of truth.
- `src/lib/theme.ts`: applies semantic tokens to the document root, including `--background`, `--primary`, sidebar tokens, typography, border radii, and shadow tokens.
- `src/lib/preferences.ts`: typed, validated preference store and cross-window event bridge.
- `src/components/settings/preferences-controller.tsx`: applies saved settings in every native webview and follows operating-system light/dark changes.
- `src/components/settings/settings-dialog.tsx`: the user interface; UI components consume shadcn/Tailwind semantic variables rather than duplicating theme-dependent colors.

The default is **Sage Garden / Dark**. Appearance can be set to Dark, Light, or Follow system.

Online fonts are **opt-in** because Google Fonts requests leave the machine. When enabled, the renderer only requests approved font families over HTTPS. Native HTML email content remains separately sanitized and sandboxed; changing the app theme does not restyle sender-provided mail bodies.

## Mail preferences

- **Density:** compact or comfortable message rows.
- **Show snippets:** toggles the message preview text in the list.
- **Mark read on open:** controls whether selecting an unread message sends an IMAP Seen flag.
- **Remote images:** defaults to blocked. Per-message loading is still possible. Enabling this globally can allow email tracking.
- **Base font scale:** 85–125% for rem-based interface sizing; fixed-pixel elements may not scale identically.

Automatic Inbox synchronization remains on the Rust-side 60-second timer. It is not controlled by a decorative settings toggle.

## Verification

`bun run test:source` covers source contracts, theme completeness, preference parsing, persistence and semantic token application. Before publishing an installer, also run `bun run typecheck`, `bun run biome:check` and the real Windows/Linux Tauri build. See `SMOKE_TESTS.md` for visual, privacy and native multiwindow regression checks.
