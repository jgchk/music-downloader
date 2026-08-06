# Contract tests — external dependencies (slskd, MusicBrainz)

Two tiers that keep our code honest about what slskd and MusicBrainz actually send. Neither provider
knows this project exists, so Pact-style (provider-verified) contracts are impossible; this is the
[integration contract test](https://martinfowler.com/bliki/IntegrationContractTest.html) pattern
instead — _we_ verify the contract against the live services on a schedule, and the same contract
artifact validates the fast, offline tests.

The single source of truth is the set of **zod schemas** in `src/adapters/{slskd,musicbrainz}/schemas.ts`.
They model only the fields the adapters consume, tolerate unknown fields (additive provider change is
not drift), and are enforced at runtime — a contract-violating response becomes a modeled boundary
`InfraError`, never malformed data flowing inward.

## Tier 1 — every commit (`pnpm test:contract`, part of `pnpm check` and CI)

Isolated, wire-level, no containers, no network. Each test starts a throwaway `node:http` server
(`support/server.ts`) that replays recorded fixtures, points the real adapter with its real `fetch`
client at it, and asserts both the responses it consumes and the requests it sends.

- `musicbrainz.contract.test.ts`, `slskd.contract.test.ts` — the adapter contract tests.
- `fixtures.contract.test.ts` — every recorded fixture **and** every E2E WireMock stub `jsonBody`
  must validate against the contract schemas, so neither can silently drift.
- `slskd-spec.contract.test.ts` — the consumed-surface manifest holds against the pinned slskd spec.

- `slskd-vocabulary.contract.test.ts` — the unit tier's transfer-state stubs name only states the
  pinned slskd can actually serve, and every terminal state is witnessed by a recording.

Fixtures live in `fixtures/{musicbrainz,slskd}/**/*.json` as `{ provenance, request, response }`
envelopes — verbatim captures from the live services, sanitized, never hand-authored
(prettier-ignored). slskd fixtures are grouped by the **scenario** that recorded them, because most
of them are the same endpoint seen in a different state:

| Scenario      | What it witnesses                                                                           |
| ------------- | ------------------------------------------------------------------------------------------- |
| `full-flow`   | the happy path as one coupled session: search → release → enqueue → poll → events → options |
| `queued`      | a genuinely queued transfer _with_ its `placeInQueue`                                       |
| `cancelled`   | `Completed, Cancelled` and the exception a cancellation carries                             |
| `rejection`   | a peer refusing a file — as the 500 body **and** as the `Completed, Errored` row            |
| `errored`     | a peer that died mid-transfer                                                               |
| `offline`     | an enqueue to a peer the server reports as offline                                          |
| `unreachable` | an enqueue to a peer whose cached address no longer answers (recorded by `offline`)         |
| `stalled`     | an enqueue to a peer that never answered                                                    |
| `absent`      | the 404 that means "this user has no transfers" — state, not a fault                        |
| `live`        | the live-network cross-check: real heterogeneous peers the lab cannot fake                  |

## Tier 2 — weekly drift detection (`.github/workflows/contract-drift.yml`)

Runs on a schedule + `workflow_dispatch`; never gates a commit. On drift it opens or refreshes a
single `contract-drift` GitHub issue.

- `drift/musicbrainz.ts` — replays the recorded request set against live `musicbrainz.org` and
  validates responses against the shared schemas (≤1 req/s, one retry).
- `drift/slskd.ts` — checks the consumed-surface manifest (`support/slskd-manifest.ts`) against a
  live `slskd/slskd:latest` OpenAPI document. slskd leaves most 2xx responses unschematized, so the
  spec check covers operations, path parameters, and request fields; response shape is pinned by the
  fixtures + runtime schemas.

## Re-recording and refreshing

```bash
# MusicBrainz fixtures (anonymous, public):
pnpm tsx test/contract/record/musicbrainz.ts

# slskd fixtures — the LAB (all transfer states; no live network, no real peers inconvenienced).
# Every command below runs from packages/downloader:
LAB=test/contract/lab
$LAB/seed-corpus.sh                                    # synthesize the shared corpus (ffmpeg)
docker compose -f $LAB/compose.yaml up -d              # soulfind + a slot-starved peer + the sut
pnpm tsx test/contract/record/slskd-lab.ts             # every scenario
pnpm tsx test/contract/record/slskd-lab.ts queued      # …or just the ones you need
docker compose -f $LAB/compose.yaml down
#   → each scenario resets the lab after itself, so scenarios are independent and re-recordable one
#     at a time. `full-flow` is the deliberate exception: its fixtures are coupled by transfer id
#     (the events log has to contain the completion of the transfer the poll captured), so it
#     records them as one session. That coupling used to be a comment warning you the set could not
#     be regenerated at all.

# slskd fixtures — the LIVE cross-check (heterogeneous real peers the lab cannot fake):
SLSKD_BASE_URL=http://host:5030 SLSKD_API_KEY=… pnpm tsx test/contract/record/slskd.ts
#   → writes into fixtures/slskd/live/. Shares its whole scrub with the lab recorder: usernames →
#     peerN, share-token prefixes → @@share\, and usernames/IP endpoints rewritten inside free-text
#     exception messages too. Review the printed summary before committing.

# Pinned slskd OpenAPI snapshot (refresh when the live instance is upgraded):
docker run -d --name slskd-spec -e SLSKD_SWAGGER=true -p 5030:5030 slskd/slskd:<version>
curl -s localhost:5030/swagger/v0/swagger.json -o test/contract/slskd-spec/swagger-<version>.json
#   then update test/contract/slskd-spec/provenance.json (version, capturedAt, imageDigest).
```

When a drift issue fires: if a consumed field or operation genuinely changed, update the schema,
re-record the affected fixtures, and (for slskd) refresh the pinned snapshot and manifest. If only
values or unconsumed surface moved, no action is needed.

## Bumping the pinned slskd version

A fixture only speaks for the version that produced it, and the transfer vocabulary is moving —
0.26 makes `TimedOut` terminal, starts downloads as `Queued, Locally`, and lets a failed transfer
return to queued, which the adapter's "has the Completed flag ⇒ terminal" reading has never seen.
So a bump is a re-record, not an edit:

1. Point `lab/compose.yaml` at the new image (both slskd services), update `PINNED_SLSKD_VERSION`
   in `record/slskd-support.ts` — the recorder refuses to record against a version it does not
   match — and refresh the OpenAPI snapshot plus `slskd-spec/provenance.json`.
2. Re-run **every** lab scenario — never a subset, and never `events.json` alone.
3. Rewrite `slskd-spec/transfer-vocabulary.json` from the new version's source. The vocabulary test
   fails until each terminal state it lists is witnessed by a fresh recording, which is the point:
   the failing test is the reminder to record, not something to satisfy by editing the list.
