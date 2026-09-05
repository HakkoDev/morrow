# Build verification notes

This source tree was prepared for a Windows Tauri v2 NSIS installer build.

## Checks completed in the packaging environment

- TypeScript/TSX grammar parse across `src/` using TypeScript 5.8.3.
- Strict-null/internal TypeScript pass using temporary ambient declarations for the npm packages that are unavailable in this offline environment.
- JSON, TOML, and GitHub Actions YAML configuration parse.
- Rust source structural/delimiter pass.
- Manual/API audit of the Tauri v2 dynamic-window/dialog capability calls and current `async-imap`, `lettre`, `mailparse`, and `keyring` APIs.
- Regression check confirming the old `compose-dialog.tsx` file and the `open` prop/dialog-function collision no longer exist.
- Regression check confirming `MessageView` asynchronous actions no longer dereference a nullable `message` prop.

## Why an `.exe` is not included in this archive

The packaging environment used to prepare this source has neither `cargo`/`rustc` nor network/DNS access to npm/crates.io, so it cannot download the project dependencies or execute the actual Tauri compiler/bundler. An `.exe` claimed to have been built here would therefore be misleading.

The repository includes a Windows GitHub Actions workflow that performs the real build on `windows-latest` with Rust stable and Node 22. You can also build locally on Windows with:

```powershell
npm install
npm run typecheck
npm run tauri:build
```

`npm run tauri:build` explicitly requests the NSIS bundle. The expected output is:

```text
src-tauri/target/release/bundle/nsis/*-setup.exe
```
