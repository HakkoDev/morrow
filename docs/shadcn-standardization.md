# Shared shadcn/Radix controls in Morrow

The v0.2.0 UI uses **source-owned shadcn-style components** in `src/components/ui/`, backed by Radix UI where appropriate, with TweakCN themes still providing the semantic design tokens. These aren't a hosted shadcn package, and we have not visually rebuilt the app using a new template.

## Rules

- Reuse `Button`, `Badge`, `Dialog`, `Input`, `Textarea`, `Label`, `ScrollArea`, `Separator`, `Tooltip`, `Skeleton`, `Checkbox`, `Switch`, `Collapsible`, `Tabs`, `DropdownMenu`, and `ContextMenu` for standard UI affordances.
- Use `NativeSelect` (a shadcn-style native select control) when OS-native selection is preferable for small settings lists. A Radix-backed `Select` component is also available for custom menus; don't write new `<select>` styling in feature components.
- Compose existing primitives rather than copying visual classes into dialogs/menus. Do not use nested interactive controls (for example a `Button` inside a `Button`). Mail rows, the sanitized message iframe, theme previews, and the `contentEditable` composer are legitimate feature-specific elements.
- Keep presentation token-based (`bg-card`, `text-muted-foreground`, `border-border`, `ring-ring`) so all 42 TweakCN presets and light/dark modes remain compatible.
- Keep dropdown/context menu keyboard navigation, focus management, dialog overlay placement, reduced motion, and icon-button names/labels accessible.
- The shared controls are checked into source: treat upstream shadcn CLI outputs as reference implementations to be reviewed and merged, **not** as automatic overwrites. Avoid using a new component as an excuse to restyle Morrow's existing layout.

## Changes in this pass

- Standardized the shadcn-style button/input/textarea/badge/dialog/tooltip contract, adding `data-slot` and accessible focus states.
- Replaced the account picker with a Radix DropdownMenu radio group; message actions now use Radix ContextMenu instead of manually managed global pointer listeners.
- Settings navigation uses Radix Tabs; preference checkboxes use Switch; account checkboxes use Radix Checkbox; folder mapping uses Collapsible.
- Replaced inline native select styling with the shared `NativeSelect`; new `Select` is available for situations needing a custom popup.
- Converted one-off feature buttons to the shared Button API while preserving mail row styling. The inline image file input is intentionally hidden/native for access to the OS picker.

## Validation and lockfiles

The source tests and TypeScript *syntax/transpilation* checks can run without installed app dependencies. **They are not substitutes for a full React/TypeScript build or native Tauri testing.** The source ZIP includes `package.json` dependency changes but retains its **old bun.lock**, because the build environment has no npm registry access. `src-tauri/Cargo.lock` was already stale from earlier Phase 2 work.

On a machine with Bun and Rust installed:

```sh
bun install
bun run biome:fix
bun run biome:check
bun run typecheck
bun run test:source
bun run build
bun run tauri:dev
```

Commit the regenerated `bun.lock` after dependency resolution. Alternatively, after pushing the candidate, dispatch `.github/workflows/refresh-lockfile.yml` to regenerate both lockfiles and run the Linux/native and frontend checks before it opens a PR. On Windows, verify the dialogs remain centered, the account selector opens, right-click and Shift+F10 message actions target the right messages, all theme settings stay responsive, and checkbox/switch state persists. Do not tag or publish until the CI/native acceptance gates pass.
