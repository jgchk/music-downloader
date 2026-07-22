## 1. Playwright config: harness-owned mode

- [x] 1.1 Branch `packages/web/playwright.config.ts` on `E2E_BASE_URL`: when set, omit `webServer` and set `use.baseURL` from the env; when unset, keep today's `serve.sh` `webServer` behavior byte-identical. Update the header comment: the local path is a dockerless developer convenience, not a CI gate; CI runs this suite inside the out-of-process tier.
- [x] 1.2 Update `packages/web/tests/serve.sh`'s header comment to state it serves local iteration only (no longer any CI job's boot path).

## 2. run.sh: parity phase against the image

- [x] 2.1 Add a parity phase to `test/e2e/run.sh` before the two vitest phases: `fresh_env`, `start_app` with `-e SLSKD_BASE_URL=http://127.0.0.1:9 -e MUSICBRAINZ_BASE_URL=http://127.0.0.1:9` (closed-port convention from `serve.sh`; docker takes the last `-e` occurrence), run `pnpm --dir packages/web exec playwright test` with `E2E_BASE_URL` exported, dump container logs on failure (mirroring `run_phase`), then remove the app container before phase 1.
- [x] 2.2 Verify locally: `pnpm test:e2e` runs all three phases green (build image, parity in a real browser against the container, full loop, restart), and the parity phase's cancel test observes `Cancelled` against the containered app.
- [x] 2.3 Verify the local convenience path still works standalone: `pnpm test:e2e:web` (no `E2E_BASE_URL`) boots via `serve.sh` and passes.

## 3. Pipeline: delete the web-e2e job

- [x] 3.1 In `.github/workflows/pipeline.yml`: delete the `web-e2e` job (including its beets-venv step), change the release job's `needs` to `[quality, test]`, and add a Chromium install step (`pnpm --dir packages/web exec playwright install --with-deps chromium`) to the release job after `pnpm install`, before the E2E gate.
- [x] 3.2 Update the pipeline header comment and the `test:e2e` gate step comment to reflect that the out-of-process gate now includes the browser parity phase.

## 4. Docs

- [x] 4.1 Update `test/e2e/README.md`: document the parity phase (what it covers, why it runs against closed-port third parties, its fail-fast position) and note the `serve.sh` path's demotion to local-only.

## 5. Gate

- [x] 5.1 `pnpm check` green (no production source touched; confirms format/lint over the edited configs and scripts).
