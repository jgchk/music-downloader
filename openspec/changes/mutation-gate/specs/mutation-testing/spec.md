# mutation-testing — delta for mutation-gate

## Purpose

Guarantee that the test suite *detects* faults, not merely executes lines: every change to
covered production code in the bounded-context packages must carry tests that kill its
mutants, or a justified suppression stating why the code has no behavior worth asserting.

## ADDED Requirements

### Requirement: Changed lines carry mutant-killing tests

The PR gate SHALL run mutation testing over the branch's changed production lines in the
bounded-context packages and SHALL fail while any surviving mutant on those lines is neither
killed by a test nor suppressed. The failure signal SHALL be per-mutant (file, line,
mutation), not an aggregate score.

#### Scenario: A surviving mutant blocks the merge

- **WHEN** a PR changes a production line whose mutant no test kills
- **THEN** the required mutation check fails, naming the mutant

#### Scenario: Killing the mutant unblocks

- **WHEN** a test is added or strengthened so the named mutant is killed
- **THEN** the mutation check passes without any other change

### Requirement: Suppressions are justified arid-line waivers

A mutant MAY be suppressed only by marking its code arid — behavior-free plumbing (logging
calls, config pass-through, composition wiring) — with an inline justification, held to the
same doctrine as a coverage waiver: an unjustified suppression is a defect. Directory-level
exclusion SHALL NOT be used inside the covered packages; composition roots are handled by
per-site suppression so non-arid logic in wiring stays observed.

#### Scenario: An arid suppression carries its reason

- **WHEN** a surviving mutant sits on genuinely behavior-free plumbing
- **THEN** the suppression is per-site with a written justification, and review treats an
  unjustified one as a defect

### Requirement: Full-repo drift is surfaced on a schedule

A scheduled full-repo mutation run over main SHALL execute at least weekly and SHALL file
its surviving non-suppressed mutants through a durable, visible channel (tracker issues),
without blocking any merge.

#### Scenario: Drift in untouched code becomes visible

- **WHEN** the scheduled run finds surviving mutants in code no recent PR touched
- **THEN** they are filed to the tracker with file, line, and mutation, and no build is
  blocked

### Requirement: The commit gate stays fast

Mutation testing SHALL be runnable locally on demand but SHALL NOT be part of the
seconds-order local commit gate; minutes-order analysis runs in CI.

#### Scenario: Local run is available but not imposed

- **WHEN** a developer or agent wants mutation feedback before pushing
- **THEN** a single package script runs the incremental check locally, and the standard
  commit gate's duration is unaffected

### Requirement: Scope covers both bounded-context packages end to end

Mutation scope SHALL include all TypeScript production source in the downloader and
importer packages across every layer, adapters included. Exclusion of an entire package
(the web UI, pending instrumentation support) SHALL be recorded as a tracked deferred item,
not a silent omission.

#### Scenario: An adapter mutant is real signal

- **WHEN** a mutant in an adapter's error-mapping survives the unit and contract tiers
- **THEN** it is reported like any domain mutant — adapters are not excluded from scope
