# module-architecture — delta for close-enforcement-gaps

## ADDED Requirements

### Requirement: Every first-party source tier is inside the lint and typecheck gates

The commit gate's lint and typecheck SHALL cover every first-party TypeScript source in the
repository — package sources, scripts, and every test tier (unit, contract, boundaries, e2e) —
with no tier excluded from either gate. Test tiers SHALL run the production rule profile except
for short, named, documented carve-outs; an undocumented divergence is a defect. The
architecture-pinning boundaries tier SHALL itself be inside both gates.

#### Scenario: A new tier is born inside the gates

- **WHEN** a TypeScript file is added anywhere in the repository outside generated output
- **THEN** the commit gate lints and typechecks it without configuration changes, or the gate
  fails naming the uncovered file

#### Scenario: A tier carve-out is named and documented

- **WHEN** a test tier's rule profile diverges from production
- **THEN** the divergence is a named rule with a documented rationale in the lint
  configuration, not a tier-wide exemption

### Requirement: A discarded Result is a build break

The lint gate SHALL fail when a `Result`-returning call's value is discarded — the
errors-as-values contract is enforced, not aspirational. Waivers SHALL be per-site with a
written justification; test tiers MAY be excluded as a whole only via a commented override
naming its revisit trigger.

#### Scenario: Dropping a Result fails the gate

- **WHEN** production code calls a `Result`-returning function and ignores the returned value
- **THEN** lint fails at that site

#### Scenario: A waiver carries its justification

- **WHEN** a site legitimately consumes a Result in a way the rule cannot see
- **THEN** the site carries a per-line disable with a written justification, or the code is
  restructured so the rule sees the consumption
