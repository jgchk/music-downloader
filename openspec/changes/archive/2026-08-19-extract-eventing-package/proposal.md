# Extract the eventing package

## Why

The seam's delivery and correlation *mechanisms* exist as near-identical copies across the two bounded contexts: the catch-up subscription twins differ by **zero code lines** (only comment prose), yet their test suites have already drifted 259 lines apart over identical behaviour; the correlation modules are byte-identical modulo `CONTEXT_NAME`, pinned so by a string-equality boundary test. That is `docs/research/bounded-contexts-vs-modules.md`'s "accidental shared kernel" pitfall verbatim: duplication that is forbidden to diverge is a shared kernel paying duplication cost without one-fix-site benefit. Meanwhile each subscription copy carries a 14-field dependency interface whose knobs are supplied as constants that have never varied, and its `park` poison arm has zero production callers — `docs/research/poison-event-halt-vs-park.md` (2026-08-18) concludes halt-only is the field-attested policy for this seam's consumer profile.

## What Changes

- New workspace package `packages/eventing`: a generic, domain-blind leaf library holding the seam's mechanics — a `checkpointedDrain` module (the resume-from-checkpoint / drain-to-head / hold-on-transient / halt-on-permanent protocol behind a ~5-field interface, tuning constants as defaults, the coalescing pass as an unexported internal) and the correlation mechanics (mint, adopt-vs-mint, causation chaining, the causation parser, bound to an opaque context name; the wire envelope schemas stay per context).
- Both contexts' `CatchUpSubscription` twins become consumers of `checkpointedDrain`; both contexts' `application/correlation` twins become consumers of the correlation module. Domain language, event vocabularies, ACL schemas, and per-context event-store types stay duplicated per context — the no-shared-**model** rule is unchanged.
- The `park` poison policy is deleted (unused in production; halt-only per the research verdict). The `Transient`/`Permanent` classification becomes the load-bearing wall: transient still holds-and-retries with the fallback poll; only permanent halts.
- The `module-architecture` "No shared kernel" requirement is amended to "No shared model": a mechanism-only leaf package is permitted under lint-enforced conditions (no imports from `packages/*`, no domain vocabulary; contexts import it outside `domain/`).
- Doc updates: CONTEXT-MAP seam vocabulary gains "checkpointed drain" and corrects "poison-event policy (`halt` or `park`)" to halt-only; archived D1/D7/D13 get annotations pointing at the superseding decisions (D7's Marten citation has drifted — Marten deleted the policy palette D7 mirrored).
- Test consolidation: the two subscription suites collapse into one suite in `packages/eventing` plus per-context step-function tests; the string-equality correlation boundary test retires (the twins it pinned stop existing); `packages/eventing` joins the `pnpm check` lanes and the 100% coverage gate.

**Both reactors are explicitly out of scope** — see design "Non-Goals" and D3. No wire contract or event schema changes. Two observable surfaces do change: the never-exercised park arm is gone, and the drain's structured log lines name the feed position `position` rather than `globalSeq`, because the shared module cannot carry a consumer's field name.

## Capabilities

### New Capabilities

(none — the eventing package is mechanism shared by existing capabilities, not a new behaviour)

### Modified Capabilities

- `module-architecture`: the "No shared kernel" requirement becomes "No shared model" — no source package shared between the modules may carry model types or domain vocabulary; a generic mechanism-only leaf package is permitted, with lint-enforced conditions replacing the blanket prohibition.
- `cross-module-delivery`: the "Poison-event policy per subscription" requirement narrows to halt-only — bounded retries with backoff, then halt without advancing; the "Park preserves progress" scenario is removed (per-stream park recorded as a named, non-adopted upgrade path in the research doc).

## Impact

- New: `packages/eventing` (src + tests + its own check-lane wiring).
- Modified: `packages/{downloader,importer}/src/application/events/catch-up-subscription.ts` (dissolve into thin construction of `checkpointedDrain`), both `src/application/correlation/*` (replaced by the shared module), both `src/composition/runtime.ts` (constant salad moves into drain defaults).
- **Untouched:** both reactors, both effect-landers, the parked-effect machinery.
- Deleted: the subscription `park` arm and its knob-permutation tests; `test/boundaries/correlation.test.ts`'s string-equality describe block; duplicated correlation fixtures.
- Lint: dependency-rule config gains the leaf-package clauses.
- Specs/docs: `module-architecture`, `cross-module-delivery` deltas; `CONTEXT-MAP.md`; annotations on archived design decisions D1 (merge-modular-monolith), D7 (same), D13 (end-to-end-correlation).
- Release: pure refactor + spec amendment — ships as `refactor`/`chore`; no version bump demanded.
