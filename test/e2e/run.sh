#!/usr/bin/env bash
# Orchestrate the out-of-process E2E tier (change: add-out-of-process-e2e): bring up the real image
# plus WireMock stubs, wait until everything actually serves, run the isolated suite against it over
# HTTP, then tear everything down.
#
# Env:
#   E2E_SKIP_BUILD=1   use the already-built `music-downloader:e2e` image (CI gates the exact image
#                      it will publish, so it builds once and sets this).
set -euo pipefail

cd "$(dirname "$0")/../.."
COMPOSE="docker compose -f docker-compose.test.yml"
export E2E_DATA_DIR="$(pwd)/.e2e-tmp"
# The app container runs as this uid/gid so it shares ownership of the bind-mounted ./.e2e-tmp
# (created just below by the same user), which is what lets it open the SQLite file and clean staging.
export E2E_UID="$(id -u)"
export E2E_GID="$(id -g)"

dump_logs() {
  echo "=== docker compose ps ===" >&2
  $COMPOSE ps >&2 || true
  echo "=== docker compose logs (tail) ===" >&2
  $COMPOSE logs --no-color --tail 120 >&2 || true
}
cleanup() { $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Fresh shared data dir, owned by the invoking user; 0777 as cheap insurance against any uid drift
# between the host and the container writing /data.
rm -rf .e2e-tmp
mkdir -p .e2e-tmp/staging .e2e-tmp/library
chmod -R 0777 .e2e-tmp

if [[ "${E2E_SKIP_BUILD:-0}" == "1" ]]; then
  $COMPOSE up -d
else
  $COMPOSE up -d --build
fi

# Wait until each endpoint actually answers (bounded per-attempt so a cold-starting, port-open-but-
# not-listening service can never hang us). Dump logs and fail loudly if anything never comes up.
wait_ready() {
  local url="$1" name="$2" deadline=$(( $(date +%s) + 120 ))
  until curl -fsS --max-time 3 "$url" >/dev/null 2>&1; do
    if (( $(date +%s) >= deadline )); then
      echo "readiness timeout: $name did not answer $url within 120s" >&2
      dump_logs
      exit 1
    fi
    sleep 2
  done
  echo "ready: $name"
}
wait_ready http://localhost:8081/__admin/mappings mb-stub
wait_ready http://localhost:8082/__admin/mappings slskd-stub
wait_ready http://localhost:3000/api/v1/acquisitions app

if ! pnpm exec vitest run --config test/e2e/vitest.config.ts; then
  dump_logs
  exit 1
fi
