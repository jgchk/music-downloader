#!/usr/bin/env bash
# Out-of-process E2E tier: build (or reuse) the real image, run it, drive the HTTP surface over a
# real socket, tear down. CI gates the exact image it will publish (builds once, sets E2E_SKIP_BUILD).
#
# Env:
#   E2E_SKIP_BUILD=1   use the already-built `music-importer:e2e` image.
#   E2E_PORT           host port to bind (default 3900).
set -euo pipefail

cd "$(dirname "$0")/../.."

IMAGE=music-importer:e2e
NAME=music-importer-e2e
PORT="${E2E_PORT:-3900}"

if [[ "${E2E_SKIP_BUILD:-0}" != "1" ]]; then
  docker build -t "$IMAGE" .
fi

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

docker run -d --name "$NAME" -p "$PORT:3000" "$IMAGE" >/dev/null

# Wait until the API actually answers (bounded), then assert the surface.
deadline=$(( $(date +%s) + 60 ))
until curl -fsS --max-time 3 "http://localhost:$PORT/api/v1/imports" >/dev/null 2>&1; do
  if (( $(date +%s) >= deadline )); then
    echo "readiness timeout: the app did not answer within 60s" >&2
    docker logs "$NAME" >&2 || true
    exit 1
  fi
  sleep 1
done

body="$(curl -fsS "http://localhost:$PORT/api/v1/imports")"
if [[ "$body" != '{"imports":[]}' ]]; then
  echo "unexpected /api/v1/imports body: $body" >&2
  exit 1
fi

api_version="$(curl -fsS "http://localhost:$PORT/docs/json" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).info.version')"
pkg_version="$(node -p "require('./package.json').version")"
if [[ "$api_version" != "$pkg_version" ]]; then
  echo "version mismatch: api=$api_version pkg=$pkg_version" >&2
  exit 1
fi

echo "e2e OK (version $api_version)"
