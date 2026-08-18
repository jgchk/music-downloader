# Design: adopt-download-language

## Context

See `proposal.md` — Why. The settled ubiquitous language lives in `CONTEXT-MAP.md` and `packages/*/CONTEXT.md`; the storage/wire strategy is the verdict of `docs/research/event-language-drift.md` (Greg Young's convertibility rule; rename the model, never the log; published contracts frozen). Constraints that shape everything here: the additive-only contract gate on published events, frozen fixtures, 100% coverage, the `(global position, event id)` pair being a delivery contract that consumer checkpoints point into (so history is never rewritten), and jj/trunk workflow with `pnpm check` green on every commit.

## Goals / Non-Goals

**Goals**

- Code identifiers, spec prose, and capability names speak the glossary language; a reader diffing spec against code finds the same words.
- Zero observable behavior change: byte-identical published-event fixtures, unchanged stored-event tokens, unchanged API/DTO shapes, unchanged rendered web copy and `data-testid`s.
- One new observable behavior, deliberately small: the `DEPOSIT_ROOT` / `LIBRARY_ROOT` config resolution (spec delta in this change).

**Non-Goals**

- No pin-trusting auto-import (separate proposal; drafted after this lands, in the new language).
- No stored-event migration, no new event types, no upcasters beyond what exists.
- No renaming of published event types, payload fields, DTO keys, or API routes — ever, per the research verdict; a `/downloads` route alias is possible later, additively, and is out of scope here.
- No UI copy changes.

## Decisions

1. **Stored tokens are opaque serialization constants, mapped at the store adapter.** The in-memory event union renames fully (`AcquisitionRequested` → `DownloadRequested`, …); each module's SQLite adapter owns an exhaustive bidirectional map between stored `type` strings / payload field names and the renamed model. Alternative rejected: new event types + upcasters for all ~30 types (touches every replay path for zero semantic gain; the research reserves upcasters for payloads changing for real reasons — the `reject-and-retry-download` precedent). Alternative rejected: renaming stored tokens in place via copy-transform (Young's "nuclear option"; breaks the seam's position/id delivery contract).
2. **The mapping is total and closed, enforced by tests.** A single table per module (stored token ↔ model constructor) with an exhaustiveness check in both directions, plus round-trip tests against the existing frozen fixtures — a fixture that fails to fold, or folds to a differently-named model event, fails the build. This is the tripwire against a "rename" that accidentally smuggles a semantic change (the convertibility rule).
3. **Wire boundary naming happens in the facade/contract mapping layer, which already exists.** DTO keys and published payload fields keep old names; the mapping files (`facade/mapping.ts`, `interfaces/contracts/events/mapping.ts`) become the single place old wire names meet new model names, each with a one-line glossary-pointer comment. No shims elsewhere.
4. **Capability renames are directory moves plus link fixes, done in the same commit as the code rename.** Precedent: `importer-outbound-events`. Archive directories are historical record and stay untouched; `openspec/changes/archive/**` references to old capability names remain valid history.
5. **`DEPOSIT_ROOT` resolution order**: `DEPOSIT_ROOT` if set; else `LIBRARY_ROOT` with a startup warning; both set and equal — accepted silently; both set and different — precise startup failure (fail-closed beats silently preferring one). Alternative rejected: warning-and-prefer-new on conflict (a conflicting pair is a misconfiguration, and the house rule is misconfiguration fails startup).
6. **Commit typing**: the rename commits are `refactor`; the config-alias commit is `feat(runtime)` and carries the matching `version:prep` bump, since `version-check` derives release semantics from commit types. One release ships the whole change.

## Risks / Trade-offs

- [Giant mechanical diff hides a real change] → The fixture byte-identity and stored-token round-trip tests are the review anchor: reviewers verify the tripwires exist and pass, not every hunk. Review sweep (`/review-all`) runs on the final state.
- [Rename collides with in-flight work] → Land as one train, rebase-quick; the workspace-per-session discipline already isolates concurrent efforts. Coordinate: nothing else touching `packages/*/src/domain` merges mid-train.
- [`try` is a JS keyword] → The vocabulary word cannot be an identifier in some positions; use `tryCount`/`tries` for fields and keep `attempt`-free naming without fighting the language (glossary governs prose, not keyword legality).
- [E2E scrapes UI text] → No rendered copy changes in this change; the e2e blast-radius audit still runs before merge per house practice.
- [Homelab env not updated] → None needed: `LIBRARY_ROOT` fallback keeps the deployed compose valid; the warning is the nudge, sops update follows at leisure.

## Migration Plan

1. Implement per tasks; every commit passes `pnpm check`.
2. Merge via the normal PR train (rebase-only, auto-merge armed).
3. Deploy normally; observe the `LIBRARY_ROOT` deprecation warning in flight's logs as confirmation the fallback path works; update homelab env to `DEPOSIT_ROOT` whenever convenient.
4. Rollback = revert the PR; no data or contract state to unwind.

## Open Questions

(none — the storage/wire strategy questions were resolved by `docs/research/event-language-drift.md` before drafting)
