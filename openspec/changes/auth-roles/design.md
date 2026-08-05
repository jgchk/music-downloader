# Design — auth-roles

## Context

See proposal.md — Why. Current state: `plexResourcesSchema` parses only `clientIdentifier`
(schemas.ts), the membership predicate is `resources.some((r) => r.clientIdentifier ===
machineId)` (adapter.ts), and the session codec (session.ts) is a pure HMAC-signed claims module
— `{plexAccountId, username, expiresAt}`, zod-parsed on verify, deliberately not a port, with
the e2e harness importing `signSession` as the single implementation. The stall-surfacing change
(grilled 2026-08-05) will consume the seam this change introduces; its research doc
(`docs/research/dead-letter-redrive-semantics.md`) does not constrain this change.

## Goals / Non-Goals

**Goals:**

- Close the review sweep's predicate finding by requiring the matched resource to be a server.
- Establish the permission-question seam (PEP/PDP split) so authorization models are swappable
  behind one signature.
- Keep the entire change inside `packages/web`; zero facade or bounded-context impact.

**Non-Goals:**

- No admin surface, no role-gated route, and no HTTP rendering convention for refusals — the
  first consumer (stall-surfacing) fixes how a refusal renders; shipping a convention with zero
  consumers would be speculative.
- No session-schema versioning machinery beyond the additive optional claim.
- No policy engine, no user store, no per-resource ownership (promotion trigger recorded in the
  proposal).

## Decisions

**D1 — The predicate: identifier match AND provides-server.** Membership requires one
`/resources` entry with `clientIdentifier === PLEX_SERVER_MACHINE_ID` whose `provides`
(comma-separated list per plex.tv) contains `server`. Alternatives: *owned-only* (locks out
every legitimate share-guest); *account allowlist* (rebuilds the user database that
share-is-approval exists to avoid). Device/player entries — the client-forgeable class — never
carry `provides: "server"`, which is the finding's attack shape.

**D2 — Role is the matched entry's `owned` flag, read once.** `owned === true` ⇒ `owner`, else
(false or absent) ⇒ `guest`. Single derivation point is the adapter's membership check, which
now returns `{identity, role}`; the callback threads it into the minted session. Schema reads
both new fields tolerantly (`owned: z.boolean().optional()`, `provides: z.string().optional()`)
— absent fields degrade toward denial/least-privilege, never toward grant.

**D3 — Additive session claim, tolerant decode, no forced re-login.** `role` joins the signed
claims as an optional field defaulting to `guest` on decode. Alternative considered: rotate the
codec (or secret) to force universal re-login. Rejected: the predicate fix does not invalidate
any legitimately issued session, and the conservative default means no privilege appears by
omission; the owner logs in again once to pick up `owner`. `SessionIdentity` grows the role so
the e2e harness's minted cookies stay honest.

**D4 — The seam: `authorize(claims, action)` in a pure `lib/server/authz.ts`.** Call sites name
an action from the closed union `PrivilegedAction`; the decision point consults a
`Record<PrivilegedAction, Role>` table and returns a value — `{kind: 'permitted'} | {kind:
'refused'}` — never throws. Like `session.ts`, this is deliberately NOT a port: there is no
external actor behind a pure decision, so tests exercise the real path with minted claims. The
union ships with its first member, `'system:redrive'`, declared now and mapped to `owner` —
reserved by the stall-surfacing grill, referenced by no route until that change — because a
closed union with zero members is untestable and the name is already decided. Swapping RBAC for
ABAC/PBAC later changes only this module's internals; the signature (and an additive optional
`resource` parameter, if ever needed) absorbs the rest.

**D5 — Contract truth.** `provides` and `owned` become consumed fields: the plextv recorder's
projection widens to capture them, the owner-account fixture is re-recorded to witness both, and
the replay test drives the real predicate to a grant with `role: owner`. The guest-side variant
(`owned` false/absent) has no recordable source — a guest token is not ours to record — so it is
covered at the unit tier against the tolerant schema, with the fixture-absence documented in the
contract test (the same honesty rule the recorder already follows for the events/transfers
coupling).

## Risks / Trade-offs

- **[plex.tv could permit a hostile PMS to register an arbitrary machine identifier]** → The
  predicate fix strictly narrows admission regardless (the known client-forgeable device hole
  closes). Implementation carries a timeboxed verification task against plex.tv docs/community
  sources; if server-side forgery proves possible, the recorded fallback is pinning the owner by
  account identity via configuration — a small follow-up change, and the reason `authorize`'s
  internals are swappable.
- **[`provides` formatting drift (casing, spacing, multi-value)]** → Parse as a trimmed,
  case-insensitive comma-list; the re-recorded fixture pins the real spelling.
- **[Owner lockout if plex.tv reports `owned` unexpectedly]** → Tolerant default is `guest`, so
  the failure mode is missing privilege, not lost access; live verification after deploy is the
  owner's login (same procedure as the v3.13.0 gate ship).
- **[Guest regression if share-guests' entries don't carry `provides: "server"`]** → Same
  degrade direction (denied login, fail-closed); verified live with a share-guest account before
  the change is declared done — noted in tasks as the one manual step.

## Migration Plan

Deploy normally. Existing sessions continue as `guest` for their remaining lifetime; the owner
re-logs-in once. Rollback is the previous image — the old codec ignores the unknown `role`
claim, so cookies minted by this version stay valid on rollback.
