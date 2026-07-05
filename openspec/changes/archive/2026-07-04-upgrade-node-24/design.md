## Context

Every runtime surface in this repo pins Node 20 today, consistently:

| Surface | Value | File |
|---|---|---|
| Version manager | `20.19.6` | `.nvmrc` |
| Engine constraint | `>=20.19.0` | `package.json` |
| Type definitions | `^20.19.0` | `package.json` (devDeps) |
| Docker builder + runtime | `node:20-slim` | `Dockerfile` (2 stages) |
| CI / CD Node | `node-version-file: .nvmrc` | `ci.yml`, `cd.yml` (×4 jobs) |

Two independent facts force a move:

1. **Node 20 is end-of-life (2026-04-30).** The shipped `node:20-slim` image runs on an unsupported runtime with no future security patches. Node 24 is the current Active LTS, supported through 2028; Node 22 is Maintenance LTS.
2. **The GitHub Actions Node 20 runtime is deprecated.** Runners default to Node 24 as of 2026-06-16; first-party actions migrate in fall 2026. Warnings fire off each action's *declared* runtime, independent of the project's `.nvmrc`.

The critical framing is that these are **two separate layers**:

```
LAYER 1 — the runtime YOUR code runs on
  controlled by: .nvmrc / engines / Dockerfile / @types/node
  → the EOL/security concern; what ships in the image

LAYER 2 — the runtime GitHub's ACTIONS run on
  controlled by: each action's own manifest (runs.using)
  e.g. actions/checkout@v4 declares node20
  → the source of the CI deprecation WARNINGS
```

Bumping `.nvmrc` to 24 does **not** silence the Layer 2 warnings, and bumping the actions does **not** modernize the shipped runtime. Both are needed; they're addressed separately.

## Goals / Non-Goals

**Goals:**

- Move the pinned project runtime (Layer 1) from Node 20 to Node 24 across `.nvmrc`, `engines`, `Dockerfile`, and `@types/node`.
- Bump GitHub Actions (Layer 2) to majors targeting the Node 24 Actions runtime, clearing deprecation warnings.
- Establish a deliberate, documented pinning policy (exact vs range) and make it sustainable with automated bumps.
- Prove zero behavioral drift: quality gate, 100% coverage, ffmpeg adapter tests, and the out-of-process Docker E2E all green on 24.

**Non-Goals:**

- No application source changes. If a Node 20→24 platform delta forces a code change, that is a discovered defect handled on its own, not planned scope.
- No adoption of Node 25/26 (non-LTS / bleeding-edge Current). LTS only.
- No change to public API contracts, the OpenAPI snapshot, or any behavioral capability spec.
- No move off `node:*-slim` base variants (e.g. to distroless/alpine) — out of scope.

## Decisions

### D1 — Target Node 24 (Active LTS), not 22

24 is the current Active LTS (supported to 2028) vs 22's Maintenance LTS (to 2027). For a pre-implementation greenfield app carrying no legacy runtime constraints, the longer-supported line is the obvious pick — it maximizes the window before the next forced bump. **Alternative (22):** rejected — shorter runway, no offsetting benefit here.

### D2 — Pin `.nvmrc` exactly; floor `engines`

The two files answer different questions, so they get different policies:

