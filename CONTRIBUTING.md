# Contributing to Morrow

Morrow's home is https://github.com/hakkodev/morrow. The main branch should be kept releasable.

## Formatting and linting

The repository has one style for both languages: four spaces, LF newlines and a 160-column target. Biome handles JS/TS/TSX/CSS/JSON; `cargo fmt` handles Rust. Biome does not parse Rust source.

```sh
bun run format                # Format both languages
bun run format:check          # Check formatting without modifying files
bun run biome:fix             # Biome formatting, import organization, safe lint fixes
bun run biome:check           # Biome CI (format, lint, imports)
bun run lint                  # Biome lint and Cargo Clippy
bun run quality               # Complete style/type/source check
```

Use the Biome editor extension with Zed or VS Code, and rust-analyzer for Rust. Project-specific settings are in `.zed/` and `.vscode/`. Avoid using Prettier or a separate Rust formatter in the same files.

## Everyday commits

Use short-lived branches and **Conventional Commits** with a descriptive subject, e.g.

- `fix(imap): prevent unsafe delete fallback`
- `fix(updater): align Tauri API and Rust versions`
- `feat(mail): add conversation threading`
- `build(release): publish Linux and Windows packages`
- `docs: explain GitHub updater signing`
- `refactor(compose): separate draft state`
- `test(mime): cover nested attachment parsing`
- `chore(deps): refresh Tauri dependencies`

The release-note generator sorts these automatically. Nonconventional subjects also appear in **Other changes**; prefer Conventional Commits to keep notes useful. The `!` marker (e.g. `feat(mail)!: change account format`) indicates a breaking change.

Suggested branch names: `fix/tauri-version-skew`, `feat/imap-idle`, `build/linux-releases`.

Use pull requests for medium/large changes. Prefer **squash merge** with a Conventional Commit title, label PRs as `feature`, `bug`, `security`, etc. GitHub's `.github/release.yml` also categorizes PR notes. Small personal hotfixes can go directly to `main` if you prefer; the commit-note generator supports them too.

Before pushing, run:

```powershell
bun install
bun run format
bun run quality
bun run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Appearance and preferences

See [docs/appearance.md](docs/appearance.md) for the theme token system and local preferences. Keep new UI colors on semantic shadcn tokens and ensure native compose windows receive setting changes.

## Tagged releases

The release workflow builds Windows NSIS and Linux AppImage/DEB packages in parallel.
The final job waits for both, then uploads the signed installers and a single
`latest.json` manifest. Do not publish the draft if verification fails.

Rust tests, Clippy and the Windows installer run in the `Verify and build Morrow`
workflow on `main`. Require that workflow to pass before tagging a release;
tagged release builds intentionally avoid repeating those expensive checks.
The release profile uses Thin LTO with eight codegen units to reduce compilation time.

Inspect the timings for **Build signed packages**, **Linux native dependencies**,
and **Cache Rust dependencies** if future builds seem slow. A cold cache will still
require substantial Rust compilation. Never overwrite an already published
release tag just to rerun the build.

## License and contributions

Morrow is distributed under [GPLv3](LICENSE) (`GPL-3.0-only`). By submitting a contribution, you agree that it may be distributed under the same license. Only submit code and assets you have the right to contribute.

## UI components

Morrow uses source-owned shadcn-style/Radix primitives and semantic theme tokens. Read [docs/shadcn-standardization.md](docs/shadcn-standardization.md) before adding or restyling controls.
