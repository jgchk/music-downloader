## Context

A bounded-context review found the importer's resolution verb `reject-and-retry-download` borrows the **downloader's** action-vocabulary and its domain comments narrate the **downloader's** private stale-guard / acquisition-revival invariant. The fix is to rename the verb to the importer's own intent and strip the borrowed reasoning. The one design question that decides *how* to do this safely is the verb's exact exposure surface: an in-process rename is a coordinated compile-break across one deploy, but any serialized/cross-context appearance forces an additive migration under the no-breaking-change non-negotiable.

Constraints: pure domain (no I/O in `src/domain`); errors as values; durable state behind ports wired only in composition; 100% coverage; **no breaking change** to any serialized event or cross-context seam contract; additive-only.

## Exposure tracing — the finding

Grepping `reject-and-retry-download` across both packages and tracing each hit to "persisted / crosses the ACL" vs "in-process transient" yields three distinct altitudes:

### 1. Cross-context published wire — UNAFFECTED (the verb is not there)

The importer publishes `ReleaseVerdictRecorded` to the downloader as the `release.verdict` event (`packages/importer/src/interfaces/contracts/events/{schemas,mapping}.ts` → outbound feed → `packages/downloader/src/interfaces/events/verdict-consumer.ts`). The payload is `{ acquisitionId, candidate: {username, path, sizeBytes?}, verdict: 'rejected', reasons }`. **It never carries the resolution verb string.** The domain event `ReleaseVerdictRecorded` likewise carries only `acquisitionId`, `candidate`, `reasons` — not the verb. The downloader's consumer-owned tolerant reader (`interfaces/contracts/verdicts/schemas.ts`, `externalVerdictDataSchema`) reads `verdict: z.literal('rejected')` and never sees the importer's resolution language.

→ **Renaming the verb does not touch the cross-context contract at all. The downloader package needs no change, no dual-read, no new event type.**

### 2. The importer's OWN event store — the one serialized surface (forces additive)

`ReviewResolved.resolution` (a `Resolution`) is persisted verbatim: `SqliteEventStore.append` writes `data: JSON.stringify(event)`, so `"kind":"reject-and-retry-download"` is an immutable stored fact. It is read back on every replay through three paths:
- the state fold — `evolveResolved`/`AwaitingReviewState.settled: PendingRejection` (`state.ts`), where `PendingRejection = Extract<Resolution, {kind:'reject'} | {kind:'reject-and-retry-download'}>`;
- the exhaustive `RecordIntakeDeleted` switch on `settled.kind` (`decide.ts` ~:207) — a non-exhaustive switch here strands the intake undeleted forever;
- the in-memory history projection — `read-models.ts` `historyEntry` reads `event.resolution.kind` into a `review-resolved` entry.

Per event-sourcing's immutable-facts rule and the no-breaking-change non-negotiable, a bare rename of the domain `kind` would break replay of every historical `reject-and-retry-download` event. **This is the surface that makes the change additive rather than a free rename.**

### 3. In-process facade DTO + web BFF — transient, single-deployable (rename-safe)

