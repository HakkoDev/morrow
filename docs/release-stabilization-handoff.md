# v0.2.0 release stabilization: next verification gate

This ZIP is **not** a release build. Source checks passed, but `src-tauri/Cargo.lock`
remains stale. The current execution environment has no Cargo/Rust toolchain or
package registry access, and no live IMAP/SMTP accounts.

## Implemented here

- A cleared existing draft now persists (including an empty body and subject).
  A new empty compose window still creates no draft.
- Each independent native compose window has an editor-token lease. A window
  closing does not release another window's lease. Heartbeats renew leases
  every 30 seconds; a crashed webview's lease expires after 120 seconds.
- Added Rust lease tests and JavaScript release-stabilization regressions.
- Key source documentation is no longer accidentally ignored by Git.

## Verified here

- `node --test`: **73/73 passed** with the available global TypeScript 5.8.3
  compiler temporarily linked for the test runner.
- `python3 scripts/sqlite-search-smoke.py`: passed.
- Changed TS/TSX files: TypeScript 5.8.3 syntax/transpilation passed, with
  no project-wide typechecking.
- Workflow YAML parsed successfully.

## Not verified here

- Regeneration of `Cargo.lock`, `cargo check`, `cargo test`, `cargo clippy`,
  `cargo fmt`, full TypeScript 7/Biome checks, frontend bundle and native installers.
- Google/Microsoft OAuth login/refresh, Mailcow/Gmail/Outlook IMAP/SMTP,
  draft conflict behavior on real mailboxes, taskbar/tray behavior on Windows.
- General two-way edit-in-place of non-Morrow-created provider drafts and lossless
  server-side attachment/CID-image roundtrip are **not** implemented.

## Recommended CI path

1. Push the source to the Morrow repository on a branch. In GitHub Actions,
   manually run **Refresh native dependency lockfile (reviewable PR)**.
   It uses a real Linux Rust runner to regenerate `Cargo.lock`, format the Rust
   files, build and test, and open a PR. The generated lockfile is available as
   an artifact even if compilation fails.
2. Review and merge the PR. If the repository disallows GitHub Actions from
   creating PRs, download the uploaded lockfile artifact and commit the file
   manually, then re-run the build checks.
3. Wait for the normal Windows CI workflow to pass. Fix any reported compilation,
   formatting, typecheck or lint errors before tagging.
4. Back up the existing SQLite cache and smoke-test the installed Windows
   installer with real accounts, following `docs/v0.2.0-smoke-tests.md`.
5. Only then tag `v0.2.0` and publish the signed draft release after verifying
   its updater signatures and installation behavior.

Do not commit OAuth client secrets, OAuth tokens, credentials or Tauri updater
private keys. Provider OAuth desktop **client IDs** are public metadata.
