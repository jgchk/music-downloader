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

Fixtures live in `fixtures/{musicbrainz,slskd}/*.json` as `{ provenance, request, response }` envelopes —
verbatim captures from the live services, sanitized, never hand-authored (prettier-ignored).

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

# slskd fixtures (needs the live instance; credentials only via env, never committed):
SLSKD_BASE_URL=http://host:5030 SLSKD_API_KEY=… pnpm tsx test/contract/record/slskd.ts
#   → captures a real search + one real transfer (then abandons it); sanitizes usernames → peerN and
#     share-token prefixes → @@share\. Review the printed summary before committing.

# Pinned slskd OpenAPI snapshot (refresh when the live instance is upgraded):
docker run -d --name slskd-spec -e SLSKD_SWAGGER=true -p 5030:5030 slskd/slskd:<version>
curl -s localhost:5030/swagger/v0/swagger.json -o test/contract/slskd-spec/swagger-<version>.json
#   then update test/contract/slskd-spec/provenance.json (version, capturedAt, imageDigest).
```

When a drift issue fires: if a consumed field or operation genuinely changed, update the schema,
re-record the affected fixtures, and (for slskd) refresh the pinned snapshot and manifest. If only
values or unconsumed surface moved, no action is needed.
