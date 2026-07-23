## Why

The acquisitions UI shows a "Show reasons" disclosure on every failed acquisition, but it always expands to "No reasons given" — the `AcquisitionBadge` accepts a `reasons` prop that neither call site ever passes, so it defaults to empty. The reflex fix is to wire the prop, but the failure reasons are *already surfaced better elsewhere*: the list's inline "Outcome" cell and the detail page's per-candidate "History" log both derive from the same `acquisition.history`. UX literature (NN/g on progressive disclosure and redundancy, GDS's summary-plus-detail pattern, Shneiderman's "overview → details on demand") is consistent that a disclosure revealing the *same deduped, same-source* content as adjacent visible text is redundant — an anti-pattern that adds interaction cost, not clarity. The correct fix is to remove the affordance, not feed it.

## What Changes

- Remove the failure-reason **disclosure** (`reasons` prop, the "Show/Hide reasons" toggle, the expandable list, and the "No reasons given" empty fallback) from `AcquisitionBadge`, reducing it to a plain status pill.
- Keep the two legitimate, differently-pitched failure surfaces untouched: the inline `outcomeSummary` (deduped, list + detail) and the per-candidate `History` log (detail only).
- Remove the now-defunct badge unit/SSR test cases that exercised the disclosure, reasons list, and empty fallback.
- Clears a latent accessibility defect: an unwired control announcing expandability (`aria`-style disclosure) that does nothing.
- **BREAKING**: none. `AcquisitionBadge` is an internal web component with no public contract; the facade DTOs are unchanged.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-ui`: The "Acquisition progress observation" requirement is tightened to state *how* failure reasons are surfaced — through the inline outcome summary and the history log, without a redundant expandable control that duplicates already-visible content, and with no reason-revealing affordance presented when there are no reasons to show.

## Impact

- Code: `packages/web/src/lib/components/AcquisitionBadge.svelte` (remove disclosure); its tests `AcquisitionBadge.svelte.test.ts` and `AcquisitionBadge.ssr.test.ts` (drop disclosure cases). Call sites `AcquisitionList.svelte` and `AcquisitionDetail.svelte` are already correct (they pass no `reasons`) and need no change beyond confirming.
- No change to facade DTOs, downloader/importer domains, event schemas, or the `outcomeSummary`/`statusTone` helpers.
- Coverage: net deletion of production branches; the 100% merged-coverage gate must stay green after the disclosure branches and their tests are removed together.
- User-visible: failed acquisitions still show *why* they failed (inline outcome + history); the dead "Show reasons → No reasons given" button disappears.
