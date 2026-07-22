# web-ui

The SvelteKit BFF web interface — adds a machine-readable health/readiness endpoint over the module runtimes (design D1–D3, D6).

## ADDED Requirements

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
