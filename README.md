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

## Updates

Release builds can check for signed updates through GitHub Releases. Updater signing and publishing are documented in [UPDATER_SETUP.md](UPDATER_SETUP.md).

## License

Morrow is licensed under the [GNU General Public License v3.0](LICENSE) (`GPL-3.0-only`).
