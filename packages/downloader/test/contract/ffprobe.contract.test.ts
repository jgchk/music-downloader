import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '../../src/application/__fixtures__/fakes.js';
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
  const path = join(CONTRACT_FIXTURE_ROOT, 'ffprobe', name);
  return JSON.parse(readFileSync(path, 'utf8')) as FfprobeFixture;
}

/** A runner that replays the recorded ffprobe stdout and a clean decode pass. */
function replayRunner(stdout: string): CommandRunner {
  const probe: CommandResult = { code: 0, stdout, stderr: '' };
  const decode: CommandResult = { code: 0, stdout: '', stderr: '' };
  return { run: (command) => Promise.resolve(command === 'ffprobe' ? probe : decode) };
}

describe('ffprobe contract (tier 1)', () => {
  it('parses and maps the consumed fields from recorded lossless-FLAC stdout', async () => {
    const fixture = loadFixture('lossless-flac.json');
    const runner = replayRunner(JSON.stringify(fixture.stdout));
    const probe = new FfmpegAudioProbe(silentLogger(), runner);

    const result = (await probe.probe('/staging/01.flac'))._unsafeUnwrap();

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
});
