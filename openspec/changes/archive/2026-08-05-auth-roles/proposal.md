# Proposal: auth-roles

## Why

The whole-project review sweep (2026-08-05) found the login gate's membership predicate
under-constrained: it grants a session to any Plex account whose `/resources` listing contains
an entry with the configured machine identifier — but that listing includes every device an
account can see, and device entries carry client-chosen identifiers, while
`PLEX_SERVER_MACHINE_ID` is not a secret (`.env.example` documents fetching it from
`:32400/identity`). The one predicate protecting the entire UI must require that the matching
resource actually *is* the server. At the same time, the upcoming stall-surfacing change (grilled
2026-08-05) needs the system's first authorization distinction — an owner-gated admin surface
with a redrive verb — and the fix and the distinction want the same new fact from the same
plex.tv response: the resource's `owned` flag. This change ships both together: the tightened
predicate, and the authorization *seam* — shaped so RBAC today can become ABAC/PBAC later with
zero call-site churn — with no consumer beyond the fix itself.

## What Changes

- **The membership predicate requires a server resource.** Admission is decided only by a
  `/resources` entry whose identifier matches `PLEX_SERVER_MACHINE_ID` **and** whose `provides`
  names a server — device/player entries with coincidental or forged client identifiers no
  longer satisfy the gate. plex.tv's `owned` flag on that entry is read at the same moment.
- **Sessions carry a role.** The versioned session gains `role: 'owner' | 'guest'`, derived in
  exactly one place — the login callback — from the matched server resource's `owned` flag.
  Pre-existing cookies without the field degrade tolerantly to `guest` for their remaining
  lifetime (conservative: no privilege appears by decoding absence). No route behaves
  differently by role in this change.
- **The `authorize` seam.** A single decision point answers the permission question
  `authorize(session, action)` where actions are a closed union (compile-checked, same
  discipline as the web verb inventory). Call sites name *actions, never roles*; the decision
  internals are a table-driven role check today and swappable (ABAC/PBAC) behind the unchanged
  signature later — the XACML PEP/PDP split. The action union ships with `system:redrive` declared
  as its reserved first member — referenced by no route until stall-surfacing consumes it.
- **Contract truth for the new fields.** `provides` and `owned` become consumed fields of the
  plex.tv resources contract: schema, recorded fixture witness, and recorder projection all
  extend together. The guest-side variant (`owned` absent/false) is documented as a tolerant
  default where a genuine guest recording is unobtainable.
- **Non-goals:** no admin surface, no role-gated route, no policy engine, no user store, no
  per-resource ownership — the seam's first consumer is the separate stall-surfacing change.
  RBAC→ABAC promotion trigger: a second privileged surface or a per-resource ownership
  requirement.

## Capabilities

### New Capabilities

- `web-authorization`: the permission-question seam — closed action union, single decision
  point, role model (`owner`/`guest`) derived solely from Plex server ownership at login, and
  the guarantee that privileged actions are decided only through the seam.

### Modified Capabilities

- `web-access-control`: the membership requirement tightens (matching resource must provide a
  server); the session contract gains the role field with tolerant degradation for pre-existing
  cookies; the "no further per-user distinctions" clause is withdrawn in favor of the role
  model (base interface access is unchanged for every valid session).

## Impact

- **Code:** `packages/web` only — the plex.tv adapter + zod schemas (`provides`, `owned`), the
  login callback (role derivation), the session codec (additive field + tolerant read), and a
  new `lib/server/authz` module (action union, decision table, `authorize`). Neither bounded
  context changes; no facade contracts change.
- **Contract tier:** `packages/web/test/contract` plextv fixtures re-recorded to witness
  `provides`/`owned` on the owner's account; recorder projection extended to the newly consumed
  fields (secret-scrub discipline unchanged).
- **Security posture:** strictly NARROWS the review sweep's Plex-predicate finding; it does not
  close it. The travelling verification item (task 1.3) came back positive: plex.tv does not
  demonstrably enforce ownership or uniqueness of a server machine identifier, and `provides` is
  self-asserted by the same client-chosen-header mechanism as a device's identifier
  (`docs/research/plex-machine-identifier-trust.md`). The trivially-exploitable device/player hole
  closes; the residual — a forged *server* registration under the attacker's own account, which
  also decodes as `owner` — is closed only by pinning the owner by account identity via
  configuration. That fallback is now a REQUIRED PREREQUISITE of the first owner-gated surface,
  not an optional follow-up (see design.md Risks; enforced by a tripwire test that fails the day
  `authorize` gains a production consumer).
- **Operations:** existing sessions keep working as `guest`; the owner re-logs-in once to pick
  up the role. No new required configuration.
