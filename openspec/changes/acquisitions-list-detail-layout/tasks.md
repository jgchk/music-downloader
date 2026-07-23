## 1. Compact master list

- [x] 1.1 Rework `AcquisitionList.svelte` from a 4-column table to a compact `<ul>` list: each item a link-row with the target (truncated, `title` tooltip), the tone badge, the granular in-progress phase (when `statusTone` is `pending`), and an attempts indicator (when > 0); `aria-current` on the selected row; keep the empty state and the `new-acquisition` link and the `acquisition-row` test hook
- [x] 1.2 Remove the inline Outcome column (outcome/location/failure reason now lives in the detail pane, already rendered by `AcquisitionDetail`)

## 2. Layout & styling

- [x] 2.1 `base.css`: fix the `.master-detail` grid — master fixed ~22rem, detail `minmax(0, 1fr)`; raise the stack breakpoint to ~960px
- [x] 2.2 `base.css`: add the `.queue` compact-list styles (row layout, target ellipsis, selected-row highlight, attempts/phase muted styling); ensure no horizontal overflow
- [x] 2.3 Check the three skins (forum / glass / terminal) render the compact list well; add only skin tweaks that are needed

## 3. Tests

- [x] 3.1 Rewrite `AcquisitionList.ssr.test.ts` for the compact list: target text, phase signal (badge + granular in-progress phase), attempts, `aria-current` present/absent, empty state, `new-acquisition` link; assert the long Outcome value is NOT in the list
- [x] 3.2 Confirm `AcquisitionDetail` tests still cover the outcome/failure-reason display (no change expected); adjust only if the spec delta requires
- [x] 3.3 Restore 100% merged coverage; full `pnpm check` green

## 4. Verify & wrap up

- [x] 4.1 Run the app and verify on all routes (`/acquisitions`, `/acquisitions/new`, `/acquisitions/[id]`) across the three skins that nothing overflows and the master reads well, with real-ish data
- [ ] 4.2 `openspec validate`; review to convergence; archive; release-prep; PR; merge; deploy; verify live
