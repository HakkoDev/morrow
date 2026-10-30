# Morrow

A desktop email client built with Tauri, Rust and React.

Morrow brings multiple IMAP/SMTP accounts into a customizable interface with various themes. It supports a three-pane inbox, separate compose windows, attachments and local message caching. The 0.2 development branch adds a unified inbox, local drafts, conversation navigation, and cached full-text search.

> **Status:** Early development. Expect bugs and breaking changes.

## Install

Download available builds from [GitHub Releases](https://github.com/hakkodev/morrow/releases). Windows and Linux packages are built through GitHub Actions.

## Run from source

Install [Bun](https://bun.sh/), [Rust](https://rustup.rs/) and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system.

```sh
bun install
bun run tauri:dev
```

To create a production bundle:

```sh
bun run tauri:build:all
```

## Development

Biome formats and checks TypeScript, React, CSS and JSON. Rust uses rustfmt and Clippy.

```sh
bun run format       # Apply Biome and rustfmt
bun run quality      # Check formatting, lint, types and source tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and release conventions.

## OAuth2 development setup (Google / Microsoft)

Morrow v0.2.0 implements OAuth2 PKCE for Gmail and Outlook/Microsoft 365 IMAP/SMTP. Local builds and regression tests pass; **live provider sign-in is not yet verified**. The Rust backend opens the system browser, accepts a one-time loopback callback, keeps access/refresh tokens out of the React frontend and SQLite, and stores refresh credentials in the OS vault. It refreshes expired tokens during later IMAP IDLE, polling and SMTP connections. Existing password and app-password accounts still work.

1. Register a **public/native desktop client** with the provider, not a confidential/web application. Never embed an OAuth client secret in Morrow.
2. Google: create a Desktop OAuth client, request `https://mail.google.com/` (restricted Gmail scope), and use the built-in `http://127.0.0.1:<ephemeral-port>/callback` loopback flow. Gmail's app verification, testing-mode restrictions, and data-policy review may apply if distributing Morrow to other users.
3. Microsoft: register a Mobile and desktop application that allows personal/work accounts as needed, enable public-client flows, register `http://localhost/callback` as the native redirect (Entra ignores the ephemeral port), and grant delegated permissions `IMAP.AccessAsUser.All`, `SMTP.Send` for Outlook, plus `offline_access`. Administrator consent and SMTP AUTH tenant/mailbox policy may be necessary.
4. In the account editor, choose Google OAuth2 or Microsoft OAuth2. Morrow applies official server settings; enter the public client ID for the app you registered, then click **Sign in** and complete browser consent. **Test connection** and **Save account** only after authorization succeeds. You may compile client IDs in using `MORROW_GOOGLE_CLIENT_ID` or `MORROW_MICROSOFT_CLIENT_ID` build environment variables instead.
5. Tokens are stored in the OS credential vault, and removed when accounts are deleted. Cached email remains on disk under the existing local data policy. No SMTP/IMAP password is requested for OAuth accounts.

The OAuth sign-in implementation **must be tested with registered Google and Microsoft apps and real mailboxes** before it can be considered provider-verified. Dependency lockfiles are committed; use `bun install --frozen-lockfile` and `bun run deps:check` to verify alignment. Google uses a broad restricted Gmail scope; do not promise public-distribution support without completing applicable Google verification.

## Updates

Release builds can check for signed updates through GitHub Releases. Updater signing and publishing are documented in [UPDATER_SETUP.md](UPDATER_SETUP.md).

## License

Morrow is licensed under the [GNU General Public License v3.0](LICENSE) (`GPL-3.0-only`).

## Drafts synchronization (v0.2.0 source candidate)

Unsent drafts are stored locally in SQLite. Morrow-owned drafts have an IMAP sync baseline (UUID, content revision, byte hash and UIDVALIDITY), background reconciliation every three minutes, offline persistence, and explicit conflict resolution with recovery copies. Server changes are applied automatically only to **supported text/HTML Morrow-owned drafts** when the local version is unchanged. No recipient is required for an IMAP draft, but **SMTP sending still requires at least one `To` recipient**. The draft MIME builder keeps `Bcc` on the saved copy.

**Drafts from other apps:** The Drafts dialog has **Find drafts** under **Drafts from other apps**. Morrow shows external IMAP messages read-only, then **Import copy** downloads the selected UID (checked against UIDVALIDITY), creates a new local UUID and preserves the original provider draft untouched. Supported MIME attachments are saved under Morrow application data, and supported CID images are converted to inline images in the editor. Imported copies are independent drafts, **not a remote editing link**. Editing and uploading a copy will create a separate Morrow-owned message on the server, which may appear alongside the original.

Safety limits: a complete Drafts scan is capped at 500 messages; remote import max 8 MB, 40 attachments, 5 inline images at 2 MB each. Encrypted, signed, nested, malformed or unresolved CID MIME is rejected, not silently converted. Non-editable Morrow-owned drafts with attachments are still retained remotely and may require manual recovery. Safe remote mutation requires UIDPLUS; deletion never triggers mailbox-wide EXPUNGE. Provider applications may remove custom headers and may have different draft behavior. Automatic two-way syncing of independently authored Gmail/Outlook/Apple Mail drafts remains future work.

**Verification:** 83 JavaScript source/runtime tests, 35 Rust tests, frontend checks, strict Clippy and unsigned/temporary-QA-signed Windows NSIS builds pass locally. This does not establish live provider behavior, production signing or installed OS integration. See `docs/v0.2.0-status.md` and complete the manual acceptance matrix in `docs/v0.2.0-smoke-tests.md` before publishing a supported release.
