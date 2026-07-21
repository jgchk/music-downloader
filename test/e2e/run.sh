#!/usr/bin/env bash
# Out-of-process E2E orchestration (merge-modular-monolith): run the ONE real image — both module
# runtimes + the web interface in a single process — against WireMock stubs for the two outermost
# third parties, and drive it over the web routes on a real socket. Two isolated phases:
#
#   phase 1  full-loop.e2e.test.ts   intent → download → deposit → seam → real beets → applied
#   phase 2  restart.e2e.test.ts     kill between fulfilment and import; durable resume, exactly once
#
# Path topology (host ./.e2e-tmp ⇄ container):
#   music/staging  ⇄ /music/staging   STAGING_ROOT — the harness seeds the fixture at the location
#                                     the slskd stub REPORTS (events.json under options.json root)
#   music/deposit  ⇄ /music/deposit   LIBRARY_ROOT (downloader deposits) = INTAKE_ROOT (importer
#                                     reads the same directory; INTAKE_SOURCE_ROOT defaults to
#                                     LIBRARY_ROOT, so re-rooting is the identity here)
#   music/library  ⇄ /music/library   beets' `directory` — the final library
#   data/          ⇄ /data            both modules' SQLite event stores (durable, host-inspectable)
#   config/beets   ⇄ /config/beets    hermetic beets config + its library.db; musicbrainz.host
#                                     points at the MB stub, so beets never touches the internet
#   bin/           ⇄ /e2e-bin         phase 2's BRIDGE_PYTHON wrapper + its block flag
#
# All containers share the HOST network (no docker network creation — kernel NAT modules are not
# required, and localhost means the same thing to the app, the stubs, and this script everywhere).
#
# Env:
#   E2E_SKIP_BUILD=1  use the already-built music-downloader:e2e image (CI builds once and gates
#                     the exact image it publishes)
#   E2E_PORT / E2E_MB_PORT / E2E_SLSKD_PORT   host ports (default 3000 / 8081 / 8082)
set -euo pipefail

cd "$(dirname "$0")/../.."

IMAGE=music-downloader:e2e
APP=music-e2e-app
MB_STUB=music-e2e-mb
SLSKD_STUB=music-e2e-slskd
WIREMOCK_IMAGE=wiremock/wiremock:3.13.2
PORT="${E2E_PORT:-3000}"
MB_PORT="${E2E_MB_PORT:-8081}"
SLSKD_PORT="${E2E_SLSKD_PORT:-8082}"

export E2E_DATA_DIR="$(pwd)/.e2e-tmp"
export E2E_BASE_URL="http://localhost:$PORT"
export E2E_SLSKD_ADMIN_URL="http://localhost:$SLSKD_PORT/__admin"
export E2E_APP_CONTAINER="$APP"

