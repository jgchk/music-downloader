## Purpose

Cover-art lookup for release groups and releases via the Cover Art Archive, proxied and cached by the server, with a missing cover modeled as an expected outcome rather than an error.

## ADDED Requirements

### Requirement: Cover art is served by the application, not the browser

The system SHALL serve front-cover images for release groups and releases through its own endpoint, fetching from the Cover Art Archive server-side. The browser SHALL NOT call the Cover Art Archive directly. Fetched covers SHALL be cached server-side so repeated views of the same result do not re-fetch upstream.

#### Scenario: A cover renders through the app

- **WHEN** the UI displays a release group that has front cover art in the Cover Art Archive
- **THEN** the image is served from the application's own endpoint, and a repeat request within the cache lifetime is served without an upstream fetch

### Requirement: Missing art is an expected outcome

A release group or release without cover art SHALL be a modeled, expected outcome — the endpoint answers with a cacheable "no cover" response and the UI renders a placeholder — never an error surfaced to the user. An upstream failure (timeout, refusal) SHALL be distinguished from confirmed absence and SHALL NOT be cached as absence.

#### Scenario: No cover yields a placeholder

- **WHEN** the UI displays a release group for which the Cover Art Archive has no front cover
- **THEN** a placeholder is rendered in the artwork slot and no error is shown

#### Scenario: Upstream failure is not recorded as absence

- **WHEN** the Cover Art Archive cannot be reached for a lookup
- **THEN** the miss is not cached as "no cover", so a later request may still find the art
