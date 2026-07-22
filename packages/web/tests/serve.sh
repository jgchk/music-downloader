#!/usr/bin/env bash
# Serve the composed app for LOCAL Playwright iteration — a dockerless developer convenience,
# not any CI job's boot path (CI runs the parity smoke inside test/e2e/run.sh against the real
# built image). Scratch filesystem roots, a minimal but real beets config (validated by the real
# bridge at boot), and third-party base URLs at a fetch bad-port (127.0.0.1:9 — undici refuses
# it at the client) so the smoke never touches the network. Adapter-node build, init-hook daemon, facades over locals — not a mock server.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
scratch="$root/.e2e-scratch"
rm -rf "$scratch"
mkdir -p "$scratch"/{staging,intake,library,beets,data/downloader,data/importer}
cat > "$scratch/beets/config.yaml" <<YAML
directory: $scratch/library
library: $scratch/beets/library.db
YAML
export LIBRARY_ROOT="$scratch/library"
export STAGING_ROOT="$scratch/staging"
export INTAKE_ROOT="$scratch/intake"
export DOWNLOADER_DATABASE_FILE="$scratch/data/downloader/events.db"
export IMPORTER_DATABASE_FILE="$scratch/data/importer/events.db"
export BEETS_CONFIG="$scratch/beets/config.yaml"
export SLSKD_BASE_URL="http://127.0.0.1:9"
export SLSKD_API_KEY="e2e"
export MUSICBRAINZ_BASE_URL="http://127.0.0.1:9"
export MUSICBRAINZ_USER_AGENT="music-web-e2e/0.0"
export BRIDGE_SCRIPT="$root/../importer/src/adapters/beets/bridge/bridge.py"
export LOG_LEVEL=warn
# adapter-node blocks cross-origin form POSTs unless ORIGIN names the public URL.
export ORIGIN=http://localhost:4173
export PORT=4173
export HOST=127.0.0.1
pnpm build
# The adapter-node entry — the exact production process shape (init hook boots the daemon
# before the listener accepts work). `vite preview` is NOT equivalent: it re-bundles the SSR
# server and breaks on native CJS deps (better-sqlite3).
exec node build
