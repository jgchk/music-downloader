#!/usr/bin/env bash
# Generate the lab peer's shared corpus (change: slskd-contract-truth).
#
# The lab must share *something* real — slskd indexes the directory and serves genuine bytes — but
# nothing copyrighted may live in this repository, so the corpus is synthesized with ffmpeg and left
# untracked. Sizes are chosen against the peer's 1 KiB/s upload limit:
#
#   - the slot hog is incompressible noise (well over ten minutes of occupancy), long enough that
#     anything enqueued behind it sits in a genuine remote queue for a whole recording session;
#   - the other two are digital silence (a few KiB), so a success-path download completes in seconds.
#
# Idempotent: existing files are left alone. Run from anywhere.
set -euo pipefail

CORPUS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/corpus/Lab Artist/Lab Album"
mkdir -p "$CORPUS_DIR"

flac_from() {
  local target="$CORPUS_DIR/$1"
  shift
  if [[ -f "$target" ]]; then
    echo "kept    $(basename "$target")"
    return
  fi
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "$1" -ac 2 -ar 44100 -c:a flac "$target"
  echo "created $(basename "$target") ($(stat -c %s "$target") bytes)"
}

# Incompressible pink noise — the slot hog.
flac_from '01 - Slot Hog.flac' 'anoisesrc=d=8:c=pink:r=44100:a=0.8'
# Digital silence — compresses to a few KiB, so these transfer in seconds.
flac_from '02 - Queued Behind.flac' 'anullsrc=r=44100:cl=stereo:d=5'
flac_from '03 - Success Path.flac' 'anullsrc=r=44100:cl=stereo:d=5'

echo "corpus ready at ${CORPUS_DIR}"
