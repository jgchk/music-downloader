#!/usr/bin/env bash
# Runs one tier-2 drift check and translates its exit code into the step output the drift workflow
# routes on (change: drift-signal-fidelity). One place, so the three checks cannot disagree about
# what a code means:
#
#   0 → conforms      the provider answered and the consumed surface still holds
#   1 → drift         the consumed surface changed — or the checker itself is broken (issue #110)
#   2 → unavailable   the provider could not be reached, so nothing was confirmed OR refuted
#
# Anything other than 0 or 2 is `drift`, deliberately: an unhandled crash exits 1, and a checker
# that fell over belongs in the loud channel rather than being mistaken for a quiet outage.
#
# Usage: run-check.sh <target-name> <log-file> <command...>
set -uo pipefail

target="$1"
log="$2"
shift 2

"$@" 2>&1 | tee "$log"
# PIPESTATUS, not $?: with `tee` on the right of the pipe, $? is tee's status. pipefail would give
# the rightmost failure, which is close enough for a boolean and useless for a three-way code.
code="${PIPESTATUS[0]}"

case "$code" in
  0) status=conforms ;;
  2) status=unavailable ;;
  *) status=drift ;;
esac

echo "status=${status}" >>"$GITHUB_OUTPUT"
echo "${target}: ${status} (exit ${code})"

# Always 0: this wrapper reports, it does not judge. Whether the run goes red is decided once, by
# the workflow's own step, from the collected statuses — so a red run always has an issue behind it.
exit 0
