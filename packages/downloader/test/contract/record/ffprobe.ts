import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTRACT_FIXTURE_ROOT } from '../support/fixture.js';

/**
 * Records the ffprobe contract fixture from the real binary. ffprobe is a CLI, not an HTTP service,
 * so the fixture is its captured JSON stdout under a small provenance envelope — not the HTTP-shaped
 * {@link ContractFixture} the slskd/musicbrainz recorders write. A short lossless FLAC is synthesized
 * with ffmpeg so the capture is fully reproducible with no committed audio asset:
 *
 *   pnpm tsx packages/downloader/test/contract/record/ffprobe.ts
 *
 * Review the printed summary before committing.
 */

const OUT_DIR = join(CONTRACT_FIXTURE_ROOT, 'ffprobe');
const sample = join(tmpdir(), `contract-ffprobe-${process.pid}.flac`);

function ffprobeVersion(): string {
  return execFileSync('ffprobe', ['-version'], { encoding: 'utf8' }).split('\n')[0]!.trim();
}

function main(): void {
  // A deterministic 1s stereo 44.1kHz/16-bit sine tone: exercises the real bit-depth, sample-rate,
  // duration, and format-bitrate fields the adapter consumes, with no external file to check in.
  execFileSync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-sample_fmt',
    's16',
    '-ar',
    '44100',
    '-ac',
    '2',
    sample,
  ]);

  try {
    const stdout = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_streams', '-show_format', '-print_format', 'json', sample],
      { encoding: 'utf8' },
    );
    const fixture = {
      provenance: {
        source:
          'ffprobe on a synthesized 1s stereo 44.1kHz/16-bit FLAC (test/contract/record/ffprobe.ts)',
        capturedAt: new Date().toISOString().slice(0, 10),
        serviceVersion: ffprobeVersion(),
        note: 'raw ffprobe -show_streams -show_format -print_format json stdout',
      },
      stdout: JSON.parse(stdout) as unknown,
    };
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'lossless-flac.json'), `${JSON.stringify(fixture, null, 2)}\n`);
    console.log('wrote ffprobe/lossless-flac.json');
  } finally {
    rmSync(sample, { force: true });
  }
}

main();
