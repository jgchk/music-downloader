# web-access-control — delta for auth-roles

## MODIFIED Requirements

### Requirement: The web interface requires an authorized session

The web interface SHALL require a valid session on every server route except the login flow
(`/login`, its callback) and the health endpoint. An unauthenticated GET or HEAD request SHALL
be redirected to the login page; any other unauthenticated request (form actions and other
writes) SHALL be refused without side effects. A valid session SHALL grant the base interface —
submission, cancellation, selection, and review resolution — regardless of role; per-user
distinctions SHALL exist only as owner-gated privileged actions decided through the
authorization seam (see `web-authorization`). This change gates no route or action by role.

#### Scenario: Unauthenticated page request lands on login

- **WHEN** a request without a valid session cookie targets any gated page
- **THEN** the response redirects to the login page and no gated content is served

#### Scenario: Unauthenticated action is refused

- **WHEN** a request without a valid session cookie targets a form action or other state-changing route
- **THEN** the request is refused and no facade command is invoked

#### Scenario: Health endpoint stays open

- **WHEN** a request without any session targets the health endpoint
- **THEN** it is served normally, so deploy verification and monitoring need no credentials

#### Scenario: A guest session retains the base interface

- **WHEN** a request with a valid guest-role session targets any base-interface page or action
- **THEN** it is served exactly as before roles existed

### Requirement: Access is granted solely by Plex server membership

Authorization SHALL be decided by asking plex.tv, with the logging-in user's own token, whether
the account can see a **server** whose machine identifier equals the configured
`PLEX_SERVER_MACHINE_ID`: the matching resource entry SHALL both carry the configured machine
identifier and declare that it provides a server. A resource entry that matches the identifier
but does not provide a server — a player or other device, whose identifiers are client-chosen —
SHALL NOT satisfy the check. There SHALL be no user database, allowlist, or per-user
permissions. The matched entry's ownership flag SHALL be read at this moment as the session's
role source (see `web-authorization`). A plex.tv failure or unreachability SHALL surface as a
modeled infrastructure error on the login page and SHALL never result in a grant.

#### Scenario: Shared account is admitted

- **WHEN** the authenticated Plex account's accessible resources include a server providing
  the configured machine identifier
- **THEN** the login completes and a session is issued

#### Scenario: Unshared account is denied

- **WHEN** the authenticated Plex account's accessible resources do not include the configured machine identifier
- **THEN** the login page renders a denial message, no session is issued, and nothing about the account is stored

#### Scenario: A non-server resource with a matching identifier is denied

- **WHEN** the authenticated account's resources contain an entry carrying the configured
  machine identifier that does not declare it provides a server
- **THEN** the login is denied exactly as an unshared account is, and no session is issued

#### Scenario: plex.tv unavailable fails closed

- **WHEN** plex.tv is unreachable or returns a malformed or error response during the membership check
- **THEN** the login fails with a modeled infrastructure error and no session is issued

### Requirement: Sessions are stateless signed cookies with fixed expiry

A session SHALL be a signed, HttpOnly cookie carrying the Plex account identity, the session's
role, and a fixed expiry 7 days from login, verified per-request by pure computation against the
configured `SESSION_SECRET` — no server-side session state and no per-request plex.tv call.
Activity SHALL NOT extend a session; re-login re-runs the membership check, making cookie
lifetime the re-verification cadence. A validly signed cookie without a role field SHALL decode
as a guest session (see `web-authorization`); role SHALL change only by logging in again.

#### Scenario: Valid session is admitted without upstream calls

- **WHEN** a request carries an untampered session cookie within its validity window
- **THEN** it is admitted by signature and expiry verification alone, with no external call

#### Scenario: Expired session must log in again

- **WHEN** a request carries a session cookie past its fixed expiry, regardless of how recently the user was active
- **THEN** the request is treated as unauthenticated and the user must complete the Plex login again

#### Scenario: Tampered cookie is unauthenticated

- **WHEN** a request carries a cookie whose signature does not verify
- **THEN** the request is treated as unauthenticated

#### Scenario: Rotating the secret revokes every session

- **WHEN** `SESSION_SECRET` is changed and the process restarted
- **THEN** all previously issued cookies fail verification and every user must log in again

#### Scenario: The role rides the cookie, not a lookup

- **WHEN** a request carries a valid session cookie bearing a role
- **THEN** the role is available to the authorization seam from the cookie alone, with no
  store read or upstream call
