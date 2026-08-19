# mutation-testing — delta for mutation-recorded-survivors

## MODIFIED Requirements

### Requirement: Suppressions are justified arid-line waivers

A mutant MAY be suppressed only with a written justification, in one of three forms:

- **At the site**, `// Stryker disable next-line <mutator>: <reason>`, for an individual arid or
  provably equivalent mutant whose line carries no other mutant of that mutator worth observing.
- **At the configuration site**, for a whole *class* of mutant that is arid or unmeasurable on this
  repository, with its reason recorded in configuration and its tally in the adopting change's
  design document.
- **At the site, per mutant**, `` // Stryker recorded-survivor <mutator> `<replacement>`: <reason> ``,
  for a provably equivalent mutant whose line carries a **killable** sibling of the same mutator.
  Naming the replacement is what distinguishes the two, so the equivalent mutant is waived and the
  killable one stays observed.

The second form is the waiver doctrine's stated preference — "A rejected rule is disabled once, in
configuration, with its reason" — and exists because a class retired by hundreds of identical
site comments is itself the signal that a rule failed admission. Directory-level exclusion inside
the covered packages SHALL NOT be used; composition roots are handled by per-site suppression so
non-arid logic in wiring stays observed.

The third form SHALL be reached for only when the first would blind a killable mutant, and each use
SHALL state the proof that no test could distinguish the mutant from the original. Review treats an
unproven one as a defect, exactly as it treats an unjustified `any`.

#### Scenario: A class rejection is argued once, in configuration

- **WHEN** a whole family of mutants is arid or unkillable by any honest test on this repository
- **THEN** it is rejected at the config site with its reason and its measured tally, not by
  repeating a suppression comment at every occurrence

#### Scenario: An equivalent mutant is suppressed at its site

- **WHEN** a single mutant is provably equivalent to the original code, and no other mutant of its
  mutator on that line is worth observing
- **THEN** it carries an inline suppression stating why no test could distinguish it, and review
  treats an unjustified one as a defect

#### Scenario: An equivalent mutant shares its line and mutator with a killable one

- **WHEN** a provably equivalent mutant sits on a line where another mutant of the **same** mutator
  is killed by the suite
- **THEN** it is waived per mutant, by a marker naming the mutator and the exact replacement, so the
  killable sibling remains a finding if it ever survives
- **AND** a line-granular suppression SHALL NOT be used, because it would silence the sibling too

#### Scenario: A per-mutant waiver is read by the tooling, not only by a human

- **WHEN** a mutant carries a recorded-survivor marker
- **THEN** both the weekly drift channel and the PR verdict treat it as suppressed rather than
  surviving, so a waiver argued once is not re-filed as a finding every week

#### Scenario: A waiver that has outlived its argument fails

- **WHEN** a recorded-survivor marker names a mutant that the run killed, or that is absent from a
  file the run actually mutated
- **THEN** the tooling fails and names the stale marker, so the waiver is re-argued or removed
  rather than lingering as a comment nothing rechecks

#### Scenario: A run that could not grade the mutant does not condemn the waiver

- **WHEN** the named mutant is reported with a status that reflects the run rather than the suite's
  assertion strength — timed out, or failing to compile or execute
- **THEN** the waiver is neither applied nor reported stale, because a run that could not grade the
  mutant has no evidence either way, and failing on one would redden the channel over machine load

## ADDED Requirements

### Requirement: Equivalent mutants are resolved on the honest rung

A surviving mutant SHALL be resolved by the first applicable rung, in order: killed by a test that
asserts the behavior; deleted, when the survivor proves the code is redundant with a check that
already runs; suppressed at line granularity, when that silences nothing killable; recorded per
mutant, only when the rungs above do not apply.

Production code SHALL NOT be reshaped for the sole purpose of preventing a tool from generating an
equivalent mutant. A finding that can only be satisfied by contorting the code has failed admission,
not the code.

#### Scenario: A survivor proves a guard is redundant

- **WHEN** every mutant of a guard survives because a check downstream already rejects everything
  the guard would have rejected
- **THEN** the guard is deleted and the downstream check documented as the single validator, rather
  than the mutants being waived
