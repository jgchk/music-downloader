#!/usr/bin/env bash
# The commit gate (`pnpm check`). One lane list, two modes:
#   default   — all lanes fan out in parallel; every lane must pass, first failure kills the
#               rest (fail-fast) and prints its buffered output.
#   --serial  — the same lanes one at a time in display order, output streamed live. This is
#               the debugging/CI-reproduction mode; the lane list is defined only here.
#
# Lane independence notes (parallel mode):
#   • Package exports point at `src/`, so no lane consumes another lane's build output.
#   • `check:svelte` and the web vite build both (re)generate `.svelte-kit/` — they share the
#     single `web` lane so nothing races on that directory. The web vitest projects use the
#     plain svelte plugin (no svelte-kit sync), so the test lane never touches it.
#   • The tsc typecheck lanes and the two tsc build lanes use distinct tsconfigs and therefore
#     distinct .tsbuildinfo files; they never contend. `typecheck:tiers` walks the out-of-package
#     projects (scripts, contract, boundaries, e2e, config files) serially inside its own lane.
#
# CI (`pipeline.yml`) runs the underlying pnpm scripts individually and cold — this script is
# the local loop's ergonomics, not a change to what the gate means.
set -euo pipefail

cd "$(dirname "$0")/.."

MODE=parallel
if [[ "${1:-}" == "--serial" ]]; then
  MODE=serial
elif [[ $# -gt 0 ]]; then
  echo "usage: check.sh [--serial]" >&2
  exit 2
fi

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

# Lane order here is display order (and execution order in --serial mode). Commands mirror
# package.json scripts; typecheck/build are split per package so the slowest compiler doesn't
# gate the others.
NAMES=(
  format
  lint
  typecheck:downloader
  typecheck:importer
  typecheck:tiers
  build:downloader
  build:importer
  web
  test
  contract
  tooling
  bridge
)
declare -A COMMANDS=(
  ["format"]="pnpm run format"
  ["lint"]="pnpm run lint"
  ["typecheck:downloader"]="pnpm exec tsc --noEmit -p packages/downloader/tsconfig.json"
  ["typecheck:importer"]="pnpm exec tsc --noEmit -p packages/importer/tsconfig.json"
  ["typecheck:tiers"]="pnpm run typecheck:tiers"
  ["build:downloader"]="pnpm exec tsc --noCheck -p packages/downloader/tsconfig.build.json"
  ["build:importer"]="pnpm exec tsc --noCheck -p packages/importer/tsconfig.build.json"
  ["web"]="pnpm --dir packages/web run check:svelte && pnpm --dir packages/web run build"
  ["test"]="pnpm run test:cov"
  ["contract"]="pnpm run test:contract"
  ["tooling"]="pnpm run test:tooling"
  ["bridge"]="pnpm run test:bridge"
)

if [[ "$MODE" == "serial" ]]; then
  echo -e "${BOLD}pnpm check — ${#NAMES[@]} lanes, serial${RESET}\n"
  for name in "${NAMES[@]}"; do
    echo -e "${BOLD}=== $name ===${RESET}"
    started=$EPOCHREALTIME
    if ! bash -c "${COMMANDS[$name]}"; then
      echo -e "\n${RED}${BOLD}✗ ${name} failed${RESET}"
      exit 1
    fi
    duration=$(awk -v a="$started" -v b="$EPOCHREALTIME" 'BEGIN { printf "%.1f", b - a }')
    echo -e "  ${GREEN}✓${RESET} $name (${duration}s)\n"
  done
  echo -e "${GREEN}${BOLD}All checks passed${RESET}"
  exit 0
fi

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

declare -A PIDS
declare -A STARTED

echo -e "${BOLD}pnpm check — ${#NAMES[@]} lanes in parallel${RESET}\n"

for name in "${NAMES[@]}"; do
  # Own session per lane so a failure can kill the lane's whole process tree.
  setsid bash -c "${COMMANDS[$name]}" > "$TEMP_DIR/$name.out" 2>&1 &
  PIDS[$name]=$!
  STARTED[$name]=$EPOCHREALTIME
  echo -e "  ${YELLOW}⏳${RESET} $name"
done
echo ""

declare -A DURATION
failed_name=""

while [[ ${#PIDS[@]} -gt 0 ]]; do
  wait -n -p finished_pid "${PIDS[@]}" && status=0 || status=$?
  for name in "${!PIDS[@]}"; do
    [[ "${PIDS[$name]}" == "$finished_pid" ]] || continue
    DURATION[$name]=$(awk -v a="${STARTED[$name]}" -v b="$EPOCHREALTIME" 'BEGIN { printf "%.1f", b - a }')
    unset "PIDS[$name]"
    if [[ $status -ne 0 ]]; then
      failed_name=$name
      for other in "${!PIDS[@]}"; do
        kill -TERM -- "-${PIDS[$other]}" 2>/dev/null || true
      done
      wait 2>/dev/null || true
      break 2
    fi
    echo -e "  ${GREEN}✓${RESET} $name (${DURATION[$name]}s)"
    break
  done
done

if [[ -n "$failed_name" ]]; then
  echo -e "\n${RED}${BOLD}✗ ${failed_name} failed (${DURATION[$failed_name]}s)${RESET}\n"
  cat "$TEMP_DIR/$failed_name.out" 2>/dev/null || echo "(no output captured)"
  exit 1
fi

echo -e "\n${GREEN}${BOLD}All checks passed${RESET}"
