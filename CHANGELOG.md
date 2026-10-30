# Changelog

## v0.1.5 — Themes and preferences (source candidate)

- Added 42 TweakCN themes with matching light/dark palette, typography, radius and shadows. SCFD, tints and accent overlays are excluded.
- Replaced scattered theme overrides with one semantic CSS-token engine; separate compose windows share the same settings.
- Added settings for theme, dark/light/system appearance, message density, base font scale, preview snippets, mark-read-on-open, remote images and opt-in Google Fonts.
- Stored preferences locally with validation and per-window synchronization; no user/account secrets included.
- Added theme and preference regression tests. Windows/Linux installers and cross-window behavior still require real Tauri build validation.
- Cached messages and folders load first. IMAP synchronization runs separately in the background.
- Message rows, details, attachments, and exports are scoped to the correct account.
- IMAP and SMTP must both authenticate successfully before an account is saved.
- Dropdown for switching accounts, with a separate Manage Accounts menu.
- Clicking the already-selected account or folder does not reload it.
- Implement message selection.
- Implemented context menu with read/unread, star, spam, archive, delete, move and save as .eml
- Create and delete folders with confirmation and protection for system folders.
- Fixed scrolling for message list and navigation.
- Added dark mode toggle for email contents.
- Property centered placeholder in the reading pane.
- Various accessability updates, keyboard controls, vocus indicators, etc.

- Addressed Biome 2.5 deprecation (`linter.rules.preset: "recommended"`) without weakening lint rules.
- Fixed React hook dependency stability in mailbox initialization, message loading and sent-mail event handling.
- Added explicit button types, correctly associated account form labels, and removed non-null assertions and return-valued `forEach` callbacks.
- Preserved per-message remote-image privacy using a keyed reader rather than an effect resetting state.
- Added regression checks for these cases. Morrow's Plane project workflow states were repaired separately; that is not application source.

- Added Biome 2.5.15 for frontend formatting, lint and import organization, plus rustfmt/Clippy for Rust.
- Added unified Bun commands and non-mutating CI style checks.
- Added Zed and VS Code project formatting defaults.
- Replaced the long README with a concise public overview; kept developer/release details in separate documentation.
- Updated ignore rules to reduce accidental commits of local credentials and signing material.

## v0.1.4 — Tauri compatibility and multi-platform releases (source candidate)

- Fixed Rust `PluginConfig` updater access with `.plugins.0.get`.
- Pinned Rust `tauri` and npm `@tauri-apps/api` to matching v2.12.3, CLI v2.12.2, added build-time version check.
- Moved MSVC static runtime configuration to `build.windows.staticVCRuntime`.
- Added GitHub release workflow for Windows NSIS and Linux AppImage/DEB, signed updater metadata for both, and serialized uploads to avoid updater-manifest races.
- Added readable Conventional Commit release note generation and post-release asset verification; created `.github/release.yml` for PR-based notes.
- Added contribution, release, signing, and commit/tagging instructions for `hakkodev/morrow`.
- Actual Cargo/Windows/Linux bundle compilation requires CI: this environment has no Rust toolchain or network package resolution.


## v0.1.3 — GitHub updater and Windows console fix (source candidate)

- Added the official Tauri v2 updater + process plugins and least-privilege permissions for the main window only.
- Automatic update check after startup and every six hours while app runs; manual check, version/release notes, download progress, user-confirmed signed install and relaunch.
- Added GitHub Releases workflow to publish signed Windows NSIS updater bundles and `latest.json`; config endpoint resolved from real `GITHUB_REPOSITORY`, not a fabricated URL.
- Kept developer builds buildable without signing credentials, with an explicit disabled-updater UI.
- Fixed the extra Windows release terminal using the GUI subsystem attribute in `main.rs`.
- Added setup docs and regression contracts for the updater and console fix.

## v0.1.2 — Stabilization (source candidate)

- Aligned frontend, Tauri, Cargo, and lockfile project versions to 0.1.2.
- Replaced dangerous mailbox-wide IMAP EXPUNGE fallback with UID-scoped deletion where supported; refuse unsafe cases.
- Selected Trash folder before server-side move to prevent accidental duplicate moves after ambiguous failures.
- Added connection and command timeouts plus more actionable error messages.
- Made UIDVALIDITY cache resets and stale UID pruning transactional.
- Introduced schema compatibility checks and explicit legacy migration errors.
- Added MIME and SQLite Rust regression tests; added Node source-contract tests.
- Restricted dynamic compose-window capability permissions, cleared failed composer seed state.
- Added deterministic Bun-lockfile-driven Windows test and NSIS installer CI workflow.
- No compiled Windows artifact or successful cargo test is claimed by this package.

## v0.1.1 — MIME lifetime correction

- Replaced lifetime-coupled `ParsedMail::parts()` traversal with owned attachment metadata and recursive MIME subpart walking.
- Resolved the `attachment_parts` lifetime compilation defect.

## v0.1.0 — Morrow desktop foundation

- Named Morrow and adopted the charcoal / warm stone / sage dark shadcn token palette.
- New Message, Reply, Reply All and Forward open independent Tauri webview windows.
- IMAP/SMTP, keyring credentials, SQLite local cache, separate native composer and 60-second Rust Inbox polling.
