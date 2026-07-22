## Why

The Playwright web-e2e tier is the one release gate that does not validate the artifact we ship: it builds the app on the CI runner and boots `node build` directly via a bespoke harness (`packages/web/tests/serve.sh`), with its own scratch env, a hand-built beets venv at `/tmp/beets-venv`, and `BRIDGE_PYTHON` wiring that diverges from the image's `/opt/beets-venv`. Our E2E tiers exist as final validation of the produced Docker image; the browser tier should be no exception. Collapsing it into the out-of-process E2E stage makes Playwright drive the exact image that publishes, removes a parallel-universe boot path, and deletes a CI job plus its venv-recreation step.

## What Changes

- The Playwright parity smoke moves into the out-of-process E2E tier (`test/e2e/run.sh`) as an additional phase, driving the real built Docker image over its published port instead of a runner-local `node build`.
- The parity phase gets its own app run with third-party base URLs pointed at a closed port — preserving the smoke's semantics (unreachable slskd keeps acquisitions retrying, so the cancel path stays open) and additionally proving the image boots and serves while third parties are down.
- A CI Playwright entry point is added that does not own app startup (no `webServer`), taking its base URL from the harness environment; `run.sh` owns container lifecycle for all phases.
- The `web-e2e` job and its beets-venv setup step are removed from `.github/workflows/pipeline.yml`; the release job installs Chromium and runs the browser phase inside the existing E2E gate.
- `pnpm test:e2e:web` (the `serve.sh` path) is kept as the local, dockerless UI iteration loop — a developer convenience, no longer a CI gate.
- Accepted trade-off: the release job's critical path lengthens slightly (Chromium install + browser phase serialize into it), and a browser flake now reruns the whole release job rather than a small parallel one.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `out-of-process-e2e`: gains a requirement that the tier includes a real-browser interface phase against the same built image, including an app run with unreachable third parties proving degraded boot and user-shaped cancellation.
- `web-ui`: the coverage-gate requirement's Playwright clause changes — Playwright e2e remains threshold-free but runs as a phase of the out-of-process E2E tier against the built image, not as a separate CI job over a bespoke local boot.

## Impact

- `.github/workflows/pipeline.yml` — `web-e2e` job deleted; release job gains a Chromium install step; `needs` list shrinks.
- `test/e2e/run.sh` — third phase (parity) with a closed-port third-party app run; invokes Playwright instead of vitest for that phase.
- `packages/web/playwright.config.ts` (or a sibling CI config) — a no-`webServer` mode with `baseURL` from the harness env.
- `packages/web/tests/serve.sh` + root `test:e2e:web` script — retained for local iteration; docs updated to state it is not a gate.
- `test/e2e/README.md` — documents the new phase.
- No production source changes; no facade or event-store contracts touched.
