## 1. Lock the new behavior with a failing test

- [x] 1.1 In `AcquisitionBadge.svelte.test.ts`, add a test asserting a `failed`-phase badge renders **no** reason-revealing control (no button, no reasons list) — this fails against the current disclosure. This is the red step for the spec's "reasons shown once, not behind a redundant control" scenario.
- [x] 1.2 Confirm the existing list/detail component tests still assert reasons appear via the inline outcome summary (`outcomeSummary`) and the detail history log; add a covering assertion if any surface is untested, so removing the disclosure leaves reasons demonstrably visible elsewhere.

## 2. Remove the disclosure from the component

- [x] 2.1 In `AcquisitionBadge.svelte`, reduce `Props` to `{ phase }` — drop the `reasons` and `initiallyExpanded` props, the `expanded` `$state`, and the `toggle` handler.
- [x] 2.2 Remove the `{#if phase === 'failed'}` block: the "Show/Hide reasons" button, the expandable `<ul>`/`{#each reasons}`, and the "No reasons given" `{:else}` fallback. The template becomes the single `<span class="badge">` line.
- [x] 2.3 Run 1.1's test — now green.

## 3. Clear stale tests and confirm call sites

- [x] 3.1 In `AcquisitionBadge.svelte.test.ts`, delete the cases exercising expand/collapse, the reasons list, and the empty fallback; keep the phase-label/tone cases.
- [x] 3.2 In `AcquisitionBadge.ssr.test.ts`, update expected server-rendered markup to the reduced badge (no button/list); remove disclosure-specific assertions.
- [x] 3.3 Confirm `AcquisitionList.svelte` and `AcquisitionDetail.svelte` pass only `phase` to the badge (they already do) — no edit expected; note if any deviation is found.

## 4. Gate and verify

- [x] 4.1 Run `pnpm check` — format, lint, typecheck, build, and 100% merged coverage all green (no coverage reference to removed disclosure branches).
- [x] 4.2 Drive the acquisitions UI (list + a failed acquisition's detail) and confirm: failure reasons still visible via outcome summary + history, and the dead "Show reasons" button is gone.
- [x] 4.3 Validate the change: `openspec validate --change simplify-acquisition-failure-reasons`.
