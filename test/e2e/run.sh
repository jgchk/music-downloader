#!/usr/bin/env bash
# Orchestrate the out-of-process E2E tier (change: add-out-of-process-e2e): bring up the real image
# plus WireMock stubs, run the isolated suite against it over HTTP, then tear everything down.
#
# Env:
#   E2E_SKIP_BUILD=1   use the already-built `music-downloader:e2e` image (CI gates the exact image
#                      it will publish, so it builds once and sets this).
set -euo pipefail

cd "$(dirname "$0")/../.."
COMPOSE="docker compose -f docker-compose.test.yml"
export E2E_DATA_DIR="$(pwd)/.e2e-tmp"
# The app container runs as this uid/gid so it shares ownership of the bind-mounted ./.e2e-tmp.
export E2E_UID="$(id -u)"
export E2E_GID="$(id -g)"

cleanup() { $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Fresh shared data dir, owned by the invoking user so the container (uid 1000 / node) can write.
rm -rf .e2e-tmp
mkdir -p .e2e-tmp/staging .e2e-tmp/library

if [[ "${E2E_SKIP_BUILD:-0}" == "1" ]]; then
  $COMPOSE up -d
else
  $COMPOSE up -d --build
fi

pnpm exec vitest run --config test/e2e/vitest.config.ts
