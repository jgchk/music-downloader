#!/usr/bin/env bash
# The Python peer of `pnpm test:cov`: runs the beets-bridge unit tests under coverage.py at a 100%
# branch-coverage gate (.coveragerc). Hermetic — creates a local .venv (gitignored) holding only
# coverage; the tests fake `beets`, so no beets/ffmpeg/network is needed, just a `python3` on PATH
# (which the bridge itself already requires). Wired into `pnpm check` and the CI `test` job.
set -euo pipefail
cd "$(dirname "$0")"

VENV=.venv
if [[ ! -x "$VENV/bin/coverage" ]]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet 'coverage==7.6.10'
fi

"$VENV/bin/coverage" run -m unittest discover -s . -p 'test_*.py'
"$VENV/bin/coverage" report
