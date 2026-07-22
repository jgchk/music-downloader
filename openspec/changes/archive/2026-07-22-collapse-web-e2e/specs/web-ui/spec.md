## MODIFIED Requirements

### Requirement: UI package meets the coverage gate

The web package SHALL meet the 100% line-and-branch coverage threshold via one merged root-level report across three vitest projects — `server` (node), `ssr` (node), and `client` (Browser Mode, Chromium) — with coverage inclusion configured so untested source files count against the gate. Permitted exclusions are limited to: `app.html`, `*.d.ts`, generated `.svelte-kit/` output, trivial hooks, and test/setup files. Any inline coverage-ignore pragma MUST carry a comment naming the compiler artifact it excuses. Playwright e2e SHALL remain outside the coverage threshold and SHALL run in CI as a phase of the out-of-process E2E tier against the built image, not as a separate job over a runner-local boot; a runner-local Playwright path MAY be kept as a non-gating developer convenience.

#### Scenario: Untested component fails the gate

- **WHEN** a source component exists in the web package with no test exercising it
- **THEN** the merged coverage report counts its uncovered lines and the gate fails

#### Scenario: Merged report spans node and browser tests

- **WHEN** the test gate runs server, ssr, and client projects
- **THEN** a single coverage report aggregates all three against the 100% threshold

#### Scenario: Playwright e2e gates the release from within the out-of-process tier

- **WHEN** the post-merge pipeline runs the Playwright parity smoke
- **THEN** it runs inside the out-of-process E2E tier against the built image, contributes to no coverage threshold, and its failure blocks publish via that tier's gate
