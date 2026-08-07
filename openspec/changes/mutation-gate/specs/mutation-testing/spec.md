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

## MODIFIED Requirements

Three requirements above were drafted before adoption measured what the tool can actually do on
this repository. They are restated here so the archived capability describes what shipped rather
than what was hoped for; the reasoning is in `design.md` (D4a, D6, D7) and the burn-down section.

### Requirement: Changed lines carry mutant-killing tests

The PR gate SHALL run mutation testing over the production **files** the branch changed in the
bounded-context packages, and SHALL report every surviving non-suppressed mutant in them, per
mutant (file, line, mutation) rather than as an aggregate score.

File granularity replaces line granularity: it is stricter, and once the repository is
mutant-clean the two give the same verdict, while file scope additionally catches a change that
weakens an assertion elsewhere in the same file.

The check SHALL fail the branch only once the repository is mutant-clean. Until then the step is
non-failing and the check is not required — a check that is red on debt the branch did not create
is one the loop learns to ignore, and quality-gates.md counts an ignored finding as false.
Both flips happen together.

#### Scenario: A surviving mutant is named on the PR

- **WHEN** a PR changes a production file that carries a mutant no test kills
- **THEN** the mutation check reports it in the job summary, naming file, line, and mutation

#### Scenario: Nothing in scope changed

- **WHEN** a PR changes no production file in the bounded-context packages
- **THEN** the job resolves an empty scope, says so, and runs no mutation pass

### Requirement: Suppressions are justified arid-line waivers

A mutant MAY be suppressed only with a written justification, in one of two forms:

- **At the site**, `// Stryker disable next-line <mutator>: <reason>`, for an individual arid or
  provably equivalent mutant.
- **At the configuration site**, for a whole *class* of mutant that is arid or unmeasurable on this
  repository, with its reason recorded in configuration and its tally in the adopting change's
  design document.

The second form is the waiver doctrine's stated preference — "A rejected rule is disabled once, in
configuration, with its reason" — and exists because a class retired by hundreds of identical
site comments is itself the signal that a rule failed admission. Directory-level exclusion inside
the covered packages SHALL NOT be used; composition roots are handled by per-site suppression so
non-arid logic in wiring stays observed.

#### Scenario: A class rejection is argued once, in configuration

- **WHEN** a whole family of mutants is arid or unkillable by any honest test on this repository
- **THEN** it is rejected at the config site with its reason and its measured tally, not by
  repeating a suppression comment at every occurrence

#### Scenario: An equivalent mutant is suppressed at its site

- **WHEN** a single mutant is provably equivalent to the original code
- **THEN** it carries an inline suppression stating why no test could distinguish it, and review
  treats an unjustified one as a defect

### Requirement: Scope covers both bounded-context packages end to end

Mutation scope SHALL include all TypeScript production source in the downloader and importer
packages across every layer, adapters included. Exclusion of an entire package (the web UI, pending
instrumentation support) SHALL be recorded as a tracked deferred item, not a silent omission.

Where a class rejection leaves part of that scope unmeasured — module-scope declarations, which is
all of the anti-corruption layer's schemas — the gate SHALL NOT report the unmeasured code as
audited. The run summary SHALL state how many mutants it analysed and how many it ignored, so a
scope in which nothing was actually measured cannot read as a clean result.

#### Scenario: A file whose mutants were all ignored is not reported as clean

- **WHEN** every mutant in the analysed scope was ignored as arid or unmeasurable
- **THEN** the summary says nothing in that scope was audited, rather than "no surviving mutants"