dump_logs() {
  for c in "$APP" "$MB_STUB" "$SLSKD_STUB"; do
    echo "=== docker logs: $c (tail) ===" >&2
    docker logs --tail 120 "$c" >&2 || true
  done
}
cleanup() { docker rm -f "$APP" "$MB_STUB" "$SLSKD_STUB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

if [[ "${E2E_SKIP_BUILD:-0}" != "1" ]]; then
  echo "── building $IMAGE"
  docker build -t "$IMAGE" .
fi

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

# ── stubs (shared by both phases; scenario state reset between them) ────────────────────────────
docker run -d --name "$MB_STUB" --network host \
  -v "$(pwd)/test/e2e/stubs/musicbrainz:/home/wiremock" \
  "$WIREMOCK_IMAGE" --port "$MB_PORT" --disable-banner >/dev/null
docker run -d --name "$SLSKD_STUB" --network host \
  -v "$(pwd)/test/e2e/stubs/slskd:/home/wiremock" \
  "$WIREMOCK_IMAGE" --port "$SLSKD_PORT" --disable-banner >/dev/null
wait_ready "http://localhost:$MB_PORT/__admin/mappings" mb-stub
wait_ready "http://localhost:$SLSKD_PORT/__admin/mappings" slskd-stub

fresh_env() {
  rm -rf .e2e-tmp
  mkdir -p .e2e-tmp/music/{staging,deposit,library} \
           .e2e-tmp/data/{downloader,importer} \
           .e2e-tmp/config/beets .e2e-tmp/bin
  chmod -R 0777 .e2e-tmp

  # Hermetic beets config: library-defining settings only (the bridge forces the non-interactive
  # session overlay and injects the musicbrainz source). Library and deposit share the /music
  # parent so beets' move is a rename. musicbrainz.host pins beets to the stub's ws/2 XML.
  cat > .e2e-tmp/config/beets/config.yaml <<YAML
directory: /music/library
library: /config/beets/library.db
import:
  move: yes
plugins: []
musicbrainz:
  host: localhost:$MB_PORT
  https: no
  ratelimit: 100
YAML

  # Phase 2's bridge gate: BRIDGE_PYTHON points here. Startup's `validate` verb passes straight
  # through (boot must succeed); while the flag exists every OTHER invocation (propose/apply)
  # blocks, holding the import open so the kill lands inside the window.
  cat > .e2e-tmp/bin/bridge-python <<'SH'
#!/bin/sh
case "$*" in
  *" validate"*) ;;
  *) while [ -f /e2e-bin/bridge-blocked ]; do sleep 1; done ;;
esac
exec /opt/beets-venv/bin/python3 "$@"
SH
  chmod +x .e2e-tmp/bin/bridge-python
}

start_app() { # start_app [extra docker-run args...]
  docker run -d --name "$APP" --network host \
    --user "$(id -u):$(id -g)" \
    -e HOME=/tmp \
    -e PORT="$PORT" \
    -e ORIGIN="http://localhost:$PORT" \
    -e LOG_LEVEL=info \
    -e LIBRARY_ROOT=/music/deposit \
    -e STAGING_ROOT=/music/staging \
    -e DOWNLOADER_DATABASE_FILE=/data/downloader/events.db \
    -e SLSKD_BASE_URL="http://localhost:$SLSKD_PORT" \
    -e SLSKD_API_KEY=test-key \
    -e MUSICBRAINZ_BASE_URL="http://localhost:$MB_PORT" \
    -e MUSICBRAINZ_USER_AGENT="music-downloader-e2e/0.0 (https://example.test)" \
    -e INTAKE_ROOT=/music/deposit \
    -e IMPORTER_DATABASE_FILE=/data/importer/events.db \
    -e BEETS_CONFIG=/config/beets/config.yaml \
    -e AUTO_APPLY_THRESHOLD=0.15 \
    -v "$E2E_DATA_DIR/music:/music" \
    -v "$E2E_DATA_DIR/data:/data" \
    -v "$E2E_DATA_DIR/config/beets:/config/beets" \
    -v "$E2E_DATA_DIR/bin:/e2e-bin" \
    "$@" \
    "$IMAGE" >/dev/null
  wait_ready "$E2E_BASE_URL" app
}

run_phase() { # run_phase <spec-file>
  if ! pnpm exec vitest run --config test/e2e/vitest.config.ts "$1"; then
    dump_logs
    exit 1
  fi
}

echo "── phase 1: full loop"
fresh_env
start_app
run_phase test/e2e/full-loop.e2e.test.ts
docker rm -f "$APP" >/dev/null

echo "── phase 2: restart resilience"
curl -fsS -X POST "http://localhost:$SLSKD_PORT/__admin/scenarios/reset" >/dev/null
curl -fsS -X DELETE "http://localhost:$SLSKD_PORT/__admin/requests" >/dev/null
fresh_env
touch .e2e-tmp/bin/bridge-blocked
start_app -e BRIDGE_PYTHON=/e2e-bin/bridge-python
run_phase test/e2e/restart.e2e.test.ts

echo "── e2e green"
