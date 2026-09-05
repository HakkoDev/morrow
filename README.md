# Morrow

**Morrow** is a dark, native desktop IMAP/SMTP mail client built with **Rust + Tauri v2** and a **React + shadcn/ui + Tailwind CSS v4** frontend.

It is a **mail client only**. Morrow does not run an SMTP server, IMAP server, MTA, queue, spam filter, or any other mail-server infrastructure. It connects directly to mail servers you already have.

## What is implemented

### Desktop experience

- Mailbird/Thunderbird-style three-pane mailbox layout
- Dark-mode-only Morrow theme using the muted slate / warm stone palette
- **New Message, Reply, Reply All, and Forward open in a separate native Tauri window**
- Multiple independent compose windows can be open at once
- Compose supports To, Cc, Bcc, subject, body, and multiple attachments
- Message HTML is rendered separately from the dark application chrome so sender formatting remains readable

### Mail accounts

- Multiple accounts
- Generic IMAP + SMTP configuration
- TLS, STARTTLS, or plain transport options
- Connection testing before saving
- Common-provider setting guesses for Gmail, Yahoo, and iCloud
- Generic `mail.<domain>` fallback for self-hosted providers
- Separate IMAP and SMTP usernames/passwords when required
- Editable Sent, Drafts, and Trash folder mappings
- RFC 6154 special-use folder discovery fallback for Sent/Trash/Archive
- Optional IMAP Sent-copy append for SMTP servers that do not save sent mail themselves
- Gmail preset disables the extra Sent append because Gmail's SMTP service stores sent messages itself

### Receiving / IMAP

- Folder discovery
- Inbox and arbitrary folder sync
- Immediate Inbox sync at startup and account switch
- **Rust-side automatic Inbox sync every 60 seconds while Morrow is running**
  - the polling loop is not dependent on a React/browser timer
  - minimized/background webviews do not stop the polling loop
  - the UI receives a `mail:synced` event and refreshes the current Inbox from the local cache
- Incremental UID-based synchronization
  - server UID list is authoritative
  - local messages removed from the server are pruned from the cache
  - existing messages refresh flags without downloading the entire RFC822 body again
  - complete RFC822 bodies are downloaded only for uncached UIDs
- UIDVALIDITY handling; local folder cache resets if server UID validity changes
- Read/unread state through `\\Seen`
- Star/unstar through `\\Flagged`
- Move / archive
- Trash and permanent delete behavior
- Fallback from IMAP `MOVE` to `COPY + \\Deleted + EXPUNGE` for servers without MOVE support
- Load-older batches from the UI, up to the 1,000-message local view limit per folder
- Local message search over cached subject, sender, recipients, and preview

### Reading messages

- MIME parsing
- Plain-text and HTML bodies
- Multipart messages
- Attachment discovery and save-to-disk
- Sandboxed HTML rendering
- DOMPurify sanitization
- Remote images blocked by default to reduce tracking-pixel exposure
- Per-message option to load remote images
- Reply, Reply All, and Forward actions

### Sending / SMTP

- SMTP over implicit TLS
- SMTP with required STARTTLS
- Optional plain SMTP for trusted/development networks
- SMTP authentication
- To / Cc / Bcc
- Subject and plain-text body
- Multiple file attachments
- MIME/content-type detection
- RFC message generation through Lettre
- 30-second SMTP command timeout
- Best-effort Sent-folder archive after SMTP acceptance
- SMTP success is not reported as failure if only the IMAP Sent archive fails, preventing accidental duplicate sends

### Desktop storage and security

- SQLite local cache in the Tauri application-data directory
- WAL mode and foreign-key support
- Passwords are **not** stored in SQLite
- IMAP/SMTP credentials are stored in the OS credential store through `keyring`
  - Windows Credential Manager
  - macOS Keychain
  - Linux Secret Service
- Tauri CSP enabled
- Compose windows receive only the Tauri capabilities they need through the `compose-*` capability rule
- No frontend access to raw saved credentials after account setup

## Theme

Morrow is intentionally dark-mode-only. The application token layer uses this palette:

```text
Canvas / deep slate     #2F3640
Elevated slate          #4F5966
Soft slate              #6F7682
Warm stone              #8B8178
Soft warm stone         #A79C91
Sand highlight          #C8B7A6
Muted sage              #7D8F88
Soft sage               #B8C6BD
```

The colors are mapped into shadcn/Tailwind semantic tokens in `src/styles.css` instead of being scattered through individual components.

## Stack

### Desktop / backend

- Tauri v2
- Rust
- Tokio
- `async-imap`
- `lettre`
- `mailparse`
- `rusqlite` (bundled SQLite)
- `keyring`
- `native-tls` / `tokio-native-tls`

### UI

- React
- TypeScript
- Vite
- Tailwind CSS v4
- shadcn/ui-style components using Radix primitives
- Lucide icons
- DOMPurify

## Project layout

