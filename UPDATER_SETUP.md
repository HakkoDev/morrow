# Morrow GitHub Releases and updater setup

Repository: **https://github.com/hakkodev/morrow**.

This setup produces **Windows x64 NSIS `.exe`** and **Linux x64 AppImage + `.deb`** assets on the same GitHub Release. It also combines signed updater metadata in `latest.json` for Windows and Linux. Regular builds work without updater credentials; only release-tagged signed builds have a configured updater.

## One-time signing configuration

1. Generate a Tauri updater signing keypair on your trusted machine:

   ```powershell
   bun install
   bunx tauri signer generate -w "$HOME/.tauri/morrow.key"
   ```

2. Back up the private key and its passphrase securely. **Do not push the private key to GitHub.** Losing it makes future in-app updates to old installations impossible without manual replacement.
3. At https://github.com/hakkodev/morrow/settings/secrets/actions configure:
   - **Variable** `TAURI_SIGNING_PUBLIC_KEY`: the contents of `morrow.key.pub`.
   - **Secret** `TAURI_SIGNING_PRIVATE_KEY`: the contents of `morrow.key`.
   - **Secret** `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the passphrase (if one was configured).
4. Ensure the repository permits GitHub Actions to create releases (`contents: write` is requested by the workflow). GitHub-hosted runners need access to crates.io and npm to build.
5. The repository must be publicly readable for unauthenticated app clients to fetch GitHub Releases updater assets. A private repository needs a separately authenticated update endpoint; do not embed a GitHub token in the app.

These keys sign updater artifacts; they do **not** Authenticode-sign the Windows installer for SmartScreen reputation.

## Normal development

```powershell
bun install
cargo check --manifest-path src-tauri/Cargo.toml
bun run test:source
bun run typecheck
bun run tauri:build:windows
```

Linux build:

```bash
bun install
bun run tauri:build:linux
```

Ordinary builds have an **unconfigured updater**. The release workflow applies a generated config overlay with your real public key and the endpoint:

`https://github.com/hakkodev/morrow/releases/latest/download/latest.json`

Update checks occur at startup and every 6 hours while Morrow runs, with an optional manual checker. They only offer updates; installation requires user action. Only **published, non-prerelease GitHub Releases** qualify for `/releases/latest`.

## Publishing a release

1. Merge work into `main`, check CI and regenerate/commit `bun.lock` and `src-tauri/Cargo.lock` after dependency changes.
2. Update version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`. Run `node scripts/verify-versions.mjs`.
3. Push an annotated tag matching it exactly:

   ```bash
   git tag -a v0.1.4 -m "Morrow v0.1.4"
   git push origin v0.1.4
   ```

4. `.github/workflows/release.yml` creates a draft and notes, runs **Linux AppImage/DEB** and **Windows NSIS** in parallel, stores both platforms' signed bundles as workflow artifacts, then has one final job upload installers and signatures and upload a combined `latest.json` last. If a job fails, re-run the workflow and leave the release as a draft until verified.
5. Review https://github.com/hakkodev/morrow/releases and **Publish release**. For the very first signed version, install it manually. The next signed version (same public/private key pair) can be installed through the in-app updater.

GitHub release notes are generated from git history since the previous stable SemVer tag by `scripts/generate-release-notes.mjs` and grouped by Conventional Commit prefixes. Direct commits are included, not only merged PRs. `.github/release.yml` is also present for GitHub's native PR-label release notes.

## Troubleshooting

- `tauri (v2.12.x) : @tauri-apps/api (v2.11.x)` → run `bun install` (or `bun update @tauri-apps/api @tauri-apps/cli` with compatible pinned versions), then run version verification. Rust Tauri and JS API must stay on the **same major.minor**, pinned to `2.12.3` here; CLI is `2.12.2`.
- `PluginConfig has no get` → `app.config().plugins.0.get("updater")` is the compatible Rust accessor. This source includes that fix.
- `STATIC_VCRUNTIME is deprecated` → configured via `build.windows.staticVCRuntime` in `tauri.conf.json`. If a warning persists, remove any old `STATIC_VCRUNTIME` environment variable from your local shell/CI environment. Config cannot override the presence of that variable.
- `latest.json` missing an OS → workflow verification fails the draft; re-run the failed job to re-upload missing assets. Builds run **in parallel**; `latest.json` is generated once, only after both platform builds succeed.
- Missing `*.AppImage` or Linux package support → Linux builds require `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`, `pkg-config`, `libssl-dev`, `libsecret-1-dev`, etc. The release runner installs them.
- AppImage needs FUSE on some Linux distributions; `.deb` is provided as an alternative. Tauri's Linux in-app updater is designed for **AppImage**. For `.deb`, install a newer package manually or via a package repository.
- Update checker says unconfigured → local unsigned build or missing public key/endpoint in the release overlay. Install the signed release build.
- Windows console window still opens → rebuild the *release* binary; the subsystem attribute in `src-tauri/src/main.rs` applies when not `debug_assertions`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit naming and tagging policy.

## Release speed and quality gates

- Each platform compiles once in the release profile. The finalizer downloads both sets of workflow artifacts, checks that Tauri `.sig` files are present, and uploads `latest.json` **last**. These checks do not cryptographically verify signatures; the updater verifies them against the configured public key. Never publish a draft when the finalizer fails.
- Release preparation runs source tests, Biome, and TypeScript checks, but the packaging jobs do **not** rerun `cargo check`, `cargo test`, or Clippy on both platforms. Require the Windows `Verify and build Morrow` workflow to pass on the release commit before tagging; configure branch protection for the relevant required checks.
- `Swatinem/rust-cache` shares the Windows cache key between main CI and tagged builds, while Linux maintains its own cache. The first run after a toolchain/dependency/profile change still compiles most Rust crates.
- `Cargo.toml` uses Thin LTO with eight codegen units. This trades some optimization for faster compilation compared with full LTO and one codegen unit; measure actual build timings and binary sizes. The application version is unchanged.
- Do not re-tag a **published** version to pick up this workflow. Commit it on `main` and use it for the next legitimate tagged release; existing published releases should remain immutable.
