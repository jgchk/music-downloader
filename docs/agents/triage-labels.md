# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the
actual label strings used in this repo's tracker. Here they are identical.

| Canonical role    | Label in our tracker | Meaning                                  |
| ----------------- | -------------------- | ---------------------------------------- |
| `needs-triage`    | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`      | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human` | `ready-for-human`    | Requires human implementation            |
| `wontfix`         | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the
corresponding label string from this table.

## Category roles

This repo has **three** category roles, not the usual two:

| Category role   | Meaning                                                        |
| --------------- | -------------------------------------------------------------- |
| `bug`           | Something is broken                                            |
| `enhancement`   | New feature or improvement                                     |
| `quality-gate`  | A review finding nominated for promotion to a machine-enforced rule |

`quality-gate` is a category, not a state — an issue carrying it still needs one of the five
state roles above. It exists because a promotion candidate is neither a defect nor a
feature: it proposes a *check*, and its lifecycle is governed by the promotion ladder and
admission contract in `docs/development/quality-gates.md` rather than by ordinary
implementation.

Two consequences worth knowing when triaging one:

- **Filing is not adoption.** These issues are deliberately filed as candidates. Adoption is
  its own change that runs the one-shot rule triage and records the admission tally in that
  change's design document. A `ready-for-agent` quality-gate issue means "the rung is
  settled and the adopting change can be written", not "turn the rule on".
- **The state usually turns on which ladder rung applies.** Where the rung is decided and
  the admission bar is assessable, it is `ready-for-agent`. Where the rung is genuinely open
  — typically a choice between a cheap check with a false-positive problem and a type-level
  change with real reach — it is `ready-for-human`.

## How these actually get used here

This is a single-maintainer tracker: every issue is authored by the person triaging it, and
most are filed by review agents during ship cycles. Two states do the real work —
**`ready-for-agent`** (a brief is attached; an AFK agent can pick it up) and
**`ready-for-human`**. `needs-info` has no external reporter to ask and will rarely apply.
