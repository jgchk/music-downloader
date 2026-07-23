#!/usr/bin/env bash
# Record the beets-bridge contract fixtures against the pinned beets version.
#
# Run this manually whenever the pin in src/adapters/beets/bridge/requirements.txt changes (a
# deliberate upgrade event) and commit the refreshed JSON under test/contract/fixtures/. It needs:
#   • python3 (a hermetic venv is created at test/contract/.venv, gitignored)
#   • ffmpeg on the PATH (generates the tiny fixture library)
#   • network access to musicbrainz.org (the matcher fixtures pin a real, stable release)
#
# The fixture release: The Beatles — "Love Me Do" single (1988, MBID
# 22c9f6a3-0569-4c59-b551-cb4a26b0bc3f), chosen for its two short, duration-annotated tracks.
set -euo pipefail
cd "$(dirname "$0")"

VENV=.venv
REQ=../../src/adapters/beets/bridge/requirements.txt
BRIDGE=../../src/adapters/beets/bridge/bridge.py
FIXTURES=fixtures/beets-bridge
MBID=22c9f6a3-0569-4c59-b551-cb4a26b0bc3f

if [[ ! -x "$VENV/bin/python" ]]; then
  python3 -m venv "$VENV"
fi
"$VENV/bin/pip" install --quiet --requirement "$REQ"
PY="$VENV/bin/python"
BEETS_VERSION="$("$PY" -c 'import beets; print(beets.__version__)')"
CAPTURED_AT="$(date -u +%F)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/beets" "$WORK/library" "$WORK/intake/love-me-do" "$WORK/intake/weak" "$WORK/intake/mystery" "$WORK/intake/diff" "$WORK/intake/missing" "$WORK/intake/empty"
cat > "$WORK/beets/config.yaml" <<EOF
directory: $WORK/library
library: $WORK/beets/library.db
import:
  move: yes
plugins: [musicbrainz]
EOF
BAD_CONF="$WORK/beets/bad-config.yaml"
sed "s#directory: $WORK/library#directory: $WORK/nonexistent#" "$WORK/beets/config.yaml" > "$BAD_CONF"

gen() { # gen <path> <seconds> <artist> <album> <title> <track>
  ffmpeg -v error -f lavfi -i "anullsrc=r=22050:cl=mono" -t "$2" -b:a 32k \
    -metadata artist="$3" -metadata albumartist="$3" -metadata album="$4" \
    -metadata title="$5" -metadata track="$6/2" -metadata date=1988 -y "$1"
}
gen "$WORK/intake/love-me-do/01 Love Me Do.mp3"      143 "The Beatles" "Love Me Do" "Love Me Do"      1
gen "$WORK/intake/love-me-do/02 P.S. I Love You.mp3" 123 "The Beatles" "Love Me Do" "P.S. I Love You" 2
# Weak match: right release, but one track is a 30-second stub (a big duration penalty).
gen "$WORK/intake/weak/01 Love Me Do.mp3"      30  "The Beatles" "Love Me Do" "Love Me Do"      1
gen "$WORK/intake/weak/02 P.S. I Love You.mp3" 123 "The Beatles" "Love Me Do" "P.S. I Love You" 2
# No-match: an album MusicBrainz will never know.
gen "$WORK/intake/mystery/01 Jam One.mp3" 61 "Unknown Homie xq77" "Basement Tape zz93" "Jam One" 1
gen "$WORK/intake/mystery/02 Jam Two.mp3" 59 "Unknown Homie xq77" "Basement Tape zz93" "Jam Two" 2
# Diff detail: the right release, but track 1 is mis-titled (a retag) and a third file matches no
# track at all (an unmatched extra) — a candidate carrying a retag and an extra file.
gen "$WORK/intake/diff/01 Luv Me Do.mp3"      143 "The Beatles" "Love Me Do" "Luv Me Do"      1
gen "$WORK/intake/diff/02 P.S. I Love You.mp3" 123 "The Beatles" "Love Me Do" "P.S. I Love You" 2
gen "$WORK/intake/diff/99 Bonus Beatz.mp3"    77  "The Beatles" "Love Me Do" "Bonus Beatz"     9
# Missing track: only one file for the two-track release, so the second track is missing (no file).
gen "$WORK/intake/missing/01 Love Me Do.mp3"  143 "The Beatles" "Love Me Do" "Love Me Do"      1

mkdir -p "$FIXTURES"
record() { # record <name> <verb> [bridge args...]
  local name="$1" verb="$2"
  shift 2
  "$PY" "$BRIDGE" "$@" > "$WORK/out.json"
  NAME="$name" VERB="$verb" BEETS_VERSION="$BEETS_VERSION" CAPTURED_AT="$CAPTURED_AT" \
    MBID="$MBID" OUT="$WORK/out.json" "$PY" - <<'PYEOF' > "$FIXTURES/$name.json"
import json, os, sys
with open(os.environ["OUT"]) as handle:
    output = json.load(handle)
json.dump({
    "provenance": {
        "beets": os.environ["BEETS_VERSION"],
        "capturedAt": os.environ["CAPTURED_AT"],
        "recorder": "test/contract/record-bridge-fixtures.sh",
        "release": os.environ["MBID"],
    },
    "verb": os.environ["VERB"],
    "name": os.environ["NAME"],
    "output": output,
}, sys.stdout, indent=2, sort_keys=True)
print()
PYEOF
  echo "recorded $name"
}

