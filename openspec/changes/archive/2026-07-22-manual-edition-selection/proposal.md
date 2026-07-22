## Why

The `request-by-release-group-id` change resolves a release-group request to a representative **official** edition, and when a group has **no official edition** it fails cleanly as unresolved. That is safe but lossy: the group's editions (bootleg/promo/etc.) are real, and the user asked for that album. Rather than guess or give up, we should let a human pick the edition — the same human-in-the-loop model the importer already uses for uncertain matches.

## What Changes

- When a release-group request resolves to a group with editions but **no official edition**, metadata resolution yields a new **needs-selection** outcome carrying the candidate editions instead of failing as unresolved.
- The acquisition **pauses** in a new `AwaitingManualSelection` state, retaining the candidate editions and performing no search/download/import.
- A new `SelectEdition` command (valid only while awaiting selection) resumes the acquisition by resolving the chosen release id — reusing the existing direct-by-release-id path — to the target, then continuing the normal flow.
- The web UI surfaces awaiting-selection acquisitions, presents each candidate edition (title, date, country, format, track count), and lets the user choose one.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `metadata-resolution`: change the release-group "no official edition" outcome from an unresolved failure to a needs-selection outcome carrying the candidate editions.
- `acquisition-lifecycle`: add the awaiting-manual-selection pause/resume state and the select-edition command.
- `web-ui`: surface awaiting-selection acquisitions and the edition-choice action.

## Impact

- **Depends on** `request-by-release-group-id` (the release-group request kind, the edition picker, and the release-group adapter branch must exist first).
- **Downloader domain**: new event/command/state; `MetadataResolution` gains a `needsSelection` variant carrying `EditionCandidate` values; adapter maps the picker's candidate editions.
- **Interfaces/UI**: a pending-selection read model, a select-edition command endpoint (HTTP/MCP), and a SvelteKit selection surface.
- Additive to the public contract; contract tests extended, not broken.
