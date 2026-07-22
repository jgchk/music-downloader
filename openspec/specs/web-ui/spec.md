# web-ui Specification

## Purpose

Define the SvelteKit BFF web interface — the product's sole interface at functional parity with the retired MCP tools — including its in-process facade access rule, the single-process daemon shape, and the testing/coverage regime that keeps the UI package inside the 100% merged coverage gate.

## Requirements
### Requirement: Acquisition submission and cancellation

The web UI SHALL let a user submit an acquisition (target plus quality policy, matching the downloader facade's submit contract) and cancel a pending acquisition. Failures returned by the facade SHALL render as actionable messages, not crashes.

#### Scenario: Successful submission

- **WHEN** a user submits a valid acquisition form
- **THEN** the BFF dispatches the downloader facade's submit command in-process and the UI shows the new acquisition with its identifier and current phase

#### Scenario: Rejected submission renders the modeled error

- **WHEN** the facade returns a modeled validation or conflict error for a submission
- **THEN** the UI re-renders the form with the failure's message and no acquisition is created

#### Scenario: Cancellation

- **WHEN** a user cancels an acquisition that is still cancellable
- **THEN** the facade's cancel command is dispatched and the UI reflects the cancelled state

### Requirement: Acquisition progress observation

The web UI SHALL show the user each acquisition's current phase and outcome (including failure reasons) from the downloader facade's read models.

#### Scenario: Progress listing

- **WHEN** a user opens the acquisitions view while acquisitions exist in various phases
- **THEN** each acquisition renders with its phase, target description, and, for terminal states, its outcome or failure reason

### Requirement: Import review resolution

The web UI SHALL list imports awaiting review and let the user resolve a review (matching the importer facade's resolve contract), at parity with the retired `resolve_review` MCP tool.

#### Scenario: Resolving a review

- **WHEN** a user resolves a pending review with a valid choice
- **THEN** the importer facade's resolve command is dispatched and the review leaves the pending list

#### Scenario: Stale resolution is a modeled error

- **WHEN** a user resolves a review that is no longer pending
- **THEN** the UI shows the facade's modeled conflict error and the import's state is unchanged

### Requirement: BFF calls facades in-process only

All web UI data access SHALL occur in SvelteKit server routes (loads, actions, server endpoints) calling module facades in-process. The browser client SHALL NOT reach module code directly, and server-only modules SHALL NOT be importable into client bundles.

#### Scenario: No network hop behind the BFF

- **WHEN** any web UI page is served or action processed
- **THEN** the BFF performs no HTTP request to its own process or to localhost to obtain module data

#### Scenario: Server-only leak breaks the build

- **WHEN** a client-bundled component imports a facade or other server-only module
- **THEN** the build fails

### Requirement: Single-process daemon serves the UI

The production process SHALL start via a single entry point that boots both module runtimes (event stores, subscriptions, reactors, source pollers) and then serves the web UI. Background processing SHALL NOT depend on page traffic.

#### Scenario: One process serves pages and processes events

- **WHEN** the production entry point starts
- **THEN** the web UI responds on the configured port and a submitted acquisition progresses through download and import with no further HTTP requests arriving

### Requirement: UI package meets the coverage gate

The web package SHALL meet the 100% line-and-branch coverage threshold via one merged root-level report across three vitest projects — `server` (node), `ssr` (node), and `client` (Browser Mode, Chromium) — with coverage inclusion configured so untested source files count against the gate. Permitted exclusions are limited to: `app.html`, `*.d.ts`, generated `.svelte-kit/` output, trivial hooks, and test/setup files. Any inline coverage-ignore pragma MUST carry a comment naming the compiler artifact it excuses. Playwright e2e SHALL run as a separate job with no coverage threshold.

#### Scenario: Untested component fails the gate

- **WHEN** a source component exists in the web package with no test exercising it
- **THEN** the merged coverage report counts its uncovered lines and the gate fails

#### Scenario: Merged report spans node and browser tests

- **WHEN** the test gate runs server, ssr, and client projects
- **THEN** a single coverage report aggregates all three against the 100% threshold

### Requirement: Health endpoint reports readiness and version

The web interface SHALL expose an unauthenticated `GET /health` server route that returns a JSON body describing the process's readiness. The body SHALL include an overall `status` of `ok` or `degraded`, the running application `version` (sourced from the shipped package version, not from the environment), and a per-module `status` of `up` or `down` for each module runtime (`downloader` and `importer`). When every module runtime reports healthy, the route SHALL respond `200` with overall `status` `ok`. When any booted module runtime reports unhealthy, the route SHALL respond `503` with overall `status` `degraded`, and the body SHALL still enumerate each module's status so the unhealthy module is named. The route SHALL obtain module readiness by reading the runtime readiness snapshot in the SvelteKit server layer only; it SHALL NOT import module internals, scan an event store, or perform domain I/O to answer.

#### Scenario: Ready process reports ok with version

- **WHEN** a client issues `GET /health` against a process whose module runtimes are all healthy
- **THEN** the route responds `200` with a JSON body whose overall `status` is `ok`, whose `version` is the running application version, and whose `modules.downloader.status` and `modules.importer.status` are both `up`

#### Scenario: A degraded module drives a 503

- **WHEN** a client issues `GET /health` while a booted module runtime reports itself unhealthy
- **THEN** the route responds `503` with overall `status` `degraded` and the responding body names that module with `status` `down`

#### Scenario: No domain I/O or module-internal import behind the probe

- **WHEN** the `/health` route handles a request
- **THEN** it reads only the runtime readiness snapshot exposed through the server layer and performs no event-store scan, no third-party dependency call, and no import of module-internal code

### Requirement: Health endpoint meets the coverage gate

The `/health` server route SHALL be covered by the web package's merged 100% line-and-branch coverage gate, exercising both the ready (`200`/`ok`) and degraded (`503`/`degraded`) paths, with no new coverage carve-out introduced for it.

#### Scenario: Both status paths are exercised under the gate

- **WHEN** the web test gate runs
- **THEN** tests drive both the all-healthy and the degraded branches of the route and the merged coverage report counts the route with no threshold exclusion

### Requirement: Manual edition selection for release-group requests

The web UI SHALL surface acquisitions that are awaiting manual edition selection, presenting each candidate edition with its identifying metadata — title, release date, country, format, and track count — so a user can distinguish the editions. The UI SHALL let the user select one candidate edition, which resumes the acquisition with that edition as the resolved target. A selection that the system rejects (e.g. the acquisition is no longer awaiting selection) SHALL render as the modeled error, not a crash or a silent no-op. The UI SHALL accept the release-group identifier as a request kind when submitting an acquisition.

#### Scenario: Awaiting-selection acquisition lists its candidate editions

- **GIVEN** an acquisition awaiting manual edition selection
- **WHEN** the user views it
- **THEN** the UI lists the candidate editions, each showing title, release date, country, format, and track count

#### Scenario: Selecting an edition resumes the acquisition

- **GIVEN** an acquisition awaiting manual edition selection is shown with its candidate editions
- **WHEN** the user selects one edition
- **THEN** the UI submits that selection and the acquisition proceeds with the chosen edition as its target

#### Scenario: A stale selection renders the modeled error

- **GIVEN** an acquisition that has left the awaiting-selection state
- **WHEN** the user submits a selection for it
- **THEN** the UI renders the modeled rejection error rather than crashing or silently ignoring it

#### Scenario: Submitting a request by release-group identifier

- **GIVEN** a user submitting a new acquisition
- **WHEN** they provide a MusicBrainz release-group identifier as the request
- **THEN** the UI submits a release-group request that the system resolves by selecting a representative edition
