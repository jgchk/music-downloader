# syntax=docker/dockerfile:1

# --- Builder: install the workspace (incl. native better-sqlite3 build) and build the web app ----
# The product ships as ONE image: the SvelteKit adapter-node build whose init hook boots both
# module runtimes (packages/web bundles the workspace TS sources; better-sqlite3 and pino stay
# external and are served from packages/web/node_modules at runtime).
FROM node:24.18.0-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
RUN corepack enable
WORKDIR /app

# Toolchain for native modules (better-sqlite3) that lack a prebuild for this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# pnpm-workspace.yaml carries the pnpm 11 `allowBuilds` setting that permits better-sqlite3's native
# build; without it the install skips the native addon and the runtime image is broken.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/downloader/package.json packages/downloader/package.json
COPY packages/importer/package.json packages/importer/package.json
COPY packages/web/package.json packages/web/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --dir packages/web run build

# Drop dev dependencies: `pnpm prune --prod` cannot relink workspace importers (it leaves the
# package node_modules empty), so reinstall prod-only from the same lockfile — the builder's
# toolchain re-runs the allowed native builds (better-sqlite3).
RUN rm -rf node_modules packages/downloader/node_modules packages/importer/node_modules packages/web/node_modules \
  && pnpm install --prod --frozen-lockfile

# --- Runtime: Node + both modules' OS-level dependencies ------------------------------------------
# ffmpeg serves the downloader's audio probe; python3 runs the stateless beets bridge; the venv
# pins beets at the contract-tested version (packages/importer/src/adapters/beets/bridge/
# requirements.txt); fpcalc (libchromaprint-tools), oggz-tools and opus-tools let the user's beets
# plugin chain run unmodified.
FROM node:24.18.0-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 python3-venv ffmpeg libchromaprint-tools oggz-tools opus-tools \
  && rm -rf /var/lib/apt/lists/*

COPY packages/importer/src/adapters/beets/bridge/requirements.txt /opt/beets-bridge/requirements.txt
RUN python3 -m venv /opt/beets-venv \
  && /opt/beets-venv/bin/pip install --no-cache-dir --requirement /opt/beets-bridge/requirements.txt
COPY packages/importer/src/adapters/beets/bridge/bridge.py /opt/beets-bridge/bridge.py

ENV NODE_ENV=production
# The pinned interpreter + bridge script the importer's bridge adapter spawns (overridable,
# 12-factor). BRIDGE_SCRIPT must point at a real file in bundled deployments — the in-package
# default does not survive the SvelteKit server bundle's relocation.
ENV BRIDGE_PYTHON=/opt/beets-venv/bin/python3
ENV BRIDGE_SCRIPT=/opt/beets-bridge/bridge.py
WORKDIR /app

# The workspace layout is preserved: the adapter-node bundle resolves its externalized deps
# (better-sqlite3, pino, zod, neverthrow) by walking up from packages/web/build into
# packages/web/node_modules -> the root .pnpm store.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/web/node_modules ./packages/web/node_modules
COPY --from=builder /app/packages/web/build ./packages/web/build
COPY package.json ./package.json
COPY packages/web/package.json ./packages/web/package.json

# Config is supplied entirely via the environment (12-factor) — see .env.example for the full
# surface. Mount volumes for the two event stores (DOWNLOADER_DATABASE_FILE,
# IMPORTER_DATABASE_FILE), the shared music roots (STAGING_ROOT/INTAKE_ROOT, LIBRARY_ROOT), and
# the beets config + library (BEETS_CONFIG). The web interface listens on PORT (default 3000).
EXPOSE 3000
USER node
CMD ["node", "packages/web/build"]
