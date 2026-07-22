## Context

Two E2E tiers gate the release today, with different fidelity:

- The out-of-process tier (`test/e2e/run.sh`, spec `out-of-process-e2e`) runs the exact Docker image that publishes — both module runtimes, real beets in-image, WireMock stubs for slskd/MusicBrainz — driven over the web routes by a browserless vitest HTTP client. It runs inside the release job, after image build, before publish.
- The web-e2e tier (`web-e2e` job in `.github/workflows/pipeline.yml`) runs the Playwright parity smoke (`packages/web/tests/parity.spec.ts`) against a bespoke runner-local boot: Playwright's `webServer` invokes `packages/web/tests/serve.sh`, which `pnpm build`s and execs `node build` with scratch roots, a hand-made beets venv (`/tmp/beets-venv`, recreated by a dedicated CI step), and third-party base URLs pointed at a closed port (`127.0.0.1:9`) so acquisitions retry/park rather than fulfil.

The split is historical (merge-modular-monolith design D10 framed Playwright as the threshold-free sibling of the vitest coverage projects, not as image validation). Both jobs are post-merge-only and both gate only the release via the release job's `needs`, so the separation buys no gate-placement difference — only an unvalidated boot-path divergence and an extra CI job.

Constraint: the parity smoke's cancellation test depends on unreachable third parties — with slskd down, an acquisition stays in retry long enough for a user-shaped cancel. Against the WireMock stubs, unmatched requests yield 404s whose classification is deliberate, tuned behavior (v3.3.2/v3.3.3); the smoke must not couple to it.

## Goals / Non-Goals

**Goals:**

- Playwright drives the same built image the pipeline publishes, over a real socket — every release gate validates the shipped artifact.
- One place owns app lifecycle for all E2E phases: `test/e2e/run.sh`.
- Delete the `web-e2e` CI job and its beets-venv recreation step.
- Preserve the parity smoke's semantics unchanged (five tests, closed-port third parties).

**Non-Goals:**

- No new browser coverage or additional Playwright tests (the full loop remains the vitest phases' job).
- No change to the pre-merge gate, the merged 100%-coverage regime, or the vitest browser-mode projects.
- No cross-browser matrix (Chromium-only stands, per D10).
- No CI caching of Playwright browsers (accept the ~1 min install; optimize later if it hurts).
- `serve.sh` is not deleted or reworked beyond doc comments — it stays as the local dockerless loop.

## Decisions

### D1 — Parity becomes phase 0 of `run.sh`, with its own app run against unreachable third parties

`run.sh` gains a parity phase before the two vitest phases: `fresh_env`, then `start_app` with `SLSKD_BASE_URL`/`MUSICBRAINZ_BASE_URL` overridden to `http://127.0.0.1:9` (the `serve.sh` convention). Port 9 is on the WHATWG fetch bad-ports list, so undici refuses the request at the client before any network I/O — a deterministic fetch failure with zero dependence on what is or isn't listening. `start_app` appends caller args after its defaults and docker takes the last `-e` occurrence, so the override needs no harness surgery.

- *Why a separate app run, not the stubbed one:* the cancel test needs acquisitions to stay retrying/cancellable; pointing it at WireMock would couple the smoke to unmatched-request 404 classification — recently tuned, deliberately meaningful behavior (404 listing = empty collection). The bad-port refusal is a stable, client-side guarantee: semantically what the smoke was written against (every third-party call fails, acquisitions park/retry). Bonus: the tier now proves the image boots and serves while both third parties are unreachable.
- *Why phase 0:* fail fast — the browser smoke is the cheapest phase; a rendering-level breakage surfaces before the slower loop phases run. Stubs are started once before all phases as today; the parity app simply never talks to them.

### D2 — One Playwright config with an env branch, not a second config file

`packages/web/playwright.config.ts` branches on `E2E_BASE_URL`: when set, no `webServer` block and `use.baseURL = process.env.E2E_BASE_URL`; when unset, today's `webServer`/`serve.sh` local behavior. `run.sh` invokes `pnpm --dir packages/web exec playwright test` with `E2E_BASE_URL` exported (it already exports it for the vitest phases).

- *Why not `playwright.ci.config.ts`:* two configs drift; the delta is exactly one conditional. The env var is already the harness's lingua franca.

### D3 — Chromium installs in the release job; the `web-e2e` job is deleted

The release job gains `pnpm --dir packages/web exec playwright install --with-deps chromium` (same step the `test` job already runs for vitest browser mode), and `needs: [quality, test]`. The beets-venv step disappears with the job — the image's `/opt/beets-venv` is now the only beets environment CI exercises at e2e level, which is the point.

### D4 — `test:e2e:web` survives as a documented local convenience

The root script and `serve.sh` remain for dockerless UI iteration (fast rebuild, no image build). Header comments in `serve.sh` and the Playwright config state explicitly that this path is not a CI gate; `test/e2e/README.md` documents the parity phase as part of the tier.

## Risks / Trade-offs

- [Release critical path lengthens: Chromium install (~1 min) + parity phase serialize into the release job] → Accepted; five smoke tests are seconds, and the install can be cached later if it becomes the long pole.
- [Browser flake now reruns the whole release job, not a small parallel job] → Accepted at this suite size; the smoke has no timing-sensitive assertions beyond Playwright's auto-waiting, and the cancel window is held open by design (bad-port refusal ⇒ indefinite retry).
- [Local `pnpm test:e2e` now needs Playwright's Chromium] → Already a dev dependency of the web package (vitest browser mode uses the Playwright provider), so a working dev setup has it; `run.sh` fails with Playwright's own actionable install message otherwise.
- [Cancel-test timing against the real image: the retry loop must keep the acquisition cancellable long enough for the browser] → Same semantics the smoke has today against `node build` with the same closed-port env; the image adds no scheduling difference. If flake appears, the acquisition's backoff floor — not the test — is the knob.
- [`E2E_BASE_URL` branch makes the local config path conditional] → The branch is two expressions; local behavior is byte-identical when the var is unset.

## Migration Plan

Single PR, no data or deploy migration. Rollback = revert. Ordering within the change: config branch → `run.sh` phase → pipeline edit last, so at every commit the gate that exists is green (`web-e2e` job keeps passing until the commit that deletes it, by which point the parity phase already runs inside `test:e2e`).

## Open Questions

- None blocking.
