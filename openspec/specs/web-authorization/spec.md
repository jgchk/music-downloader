# web-authorization Specification

## Purpose

Decide whether a signed-in principal may perform a privileged action. One decision point answers the permission question for actions named from a closed set; the role model behind it (owner vs guest, derived solely from Plex server ownership at login) is an implementation the seam hides, so richer models can replace it without any call site changing. Provenance: `auth-roles`.

## Requirements

### Requirement: Privileged actions are decided by a single decision point

Every privileged action the web layer offers SHALL be authorized by asking a single decision point whether the presenting session may perform a named action, drawn from a closed, compile-checked set of action names. Call sites SHALL name only the action — never a role or any other decision input — and SHALL NOT decide privilege by any other means. A refusal SHALL be a modeled outcome that produces no side effects. Routes and actions outside the privileged set are unaffected: every valid session retains the base interface.

#### Scenario: A guest session is refused an owner-gated action

- **WHEN** a session carrying the guest role asks to perform an action the decision point gates to owners
- **THEN** the decision is a modeled refusal, and nothing about the request is executed

#### Scenario: An owner session is permitted

- **WHEN** a session carrying the owner role asks to perform an owner-gated action
- **THEN** the decision permits it

#### Scenario: The decision input is the session and the action name alone

- **WHEN** the same action is asked of the same session twice
- **THEN** the decision is identical — no ambient state, upstream call, or per-request context participates

### Requirement: Roles derive solely from Plex server ownership at login

A session's role SHALL be determined exactly once, at login, from the plex.tv resource entry that satisfied the membership check: `owner` when plex.tv reports the account owns that server, `guest` otherwise. There SHALL be no other source of role — no configuration allowlist, no user database, no mutation after issuance. When plex.tv omits the ownership flag, the role SHALL be `guest`.

Note: plex.tv's ownership flag is self-asserted by the resource, so a forged server registration reports itself as owned. Gating any real action on the owner role therefore requires the account-identity pin to land first; this capability ships the role model with no such action.

#### Scenario: The owning account signs in as owner

- **WHEN** the login membership check matches a server resource plex.tv marks as owned by the authenticating account
- **THEN** the issued session carries the owner role

#### Scenario: A share-guest signs in as guest

- **WHEN** the login membership check matches a server resource plex.tv does not mark as owned
- **THEN** the issued session carries the guest role

#### Scenario: An absent ownership flag is a guest

- **WHEN** the matched server resource carries no ownership flag at all
- **THEN** the issued session carries the guest role

### Requirement: Missing role information degrades to least privilege

A session that carries no role — a validly signed cookie issued before roles existed — SHALL be treated as a guest for its remaining lifetime. Privilege SHALL never appear by omission.

#### Scenario: A pre-role session is a guest

- **WHEN** a request presents a validly signed, unexpired session cookie from before the role field existed
- **THEN** the session is admitted with the guest role, and owner-gated actions refuse it
