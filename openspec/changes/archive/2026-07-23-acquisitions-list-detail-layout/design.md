## Context

v3.6.0 shipped a master-detail `/acquisitions` view. Verified on flight with real data, the master "Queue" pane (a fixed ~264px column) renders the full 4-column acquisitions table (~645px intrinsic width), which overflows and overlaps the detail pane on `/acquisitions`, `/acquisitions/new`, and `/acquisitions/[id]`. A literature/prior-art sweep gave an unambiguous verdict, recorded below.

## Goals / Non-Goals

**Goals:** fix the overflow on all three routes; keep the master-detail split (it suits an actively-updating queue you monitor); preserve the at-a-glance phase signal that the old Outcome column carried; degrade cleanly on narrow viewports.

**Non-Goals:** no change to `AcquisitionDetail` (it already renders outcome + the unified timeline); no domain/facade/wire changes; no new skin work (the fix is base CSS + one component's markup); not building a fully separate drill-down route model (stacking is acceptable at narrow widths).

## Decisions

### The master is a compact summary list, not a table

Material 3 (List-detail canonical layout uses a *list item*, not a grid), Apple HIG (secondary/detail pane must be the wider one), NN/g (long values needed on every row belong in the detail, not a column), and AWS Cloudscape (side split only for ≤5-column tables; wider → detail goes elsewhere) all agree, and prior art converges: email/Sentry use a compact summary list + detail; download managers (qBittorrent/JDownloader — our closest analog) keep a full table but dock detail at the *bottom*; nobody puts a narrow full table beside a wide detail. We keep the side split and make the master a compact list.

**Master item anatomy:** target description (line-1, truncated with ellipsis + `title` tooltip, fluid with `min-width:0` so one long title can't distort the pane); a **phase signal** = the tone badge PLUS, for in-progress items, the granular phase (Downloading / Searching / Validating) — necessary because `phaseLabel` collapses every in-progress state to "Working"; and a small **attempts** indicator when > 0. The selected item carries `aria-current` and a persistent highlight (Apple HIG requires the primary pane to persistently mark the active selection).

**Where the old columns go:** Target → item line 1; Status → tone badge + granular in-progress phase; Attempts → small indicator; **Outcome (location / failure reason) → the detail pane** (already rendered by `AcquisitionDetail`). This is the fix's crux: the long Outcome value is the overflow source and belongs in the detail per NN/g.

### Widths and responsive behavior

Master **fixed ~22rem** (≈352px — a *list* lives fine there; the 264px only starved a *table*); detail **flexible and wider** (`minmax(0, 1fr)`), satisfying Apple's "secondary is the wider pane". Below **~960px** (the width at which master ~320px + detail ~600px + gutters stop both clearing their minimums — Material's Expanded window class is ≥840dp; we add gutter headroom) the panes stack to a single column so nothing overflows. Stacking (list above detail) is chosen over a JS-driven single-pane drill-down for simplicity; the compact list stacks cleanly.

*Alternative considered — full-width table + detail below/route (qBittorrent / GitHub Actions):* legitimate, but it costs the at-a-glance list while inspecting a job, which is worse for a queue you babysit. Rejected in favour of keeping the split with a compact master.

### Long-value handling

Target uses single-line ellipsis + `title` tooltip (revealed on hover and keyboard focus). The full outcome/path lives in the wide detail pane. No horizontal scrolling of the master (NN/g: a last resort).

## Risks / Trade-offs

- **Loss of per-row terminal outcome at a glance** → the tone badge (Done/Failed) plus one selection surfaces it; this is the intended master-detail trade and matches every analog.
- **Stacked (not drill-down) narrow layout shows both panes** → acceptable; the compact list is short, and the detail is one scroll away. A true single-pane drill-down is a possible later enhancement.

## Accessibility

Selected master item marked `aria-current` with a persistent highlight; target truncation tooltip available on keyboard focus; the list is a real `<ul>`/`<li>` of links so keyboard/AT navigation and reading order are correct; DOM source order (list then detail) matches reading order.
