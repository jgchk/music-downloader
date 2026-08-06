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

## Task 1.1 — smoke-gate outcome: **PASSED** (2026-08-06)

The unwitnessed pairing works. `slskd/slskd:0.22.5`
(`sha256:f5150c39…81a96a` — the same digest `slskd-spec/provenance.json` pins) logs into
`ghcr.io/soulfind-dev/soulfind` (`sha256:3de2e82f…948d23`, build "Soulfind Aug-6-2026") with
invented credentials via auto-registration, both sides reach `Connected, LoggedIn`, a search
fans out through soulfind and returns the peer's shares, and a real transfer completes
(`Completed, Succeeded`, 8962/8962 bytes). The lab path is therefore taken in full; the
documented live-capture fallback is **not** used.

All six scenarios were then proven to reproduce on demand before the recorder was written:

| Scenario | Enqueue | Terminal `state` | `exception` |
| --- | --- | --- | --- |
| success | 201 | `Completed, Succeeded` | (none) |
| queued (slot-starved) | 201 | `Queued, Remotely` | (none) — `placeInQueue` `null` → `1` only after the position call |
| cancelled (`?remove=false`) | 204 on DELETE | `Completed, Cancelled` | `The operation was canceled.` |
| rejection (unshared file) | 500 `One or more errors occurred. (Transfer rejected: File not shared.)` | `Completed, Errored` | `Transfer rejected: File not shared.` |
| peer offline | 500 `User labpeer appears to be offline` | (no transfer row) | — |
| errored (peer killed mid-flight) | — | `Completed, Errored` | `Transfer failed: Read error: Remote connection closed` |

Two consequences the evidence forces, both settled here:

- **D2 resolved — the adapter does not consume the position endpoint.** It reads `placeInQueue`
  off the poll, and the lab confirms a poll alone always carries `null` until
  `GET …/{id}/position` is called. So the position operation is *recorder* surface, not adapter
  surface, and stays out of the manifest (which exists to declare what adapters consume). The
  standing consequence — production queue positions are always absent unless another slskd client
  asks — is real but is new behavior to add, not a contract untruth to fix; it is recorded as a
  follow-up, not done here.
- **D4 resolved — the classifier is wrong, and wrong as a class.** `enqueueRejectionReason` has no
  `reject` rule, so the recorded rejection body maps to `TransferError` while the *same* rejection
  seen on the transfer row maps to `FileUnavailable`. The two classifiers had drifted into separate
  vocabularies; the fix is one shared calibration table, so a peer failure tells one story
  regardless of which path observed it. Two riders the recordings forced on top: the table matches
  whole recorded *phrases* rather than bare words (every slskd failure text embeds the peer's own
  chosen username, so `reject`/`connect` would let a peer named `rejectbot` pick its own verdict),
  and `Cancelled` is read from the transfer *state* rather than from any text at all — it is the
  one reason that asserts something **we** did, and no peer may author it.

## Follow-up the evidence forces, deliberately NOT done here

**Every enqueue failure is an HTTP 500, so the candidate-failure branch is largely unreachable.**
The lab witnessed slskd 0.22.5 answering 500 for an offline peer, an unshared file, and an
unresponsive peer alike (`fixtures/slskd/{offline,unreachable,rejection,stalled}/transfers-enqueue.json`).
`SlskdDownload.start` routes `>= 500` to a retryable `InfraError`, so those never reach
`enqueueRejectionReason` at all: a dead peer parks the acquisition for the whole retry budget and
then degrades to `Stalled`, instead of failing the candidate and advancing the ladder at once. That
is the same shape as the 2026-07-22 production incident, now re-proven by fixtures.

It is not fixed here because the fix is a *design* question, not a spelling: separating "slskd is
unwell" from "slskd says this peer is bad" means reading the response body on a 5xx, which promotes
substring classification into the retry/advance decision — where a vocabulary miss would newly mean
abandoning a candidate against a healthy slskd. That deserves its own proposal, and it wants the
calibrated, witnessed table this change lands as its prerequisite.

What this change does instead: pins the evidence (`slskd.contract.test.ts` — "answers every enqueue
failure with a 500, whatever the cause"), corrects the now-false comments at the branch itself, and
logs the classification the body *would* have produced, so an operator facing a parked acquisition
can tell an overloaded slskd from a dead peer.

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
