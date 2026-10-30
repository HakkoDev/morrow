# Changelog

## v0.2.0 — Daily-driver email (2026-10-30)

- Unified Inbox, scoped offline search, conversation navigation and recoverable local drafts.
- Bounded IMAP IDLE, private opt-in notifications and unread tray/taskbar indicators.
- Google/Microsoft OAuth2 PKCE and XOAUTH2 with OS-vault tokens and secure provider endpoint restrictions. Live provider registration/consent/refresh testing remains required.
- Conservative bidirectional Morrow-owned draft synchronization, conflict recovery/resolution and safe UID-scoped cleanup. External provider drafts import as independent copies without modifying originals; full cross-client edit-in-place remains unsupported.
- Rich compose with validated CID inline images, recipient-less IMAP drafts, Bcc preservation, serialized autosaves/uploads and renewable editor leases. Reopening a saved draft reuses its composer.
- Shared shadcn/Radix controls and interaction regressions for dialogs, menus, selects, toggles and tabs. Dependency locks regenerated locally; reviewable lockfile-refresh workflow added.
- Local frontend/native validation and Windows packaging are tracked in `docs/v0.2.0-status.md`. Installed OS behavior, production signing and Linux/macOS packaging remain separate acceptance checks.

### Historical archive notes (superseded by the integrated status above)

The following entries describe intermediate supplied archives, not the final repository's current dependency or verification state.

## v0.2.0 Phase 2: shadcn UI standardization (source candidate, 2026-10-30)

- Standardized shared shadcn-style, source-owned primitives and Radix-backed account dropdown, message context menu, account form controls, and settings tabs/switches/collapsible panels. Preserved Morrow layout, 42 TweakCN theme tokens and centered Dialog CSS.
- Added `Label`, `Checkbox`, `Switch`, `NativeSelect`, `Select`, `Collapsible`, `DropdownMenu`, `ContextMenu`, `Tabs`, and `Skeleton`; expanded shared Button variants and added accessible control states.
- Added automated regression checks and UI component conventions in `docs/shadcn-standardization.md`. Source checks: **75/75 passed** with an available global TS compiler, changed TS/TSX syntax transpilation passed, and workflows parsed.
- **Not yet a release:** new dependencies are declared but `bun.lock` remains stale until Bun can access the registry. Native Rust lockfile, full TS7/Biome, UI/Windows and live provider checks are also pending. Use the updated manual dependency-lockfile workflow on GitHub or run `bun install` locally.

## v0.2.0 Phase 2: release stabilization (development candidate, 2026-10-30)

- Fixed local and remote draft autosave when all fields of a previously saved draft are cleared; brand-new blank compose windows still create no draft.
- Changed editor protection from a single per-draft boolean to independent per-window UUID leases. Renewal every 30 seconds and expiration after 120 seconds protect both simultaneous compose windows and recovery after a renderer crash.
- Added two Rust unit tests for editor lease behavior and four source regression tests for new protections and release tooling.
- Added a manual GitHub Actions lockfile-refresh workflow. It regenerates `Cargo.lock` on Linux, formats Rust, checks frontend and native compilation/tests, uploads the lockfile even if compilation fails and opens a reviewable PR only if all checks pass.
- Stopped Git from ignoring key release and project documentation.
- **73/73 Node source tests passed**, SQLite FTS5 smoke passed and changed TypeScript files syntax-transpiled. Rust compilation, TypeScript 7 full project typecheck, Biome, installed UI and live-provider behavior remain unverified here. `Cargo.lock` is **still stale in this ZIP**, so this is not a release-ready build.

## v0.2.0 Phase 2: External Draft Import (development candidate, 2026-10-30)

- Read-only IMAP Drafts listing for messages not carrying Morrow ownership headers, with UIDVALIDITY-based selection and bounded complete scans.
- Explicit **Import copy** workflow. Imported drafts have new UUIDs; original provider copies remain untouched.
- Supported file attachments stored durably under Morrow app data; supported CID inline images converted into editor data URLs, with strict size/count limits and rejection of unsupported MIME.
- Recipient-less IMAP Drafts formatting using a draft-only internal envelope and retained Bcc; SMTP delivery still enforces a recipient.
- Added targeted source regression tests; no native Rust build or real-provider validation was available in the development environment.
- Not yet implemented: automatic update/delete of drafts created in other clients; general remote attachment roundtrips; complete importer MIME coverage and live conflict tests.

## v0.2.0 Phase 2 Morrow-owned Drafts sync follow-up — source candidate (October 30, 2026)

- Added SQLite v6 per-draft revision/UIDVALIDITY/remote-byte hash tracking; atomic local compare-and-swap and editing leases to protect open compose windows.
- Added background two-way synchronization for messages tagged with Morrow draft UUIDs and compatible text/HTML MIME, with automatic debounced uploads and three-minute periodic fetches.
- Added three-way conflict detection, local recovery copies and explicit resolution buttons. Prevented automatic resurrection of remote-deleted drafts and tracked intentional local deletions.
- Tightened IMAP UIDPLUS + SHA-256 guarding for replacement/deletion; no mailbox-wide expunge and no mutation of unknown provider drafts.
- Deliberate compatibility limits: no generic Gmail/Outlook-created draft import, no remote attachment/CID-image round-trip and no no-recipient uploads. These remain local/recovery-safe instead of being silently corrupted.
- **65/65 Node regression tests passed**, SQLite v6 smoke checks passed and modified frontend source syntax-transpiled. Rust, real mail provider tests and packaged native builds are **not verified**.


