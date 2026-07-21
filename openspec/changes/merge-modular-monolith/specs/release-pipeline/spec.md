## ADDED Requirements

### Requirement: The pipeline gates the entire workspace as one product
The pre-merge pipeline SHALL run the full gate — format, lint, typecheck, build, and tests — across every workspace package (both modules and the web interface) in one pipeline, with test coverage measured as a single merged report spanning node-environment and browser-mode suites against one 100% threshold. The post-merge pipeline SHALL build and publish exactly one container image containing both modules and the web interface.

#### Scenario: A failure anywhere blocks the merge
- **GIVEN** a pull request in which any workspace package fails format, lint, typecheck, build, or a test
- **WHEN** the pre-merge pipeline runs
- **THEN** the required check fails and the pull request cannot merge

#### Scenario: Coverage is one merged measurement
- **WHEN** the test gate runs
- **THEN** coverage from node-environment and browser-mode suites lands in one report evaluated against the single 100% threshold

#### Scenario: One image ships the product
- **WHEN** a release-worthy merge passes all gates
- **THEN** exactly one container image is published, containing the downloader module, the importer module, and the web interface
