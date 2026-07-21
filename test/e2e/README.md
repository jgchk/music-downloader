# Out-of-process E2E tier

A deterministic, gating end-to-end tier that drives the **real built Docker image** over a real
HTTP socket, with the reactor and on-disk SQLite live, and only the two outermost third parties
(slskd + MusicBrainz) replaced by HTTP stubs. It is the first coverage of the whole outer shell —
the composition root, config load, real socket, the real slskd/MusicBrainz/ffmpeg/filesystem
adapters, and the on-disk store — which the in-process subcutaneous tier (`src/composition/e2e.test.ts`)
fakes at the port level.

## What it exercises

One happy-path acquisition, submitted over HTTP, driven by the reactor through the full cascade:

```
POST /api/v1/acquisitions  ──▶  resolve (MusicBrainz stub) ──▶ search + rank (slskd stub)
    ──▶ download (slskd stub, stateful poll: in-progress → completed)
    ──▶ validate (REAL ffmpeg decode + ffprobe of a REAL .flac)
    ──▶ import (REAL filesystem move)  ──▶  status = Fulfilled
```

Real bytes flow end to end: the download adapter reports the file at its computed staging path, so
the harness seeds a real 10s FLAC (`fixtures/track.flac`) there — which means the real ffmpeg probe
and the real library import both run on real audio. Three adapters get their first end-to-end
coverage in one test (slskd, ffmpeg, filesystem).

## How it works

- `docker-compose.test.yml` — `app` (the real `music-downloader:e2e` image), `mb-stub`, `slskd-stub`
  (WireMock). The app's `SLSKD_BASE_URL` / `MUSICBRAINZ_BASE_URL` point at the stubs; `./.e2e-tmp`
  is bind-mounted as `/data` (staging, library, and the SQLite file), shared with the host runner.
- `stubs/{musicbrainz,slskd}/mappings/*.json` — WireMock mappings. The slskd transfer-poll endpoint
  is a **scenario state machine** (`Started → Completed`): the first poll returns "in progress", the
  next returns "completed", exercising the adapter's real polling loop deterministically.
- `acquisition.e2e.test.ts` — runs on the **host**, drives `app` over `localhost:3000`, and seeds the
  fixture using the app's own `candidateStagingDir` so the path can't drift from production.

## Running it

```sh
pnpm test:e2e        # builds the image, brings the stack up, runs the suite, tears down
```

Point the suite at any already-running instance instead:

```sh
TARGET_BASE_URL=http://host:3000 E2E_DATA_DIR=/shared/data \
  pnpm exec vitest run --config test/e2e/vitest.config.ts
```

In CI (`.github/workflows/cd.yml`) it runs **after the image build and before publish**, gating the
push: the image is built and loaded as `music-downloader:e2e`, the suite runs with
`E2E_SKIP_BUILD=1`, and publish only happens if it passes.

This tier is intentionally **separate from the unit run** (`test/e2e/vitest.config.ts`, and excluded
from eslint/tsconfig): it is verified by execution, not by the 100% unit-coverage gate.

## Caveats — what this tier does NOT cover

- **Stub fidelity.** The stubs are only as faithful as we make them; drift from the real slskd /
  MusicBrainz wire format would yield false green. This is now guarded on two sides by the contract
  tier (`test/contract/`, see its README): the contract test suite validates every stub `jsonBody`
  here against the same schemas the adapters enforce, so a stub can't drift from the contract; and a
  weekly drift workflow validates the contract against the live services. This tier still verifies
  _our_ composition end to end against a fixed contract, not the third parties' live behaviour —
  that live check lives in the contract tier's tier 2.
- **MCP.** The MCP interface is stdio-only and is covered by the in-process subcutaneous tier, not
  here. Out-of-process MCP would require a self-contained spawned instance and a logger-to-stderr
  change; it is out of scope for this tier.
