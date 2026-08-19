# Design: drift-signal-fidelity

## Context

Tier 2 of the contract tests (`.github/workflows/contract-drift.yml`) answers one question:
_has an external provider changed a shape we consume?_ It answers it by going to the live
world, which means every answer it gives is entangled with a second question it never
separates out — _could we reach the live world at all?_ Every alert it has ever produced was
an answer to the second question mistaken for an answer to the first.

## Decisions

### D1 — Three outcomes, carried by exit code

A drift check exits `0` (conforms), `1` (drift), or `2` (unavailable). The workflow reads the
code, not a boolean `outcome`, and routes accordingly.

Exit code rather than a JSON artifact because the checks are already invoked as plain
processes whose stdout is teed into the issue body, and because a code survives a crash
faithfully: an unhandled fault still exits `1`, i.e. lands in the loud branch. That is the
right default — #110 was a broken checker, and filing an issue for it was correct behaviour.
Only a *deliberate* `2` is quiet.

Rejected: a fourth "degraded" state for partially-unavailable runs. A run where five requests
conform and two are unreachable has still verified five contracts and failed to verify two;
that is `unavailable` with the detail in the log, not a new state. Aggregation is
worst-first — any `drift` wins, then any `unavailable`, else `conforms`.

### D2 — `unavailable` is green, and the masking risk is accepted deliberately

The alternative (fail the run, but file no issue) keeps a loud signal at the cost of a red
week every time MusicBrainz throttles a shared runner IP, which is the noise this change
exists to remove. The accepted risk is that a *permanently* unreachable provider only ever
shows as a weekly warning annotation rather than a page.

Two things bound that risk rather than merely hoping about it:

1. `404`/`410` is drift, not unavailability (D3). A provider that removes an endpoint — the
   realistic permanent failure — stays loud.
2. The warning is written to the job summary as well as an annotation, so the Actions run list
   carries a visible ⚠ for the week rather than a silent green.

### D3 — Transient by status, and "gone" is drift

Retryable-and-then-unavailable: `408`, `425`, `429`, `500`, `502`, `503`, `504`, and any
transport-level fault (DNS, TLS, connection reset, timeout).

Drift: every other non-2xx. The important member is `404`/`410` on a request whose fixture
recorded a `200` — the operation the adapter depends on no longer exists. Treating that as
"unavailable" would be exactly the mask D2 worries about.

`401`/`403` also land in drift. Neither drift script authenticates, so an auth challenge on a
previously-anonymous endpoint is a real change in the consumed surface, not an outage.

### D4 — The probe is shared tooling, not per-script cleverness

`scripts/drift/probe.ts` — the workspace's existing tooling tier (`scripts/`, its own
tsconfig, its own vitest project, already wired into `pnpm check` as the `tooling` lane).
Both drift scripts import it.

It is placed there rather than in either package's `test/contract/support/` because the two
consumers live in **different packages**, and a cross-package reach from `packages/web` into
`packages/downloader`'s test tree would smuggle in exactly the module coupling
`module-architecture` forbids — through a path lint does not currently watch, which is worse
than one it does.

The probe takes its clock as a parameter (`sleep`) so its retry schedule is asserted by tests
that do not actually wait.

### D5 — `Retry-After` is honoured, with a ceiling

MusicBrainz and plex.tv may both answer a throttle with `Retry-After`. Both spellings are
parsed: delta-seconds (`Retry-After: 120`) and HTTP-date. An unparseable or absent header
falls back to exponential backoff.

A provider is entitled to ask for an hour; a weekly job is not entitled to sit for one. The
honoured delay is clamped to a ceiling, above which the run gives up and reports
`unavailable` — which is the honest report anyway: we were told to come back later than this
run is willing to wait.

### D6 — Requests are still paced, and identify honestly

The ≤1 req/s MusicBrainz pacing stays. The User-Agent stops pointing at a repository that does
not exist. MusicBrainz's own guidance is that an anonymous client must identify itself with a
contactable URL; a dead URL is not politeness theatre, it is a reason to be throttled, and the
job that suffers from being throttled is this one.

## Risks / trade-offs

- **A green run now means "no drift *found*", not "no drift".** Mitigated by D2's two bounds
  and by stating it in the workflow's own comment header, so the next reader of a green
  Actions history is not misled.
- **More retries means a longer job.** A fully-throttled MusicBrainz run costs minutes, once a
  week, on a job that gates nothing.