## v0.2.0 Phase 2 OAuth2 follow-up — source candidate (October 30, 2026)

- Implemented Google/Microsoft OAuth2 authorization-code + S256 PKCE via the system browser and ephemeral loopback HTTP callback with CSRF state checks and a three-minute deadline. Requires registered native/public application client IDs; no client secret.
- Added provider selection, registered public client-ID entry, authorization UI and guarded account-saving flow with IMAP/SMTP authentication tests before saving.
- Added refresh token persistence in the operating system credential vault, serialized refresh rotation and bearer token reuse during background IMAP IDLE/polling and SMTP sends. No OAuth tokens are exposed to the renderer or SQLite.
- Enabled IMAP `AUTHENTICATE XOAUTH2` and forced SMTP XOAUTH2 for OAuth accounts. Restricted OAuth connections to official TLS-protected provider IMAP/SMTP hosts to avoid bearer token leakage.
- Migrated the database to v5 for account authentication method and public OAuth client ID. Password/app-password account support remains.
- **Unverified source only:** no Rust toolchain, full Bun dependencies, registered providers, or live Windows/Linux native test in this environment. Regenerate lockfiles with `bun run deps:sync` before building. Remote Drafts remains manual-only and bidirectional conflicts remain unfinished.

## v0.2.0 Phase 2 continuation — source candidate (October 30, 2026)

- Added an explicit **Sync draft** action: local-first draft upload to the configured IMAP Drafts folder, with UUID ownership headers, content fingerprints, post-APPEND verification, UIDVALIDITY checks and UIDPLUS-only UID-scoped old-copy cleanup. Server-to-local and multi-device draft conflict resolution are **not** implemented.
- Serialized local-draft autosaves to prevent stale, slower writes replacing newer edits.
- Expanded the rich-text composer with underline, numbered lists and an explicit image picker. Inline PNG/JPEG/GIF/WebP images are capped at five per message and 2 MB each, sanitized on entry and attached with CID references inside multipart/related MIME. Pasted HTML and dropped files remain blocked.
- Added taskbar unread indicators: a small numbered Windows overlay (1–9 and 9+) and native count where supported on Linux/macOS; retained the privacy-conscious tray tooltip.
- Added source regression tests for IMAP draft ownership/UID safety, inline MIME, badge wiring and ordered autosave.
- OAuth2 Gmail/Microsoft account sign-in still requires provider registrations, PKCE, refresh, IMAP XOAUTH2 and SMTP XOAUTH2 integration; no OAuth functionality is claimed.
- **Not release verified:** Rust compilation, package lock regeneration, Biome/TypeScript 7 production build, packaged Windows/Linux native behavior and live provider interoperability remain gated. No v0.2.0 release was published.

## v0.2.0 — Daily-driver email (source candidate)

- Added a shared, account-aware Inbox view, local favorite folders and unread counts.
- Added SQLite FTS5 search over cached message metadata and bodies with per-account filtering.
- Added local SQLite drafts with compose autosave and recovery, and account-scoped conversation lookup.
- Added reply threading headers and strengthened cross-account message ownership checks.
- Added per-account IMAP IDLE watchers with reconnect backoff, bounded sessions and the existing 60-second polling fallback.
- Added opt-in private desktop notifications, per-account mute controls and tray Show/Quit actions.
- Added basic rich-text compose, MIME HTML/plain-text alternatives and formatted local-draft persistence (SQLite schema 4).
- Added offline `from:`, `in:`, `after:` and `before:` search filters with account/folder isolation and UTC calendar-date validation.
- Licensed the project under GNU GPLv3 (`GPL-3.0-only`).
- **Not release-verified:** Gmail/Microsoft OAuth2, remote-server draft synchronization, inline-image composition and taskbar badges remain unimplemented. Local checks and unsigned/test-signed Windows NSIS packaging pass; installed notification/tray behavior, Linux packaging, production signing and live-provider tests remain pending.

## v0.1.7 — CI on Node.js 24

- GitHub Actions now runs on Node.js 24 with current action releases (checkout, setup-node, upload-artifact).
- CI verifies the lockfile, Tauri dependency pins, source regressions, Biome, typechecking, versions, Rust formatting, Clippy and Rust tests before packaging.
- Applied rustfmt across the Rust backend and resolved the remaining Clippy warnings.
- No intentional user-facing changes.

## v0.1.6 — Dependency refresh

- Updated dompurify to 3.4.17, @radix-ui/react-separator to 1.2.0, tailwind-merge to 3.7.0 and @tauri-apps/plugin-dialog to 2.8.3.
- Upgraded TypeScript to 7.0.2 and migrated the compiler configuration (removed `baseUrl`, added Vite client types).
- No intentional user-facing changes.

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

## v0.2.0 continuation (development candidate)

- IMAP IDLE watchers with per-account reconnect backoff and polling fallback.
- Opt-in native desktop notifications, per-account mute and a tray Show/Quit menu.
- Basic rich text compose with sanitization, MIME plain text alternative, and local HTML draft persistence (SQLite schema 4).
- FTS5 search filters for sender, folder, and UTC dates.

Gmail/Microsoft OAuth2 and full bidirectional/multi-device Drafts synchronization still require implementation and live testing. See the Phase 2 continuation above. These source changes are not a verified public release.
