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

Morrow v0.2.0 implements OAuth2 PKCE for Gmail and Outlook/Microsoft 365 IMAP/SMTP. The Rust backend opens the system browser, accepts a one-time loopback callback, keeps access/refresh tokens out of the React frontend and SQLite, and stores refresh credentials in the OS vault. It refreshes expired tokens during later IMAP IDLE, polling and SMTP connections. Existing password and app-password accounts still work.

1. Register a **public/native desktop client** with the provider, not a confidential/web application. Never embed an OAuth client secret in Morrow.
2. Google: create a Desktop OAuth client, request `https://mail.google.com/` (restricted Gmail scope), and use the built-in `http://127.0.0.1:<ephemeral-port>/callback` loopback flow. Gmail's app verification, testing-mode restrictions, and data-policy review may apply if distributing Morrow to other users.
3. Microsoft: register a Mobile and desktop application that allows personal/work accounts as needed, enable public-client flows, register `http://localhost/callback` as the native redirect (Entra ignores the ephemeral port), and grant delegated permissions `IMAP.AccessAsUser.All`, `SMTP.Send` for Outlook, plus `offline_access`. Administrator consent and SMTP AUTH tenant/mailbox policy may be necessary.
4. In the account editor, choose Google OAuth2 or Microsoft OAuth2. Morrow applies official server settings; enter the public client ID for the app you registered, then click **Sign in** and complete browser consent. **Test connection** and **Save account** only after authorization succeeds. You may compile client IDs in using `MORROW_GOOGLE_CLIENT_ID` or `MORROW_MICROSOFT_CLIENT_ID` build environment variables instead.
5. Tokens are stored in the OS credential vault, and removed when accounts are deleted. Cached email remains on disk under the existing local data policy. No SMTP/IMAP password is requested for OAuth accounts.

## License

Morrow is licensed under the [GNU General Public License v3.0](LICENSE) (`GPL-3.0-only`).
