import { testScope } from '../../src/application/__fixtures__/correlation.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FfmpegAudioProbe } from '../../src/adapters/ffmpeg/probe.js';
import type { CommandResult, CommandRunner } from '../../src/adapters/ffmpeg/runner.js';
import { CONTRACT_FIXTURE_ROOT } from './support/fixture.js';

/**
 * Tier 1 for the ffprobe adapter: the real {@link FfmpegAudioProbe} parse/validate/map path driven
 * against genuinely recorded ffprobe stdout (test/contract/record/ffprobe.ts). ffprobe is a CLI, so
 * the fixture is its captured JSON stdout rather than an HTTP-shaped fixture, and the command runner
 * is faked to replay it — this pins that the fields the adapter consumes are actually present in real
 * ffprobe output and map to the expected `ProbedAudio`, so a hand-written stub can't silently drift.
 */

interface FfprobeFixture {
  readonly provenance: { readonly source: string; readonly capturedAt: string };
  readonly stdout: unknown;
}

function loadFixture(name: string): FfprobeFixture {
  const fixturePath = path.join(CONTRACT_FIXTURE_ROOT, 'ffprobe', name);
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as FfprobeFixture;
}

/** A runner that replays the recorded ffprobe stdout and a clean decode pass. */
function replayRunner(stdout: string): CommandRunner {
  const probe: CommandResult = { code: 0, stdout, stderr: '', timedOut: false };
  const decode: CommandResult = { code: 0, stdout: '', stderr: '', timedOut: false };
  return { run: (command) => Promise.resolve(command === 'ffprobe' ? probe : decode) };
}

describe('ffprobe contract (tier 1)', () => {
  it('parses and maps the consumed fields from recorded lossless-FLAC stdout', async () => {
    const fixture = loadFixture('lossless-flac.json');
    const runner = replayRunner(JSON.stringify(fixture.stdout));
    const probe = new FfmpegAudioProbe(runner);

    const probed = await probe.probe('/staging/01.flac', testScope());
    const result = probed._unsafeUnwrap();

    // Fed the identical bytes real ffprobe emitted, the adapter must recover every consumed field:
    // codec/duration/sampleRate/bitDepth (from bits_per_raw_sample) and bitrate (format fallback).
    expect(result).toEqual({
      decodedCleanly: true,
      codec: 'flac',
      durationMs: 1000,
      sampleRate: 44_100,
      bitDepth: 16,
      bitrate: 165_128,
      channels: 2,
    });
  });

  it('asks ffprobe for the same output the fixtures were recorded from', async () => {
    // A replayed fixture only proves anything if production asks the binary the question the
    // recorder asked: `-show_streams -show_format -print_format json` is what makes this stdout
    // exist at all — drop `-show_format` and the format-level duration/bitrate fallbacks the tests
    // above rely on are simply not in the payload — and `-v error` keeps ffprobe's banner out of
    // the stderr the adapter logs as the operator's diagnosis. The recorder's own argument list is
    // in test/contract/record/ffprobe.ts and must stay identical to this one.
    const invocations: { readonly command: string; readonly arguments_: readonly string[] }[] = [];
    const fixture = loadFixture('lossless-flac.json');
    const replay = replayRunner(JSON.stringify(fixture.stdout));
    const recording: CommandRunner = {
      run: (command, arguments_, timeoutMs) => {
        invocations.push({ command, arguments_ });
        return replay.run(command, arguments_, timeoutMs);
      },
    };

    await new FfmpegAudioProbe(recording).probe('/staging/01.flac', testScope());

    expect(invocations.find((call) => call.command === 'ffprobe')?.arguments_).toEqual([
      '-v',
      'error',
      '-show_streams',
      '-show_format',
      '-print_format',
      'json',
      '/staging/01.flac',
    ]);
  });

  it('recovers bitDepth from a numeric bits_per_sample on recorded lossless-PCM stdout', async () => {
    // WAV pcm_s16le has no `bits_per_raw_sample`; real ffprobe reports depth as a numeric
    // `bits_per_sample`. This pins the adapter's numeric-fallback branch against real output —
    // the FLAC fixture only exercises the string `bits_per_raw_sample` path.
    const fixture = loadFixture('lossless-pcm.json');
    const runner = replayRunner(JSON.stringify(fixture.stdout));
    const probe = new FfmpegAudioProbe(runner);

    const probed = await probe.probe('/staging/01.wav', testScope());
    const result = probed._unsafeUnwrap();

    expect(result).toEqual({
      decodedCleanly: true,
      codec: 'pcm_s16le',
      durationMs: 1000,
      sampleRate: 44_100,
      bitDepth: 16,
      bitrate: 1_411_200,
      channels: 2,
    });
  });
});
