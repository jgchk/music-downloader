# syntax=docker/dockerfile:1

# --- Builder: install all deps (incl. native better-sqlite3 build) and compile TypeScript --------
FROM node:20-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# Toolchain for native modules (better-sqlite3) that lack a prebuild for this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm run build

# Drop dev dependencies, keeping the compiled native addon.
RUN pnpm prune --prod

# --- Runtime: Node + ffmpeg (a declared OS-level dependency, D5) baked in -------------------------
FROM node:20-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Config is supplied entirely via the environment (12-factor); LIBRARY_ROOT and STAGING_ROOT are
# required. The HTTP API listens on HTTP_PORT (default 3000).
EXPOSE 3000
USER node
CMD ["node", "dist/composition/index.js"]
