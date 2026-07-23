import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTRACT_FIXTURE_ROOT } from '../support/fixture.js';

/**
 * Records the ffprobe contract fixtures from the real binary. ffprobe is a CLI, not an HTTP service,
 * so each fixture is its captured JSON stdout under a small provenance envelope — not the HTTP-shaped
 * {@link ContractFixture} the slskd/musicbrainz recorders write. Short lossless samples are
 * synthesized with ffmpeg so the capture is fully reproducible with no committed audio asset:
 *
 *   pnpm tsx packages/downloader/test/contract/record/ffprobe.ts
 *
 * Two codecs are captured because real ffprobe reports bit depth under two different field names,
 * and the adapter must recover it from either:
 *   - `lossless-flac.json`: FLAC emits `bits_per_raw_sample` (a *string*), `bits_per_sample: 0`.
 *   - `lossless-pcm.json`:  WAV `pcm_s16le` emits `bits_per_sample` (a *number*) with no
 *     `bits_per_raw_sample`, exercising the numeric fallback in the adapter's bit-depth parse.
 *
 * Review the printed summary before committing.
 */

const OUT_DIR = join(CONTRACT_FIXTURE_ROOT, 'ffprobe');

function ffprobeVersion(): string {
  return execFileSync('ffprobe', ['-version'], { encoding: 'utf8' }).split('\n')[0]!.trim();
}

/** Synthesize a sample with ffmpeg, capture its ffprobe stdout, and write the fixture envelope. */
function record(args: {
  readonly sample: string;
  readonly encodeArgs: readonly string[];
  readonly source: string;
  readonly outName: string;
}): void {
  execFileSync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    ...args.encodeArgs,
    args.sample,
  ]);

  try {
    const stdout = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_streams', '-show_format', '-print_format', 'json', args.sample],
      { encoding: 'utf8' },
    );
    const fixture = {
      provenance: {
        source: args.source,
        capturedAt: new Date().toISOString().slice(0, 10),
        serviceVersion: ffprobeVersion(),
        note: 'raw ffprobe -show_streams -show_format -print_format json stdout',
      },
      stdout: JSON.parse(stdout) as unknown,
    };
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, args.outName), `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(`wrote ffprobe/${args.outName}`);
  } finally {
    rmSync(args.sample, { force: true });
  }
}

function main(): void {
  // A deterministic 1s stereo 44.1kHz/16-bit sine tone as FLAC: exercises real bit-depth (via
  // `bits_per_raw_sample`), sample-rate, duration, and format-bitrate fields, no external file.
  record({
    sample: join(tmpdir(), `contract-ffprobe-${process.pid}.flac`),
    encodeArgs: ['-sample_fmt', 's16', '-ar', '44100', '-ac', '2'],
    source:
      'ffprobe on a synthesized 1s stereo 44.1kHz/16-bit FLAC (test/contract/record/ffprobe.ts)',
    outName: 'lossless-flac.json',
  });

  // The same tone as WAV `pcm_s16le`: ffprobe reports bit depth as a NUMERIC `bits_per_sample` with
  // no `bits_per_raw_sample`, so this fixture pins the adapter's numeric-fallback bit-depth branch.
  record({
    sample: join(tmpdir(), `contract-ffprobe-${process.pid}.wav`),
    encodeArgs: ['-c:a', 'pcm_s16le', '-sample_fmt', 's16', '-ar', '44100', '-ac', '2'],
    source:
      'ffprobe on a synthesized 1s stereo 44.1kHz/16-bit WAV pcm_s16le (test/contract/record/ffprobe.ts)',
    outName: 'lossless-pcm.json',
  });
}

main();
