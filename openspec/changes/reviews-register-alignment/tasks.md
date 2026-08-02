# Tasks — reviews-register-alignment

Test-first throughout: every production edit lands behind a failing test (repo non-negotiable).
References: design.md D1–D12; delta specs under `specs/`; research
`docs/research/review-surface-ux-best-practices.md` §n.

## 1. Copy module and verb inventory (D1, D2, D4, D11)

- [x] 1.1 Build the review copy inventory in the web lib: one entry per resolution verb carrying
      button label, consequence clause, and timeline echo (D1.6); `satisfies`-checked maps, no
      bare `default` arms, tolerant fallbacks tracing raw values to disclosure
- [x] 1.2 Add the ask-oriented chip labels (attention kinds + review kinds) and the queue
      context-summary strings per the D4 table; retire `moduleLabel` from `$lib/attention.ts`
- [x] 1.3 Add the match-quality presentation: category bands + the shipped percent formula
      (D6); retire lower-is-better `formatDistance` from visible-text call sites
- [x] 1.4 Add the remediation stage gloss map with verbatim fallback (D4)
- [x] 1.5 Correct the three hedged timeline strings in the timeline copy module per the D2/D4
      table; update the timeline echo for review resolutions to the verb inventory (D1.6)
- [x] 1.6 Rewrite the no-match, supply-id-hint, and unknown-review strings source-agnostically
      (D9); ensure no visible string names beets, a module, or an enum

## 2. Intent titling (D3)

- [x] 2.1 Add the pure title-composition helper with its fallback chain (acquisition request
      phrase → path basename → "Import awaiting review"), failure-tolerant at every link
- [x] 2.2 Wire the composition into the reviews detail load and the attention-queue load;
      review rows and the detail `<h1>` render the composed title, staged path demoted to a
      labeled supporting line
- [x] 2.3 Cover the degradation scenarios (no correlation, failed read, empty path) in
      page-server and SSR tests

## 3. Resolution affordances and destructive confirm (D1, D5)

- [x] 3.1 Re-label all resolution forms from the verb inventory; em-dash consequences; ellipsis
      on form-opening summaries; no parenthesized asides (`ResolveForms`, `ManualTagsForm`,
      `CandidateTable` apply button, duplicate-action choice labels)
- [x] 3.2 Render the two file-deleting verbs with low-emphasis danger styling hooks, never the
      page-primary action (D1.4)
- [x] 3.3 Implement the SSR confirm step in the reviews `[id]` action: no dispatch without the
      `confirmed` marker — re-render with the modeled pending-confirmation state; outcome-named
      submits (`Delete the files` / `Keep the files`); decline returns unchanged
- [x] 3.4 Page-server tests: destructive verb without `confirmed` does not dispatch; with it
      dispatches; decline round-trips; non-destructive verbs dispatch directly

## 4. Candidate evidence (D6, D7)

- [x] 4.1 Add the pure word-level string-diff helper (current vs proposed) with unit tests,
      including unicode and no-change cases
- [x] 4.2 CandidateTable: muted unchanged rows, highlighted changed values with direction cue,
      headline category + percent, penalty reasons visible without amounts
- [x] 4.3 Add the per-candidate strong-scent disclosure holding `dataSource`, `albumId`, raw
      distance, and per-penalty amounts; remove them from layer-1 text
- [x] 4.4 Legacy-review fallback renders the score presentation glossed in the register

## 5. Queue and detail assembly (D3, D8)

- [x] 5.1 AttentionQueue: drop the rendered module chip (keep `data-module`), adopt ask chips
      and composed titles; update SSR tests
- [x] 5.2 ReviewDetail: composed title + supporting path line, ask-register kind presentation,
      register-compliant headings and notes per the D4 table
- [x] 5.3 Verify nav link and `data-testid` seams unchanged (`empty`, testids used by
      black-box tiers)

## 6. Skins (D10)

- [x] 6.1 Add semantic tokens/hooks for the decision anatomy: danger affordance, confirm block,
      diff marks, muted rows, candidate disclosure
- [x] 6.2 Theme the anatomy in all three skins (forum finishing-pass first); destructiveness
      never color-alone
- [x] 6.3 CSS-off/document-order sanity: confirm the new anatomy reads correctly unstyled

## 7. Gate and verification

- [x] 7.1 Sweep for leftover banned vocabulary in visible strings (enums, module nouns, tool
      names, parenthesized asides, lower-is-better numbers) across the web package
- [x] 7.2 `pnpm check` green (format, lint, typecheck, build, 100% coverage)
- [ ] 7.3 Local `pnpm test:e2e` (Docker + NAT modules) — mandatory: user-visible strings in
      the diff (ship.md Phase 5 step 1)
- [ ] 7.4 Walk the live surfaces once in the dev app: queue chips/titles, a match review's
      diff and disclosure, both destructive confirms, corrected timeline strings
