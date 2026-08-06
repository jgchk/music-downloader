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

- Narrow the review sweep's predicate finding by requiring the matched resource to declare a
  server (see Risks — closing it entirely needs the account-identity pin).
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

**D1 — The predicate: identifier match AND provides-server.** (See Risks: the server class is
also self-assertable, so this narrows admission rather than authenticating the server.) Membership requires one
`/resources` entry with `clientIdentifier === PLEX_SERVER_MACHINE_ID` whose `provides`
(comma-separated list per plex.tv) contains `server`. Alternatives: *owned-only* (locks out
every legitimate share-guest); *account allowlist* (rebuilds the user database that
share-is-approval exists to avoid). Device/player entries — the client-forgeable class — never
carry `provides: "server"`, which is the finding's attack shape.

**D2 — Role is the admitting entry's `owned` flag, read once.** `owned === true` ⇒ `owner`, else
(false or absent) ⇒ `guest`. Only entries that pass the WHOLE predicate are candidates, and the
role is `owner` iff ANY of them is owned — so neither an entry that failed the predicate nor
plex.tv's listing order can decide privilege. Single derivation point is the adapter's membership check, which
now returns `{identity, role}`; the callback threads it into the minted session. Schema reads
both new fields tolerantly (`owned: z.boolean().optional()`, `provides: z.string().optional()`)
— absent fields degrade toward denial/least-privilege, never toward grant.

**D3 — Additive session claim, tolerant decode, no forced re-login.** `role` joins the signed
claims as an optional field defaulting to `guest` on decode. Alternative considered: rotate the
codec (or secret) to force universal re-login. Rejected: the predicate fix does not invalidate
any legitimately issued session, and the conservative default means no privilege appears by
omission; the owner logs in again once to pick up `owner`. The signing input grows the role — as
`SessionSubject extends SessionIdentity`, so identity stays identity and the port keeps `identity`
and `role` as separate facts — which also keeps the e2e harness's minted cookies honest.

**D4 — The seam: `authorize(claims, action)` in a pure `lib/server/authz.ts`.** Call sites name
an action from the closed union `PrivilegedAction`; the decision point consults a
`Record<PrivilegedAction, Role>` table and returns a value — `{kind: 'permitted'} | {kind:
'refused'}` — never throws. Like `session.ts`, this is deliberately NOT a port: there is no
external actor behind a pure decision, so tests exercise the real path with minted claims. The
union ships with its first member, `'system:redrive'`, declared now and mapped to `owner` —
reserved by the stall-surfacing grill, referenced by no route until that change — because a
closed union with zero members is untestable and the name is already decided. Swapping RBAC for
ABAC/PBAC later changes only this module's internals; the signature (and an additive optional
`resource` parameter, if ever needed) absorbs the rest. Note that the role LADDER (the rank
comparison making the table a minimum rather than an exact match), not just the table, is what a
non-hierarchical model replaces.

**D5 — Contract truth.** `provides` and `owned` become consumed fields: the plextv recorder's
projection widens to capture them, the owner-account fixture is re-recorded to witness both, and
the replay test drives the real predicate to a grant with `role: owner`. (Shipped state: the
re-record needs an interactive plex.tv approval on the owner's account, so it is a handoff — until
it lands the grant assertion is SKIPPED, visibly, rather than reported green; see tasks 4.2.) The guest-side variant
(`owned` false/absent) has no recordable source — a guest token is not ours to record — so it is
covered at the unit tier against the tolerant schema, with the fixture-absence documented in the
contract test (the same honesty rule the recorder already follows for the events/transfers
coupling).

## Risks / Trade-offs

- **[plex.tv could permit a hostile PMS to register an arbitrary machine identifier]** →
  **VERIFIED 2026-08-05 (task 1.3): it can — the fallback trigger is LIVE.** See
  [`docs/research/plex-machine-identifier-trust.md`](../../../docs/research/plex-machine-identifier-trust.md).
  A server's machine identifier is self-asserted (`Preferences.xml`
  `ProcessedMachineIdentifier`), the claim flow is a plain POST carrying client-chosen
  `X-Plex-Client-Identifier` / `X-Plex-Provides: server` headers, and no source documents plex.tv
  enforcing uniqueness or ownership of a server identifier. The threat model is also narrower than
  assumed in the wrong direction: the attacker does not need to reach the *owner's* listing at all
  — the gate reads the *logging-in account's* listing, so an attacker registering a forged "server"
  under their own account sees it in their own `/resources` with `owned: true`.
  **Consequence for this change:** the predicate fix still ships and still strictly narrows
  admission (the trivially-exploitable device/player hole closes, and `provides: server` is a
  precondition the fallback keeps), but it is NOT sufficient alone. The recorded fallback — pin the
  owner by account identity via configuration (`ownerId === PLEX_OWNER_ACCOUNT_ID` for shared
  users; `owned === true` plus a matching `/user` account id for the owner) — is now a prompt
  follow-up change rather than a conditional one. It stays out of `auth-roles` because it adds
  required configuration (an explicit non-goal here) and because it composes with, rather than
  replaces, the predicate this change fixes. **The escalation direction is the point to remember:**
  a forger owns their forgery, so the residual bypass decodes as `owner`, not `guest` — the one
  path in this change that fails toward MAXIMUM privilege. Nothing is exploitable while no route
  asks the permission question, so the pin is a HARD PREREQUISITE of the first owner-gated surface
  (stall-surfacing), not a soft follow-up. `authz.boundary.test.ts` fails the day `authorize` gains
  a production consumer, so this cannot be armed silently. **The pin alone is not sufficient in
  that change either:** a role is fixed at issue and the pin verifies at login, so an `owner`
  cookie minted before it lands stays valid for up to `SESSION_TTL_MS` (7 days) afterwards — that
  change must also invalidate pre-existing owner sessions (rotate `SESSION_SECRET`, or bump a
  claims version the codec refuses).
- **[A Plex Home / managed user's `owned` flag is unverified]** → plex.tv models `home` separately
  from `owned`, and nothing here establishes what `owned` reports for a Home member on the admin's
  server. If it reports true, every Home member decodes as `owner` — the same
  privilege-appearing direction. Unverifiable without a Home account; added to the post-deploy
  verification (task 5.2). If it proves true, the account-identity pin fixes it too (a Home
  member's account id is not the owner's).
- **[plex.tv changing the TYPE of `provides`/`owned`]** → Unlike absence, a type change fails the
  whole listing parse: every login errors as `plex-unavailable` (a hard, loud, fail-closed outage
  including for the owner) rather than coercing toward a grant. Deliberate — the denial reason
  `matched-no-capabilities` exists to make the softer drift shape diagnosable in the logs.
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
