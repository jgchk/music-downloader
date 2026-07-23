## Why

The v3.6.0 master-detail acquisitions view is broken with real data on prod. The master "Queue" pane is a fixed narrow column (~264px), but it renders the full 4-column acquisitions table (Target / Status / Attempts / Outcome, where Outcome is a long file path or failure reason). The table's intrinsic width (~645px) overflows the master column and **overlaps the detail pane**, burying the detail, the new-request form, and the selected-acquisition view on `/acquisitions`, `/acquisitions/new`, and `/acquisitions/[id]`.

A research sweep (Material 3 List-detail, Apple HIG split views, NN/g data tables, AWS Cloudscape, and prior art from Gmail, Sentry, GitHub Actions, qBittorrent, k9s/Lens) is unanimous: **a multi-column data table is the wrong content for a side-by-side master pane.** The master must be a *compact summary list* (identifier + status signal); long per-row values that are needed on every row belong in the detail, not a column. A narrow full table beside a wide detail "appears essentially nowhere — because it doesn't work."

## What Changes

- **The acquisitions master pane becomes a compact summary list**, not a table: each item shows the **target description**, a **phase/status signal** (the tone badge, plus the granular in-progress phase — Downloading / Searching / Validating — which the tone badge alone collapses to "Working"), and a small **attempts** indicator. The selected item is marked `aria-current`, with the target truncated (ellipsis + tooltip) so one long title can't distort the pane.
- **Each acquisition's outcome / location / failure reason moves to the detail pane.** It is already rendered there (`AcquisitionDetail`'s outcome summary + history); the change is that it is **no longer duplicated inline in the list**. Failure reasons remain shown-once (no redundant expandable control), now via the detail view rather than a list column.
- **The master-detail layout is fixed and made responsive.** The master is a fixed ~22rem column and the detail is the wider, flexible pane (per Apple HIG: the secondary pane is the wider one); below ~960px the two panes stack to a single column so nothing overflows on narrow viewports.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `web-ui`: the **Acquisition progress observation** requirement is modified — the acquisitions list becomes a compact master (target + phase signal), and each acquisition's outcome / failure reason is surfaced in the **detail view** (selected in the detail pane) rather than as an inline list column, while remaining shown once (no redundant reason-revealing control).

## Impact

- **`packages/web` only.** `AcquisitionList.svelte` reworked from a 4-column table to a compact list; `base.css` master-detail grid widths + a `.queue` list style + the responsive breakpoint; `AcquisitionList.ssr.test.ts` updated. `AcquisitionDetail` is unchanged (it already renders the outcome). No domain, facade, or wire-contract changes; no breaking changes.
- Fixes a live rendering defect on flight (v3.7.0). Ships as a patch.
