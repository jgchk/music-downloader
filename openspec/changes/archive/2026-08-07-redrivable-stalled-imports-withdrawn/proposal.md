# Proposal: redrivable-stalled-imports

> **WITHDRAWN 2026-08-07 — never implemented. Superseded by `stalled-work-recovery`.**
>
> This proposal was drafted 2026-08-02, before the 2026-08-05 grilling session and the
> `dead-letter-redrive-semantics` research that `stalled-work-recovery` is built on. That later
> change answers the same need — the operator affordance this proposal asks for — but decides two
> of its central questions the other way:
>
> | This proposal | `stalled-work-recovery` (the decision that stands) |
> | --- | --- |
> | A redrive is a **domain fact**: new `RetryApply` command → `ApplyRetryRequested` event | A redrive is an **infrastructure operation**: no command, no event, no domain/event-schema change in either module |
> | Stalled imports **join** the attention queue with an ask-oriented chip | Stalled items are **excluded** from the queue — it is for human decisions, and a stall offers the user no verb |
>
> The contradiction is settled by shipped code, not just by design docs: `stalled-work-recovery`'s
> `redriveStalled(streamId)` landed in both reactors as an infrastructure operation that takes the
> dispatch mutex, clears dead letters through the existing seam, and re-dispatches from folded
> state — with no new command and no new event.
>
> Kept in the archive for provenance: the 2026-08-02 incident analysis in the "Why" section below
> is still the accurate account of what went wrong, and it is the motivation `stalled-work-recovery`
> inherited.

## Why

The 2026-08-02 incident (chromaprint abort → dead-lettered apply) proved that when an import
stalls, the system knows — the reactor dead-letters the effect and the status read model exposes
`stalled` — but the user can't see it and can't act on it. The acquisition page showed
"Adding to the library…" forever, the attention queue showed nothing, and recovery took manual
SQLite surgery on the production store plus a container restart. A stalled import is a
human-decision pause; the web-ui spec already demands every such pause surface in the attention
queue, and an operator affordance must exist so recovery is a click, not database surgery.

## What Changes

- **A redrive is a domain fact.** New importer command `RetryApply` → event `ApplyRetryRequested`,
  legal only while the import is in its `applying` phase. The reactor reacts to it by re-deriving
  the same Apply effect it derives today from the applying state — which, by the existing
  durability design, automatically grants a fresh retry budget (budgets key on the new event's
  position) and clears the old dead letters (`clearStalled` fires on any non-failing event of the
  stream). Zero changes to the reactor's durability machinery.
- **The facade gains an additive `retryImport` command**, permitted only while the import is
  actually stalled (the application layer consults the stalled exposure; a non-stalled applying
  import gets a modeled refusal, so the affordance can't double-dispatch a live apply).
- **The import history additively gains an `apply-retried` kind** so the timeline narrates the
  retry in the register instead of falling to the tolerant unknown-kind line.
- **The web renders the decided `stalled` flag** (v3.12.0 doctrine — rendered, never re-derived):
  the acquisition detail presents the stall as an attention state with a retry affordance in the
  affordance register, and stalled imports join the attention queue with an ask-oriented chip.
- **Non-goals:** no downloader changes; no reactor/durability changes; no automatic re-drive
  policy (retry stays a human decision); no import detail page (the acquisition detail remains
  the surface); no change to liveness pacing.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `import-management`: new requirement — a stalled import is redrivable through a domain command
  that grants a fresh budget and clears its dead letters; the facade exposes it as an additive
  command and narrates it as an additive history kind.
- `web-ui`: the acquisition detail SHALL present a stalled import as an attention state with a
  register-compliant retry affordance; the attention queue SHALL list stalled imports.

## Blocking prerequisite (from `auth-roles`, 2026-08-05)

If this change gates the redrive verb on the `owner` role — the seam `auth-roles` shipped, whose
reserved first action is `system:redrive` — it MUST first close the residual that change recorded,
or it arms a privilege escalation:

- **Pin the owner by account identity.** plex.tv's `owned` flag (and the `provides: server`
  declaration, and the machine identifier) are all SELF-ASSERTED by the resource, so an attacker
  who registers a forged "server" under their own account signs in as `owner`
  (`docs/research/plex-machine-identifier-trust.md`). Require `ownerId === PLEX_OWNER_ACCOUNT_ID`
  for shared users, and `owned === true` plus a matching `/user` account id for the owner.
- **Invalidate pre-existing owner sessions in the same change.** A role is fixed at issue and the
  pin verifies at login, so an `owner` cookie minted before the pin lands stays valid for up to
  `SESSION_TTL_MS` (7 days) afterwards. Rotate `SESSION_SECRET` or bump a claims version the codec
  refuses.
- **Verify the Plex Home/managed-user case.** It is unknown whether plex.tv reports `owned: true`
  for a Home member on the admin's server; if it does, every Home member is an `owner` today. The
  account-identity pin closes this too.

`packages/web/src/lib/server/authz.boundary.test.ts` fails the moment any production file imports
`authorize`, so this cannot be skipped silently — that failing test IS this prerequisite's
reminder. Gating the verb on the *stalled* precondition only (no role check) does not trigger it.

## Impact

- **Code:** `packages/importer` domain (`commands/events/decide/evolve/react`), application
  (retry use-case + stalled gate), facade (additive command + history kind);
  `packages/web` (copy additions, acquisition-detail affordance + route action, attention
  queue membership). No `packages/downloader` changes.
- **Contracts:** additive only — one facade command, one history entry kind. No cross-module
  contract touch; no upcasters (new event type, existing events unchanged).
- **Tests:** full unit ladder in both packages; e2e blast radius expected nil (new testids only)
  but local `pnpm test:e2e` mandatory (user-visible strings in the diff).
