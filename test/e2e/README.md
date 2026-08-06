# Out-of-process E2E tier

A deterministic, gating end-to-end tier that drives the **real built Docker image** — both module
runtimes and the web interface in one process — over a real HTTP socket, with the reactors, the
cross-module subscription seam, and both on-disk SQLite event stores live. The outermost third
parties (slskd, MusicBrainz, plex.tv) are replaced by WireMock stubs in the loop phases (the
browser phase keeps slskd/MB unreachable and uses only the plex.tv stub for the login journey);
**real beets** runs inside the
image, pinned to the MusicBrainz stub (`musicbrainz.host` in the harness beets config), so nothing
here ever touches the internet.

## What it exercises

Six phases, each against a fresh environment (`test/e2e/run.sh` orchestrates; its header
comment is the authoritative phase list). The ones with non-obvious mechanics, in detail:

**Phase 0 — browser parity smoke** (`packages/web/tests/parity.spec.ts`, Playwright): a real
browser drives the image's web interface — navigation, submit, modeled rejection, user-shaped
cancel, empty review queue. This app run points the slskd and MusicBrainz base URLs at
**`127.0.0.1:9` instead of the stubs** (plex.tv points at its stub for the login journey) — port 9 is on the WHATWG fetch bad-ports list, so undici refuses it
deterministically at the client, a guaranteed fetch failure with zero network dependence. That
keeps acquisitions retrying (the cancel test's window stays open) without coupling the smoke to
WireMock's unmatched-request 404s, whose classification is deliberate adapter behavior — and it
proves the image boots and serves while both third parties are unreachable. It runs first to fail fast: browser-level breakage surfaces before
the slower loop phases. The same suite runs dockerless for local iteration via
`pnpm test:e2e:web` (`packages/web/tests/serve.sh` boots the adapter-node build); that path is a
developer convenience, not a CI gate.

**Phase 1 — the full product loop** (`full-loop.e2e.test.ts`):

```
POST /acquisitions/new  ──▶ resolve (MB stub) ──▶ search + rank (slskd stub)
    ──▶ download (slskd stub, stateful poll: in-progress → completed)
    ──▶ validate (REAL ffmpeg decode of a REAL tagged FLAC) ──▶ deposit (REAL filesystem)
    ──▶ status = Fulfilled (web UI)
    ──▶ SEAM: catch-up subscription hands off to the importer (durable checkpoint)
    ──▶ REAL beets propose (hint-pinned via the stub's ws/2 JSON) ──▶ auto-apply
    ──▶ ImportApplied in the importer's store; review queue provably empty (web UI)
```

The slskd stub _reports_ the completed download's location (`events.json` → `localFilename` under
the `options.json` downloads root); the harness seeds the fixture at exactly that reported
location — never at a path recomputed from the app's own logic — so a regression in the adapter's
event-based resolution fails the tier. Source-resource stewardship (search + transfer cleanup,
nothing else touched) is asserted from the stub's request journal.

**Phase 2 — restart resilience** (`restart.e2e.test.ts`): the container is killed after the
downloader commits fulfilment but before the importer can finish (`BRIDGE_PYTHON` points at a
wrapper that blocks propose/apply while a flag file exists — startup's `validate` verb passes
through), then restarted on the same volumes with the gate lifted. The import completes to
`ImportApplied` **exactly once**, driven purely by the durable stores and the subscription/reactor
checkpoints — no re-submission. This phase found (and now guards) a real bug: the reactors'
one-shot startup drain raced events appended mid-drain and had no fallback poll, so a
crash-resumed import stalled forever.

**Phase 5 — review-resolution revival loop** (`review-resolution.e2e.test.ts`): a seeded
fixture whose tags are calibrated to score in the **review band** (between the auto-apply
threshold and no-match) under the image's pinned beets forces a genuine human review; the
phase asserts the review actually queued (the calibration's loud premise guard — see
`fixtures/README.md`), resolves it as `reject-unusable-delivery` over the same HTTP form a
browser posts (with a **guest** session — resolution needs no privilege), witnesses the
rejection delete the delivered files, then watches the verdict cross the store seam: the
downloader revives the hunt without a new submission, a second stubbed candidate delivers,
real beets auto-applies it, and the acquisition ends `In your library`. The second candidate
rides ad-hoc stateful WireMock mappings registered by the phase itself (the on-disk stubs
stay untouched).

## How it works

- `run.sh` — builds (or reuses via `E2E_SKIP_BUILD=1`) `music-downloader:e2e`, runs it plus three
  WireMock containers **on the host network** (no docker network creation → no NAT kernel-module
  dependency; localhost is the same everywhere), and documents the full mount/path topology in
  its header comment. Notably `LIBRARY_ROOT` (the downloader's deposit root) and `INTAKE_ROOT`
  are the same directory, exercising `INTAKE_SOURCE_ROOT`'s default (= `LIBRARY_ROOT`) as an
  identity re-root.
- `helpers.ts` — a browserless HTTP client over the same web routes the UI serves (form-encoded
  actions, HTML parsed via the components' `data-testid` markers) plus read-only host-side peeks
  into the two mounted SQLite stores.
- `stubs/{musicbrainz,slskd}/mappings/*.json` — WireMock mappings. The slskd transfer poll is a
  scenario state machine (in-progress → completed) exercising the real polling loop;
  `beets-release-ws2.json` serves the MusicBrainz **ws/2 JSON** release that beets' matcher
  fetches for the hint-pinned candidate (distance 0.0 against the tagged fixture).
- `fixtures/track.flac` — a real 10s FLAC tagged to match the stubbed release exactly; its
  sibling `track-review-band.flac` deviates just enough to force a human review
  (calibration provenance in `fixtures/README.md`).

## Running it

```sh
pnpm test:e2e        # builds the image, runs all six phases, tears everything down
```

In CI (`.github/workflows/pipeline.yml` release job) it runs after the image build and before
publish, gating the push: the image is built and loaded as `music-downloader:e2e`, and the tier
runs with `E2E_SKIP_BUILD=1`.

This tier is deliberately **separate from the unit run** and its 100% coverage gate (own vitest
config; verified by execution). The stub payloads for the downloader-facing endpoints are
contract-validated against the adapter schemas by `packages/downloader/test/contract`; the
beets-facing ws/2 mapping is validated by beets itself (an unparsable payload yields zero
candidates and fails the tier).

## Caveats

- Stub fidelity for the beets-facing ws/2 payload is guarded only by this tier (see above), and
  live third-party drift is the weekly contract-drift workflow's job, not this tier's.
- `AUTO_APPLY_THRESHOLD=0.15` (vs the 0.04 default) derisks flakiness; the pinned candidate's
  distance is 0.0, so the margin is safety, not leniency.
