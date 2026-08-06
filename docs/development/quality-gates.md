# Quality Gates

Every commit passes the gate. That makes the gate the most powerful lever in the project — and the
most dangerous place to put a check that is wrong more often than it is right. This doc governs
**what earns a place in the gate**, and **how an English rule becomes a machine one**.

## Why membership needs a bar

Two findings from the literature drive everything here.

- **Deployment model dominates analyzer power.** The same analyzer that gets ~0% of its findings
  fixed as a nightly batch gets the large majority fixed when it speaks at change time. A check in
  the commit gate is already in the strongest possible seat, so the remaining wins are **stronger
  rules in that seat**, not more seats elsewhere.
- **A noisy check in the gate is worse than no check.** The industry bar is an *effective* false
  positive rate under ten percent, where a finding people routinely ignore counts as false even if
  it is technically correct.

An automated loop makes the second point sharper. A human who cannot fix a noisy finding will
grumble and ignore it. An agent that cannot ignore it will **appease** it — write a fiction test,
add a gratuitous waiver, contort a type, delete a live condition — and every one of those is a
worse outcome than the finding never existing. Appeasement is the failure mode this bar exists to
prevent.

## The admission contract

A check — a rule pack, an analyzer, a new gate step — is admitted only if **all** of these hold:

- **Actionable.** It names a specific thing to change, and the change is one a competent
  contributor would agree improves the code. "Something here might be worth a look" is not a
  finding.
- **Under ten percent effective false positives**, measured on *this* repository, not on the
  check's reputation elsewhere. Anything the loop ignores, waives without cause, or appeases counts
  as **false** — including a finding that is technically correct but whose only available fix is
  worse than the original code.
- **Not duplicate coverage.** A rule that flags what an already-admitted check flags adds noise and
  a second thing to maintain, not signal. Check the whole gate, not just the sibling rules — the
  **compiler** is part of it, and a type-aware compiler flag beats a syntactic lint rule aimed at
  the same defect. Worse, the lint rule's "fix" can *suppress* the stronger check.
- **Earns its latency.** See the budget below.

Adoption of a **rule pack** is a one-shot, rule-by-rule triage — never a blanket enable. Every rule
with findings is individually **admitted** (its findings include at least one genuine defect or
real clarity win; the rule stays at `error` and the findings get fixed) or **rejected** (disabled at
the config site with a one-line justification naming why it fails this repo). The **admission
tally** — rules kept, rules rejected, reasons — is recorded in the adopting change's design
document, because a decision nobody wrote down gets relitigated by the next person to notice the
rule is off.

Four corollaries worth stating, because each one has been got wrong:

- **A blanket severity downgrade is not a carve-out.** A warning nobody blocks on is the
  attested-dead nightly-batch shape. A rule is `error` or it is off.
- **A check can be worth running once without earning a seat.** A one-shot audit that finds a real
  defect has paid for itself even if the rule is then rejected for a false-positive rate the gate
  cannot carry. Record both halves.
- **Prefer tuning to disabling** — but pin the whole option set when you do. Rule options usually
  *replace* a preset's entry rather than merging into it, and a rule's own defaults are often more
  permissive than the preset's, so a one-word relaxation can silently re-admit everything else the
  preset was holding shut.
- **Enable the rules you admitted, not the pack minus the ones you rejected.** A disabled rule is
  not free: the engine still loads it and decides it does not apply. Where a triage admits a small
  fraction of a large pack, listing the survivors can be an order of magnitude cheaper than
  disabling the rest — measure both before choosing.

## The waiver doctrine

A rejected rule is disabled **once, in configuration, with its reason** — visible to everyone. A
per-site suppression is the exception, and carries the same burden as an `any`: a written
justification at the site saying why *this* occurrence is not the thing the rule is for. A
suppression without a reason is a defect, and a rising suppression count is the signal that the
rule failed admission and nobody noticed.

Watch for waivers that merely move the problem. Silencing a check by disabling a *different*
guarantee — suppressing a coverage threshold to satisfy a lint rule, say — trades a visible
assertion for an invisible one, and is strictly worse than leaving the original finding.

## The promotion ladder

Rules discovered by review — a reviewer saying the same thing twice — should become machine rules.
Climb only as far as the rule actually needs; each rung costs more to write and maintain than the
one below, and stopping early is the normal outcome.

1. **Configuration of an existing rule** — a stricter option, an added restricted pattern, a
   syntactic `no-restricted-*` rule. Free, instant, no new dependency. Stop here unless the rule
   needs to know something the syntax cannot say.
2. **A local lint rule** with access to types. Reach for this when the rule depends on what a thing
   *is* rather than how it is written. Stop here unless the rule must follow a value across
   function boundaries.
3. **A dataflow rule** (a pattern-matching engine that does taint/reachability analysis). Reach for
   this only when the property is genuinely inter-procedural. Expect real maintenance cost and a
   new tool in the pipeline; adopt the tool when the first promotion actually needs it, not before.
4. **Type-level unrepresentability.** The top of the ladder and the best rung when it is reachable:
   change the types so the violation cannot be written. No check to run, no findings to triage.
   Often cheaper than rung 2 — always ask whether it is available before writing a rule.

A rule that reaches the gate by any rung still has to pass the admission contract. Promotion is not
an exemption.

## The latency budget

The commit gate is a **seconds-order** loop. It runs on every commit, so its cost is paid hundreds
of times a day and a slow gate gets bypassed — which is the same as not having one.

- Checks in the commit gate stay seconds-order, in aggregate, on a warm cache.
- Analysis that is inherently minutes-order — whole-program search, mutation runs, deep dataflow —
  belongs in CI, and must be **runnable locally on demand**. It never joins the commit gate.
- Judge a new check against the gate's **critical path**, not its total work. The gate runs its
  lanes in parallel, so a check that lands off the critical path may be nearly free while one that
  extends the longest lane costs its full duration on every commit.
- Measure before and after when adding a check, and record the numbers in the adopting change.
