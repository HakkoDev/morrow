# Changelog

## 0.1.0 — Morrow build pass

- Branded the application as **Morrow**.
- Applied the dark slate / warm stone / muted sage shadcn token palette.
- Recolored desktop/installer icons to match the Morrow palette.
- Replaced the modal compose flow with dedicated native `compose-*` Tauri windows.
- New Message, Reply, Reply All, and Forward can open separate compose windows.
- Removed the old `compose-dialog.tsx` implementation that caused the `open` boolean / dialog `open()` collision.
- Fixed `MessageView` strict-null TypeScript errors by using a stable non-null message reference after the empty-state guard.
- Added Tauri capabilities for dynamic compose windows, file dialogs, and window closing.
- Added Rust-side Inbox polling every 60 seconds so background/minimized webview timer throttling does not stop mail checks.
- Background account syncs run concurrently and each periodic IMAP sync is bounded by a 50-second timeout.
- Fixed a duplicated `if !missing.is_empty()` in the Rust IMAP incremental-sync path that could break compilation/control flow.
- Kept incremental IMAP synchronization UID-based so already-cached message bodies are not re-downloaded every minute.
- Added a Windows GitHub Actions NSIS installer workflow.
- `npm run tauri:build` now explicitly requests the NSIS installer bundle; `npm run tauri:build:all` remains available for all supported bundles.
- Updated credential-vault branding/service name to `morrow-mail`.
- Added a stable Rust toolchain declaration.
