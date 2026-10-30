# Phase 2 external Drafts import implementation notes

## Safety contract

- Automatic two-way reconciliation only operates on Morrow-owned messages with matching UUID/revision/UIDVALIDITY.
- A provider-created draft is listed only as a read-only IMAP UID. Import requires explicit user intent and rechecks UIDVALIDITY and absence of Morrow ownership headers after fetching the body via `BODY.PEEK[]`.
- Imported copies are independent local drafts, not linked to the source provider UID. Neither import nor subsequent Morrow sync can alter or delete the original source UID.
- Attachment bytes are written under the application-data directory, not temp, using generated paths and sanitized file basenames. Import either saves a complete supported draft locally or reports an error without altering the remote source.
- Unsupported cryptographic, nested or malformed MIME, excess payloads and unresolved inline images fail closed. The importer is deliberately conservative; complex original formatting may not round-trip identically even when it is accepted.
- UIDPLUS, UID-scoped cleanup, last-seen hash checks and existing conflict resolution still apply to new Morrow-owned copies.

## Provider differences

Provider-created drafts frequently lack Morrow ownership UUIDs and may change IMAP UID during save. Matching on subject, recipient or message ID is not sufficient to safely overwrite them. True external cross-client *edit-in-place* will require provider-specific identity models, attachment/image round-trip tests, reliable deletion handling and validation on actual Gmail/Microsoft/standard IMAP servers.

## Release blockers

Current candidate passed Node source regressions and modified TypeScript syntax transpilation only. Rust compilation, dependency lock regeneration, full TypeScript/Biome and native/real-provider tests remain unverified. A green source suite does not imply a shippable release.