```text
.
├── .github/
│   └── workflows/
│       └── build-windows.yml       # repeatable Windows NSIS installer build
├── src/
│   ├── components/
│   │   ├── mail/
│   │   │   ├── account-dialog.tsx
│   │   │   ├── compose-window.tsx # dedicated native-window compose UI
│   │   │   ├── mail-sidebar.tsx
│   │   │   ├── message-list.tsx
│   │   │   └── message-view.tsx
│   │   └── ui/                     # shadcn-style UI primitives
│   ├── lib/
│   │   ├── html.ts
│   │   ├── mail-api.ts
│   │   ├── open-compose.ts         # creates Tauri compose-* webview windows
│   │   ├── types.ts
│   │   └── utils.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── src-tauri/
│   ├── capabilities/
│   ├── icons/
│   ├── src/
│   │   ├── commands.rs
│   │   ├── credentials.rs
│   │   ├── db.rs
│   │   ├── imap.rs
│   │   ├── mime.rs
│   │   ├── models.rs
│   │   ├── smtp.rs
│   │   ├── lib.rs
│   │   └── main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── rust-toolchain.toml
├── tsconfig.json
└── vite.config.ts
```

## Prerequisites

Install the normal Tauri v2 platform prerequisites first:

- Rust stable **1.88 or newer** (`keyring` 4.2 requires Rust 1.88+)
- Node.js 22 recommended
- Your operating system's Tauri/WebView build dependencies

Then install JavaScript dependencies:

```bash
npm install
```

## Development

```bash
npm run typecheck
npm run tauri:dev
```

## Production builds

For the normal Windows installer path, `npm run tauri:build` is intentionally pinned to the **NSIS `.exe` bundle only**. This avoids making the ordinary build depend on Windows' optional WiX/VBSCRIPT MSI tooling.

```powershell
npm run tauri:build
```

To request every Tauri bundle supported by the current operating system instead:

```bash
npm run tauri:build:all
```

The Tauri `beforeBuildCommand` runs `npm run build`, so a frontend TypeScript failure stops packaging rather than producing a broken application.

### Windows `.exe` installer (NSIS)

On Windows:

```powershell
npm install
npm run typecheck
npm run tauri:build
```

The NSIS installer is emitted under:

```text
src-tauri/target/release/bundle/nsis/*.exe
```

The repository also contains `.github/workflows/build-windows.yml`. Run the **Build Windows installer** workflow (or push a `v*` tag) to compile Morrow on a Windows runner and upload the generated NSIS `.exe` as a workflow artifact.

### Linux note

This project uses native TLS. On Debian/Ubuntu-style systems you normally need the Tauri Linux build prerequisites plus OpenSSL development packages (commonly `pkg-config` and `libssl-dev`). The OS credential vault also expects a working Secret Service implementation in the desktop session.

## Adding an account

1. Open **Add IMAP/SMTP account**.
2. Enter the display name and email address.
3. Press **Guess server settings** or fill the servers manually.
4. Set IMAP hostname, port, TLS mode, username, and password.
5. Set SMTP hostname, port, TLS mode, username, and password.
6. Use **Test connection**.
7. Save the account.
8. Morrow immediately syncs Inbox and then automatically checks Inbox every 60 seconds while the app is running.

Typical generic secure settings are:

```text
IMAP: 993 / TLS
SMTP: 465 / TLS
```

or:

```text
IMAP: 993 / TLS
SMTP: 587 / STARTTLS
```

Use the exact settings supplied by the mail provider. Morrow deliberately does not silently downgrade TLS.

## Authentication scope

The included account flow supports normal IMAP/SMTP **username + password or app-password authentication**.

OAuth2 is intentionally not represented as a fake generic checkbox. Gmail/Microsoft OAuth requires provider-specific application registration, client IDs, redirect URIs, consent configuration, token refresh handling, and XOAUTH2/OAuth IMAP/SMTP authentication. If a provider disables password/app-password IMAP/SMTP authentication, an OAuth2 provider integration must be added for that provider.

For ordinary self-hosted Dovecot/Mailcow-style IMAP/SMTP accounts and providers that support app passwords, the included authentication path is ready to use.

## Local data

The SQLite database is created inside Tauri's application data directory as:

```text
mail.sqlite3
```

It contains account server metadata and cached email content, but **not account passwords**.

Credential-vault entries are stored under the service name:

```text
morrow-mail
```

with separate IMAP and SMTP entries per account UUID.

## Important behavior

- SQLite is a cache, not the source of truth for mailbox state.
- IMAP operations are performed on the mail server first, then reflected locally.
- `BODY.PEEK[]` is used when downloading mail so a background sync does not mark messages read.
- Opening an unread message intentionally sends `\\Seen` to the IMAP server.
- Deleting a message first moves it to the configured/special-use Trash folder; deleting from Trash permanently deletes/expunges it.
- Sending happens through SMTP only.
- When enabled, saving the sent copy happens afterward through IMAP.
- Automatic receive polling runs every 60 seconds for each configured account while the Morrow process is running.

## Provider note

Morrow does **not** include or require a mail server. IMAP is the receiving/synchronization protocol and SMTP submission is the sending protocol. Mail storage/delivery remains the responsibility of the configured provider or your existing self-hosted mail server.

## Product-level additions that are not part of this build

The core IMAP/SMTP flow is implemented. Larger Thunderbird/Mailbird-class layers that can be added later include provider OAuth2, server-side search, draft autosave/sync, contacts, signatures, rules/filters, unified inbox, desktop new-mail notifications, threading/conversation view, calendar/contact protocols, PGP/S-MIME, and automatic application updates.
