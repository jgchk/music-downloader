# Contract tests — plex.tv (web access control)

The web package's consumer contract with plex.tv, in the downloader tier's shape (see
`packages/downloader/test/contract/README.md` for the doctrine — [integration contract
tests](https://martinfowler.com/bliki/IntegrationContractTest.html), we verify because Plex won't).

The single source of truth is the set of **zod schemas** in `src/lib/server/plex/schemas.ts`: only
the fields the login flow consumes (PIN create/check, account identity, resource machine ids),
tolerant of unknown fields, enforced at runtime by the adapter.

## Tier 1 — every commit (part of `pnpm test:contract`, `pnpm check`, and CI)

- `plextv.contract.test.ts` — the real `PlexTvAccess` adapter over real `fetch` against a local
  server replaying the recorded fixtures; asserts consumed responses and sent requests (paths,
  identity headers, token header placement).
- `fixtures.contract.test.ts` — every fixture validates against the schemas **and provably carries
  no secrets**: the auth token is a pinned placeholder, the account is pseudonymized (`user1`),
  machine ids are `machine-N`. An unscrubbed re-recording fails the commit gate.

## Tier 2 — weekly drift (`.github/workflows/contract-drift.yml`)

`drift/plextv.ts` live-checks ONLY the unauthenticated PIN operations. The token-requiring surface
(`/user`, `/resources`) is deliberately replay-only: live-checking it would need a stored long-lived
Plex credential — the exact thing the access design refuses to hold (design D8). Drift there
surfaces as fail-closed login failures on the live instance instead.

## Re-recording

```bash
pnpm tsx packages/web/test/contract/record/plextv.ts
```

The recorder is **interactive**: it creates two PINs, leaves one unapproved (the pending fixture),
prints a plex.tv link for the other and polls until a human approves it, then captures the
authorized check + account + resources with the resulting token. Everything is projected to
consumed fields and scrubbed **before** being written; the token lives only in the recorder's
memory. Review the printed summary before committing.
