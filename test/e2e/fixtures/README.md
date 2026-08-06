# E2E fixtures — provenance

Both fixtures are scored by the **image's pinned beets** against the one release the
MusicBrainz stub serves (`stubs/musicbrainz/mappings/beets-release-ws2.json`: Test Artist /
Test Album, one 10 s track "Track One", 2020). The distances below are **measured, not
estimated** — re-measure whenever the beets pin moves (the review-resolution phase's explicit
review-queued assertion fails loudly when this calibration drifts; that failure points here).

| fixture                  | role                             | tags vs. the stubbed release                        | measured distance |
| ------------------------ | -------------------------------- | --------------------------------------------------- | ----------------- |
| `track.flac`             | clean match (auto-apply)         | identical                                           | 0.0000            |
| `track-review-band.flac` | review-band match (human review) | album `Basement Sessions`, title `Track One (Live)` | 0.3028            |

Calibration provenance: **beets 2.12.0** (the image's `requirements.txt` pin), measured through
the production bridge's `propose` verb with the hint pinned to the stub release, exactly as the
importer invokes it. The harness runs `AUTO_APPLY_THRESHOLD=0.15`; the review band is
`distance > 0.15` (a hinted candidate is returned at any distance, so tag deviation cannot
overshoot into no-match — the calibration risk is only *under*shooting below the threshold).
`0.3028` sits at a comfortable margin above the band's edge.

## The deviation recipe (why these tags)

- **Album title fully different** (`Basement Sessions`) — the dominant, robust lever
  (~0.29 of the distance). beets discounts parenthetical suffixes like "(Bootleg)" as likely
  variants of the same album, so the album title must differ in substance, not decoration.
- **Track title variant** (`Track One (Live)`) — a small contribution (~0.01); kept so the
  fixture reads as a genuine wrong-edition file, not a renamed album.
- **The audio stream is bit-identical to `track.flac` — deliberately.** The deviation must be
  invisible to the DOWNLOADER and weak only to BEETS: the download validator compares the
  ffmpeg-probed duration against the candidate metadata the search stub reported, so a
  duration nudge fails validation (`DurationMismatch`) before beets ever scores the file.
  Tags only — never touch the audio.
- Artist is deliberately identical: the fixture models the realistic weak match ("right
  artist, wrong release"), and the album mismatch alone already clears the band.

## Regenerating / recalibrating

Regenerate the review-band fixture from the clean one (stream copy — tags only):

```sh
ffmpeg -i track.flac -c:a copy \
  -metadata album="Basement Sessions" -metadata title="Track One (Live)" \
  track-review-band.flac
```

Re-measure a fixture's distance against a candidate beets pin (WireMock MB stub on :8091,
the bridge run exactly as the image runs it):

```sh
docker run -d --name calib-mb --network host \
  -v "$(pwd)/../stubs/musicbrainz:/home/wiremock" wiremock/wiremock:3.13.2 \
  --port 8091 --disable-banner
# beets config: musicbrainz.host: localhost:8091, https: no; then:
docker run --rm --network host -v <dir-with-fixture>:/calib -v <beets-config>:/calib/config.yaml \
  --entrypoint /opt/beets-venv/bin/python3 music-downloader:e2e \
  /opt/beets-bridge/bridge.py --config /calib/config.yaml propose /calib \
  --search-id 6e29d5f7-4b0f-4b62-8862-1c62ae2a1eb1
```

The emitted proposal JSON carries `candidates[].distance` — the number in the table above.
