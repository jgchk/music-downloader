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

Category roles use GitHub's stock `bug` and `enhancement`, both already present.

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the
corresponding label string from this table.

## How these actually get used here

This is a single-maintainer tracker: every issue is authored by the person triaging it, and
most are filed by review agents during ship cycles. Two states do the real work —
**`ready-for-agent`** (a brief is attached; an AFK agent can pick it up) and
**`ready-for-human`**. `needs-info` has no external reporter to ask and will rarely apply.
