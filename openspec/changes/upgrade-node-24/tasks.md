## 1. Resolve target version

- [x] 1.1 Look up the latest Node.js 24.x LTS patch release; record the exact `major.minor.patch` (used everywhere below as `<24.x.y>`) — **24.18.0**
- [x] 1.2 Confirm the current major of each GitHub Action in use (`actions/checkout`, `actions/setup-node`, `pnpm/action-setup`, `docker/setup-buildx-action`, `docker/login-action`, `docker/metadata-action`, `docker/build-push-action`) and note the newest major targeting the node24 Actions runtime — checkout/setup-node/pnpm-setup **@v6**; setup-buildx/login **@v4**; metadata **@v6**; build-push **@v7**

## 2. Layer 1 — project runtime bump

- [x] 2.1 Set `.nvmrc` to the exact `<24.x.y>` (exact pin per design D2) — `24.18.0`
- [x] 2.2 Set `engines.node` in `package.json` to the floor range `>=24.0.0` (per design D2)
- [x] 2.3 Bump `@types/node` devDependency to `^24.0.0` — resolves to 24.13.2
- [x] 2.4 Update both `Dockerfile` stages (`builder`, `runtime`) from `node:20-slim` to the exact `node:<24.x.y>-slim` (per design D3) — `node:24.18.0-slim`
- [x] 2.5 Refresh `pnpm-lock.yaml` (`pnpm install`), ensuring native deps (better-sqlite3, etc.) resolve/rebuild against Node 24
- [x] 2.6 Grep the repo for any remaining `20`-based Node references (docs, comments, scripts) and update or leave a deliberate note — none found; README already references `.nvmrc` (single-source-of-truth, no hardcoded number)

## 3. Layer 2 — GitHub Actions runtime bump

- [x] 3.1 Bump `actions/checkout`, `actions/setup-node`, and `pnpm/action-setup` to their node24-runtime majors in `ci.yml` and `cd.yml` — all `@v6`
- [x] 3.2 Bump the `docker/*` actions to current majors in `cd.yml` — buildx/login `@v4`, metadata `@v6`, build-push `@v7`
- [x] 3.3 Review each bumped action's changelog for breaking input/option changes and adjust the workflow `with:` blocks as needed — no changes needed; pnpm-before-setup-node ordering preserved, pnpm version via `packageManager`, all `with:` inputs stable across majors

## 4. Sustainability — automated bumping

- [x] 4.1 Add update-automation config (per design D4) — **self-hosted Renovate** (`renovate.json` + `.github/workflows/renovate.yml`, `renovatebot/github-action@v46`), chosen over Dependabot because Dependabot has no `.nvmrc` manager and the hosted Renovate app adds a third-party to the trust boundary
- [x] 4.2 Confirm the config would propose bumps for the pinned Node version, the Docker base image, and action versions — Renovate `nvm` manager covers `.nvmrc`, `dockerfile` covers the base image (grouped with `.nvmrc` as one "node runtime" PR), `github-actions` covers action versions, `npm` covers `@types/node`. **Operational follow-up:** repo owner must add a `RENOVATE_TOKEN` secret (PAT with `repo`+`workflow` scopes, or App token) before the workflow is live

## 5. Verify — zero behavioral drift on Node 24

- [x] 5.1 Run the quality gate on Node 24: `pnpm run format`, `lint`, `typecheck`, `build` — all green (via `fnm exec --using 24.18.0`)
- [x] 5.2 Run the full suite at 100% coverage on Node 24: `pnpm run test:cov` — **336/336 pass, 100% coverage**. Note: required `pnpm rebuild better-sqlite3` locally after the Node switch (native ABI); CI/Docker install fresh so are unaffected
- [x] 5.3 Build the image and run the out-of-process Docker E2E against `node:24.18.0-slim` — **passes unchanged** (better-sqlite3 built for Node 24 inside the container, real ffmpeg + import over HTTP)
- [ ] 5.4 Push the branch and confirm CI/CD is green and emits **no** Node runtime deprecation warnings (validates the runtime-baseline spec)

## 6. Wrap up

- [x] 6.1 Update any docs that state the Node version (e.g. `docs/development/twelve-factor.md` dev/prod-parity notes, README/stack lists) to Node 24 — **no-op**: no doc hardcodes a version; README already points to `.nvmrc` (single source of truth), twelve-factor parity note is version-agnostic
- [ ] 6.2 Commit with a conventional message and open the PR; archive the change once merged
