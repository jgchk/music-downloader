## ADDED Requirements

### Requirement: The web interface requires an authorized session

The web interface SHALL require a valid session on every server route except the login flow (`/login`, its callback) and the health endpoint. An unauthenticated page request SHALL be redirected to the login page; an unauthenticated form action or non-page request SHALL be refused without side effects. A valid session SHALL grant the full interface — submission, cancellation, selection, and review resolution — with no further per-user distinctions.

#### Scenario: Unauthenticated page request lands on login

- **WHEN** a request without a valid session cookie targets any gated page
- **THEN** the response redirects to the login page and no gated content is served

#### Scenario: Unauthenticated action is refused

- **WHEN** a request without a valid session cookie targets a form action or other state-changing route
- **THEN** the request is refused and no facade command is invoked

#### Scenario: Health endpoint stays open

- **WHEN** a request without any session targets the health endpoint
- **THEN** it is served normally, so deploy verification and monitoring need no credentials

### Requirement: Login is the Plex PIN flow via full-page redirect

The login page SHALL render without contacting any external service. Submitting the login form SHALL create a Plex PIN server-side and redirect the browser to Plex's hosted auth page with a forward URL back to the app's callback route; the callback SHALL check the PIN once server-side. Upstream PIN creation SHALL occur only on form submission, never on page render.

#### Scenario: Rendering the login page costs nothing upstream

- **WHEN** the login page is requested (including repeatedly, by unauthenticated crawlers)
- **THEN** no request is made to plex.tv

#### Scenario: Approved PIN establishes a session

- **WHEN** the callback is reached after the user approves the PIN and the account passes the membership check
- **THEN** a session cookie is set and the browser is redirected into the gated interface

#### Scenario: Unapproved or expired PIN is a modeled error

- **WHEN** the callback is reached with a PIN that was not approved or has expired
- **THEN** the login page re-renders with a modeled error and no session is created

### Requirement: Access is granted solely by Plex server membership

Authorization SHALL be decided by asking plex.tv, with the logging-in user's own token, whether the account can see a server whose machine identifier equals the configured `PLEX_SERVER_MACHINE_ID`. There SHALL be no user database, allowlist, or per-user permissions. A plex.tv failure or unreachability SHALL surface as a modeled infrastructure error on the login page and SHALL never result in a grant.

#### Scenario: Shared account is admitted

- **WHEN** the authenticated Plex account's accessible resources include the configured machine identifier
- **THEN** the login completes and a session is issued

#### Scenario: Unshared account is denied

- **WHEN** the authenticated Plex account's accessible resources do not include the configured machine identifier
- **THEN** the login page renders a denial message, no session is issued, and nothing about the account is stored

#### Scenario: plex.tv unavailable fails closed

- **WHEN** plex.tv is unreachable or returns a malformed or error response during the membership check
- **THEN** the login fails with a modeled infrastructure error and no session is issued

### Requirement: Sessions are stateless signed cookies with fixed expiry

A session SHALL be a signed, HttpOnly cookie carrying the Plex account identity and a fixed expiry 7 days from login, verified per-request by pure computation against the configured `SESSION_SECRET` — no server-side session state and no per-request plex.tv call. Activity SHALL NOT extend a session; re-login re-runs the membership check, making cookie lifetime the re-verification cadence.

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

### Requirement: Logout ends the session

The interface SHALL offer a logout action that clears the session cookie.

#### Scenario: Logging out

- **WHEN** an authenticated user invokes logout
- **THEN** the session cookie is cleared and subsequent requests are treated as unauthenticated

### Requirement: The application retains no Plex credentials

The user's Plex token SHALL be used only for the duration of the login exchange (PIN check and membership check) and SHALL NOT be persisted, placed in the session cookie, or written to logs. Configuration SHALL NOT include any owner or admin Plex token.

#### Scenario: The user token dies with the login exchange

- **WHEN** a login completes (granted or denied)
- **THEN** the user's Plex token exists nowhere in the system — not in the cookie, not in any store, not in log output

#### Scenario: No long-lived Plex credential in configuration

- **WHEN** the composed configuration surface is inspected
- **THEN** the only access-control values are the cookie-signing secret and the public machine identifier — no Plex token of any kind

### Requirement: Access-control misconfiguration fails closed

Missing or blank access-control configuration (`SESSION_SECRET`, `PLEX_SERVER_MACHINE_ID`) SHALL fail startup precisely, and no environment configuration of the shipped artifact SHALL disable or bypass the gate.

#### Scenario: Missing configuration fails startup

- **WHEN** the process starts without a session secret or machine identifier
- **THEN** startup fails naming the missing variable, rather than serving with a weakened or open gate

#### Scenario: No configuration opens the gate

- **WHEN** the shipped image is booted with any combination of environment values
- **THEN** unauthenticated requests to gated routes are never served — there is no auth-disable or test-strategy switch in the artifact
