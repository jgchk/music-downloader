# module-architecture — delta for deterministic-floor

## ADDED Requirements

### Requirement: The production lint profile is the strictest typed tier

The production lint profile SHALL extend the strictest typed rule tiers the toolchain
publishes (`strictTypeChecked` and `stylisticTypeChecked`, or their successors), not a
weaker tier. Any rule disabled from those tiers SHALL carry a one-line justification comment
at the disable site in the lint configuration; an unjustified disable is a defect.

#### Scenario: The profile cannot silently regress

- **WHEN** the lint configuration extends a typed rule tier weaker than the strictest
  published tier without a documented decision
- **THEN** review flags it as a constitutional violation, and the configuration names no such
  weaker tier today

#### Scenario: A carve-out carries its reason

- **WHEN** a rule from the strict tiers is disabled or downgraded
- **THEN** the disable site carries a one-line justification comment naming why the rule
  fails this repo

### Requirement: Gate membership is admitted, not accumulated

A new check (rule pack, analyzer, or gate step) SHALL enter the commit gate only through the
admission contract in `docs/development/quality-gates.md`: the check is actionable, and its
effective false-positive rate — counting every finding the loop ignores, waives without
cause, or appeases — is under ten percent. Adoption of a rule pack SHALL be a one-shot
rule-by-rule triage whose admission tally (rules kept, rules rejected, reasons) is recorded
in the adopting change's design document.

#### Scenario: A rule pack is triaged rule-by-rule

- **WHEN** a third-party rule pack is proposed for the gate
- **THEN** every rule with findings is individually admitted (at least one genuine defect or
  clarity win) or rejected with a justification comment in configuration, and the tally is
  recorded in the adopting change

#### Scenario: A noisy check is rejected regardless of pedigree

- **WHEN** a candidate check's findings on this repository are predominantly noise
- **THEN** the check is rejected or the offending rules disabled, whatever its reputation
  elsewhere
