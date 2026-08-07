# mutation-testing — delta for mutation-gate-diff-scope

## MODIFIED Requirements

### Requirement: Changed lines carry mutant-killing tests

The PR gate SHALL run mutation testing over the production **files** the branch changed in the
bounded-context packages, and SHALL report every surviving non-suppressed mutant in them, per
mutant (file, line, mutation) rather than as an aggregate score. That is the gate's **reporting**
scope, and it stays file-wide: a wide report under a narrow gate is strictly more information,
and it preserves the ability to notice an assertion weakened elsewhere in a file the branch
touched.

The gate's **failure** scope SHALL be narrower than its reporting scope. A branch SHALL fail only
for a surviving mutant whose mutated span **overlaps** a line that branch added or modified,
computed from the diff against the same merge-base the scope resolution uses. Overlap, not
containment: a mutant whose span merely *encloses* a changed line — the removal of a block the
branch edited one line of — SHALL count as a finding. A surviving mutant whose span lies wholly
outside the changed lines SHALL be reported and SHALL NOT fail the branch.

The verdict SHALL be carried by the step that owns it rather than by the mutation runner's exit
code, and SHALL name at most one finding per changed line, so that one weak line presents as one
thing to do rather than a wall.

#### Scenario: A surviving mutant on a changed line is a finding

- **WHEN** a PR changes a production line whose surviving mutant no test kills
- **THEN** the verdict names it — file, line, mutator — as a blocking finding

#### Scenario: A survivor on an untouched line is reported, not blocking

- **WHEN** a PR changes a production file that also carries a surviving mutant on a line the
  branch did not touch
- **THEN** that mutant appears in the run's report and is not part of the verdict

#### Scenario: A block mutant spanning an edited line still counts

- **WHEN** a surviving mutant's span encloses the changed lines rather than sitting inside them
- **THEN** the verdict counts it, because the spans overlap

#### Scenario: Nothing in scope changed

- **WHEN** a PR changes no production file in the bounded-context packages
- **THEN** the job resolves an empty scope, says so, and runs no mutation pass

## ADDED Requirements

### Requirement: The verdict is measured in shadow before it blocks

The verdict SHALL ship in a shadow state: it computes its decision and publishes it where the
run's findings are read, and it does not fail the job. Enforcement SHALL be enabled by a single
documented configuration switch, without changing how the verdict is computed.

Enforcement SHALL NOT be enabled until the effective false-positive rate of the *enforcing*
configuration has been measured on real pull requests in this repository and recorded against the
ten-percent admission bar — where a finding the loop ignores, waives without cause, or appeases
counts as false. Measurement on the check's reputation elsewhere SHALL NOT substitute.

#### Scenario: Shadow publishes the decision without failing

- **WHEN** the verdict finds a surviving mutant overlapping a changed line while shadow is on
- **THEN** the decision is published with the findings that produced it, and the job stays green

#### Scenario: The flip is gated on a measurement taken here

- **WHEN** enforcement is proposed
- **THEN** the shadow verdicts collected on this repository's own pull requests, and the
  effective false-positive rate derived from them, are on the record first

### Requirement: The verdict fails closed on an absent or unmeasured audit

Once enforcing, the verdict SHALL fail on each of three conditions, not one: a surviving mutant
overlapping a changed line; a report that is missing or cannot be read as a mutation report; and
a resolved scope in which no mutant was actually analysed — every mutant ignored, or none
generated at all. A run that crashed, wrote nothing, or measured nothing SHALL NOT read as a
passing gate.

#### Scenario: A crashed run is not a green gate

- **WHEN** the mutation run dies before writing a report, or writes one that cannot be read
- **THEN** the verdict fails and says which of the two happened, rather than reporting no
  findings

#### Scenario: A scope that audited nothing is not clean

- **WHEN** every mutant in the resolved scope was ignored, or the scope produced no mutants
- **THEN** the verdict fails as unaudited rather than passing as clean
