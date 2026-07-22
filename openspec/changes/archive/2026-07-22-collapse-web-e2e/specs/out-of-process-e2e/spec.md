## ADDED Requirements

### Requirement: A real-browser interface phase runs against the same image

The tier SHALL include a browser-driven phase that exercises the web interface of the same built image the tier's other phases run — a real browser driving pages over the container's HTTP listener on a real socket — covering at minimum: the product navigation renders, an acquisition can be submitted and appears in the listing, a rejected submission re-renders the form with its modeled error, a retrying acquisition can be cancelled from its detail page, and the review queue serves its empty state. The phase SHALL be orchestrated by the tier's harness (which owns container lifecycle for all phases); the browser runner SHALL NOT build, boot, or own the application process in CI.

#### Scenario: Browser drives the published artifact, not a bespoke boot

- **WHEN** the tier runs in CI
- **THEN** the browser phase targets the running container built from the image to be published, over its HTTP port, rather than an application booted outside the image

#### Scenario: Browser phase failure blocks publish

- **WHEN** the browser phase fails against a freshly built image
- **THEN** the tier fails and the pipeline does not publish that image

### Requirement: The browser phase proves degraded boot with third parties unreachable

The browser phase SHALL run against an application instance whose third-party base URLs point at a local endpoint the application's HTTP client refuses deterministically (a WHATWG fetch bad port — the client rejects the request before any network I/O), so the image is proven to boot, serve pages, and accept user actions while both outermost third parties are unreachable, and so acquisitions remain in retry — keeping user-shaped cancellation observable. The phase SHALL NOT depend on the tier's HTTP stubs or on any stub's unmatched-request behavior.

#### Scenario: Image serves while third parties are down

- **WHEN** the browser phase's application instance starts with slskd and MusicBrainz base URLs pointing at a deterministically-refused endpoint
- **THEN** the container becomes ready and serves the interface's pages

#### Scenario: Cancellation is exercised against a retrying acquisition

- **WHEN** an acquisition is submitted during the browser phase
- **THEN** it remains retrying (third parties unreachable) long enough for the browser to cancel it from its detail page and observe the Cancelled status