CONF=(--config "$WORK/beets/config.yaml")

record validate-valid              validate "${CONF[@]}" validate
record validate-invalid-directory  validate --config "$BAD_CONF" validate

record propose-pinned-strong  propose "${CONF[@]}" propose "$WORK/intake/love-me-do" --search-id "$MBID"
record propose-weak-durations propose "${CONF[@]}" propose "$WORK/intake/weak" --search-id "$MBID"
record propose-free-search-weak propose "${CONF[@]}" propose "$WORK/intake/mystery"
record propose-diff-detail    propose "${CONF[@]}" propose "$WORK/intake/diff" --search-id "$MBID"
record propose-missing-track  propose "${CONF[@]}" propose "$WORK/intake/missing" --search-id "$MBID"
record propose-doomed-missing-directory propose "${CONF[@]}" propose "$WORK/never-existed"
record propose-doomed-no-audio          propose "${CONF[@]}" propose "$WORK/intake/empty"

record apply-doomed-bad-ref apply "${CONF[@]}" apply "$WORK/intake/love-me-do" --candidate "not-a-ref"
record apply-applied        apply "${CONF[@]}" apply "$WORK/intake/love-me-do" --candidate "MusicBrainz:$MBID"

# Re-deposit the same release: the incumbent now surfaces on propose and blocks a plain apply.
gen "$WORK/intake/love-me-do/01 Love Me Do.mp3"      143 "The Beatles" "Love Me Do" "Love Me Do"      1
gen "$WORK/intake/love-me-do/02 P.S. I Love You.mp3" 123 "The Beatles" "Love Me Do" "P.S. I Love You" 2
record propose-with-incumbent   propose "${CONF[@]}" propose "$WORK/intake/love-me-do" --search-id "$MBID"
record apply-skipped-duplicate  apply "${CONF[@]}" apply "$WORK/intake/love-me-do" --candidate "MusicBrainz:$MBID"
record apply-doomed-candidate-not-found apply "${CONF[@]}" apply "$WORK/intake/love-me-do" --candidate "MusicBrainz:00000000-0000-0000-0000-000000000000"
record apply-as-is-applied      apply "${CONF[@]}" apply "$WORK/intake/love-me-do" --duplicate-action keep-both --as-is

# Applied-with-failures: an `applied` outcome that still carries a non-empty `failures[]`. The bridge
# records a failure only when session.run() raises AFTER at least one album already imported (design
# D7). We force that deterministically and offline: a tiny beets plugin whose `album_imported`
# listener raises on the SECOND album, over an intake of TWO distinct as-is albums. The bridge
# appends its own `album_imported` listener LAST, so for album 1 the plugin passes and the bridge
# records it; for album 2 the plugin raises before the bridge appends it — so `imported` is non-empty
# (album 1 moved) and the caught error becomes an `import-pipeline` failure entry. `--as-is` keeps it
# network-free.
mkdir -p "$WORK/plugins" "$WORK/intake/twins/alpha" "$WORK/intake/twins/beta"
cat > "$WORK/plugins/failsecond.py" <<'PYEOF'
from beets.plugins import BeetsPlugin


class FailSecond(BeetsPlugin):
    """Raise on the second album_imported so a first album has already moved.

    The bridge's own album_imported listener (appended last) records album 1;
    this listener (loaded first) then raises on album 2 before the bridge can
    append it, so session.run() throws with a non-empty `imported` — which
    run_apply records as a non-empty apply `failures[]`, not a plain retry.
    """

    seen = 0

    def __init__(self):
        super().__init__()
        self.register_listener("album_imported", self.on_album_imported)

    def on_album_imported(self, lib, album):  # noqa: ARG002 - beets event signature
        FailSecond.seen += 1
        if FailSecond.seen >= 2:
            raise RuntimeError("synthetic post-import failure recorded as an apply failure")
PYEOF
FAIL_CONF="$WORK/beets/fail-config.yaml"
cat > "$FAIL_CONF" <<EOF
directory: $WORK/library
library: $WORK/beets/library.db
import:
  move: yes
pluginpath: [$WORK/plugins]
plugins: [musicbrainz, failsecond]
EOF
gen "$WORK/intake/twins/alpha/01 Alpha One.mp3" 12 "Twin Alpha zz1" "Alpha Sessions zz1" "Alpha One" 1
gen "$WORK/intake/twins/beta/01 Beta One.mp3"   12 "Twin Beta zz2"  "Beta Sessions zz2"  "Beta One"  1
record apply-applied-with-failures apply --config "$FAIL_CONF" apply "$WORK/intake/twins" --duplicate-action keep-both --as-is

echo "all fixtures recorded against beets $BEETS_VERSION"