- **`.nvmrc` → exact `24.<minor>.<patch>`** — this is a lockfile for the runtime, our most impactful dependency. Exactness buys byte-identical CI/local runs, kills "works on my machine" patch drift, and makes every bump a reviewable commit with an audit trail. **Alternative (bare `24`):** rejected — a new upstream patch would silently change CI overnight and a bad patch could break the build with no code change. There is no principled reason to lock every npm dep in `pnpm-lock.yaml` and then let the runtime float.
- **`engines.node` → floor `>=24.0.0`** — this is a support *declaration*, not an installer (it's advisory unless `engine-strict` is set). A floor states "24 is our minimum" without falsely rejecting a contributor on a newer 24 patch. **Alternative (`>=24 <25`):** viable if we want `engines` to mean *exactly* what CI proves, but it costs a bump every major; rejected for a non-library app whose `engines` no external consumer reads.

This split is exactly the existing convention (`.nvmrc` was already exact, `engines` a floor) — this change makes it deliberate rather than incidental.

### D3 — Pin the Docker base image to an exact tag

The `Dockerfile` currently uses `node:20-slim` (major-only), which contradicts the exact `.nvmrc` — the image's patch level floats at build time while CI's doesn't. Move both stages to an exact `node:24.<minor>.<patch>-slim` so the shipped runtime matches the validated one. **Alternative (digest pin `@sha256:…`):** the only way to get truly bit-reproducible images, but heavier to maintain by hand; deferred to the update automation (D4), which can maintain a digest pin if we later want one. Exact tag is the pragmatic baseline.

### D4 — Add automated runtime bumping (Renovate or Dependabot)

Exact pinning is only sustainable if something proposes the bumps — otherwise pins rot and miss security patches. Configure update automation to watch the pinned Node version, the Docker base image, and GitHub Actions versions, opening PRs that CI validates before merge. This converts "I forgot to patch" into "a bot proposes, CI proves, human merges" — the same bargain we already accept for `pnpm-lock.yaml`.

**Choice: self-hosted Renovate, run as a GitHub Action** (`.github/workflows/renovate.yml` + `renovate.json`). Rationale, decided during implementation:

- Dependabot has **no manager for `.nvmrc`** — it would cover the Docker base image, actions, and `@types/node`, but leave the exact Node pin (`.nvmrc`) to manual bumps, failing the `runtime-baseline` requirement that automation propose the pinned-Node-version bump. Renovate's `nvm` manager covers `.nvmrc` natively.
- The **hosted** Renovate app was rejected: it puts a third-party (Mend) GitHub App with write access inside the trust boundary — an unnecessary supply-chain surface for this security-minded project. Self-hosting via the `renovatebot/github-action` keeps Renovate in our own CI, authenticated with a token we control, with no third-party app.
- Cost is zero either way (Renovate is free, self-hosted or hosted); the tradeoff we accept is owning the workflow (pinning the action, managing the token, setting the cron) instead of it being fully managed.
- `renovate.json` groups the `.nvmrc` + Dockerfile `node` updates into one "node runtime" PR, so the exact pin and the base image move in lockstep — directly serving the dev/prod-parity requirement.

**Token requirement:** because Renovate edits files under `.github/workflows/`, the default `GITHUB_TOKEN` is insufficient. Setup needs a repo secret `RENOVATE_TOKEN` — a classic PAT with `repo` + `workflow` scopes, or a GitHub App token with Contents/Pull-requests/Workflows write. This is a one-time manual step outside the repo.

### D5 — Bump actions to node24-runtime majors (Layer 2), separately

Update `actions/checkout`, `actions/setup-node`, `pnpm/action-setup`, and the `docker/*` actions to their latest majors, which declare the Node 24 Actions runtime. This is the *only* thing that clears the deprecation warnings — tracked as distinct tasks from the Layer 1 bump so the two-layer distinction stays legible and either can be verified independently.

## Risks / Trade-offs

- **Node 20→24 platform delta breaks a dependency (ffmpeg probe / better-sqlite3 native binding / Fastify).** → The test pyramid runs on 24 before anything ships; native modules rebuild against 24 during `pnpm install`. The out-of-process E2E exercises real ffmpeg + on-disk SQLite in the actual image, so a native-ABI break surfaces before publish, not in production.
- **Exact `.nvmrc` pin goes stale / misses a security patch.** → D4 automation opens bump PRs; the exact pin is a feature (deliberate, reviewed bumps), not a liability, once automation is in place.
- **Action major bump introduces a breaking input change** (e.g. `setup-node` option rename). → Bump and read each action's changelog per task; the CI run on the change branch validates the whole pipeline before merge.
- **Warnings persist despite bumps** due to a known runner bug where the end-of-job warning fires off an action's declared version even when forced to node24. → Mitigated by bumping to majors that *actually* declare node24 (not by env-forcing); if a transitive/first-party action still declares node20, note it as upstream-blocked rather than chasing it.
- **`node:24.x-slim` exact tag still gets rebuilt upstream** (not bit-reproducible). → Accepted for the baseline; D4 can escalate to a digest pin if reproducibility becomes a requirement.

## Migration Plan

1. Layer 1: bump `.nvmrc`, `engines`, `@types/node`, `Dockerfile`; refresh `pnpm-lock.yaml`.
2. Layer 2: bump GitHub Actions majors.
3. Add update automation config (D4).
4. Verify on 24: quality gate → coverage → E2E (see tasks).
5. **Rollback:** the change is config-only and lands on a feature branch behind CI + the E2E publish gate. If 24 fails verification, revert the branch — nothing is published until the gate is green, so there is no production exposure to roll back.

## Open Questions

- ~~**Renovate vs Dependabot**~~ — RESOLVED (D4): self-hosted Renovate as a GitHub Action, because Dependabot cannot bump `.nvmrc` and the hosted app adds a third-party to the trust boundary.
- ~~**Exact minor/patch to pin**~~ — RESOLVED: Node **24.18.0** (latest 24.x LTS at implementation, 2026-06-23).
- **`RENOVATE_TOKEN` provisioning** — the self-hosted workflow is inert until the repo owner creates the PAT/App token (with `workflow` scope) and adds it as a secret. Tracked as an operational follow-up, not a code task.
