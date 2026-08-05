# Design — slskd-contract-truth

## Context

See proposal.md — Why. Evidence base: `docs/research/slskd-transfer-state-capture.md` (grill
2026-08-05, riders adopted contingent on the smoke test). Current recorder:
`test/contract/record/slskd.ts`, scenario-scripted against live slskd at the homelab, with the
consumed-field projection scrub and the documented events↔transfers coupling caveat. Manifest:
`test/contract/support/slskd-manifest.ts` + `spec-compat.ts` (path params and bodies only).

## Goals / Non-Goals

**Goals:** every consumed shape witnessed; manifest complete; scenario re-recordability; the
classifier true to recorded reality.

**Non-Goals:** CI lab usage; slskd 0.26 adoption; any adapter behavior change beyond recorded
evidence; recording states the pinned version cannot emit (0.22.5's terminal vocabulary is
`Succeeded/Cancelled/Errored` — `Rejected`/`TimedOut` return only as 0.26 work).

## Decisions

**D1 — Lab topology.** docker-compose, record-time only: `ghcr.io/soulfind-dev/soulfind`
(port 2242, open auto-registration) + peer slskd sharing seeded fixture files (configured
`UPLOAD_SLOTS=1` + minimal speed limit for slot starvation) + target slskd pointed at soulfind.
Orchestration lives in the recorder script as named scenarios (`queued`, `cancelled`,
`errored`, `rejection`, `offline`, `full-flow`), each producing its fixture set with provenance
naming lab + slskd version. **Smoke gate first:** task 1.1 proves slskd logs in, searches, and
transfers through soulfind; if it fails, the recorded fallback (documented in the recorder) is
live capture for queued (immediate poll race) + cancelled (DELETE `?remove=false`) with
explicit provenance-marked gaps for errored/rejection — and the unreachable-state stub
correction proceeds regardless, since it depends on slskd source reading, not recording.

**D2 — placeInQueue needs the position endpoint.** The research proved a poll alone never
carries `placeInQueue`; the recorder's queued scenario calls the position endpoint explicitly
and the fixture set records both the poll and the position response; the manifest gains the
position operation if (as expected) the adapter consumes it — if the adapter turns out to
derive queue position another way, that discovery is evidence for the fix rider.

**D3 — Manifest completeness is enforced, not promised.** The new tier check derives the set of
issued operations from the contract tests' asserted requests and fails on any request an
adapter sends that the manifest lacks (closing the DELETE-searches class structurally, not by
one-off addition). Query parameters join `SlskdOperation`/`checkSlskdSpec` as first-class
consumed shape.

**D4 — Classifier truth.** Recorded `exception` spellings become the classifier's calibration
fixtures; the substring rules are adjusted only as evidence demands, each adjustment carrying
its fixture as the red test. The unreachable-state stubs (`Completed, Rejected`,
`Completed, TimedOut`) are rewritten to the reachable vocabulary with their intent preserved
(rejection/timeout scenarios become `Errored`-with-exception-text realities). The
reachable-vocabulary pin is a small committed record (version → states) the stub-vocabulary
test reads.

**D5 — Version-bump economics.** Re-record procedure documented beside the lab compose; the
0.26 delta (retries, terminal `TimedOut`, `Queued, Locally`, Completed→re-Queued) is recorded
as the known next-bump workload, not handled now.

## Risks / Trade-offs

- **[slskd may not pair with soulfind (undocumented combination)]** → The smoke gate is task
  one; the fallback path is pre-decided and documented, so a failed smoke test degrades scope,
  not the change.
- **[Recorded spellings are still one version's spellings]** → That is the point: pinned
  provenance + the vocabulary record turn "spellings changed" from a silent misclassification
  into a failing re-record.
- **[Lab fixtures differ subtly from live-network fixtures (localhost speeds, no NAT)]** → The
  consumed fields are state/exception/position shapes, not timings; the full-flow scenario
  keeps one live-network-recorded success flow as a cross-check fixture.
- **[Fix rider scope creep]** → The rider is bounded to `transfers.ts` classification and its
  stubs; anything structural it reveals becomes its own proposed change.

## Migration Plan

Test-tier landing; the fix rider (if evidence triggers it) ships in the same PR as `fix:` with
normal versioning. No deploy sequencing constraints with the other drafted changes.

## Open Questions

- Whether the errored-`exception` spelling for peer-offline differs between soulfind-lab and
  live network (the message originates client-side in Soulseek.NET per the research, so
  likely identical) — settled by comparing the one live cross-check fixture at record time.
