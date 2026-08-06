# Can a hostile Plex server claim an arbitrary machine identifier?

**Research date:** 2026-08-05.

**Question.** The login gate admits an account when plex.tv's `/api/v2/resources` listing — fetched
with the logging-in user's own token — contains an entry whose `clientIdentifier` equals the
configured `PLEX_SERVER_MACHINE_ID`. The machine identifier is not a secret (`.env.example`
documents reading it from `:32400/identity`). The `auth-roles` change narrows the predicate to
require that the matching entry also declares `provides: server`, on the reasoning that
device/player identifiers are client-chosen while the server class is not. **Is the server class
actually attested by plex.tv?** Could a hostile Plex Media Server register with an arbitrary
machine identifier and so satisfy the gate? (Timeboxed verification carried by `auth-roles` task
1.3; the fallback recorded in the change's design is pinning the owner by account identity via
configuration.)

**Method.** Web research against plex.tv API documentation aggregators, the PMS claim-flow scripts
distributed with container images, python-plexapi's model of the resources listing, Plex community
forum threads on duplicate machine identifiers, and the December 2025 / January 2026 plex.tv
backend CVEs. Timeboxed; no live probing of plex.tv's registration endpoint was performed (doing so
would mean attempting to register a forged server against a third party's service).

## Verdict

**Treat the server class as forgeable.** No consulted source states that plex.tv enforces
uniqueness or ownership of a server machine identifier at registration, and the documented
registration mechanism is a plain HTTPS POST carrying entirely client-chosen headers. Confidence is
moderate-high on the mechanism and moderate on the specific cross-account duplicate case — nobody
has publicly tested whether plex.tv refuses a claim for an identifier already bound to another
account. For an authentication gate, undocumented-and-untested is the same as unenforced.

**The `provides: server` narrowing is still correct and still worth shipping** — it closes the
known, trivially-exploitable device/player hole and strictly narrows admission — but it is **not
sufficient on its own**, because `X-Plex-Provides: server` is self-asserted by exactly the same
mechanism as `player` or `controller`. The check raises the bar from "any Plex client" to "any
process willing to send one extra header".

## What the mechanism actually is

- The machine identifier is **self-asserted by the server**. PMS generates it locally and stores it
  in `Preferences.xml` as `ProcessedMachineIdentifier`; nothing external assigns it.
- Claiming is `POST https://plex.tv/api/claim/exchange?token=<claim_token>` with
  `X-Plex-Client-Identifier: <machine id>`, `X-Plex-Provides: server`, `X-Plex-Product: Plex Media
  Server` and cosmetic platform headers. The response carries the `authentication-token` stored as
  `PlexOnlineToken`. Container claim scripts reproduce this with `curl`, and at least one accepts a
  `$PLEX_CLIENT_ID` environment override rather than reading the identifier from `Preferences.xml`.
- plex.tv treats the identifier as an **identity key, not an owned namespace**: duplicate ids
  collapse into "the same server" (the standard cloned-VM / restored-`Preferences.xml` forum
  failure mode) rather than being rejected, and the documented account-transfer procedure re-claims
  the *same* identifier under a *different* account after the local `PlexOnlineToken` is cleared.
  The "already claimed" guard users hit is enforced locally by PMS, not by plex.tv refusing the
  identifier — and a hostile implementation simply does not implement that guard.
- Corroborating weakness: the recent plex.tv backend CVEs (CVE-2025-69414 / -69416 / -69417) are
  authorization failures in precisely this area — the backend failing to distinguish server tokens
  from non-server device tokens on `clients.plex.tv/devices.xml` and `shared_servers`. That is not
  a backend to credit with a silent, undocumented machine-id ownership check.

## The threat model is not the victim's listing

Two listings must not be confused:

- **The owner's listing** — an entry appears only for a resource the account owns, shares a Plex
  Home with, or has *accepted* a share for. An attacker cannot inject into the real owner's
  listing. True, and irrelevant to this gate.
- **The attacker's own listing** — this is the one the gate reads. The gate queries `/resources`
  *with the logging-in user's token*. An attacker registers a forged "server" under their own Plex
  account, then signs in with their own account: their listing carries
  `clientIdentifier == <our machine id>`, `provides` containing `server`, and `owned: true`. The
  gate passes. No share, no victim interaction, nothing but knowledge of the (non-secret) machine
  identifier.

The only residual uncertainty is whether plex.tv rejects the claim because the identifier is
currently bound to another account. If it does not, the gate is bypassable. If it does, the
attacker may instead be able to disturb the real server's registration — a different hazard, not a
reassurance.

## Consequence: the account-identity fallback trigger is LIVE

The `auth-roles` design recorded the fallback as conditional ("if server-side forgery proves
possible"). It has proved possible-to-likely, so the trigger is live and the fallback should be a
prompt follow-up change. Its shape, using fields plex.tv itself stamps rather than fields the
resource self-asserts:

- Shared users: require `ownerId == PLEX_OWNER_ACCOUNT_ID` on the matched resource entry. plex.tv
  populates `ownerId` from the real owning account, so an attacker's self-owned forgery cannot
  produce it.
- The owner's own login: `owned === true` **and** the account id from `/api/v2/user` equals
  `PLEX_OWNER_ACCOUNT_ID` (an owner-owned entry carries no `ownerId`).
- Keep `clientIdentifier` and `provides: server` as narrowing conditions; they stop being
  load-bearing for authentication.

Cost is one configuration value and one field comparison. It converts the gate from trusting a
self-asserted identifier to trusting plex.tv's authenticated account-ownership relation — the only
thing in the listing plex.tv genuinely vouches for. It is out of scope for `auth-roles` (which
declared "no new required configuration" and whose predicate fix narrows admission either way), and
it is exactly the class of swap the `authorize` seam and the single-derivation-point membership
check were shaped to absorb.

## Sources

- <https://github.com/spritsail/plex-media-server/blob/master/claim-server.sh> — the claim exchange
  as raw headers; identifier taken from `$PLEX_CLIENT_ID` or `Preferences.xml`, `X-Plex-Provides:
  server` hand-set.
- <https://www.plexopedia.com/plex-media-server/api-plextv/claim-token/> — claim-token →
  `plex.tv/api/claim/exchange` → `PlexOnlineToken`; no uniqueness or ownership validation described.
- <https://github.com/Arcanemagus/plex-api/wiki/Plex.tv> — `X-Plex-Client-Identifier` documented as
  "UUID, serial number, or other number unique per device"; `X-Plex-Provides` = "player,
  controller, server" — all client-supplied, same trust class.
- <https://python-plexapi.readthedocs.io/en/latest/modules/myplex.html> — `MyPlexResource` fields:
  `owned`, `ownerId` ("ID of the user that owns this resource (shared resources only)"),
  `sourceTitle`, `provides`, `accessToken` — the fields the fallback would consume.
- <https://forums.plex.tv/t/issues-accessing-duplicated-plex-servers/585082> and
  <https://forums.plex.tv/t/duplicate-servers-after-re-install/900626> — duplicate machine ids are
  collapsed as "the same server", not rejected.
- <https://www.sentinelone.com/vulnerability-database/cve-2025-69417/> and
  <https://www.sentinelone.com/vulnerability-database/cve-2025-69416/> — plex.tv backend fails to
  separate server from non-server device token authority; evidence against assuming a hidden
  server-identity check.
