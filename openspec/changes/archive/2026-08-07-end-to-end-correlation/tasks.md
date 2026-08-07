# Tasks — end-to-end-correlation

Red-first TDD throughout; the failing test precedes every production edit, visible in commit
order. Domain layers are untouched by construction — any task needing a domain edit is a design
error to raise, not implement.

## 1. The pair's home (both modules)

- [x] 1.1 Types + mint (red first): `correlationId` format, `CommandContext`, the causation
      reference union with context-namespaced event coordinates; mint helper; terminology note
      (incl. the Axon-inversion hazard) at the type.
- [x] 1.2 `EventMetadata` grows optional `causation` beside the existing `correlationId` (red
      first): append paths write the context; readers tolerate absence; no upcaster changes —
      pinned by a legacy-row read test.

## 2. Carriage through the shell

- [x] 2.1 Application services take `CommandContext` (red first, compiler-driven call-site
      sweep): facades construct from their trigger; events of one decision share the deciding
      command's causation.
- [x] 2.2 Reactor propagation (red first): story copied from the triggering stored event,
      causation = its coordinates, fresh mint on absent metadata (with the calibrated log
      line); per-dispatch child logger binds `{correlationId, streamId, globalSeq}`.
- [x] 2.3 Supervisor context pinning (red first): watch pins the dispatch context at creation;
      callbacks, teardown, and outcome delivery log/deliver under it — the async-hop test from
      the research checklist.
- [x] 2.4 Non-HTTP triggers (red first): poll ticks, boot re-emit, parked retry — one test per
      trigger. Finding: they do NOT mint. A reactor trigger delivers a stored event, which already
      has a story, so it continues it; fresh minting happens only where there is no parent. There
      is no intake scanner in the codebase — intake is event-driven (design D15).

## 3. The web layer

- [x] 3.1 `handle` hook mints per request; request-scoped child on `locals`; facade command
      calls thread the context (red first: one-request-one-id log test; the hooks test
      register).
- [x] 3.2 Boundary pin: no id in any user-visible copy (grep-backed test over the copy layer,
      e2e scrape surface untouched).

## 4. The seam

- [x] 4.1 Producers render the optional metadata block (red first): both outbound renderers +
      schemas; additivity gates green against frozen fixtures.
- [x] 4.2 Consumers adopt the story (red first): tolerant intake reads the block, adopts the
      id with consumed-event causation; absent block ⇒ fresh mint, consumption unchanged —
      contract-tier tests against the producers' fixtures both ways.
- [x] 4.3 The verdict continues the story (red first): downloader-origin import → resolved
      review → published verdict carries the original id — the full-circle contract test.

## 5. Domain blindness and gates

- [x] 5.1 Grep-backed boundary test: no domain-layer signature or payload names correlation or
      causation (boundaries-tier style).
- [x] 5.2 E2E join assertion: one submission's story id appears in both modules' stores (no new
      phase; rides `full-loop`). Asserted over the durable metadata rather than captured container
      logs — same id by construction, deterministic where stdout is not (design D14).
- [x] 5.3 `logging.md` Correlation section reviewed against the shipped reality; full gate
      (`pnpm check`) green. Out-of-process e2e NOT run locally (needs docker + a live slskd);
      its new assertion typechecks and its helper was verified against a real SQLite store.