`resolveReviewRequestSchema` (`facade/schemas.ts`) carries `verb: 'reject-and-retry-download'` on the inbound request DTO, mapped to the domain in `facade/mapping.ts`; `resolutionVerbSchema` carries it for the outbound history DTO. The only caller is the web BFF in the **same deployable** (`packages/web/src/lib/server/forms.ts`, the `ResolveForms` component's hidden `value=`, `reviews/[id]/page.server.ts`). The request verb is never persisted (it is parsed, mapped to the domain, discarded); the history verb is *derived* on every read from the (upcast) event log, so it is never a stored value either.

→ Renaming these is a **coordinated compile-break across one atomic deploy** — a synchronized web-BFF form update — not a wire break.

## Decision — additive rename via the upcaster seam, new verb `reject-unusable-delivery`

Because altitude (2) is serialized, the change is **additive**, but only at that altitude; altitudes (1) and (3) are untouched-or-coordinated. The existing, purpose-built seam absorbs the serialization concern:

### D1: New verb name — `reject-unusable-delivery`

It names the importer's own intent — the delivered copy is unusable — and stops at the ACL: it says nothing about downloading, retrying, or reviving, which are the consumer's concerns. Contrast the two reject verbs in the importer's own language: `reject` = "wrong thing to have"; `reject-unusable-delivery` = "right thing, bad copy". The retained `acquisitionId`/`candidate` remain **opaque provenance** echoed back on the verdict fact — the importer carries them, never interprets them.

### D2: Register the importer's first upcaster (`ReviewResolved` v1→v2)

The `UpcasterRegistry`/`CURRENT_SCHEMA_VERSION` seam in `adapters/sqlite/upcaster.ts` exists precisely so "the first real schema change is a localized, tested upcaster rather than a migration." This change is that first use:
- bump `CURRENT_SCHEMA_VERSION` 1 → 2, so new `ReviewResolved` events are stamped v2 and carry the new token;
- register a `ReviewResolved` v1→v2 upcaster that, when `data.resolution.kind === 'reject-and-retry-download'`, rewrites it to `reject-unusable-delivery` (all other resolution kinds pass through untouched);
- wire the populated registry where `composition/runtime.ts` (~:164) currently constructs an empty `new UpcasterRegistry()` — via a small factory (e.g. `buildUpcasterRegistry()`) in the sqlite adapter, so the wiring is testable.

Result: the domain union carries **only** `reject-unusable-delivery`; legacy v1 events are lifted before `evolve` (or any projection) ever sees them, so the state fold, the exhaustive `RecordIntakeDeleted` switch, and the history projection all read historical rejections identically. This is the ES form of the no-breaking-change policy — old facts stay valid, new writes use the new language.

Alternative considered — keep both kinds in the domain `Resolution` union forever (tag-tolerant). Rejected: it re-imports the very smell we are removing (the domain would still name the downloader's verb), and it leaks a legacy token into the pure domain instead of confining it to the deserialization boundary where upcasters belong.

Alternative considered — a naive rename with no upcaster. Rejected: breaks replay of historical `reject-and-retry-download` events (violates the non-negotiable).

### D3: In-process facade + web BFF renamed in lockstep (no dual-verb wire)

`resolveReviewRequestSchema.verb`, `resolutionVerbSchema`, `facade/mapping.ts`, and every web form/component/test value flip to `reject-unusable-delivery` in the same change. No deprecation window and no accept-both is needed: there is no external client and the value is never serialized, so the single-deployable compile-break is the migration. (If an out-of-process HTTP/CLI/MCP binding ever returns — see the note in `facade/schemas.ts` — that binding would own its own additive translation; not in scope now.)

### D4: Which downloader-vocabulary comments move, and where

Strip from the importer's **domain** and reframe in importer terms (the reasoning does not "move" to a new file — the downloader already documents its own stale-guard/revival in `downloader/interfaces/contracts/verdicts/schemas.ts` and its external-validation use-cases; the importer simply stops duplicating it):
- `events.ts` `DeliveredCandidate` (~:26) — drop "the sender's stale-guard compares against"; reframe as "retained as opaque provenance so a release verdict can echo back exactly which copy was judged; the importer does not interpret it."
- `events.ts` `ReleaseVerdictRecorded` (~:250) — drop "so it can revive the acquisition"; reframe as "a record-only fact the importer publishes: the delivered copy was rejected as unusable; what a consumer does with it is the consumer's business."
- `decide.ts` (~:95) — drop "the sender fulfilled with (its stale-guard compares it)"; reframe as "echo back the exact copy the importer judged (opaque provenance for the consumer); without a retained candidate the verb is refused precisely — plain reject stays available."
- `decide.ts` (~:21) `NoRetainedCandidate` doc + `react.ts` (~:74) comment — update to the new verb name and drop "the outbound publisher consumes" framing that leans on the consumer's behavior.

Out of scope: the **contract-layer** comments in `interfaces/contracts/events/schemas.ts` (e.g. "echoed for the receiver's stale-guard"). That is the producer-owned ACL whose explicit job is to satisfy the documented tolerant-reader needs of its consumer; wording justified to the consumer is acceptable at the contract altitude. (A sibling change, `review-sweep-hardening` task 7.8, separately restates that `release.verdict` docstring in the importer's own terms.)

## Risks / Trade-offs

- **Upcaster correctness is load-bearing** — a legacy `reject-and-retry-download` that is *not* upcast would fold to a `Resolution` the new exhaustive switches do not handle. Mitigated by a direct upcaster unit test (legacy row → new kind) plus a replay/read-back test through the real registry that a stored v1 rejection settles and projects identically.
- **Schema-version bump touches every new write** (all events now stamp v2). This is the intended semantics of the seam; the upcaster is registered per-type-per-fromVersion, so only `ReviewResolved` v1 is transformed and all other v1 events pass through unchanged.
- **Coordinated web rename** — the domain/facade/web edits must land together or the compile breaks; that is the point (a half-done rename cannot ship). No runtime window where old and new coexist across a boundary, because there is no boundary.

## Migration Plan

Additive and backward-compatible. On deploy: new `ReviewResolved` events are written at schema version 2 with `reject-unusable-delivery`; existing version-1 events are upcast on read. No table change, no data backfill, no rollback complication — reverting the code leaves the (few) v2 rows readable only if the v1→v2 upcaster is present, so a revert would need the upcaster kept; the safer revert path is to re-add the old kind, which is why the forward change is the low-risk direction. The cross-context `release.verdict` contract and the downloader are entirely unaffected.

## Open Questions

None blocking. The out-of-process transport binding (HTTP/CLI/MCP) is retired today; if it returns, its verb translation is that binding's own additive concern, not this change's.
