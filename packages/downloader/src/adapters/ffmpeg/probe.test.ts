import { describe, expect, it } from 'vitest';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import { FfmpegAudioProbe } from './probe.js';
import type { CommandResult, CommandRunner } from './runner.js';

const OK = { code: 0, stdout: '', stderr: '' };

function runner(probe: CommandResult, decode: CommandResult): CommandRunner {
  return {
    run: (command) => Promise.resolve(command === 'ffprobe' ? probe : decode),
  };
}

function ffprobeJson(streams: unknown[], format?: unknown): CommandResult {
  return { code: 0, stdout: JSON.stringify({ streams, format }), stderr: '' };
}

function probeWith(runnerImpl: CommandRunner): FfmpegAudioProbe {
  return new FfmpegAudioProbe(silentLogger(), runnerImpl);
}

describe('FfmpegAudioProbe', () => {
  it('reports a clean decode with full metadata for a lossless file', async () => {
    const meta = ffprobeJson(
      [
        {
          codec_type: 'audio',
          codec_name: 'flac',
          sample_rate: '44100',
          channels: 2,
          bits_per_raw_sample: '16',
          bit_rate: '900000',
          duration: '180.5',
        },
      ],
      { duration: '180.5', bit_rate: '900000' },
    );

    const probeResult = await probeWith(runner(meta, OK)).probe('/staging/01.flac');
    const result = probeResult._unsafeUnwrap();

    expect(result).toEqual({
      decodedCleanly: true,
      codec: 'flac',
      durationMs: 180_500,
      sampleRate: 44_100,
      bitDepth: 16,
      bitrate: 900_000,
      channels: 2,
    });
  });

  it('marks a file unplayable when the decode pass fails', async () => {
    const meta = ffprobeJson([{ codec_type: 'audio', codec_name: 'flac', duration: '10' }]);
    const decodeFailed = { code: 1, stdout: '', stderr: 'Invalid data' };

    const probeResult2 = await probeWith(runner(meta, decodeFailed)).probe('/x.flac');
    const result = probeResult2._unsafeUnwrap();

    expect(result.decodedCleanly).toBe(false);
    expect(result.codec).toBe('flac'); // metadata is still read from the header
    expect(result.durationMs).toBe(10_000);
  });

  it('yields empty metadata when ffprobe itself fails', async () => {
    const probeFailed = { code: 1, stdout: '', stderr: 'not found' };

    const probeResult3 = await probeWith(runner(probeFailed, OK)).probe('/x.flac');
    const result = probeResult3._unsafeUnwrap();

    expect(result).toEqual({
      decodedCleanly: false,
      codec: '',
      durationMs: 0,
      sampleRate: undefined,
      bitDepth: undefined,
      bitrate: undefined,
      channels: undefined,
    });
  });

  it('treats a file with no audio stream as not cleanly decoded', async () => {
    const meta = ffprobeJson([{ codec_type: 'video', codec_name: 'png' }]);

    const probeResult4 = await probeWith(runner(meta, OK)).probe('/cover.png');
    const result = probeResult4._unsafeUnwrap();

    expect(result.decodedCleanly).toBe(false);
    expect(result.codec).toBe('');
  });

  it('handles ffprobe output with no streams at all', async () => {
    const meta = { code: 0, stdout: '{}', stderr: '' };

    const probeResult5 = await probeWith(runner(meta, OK)).probe('/empty');
    const result = probeResult5._unsafeUnwrap();

    expect(result.decodedCleanly).toBe(false);
  });

  it('falls back to the format duration and tolerates N/A and a missing codec name', async () => {
    const meta = ffprobeJson(
      [{ codec_type: 'audio', bit_rate: 'N/A' }], // no codec_name, no stream duration
      { duration: '200' },
    );

    const probeResult6 = await probeWith(runner(meta, OK)).probe('/x.opus');
    const result = probeResult6._unsafeUnwrap();

    expect(result).toEqual({
      decodedCleanly: true,
      codec: '',
      durationMs: 200_000,
      sampleRate: undefined,
      bitDepth: undefined,
      bitrate: undefined,
      channels: undefined,
    });
  });

  it('defaults duration to zero when neither the stream nor the format declares one', async () => {
    const meta = ffprobeJson([{ codec_type: 'audio', codec_name: 'mp3' }]); // no format object

    const probeResult7 = await probeWith(runner(meta, OK)).probe('/x.mp3');
    const result = probeResult7._unsafeUnwrap();

    expect(result.durationMs).toBe(0);
    expect(result.bitrate).toBeUndefined();
  });

  it('reads bit depth from bits_per_sample when bits_per_raw_sample is absent', async () => {
    const meta = ffprobeJson([
      { codec_type: 'audio', codec_name: 'alac', duration: '10', bits_per_sample: 24 },
    ]);

    const probeResult = await probeWith(runner(meta, OK)).probe('/x.m4a');
    const result = probeResult._unsafeUnwrap();

    expect(result.bitDepth).toBe(24);
  });

  it('treats a bits_per_sample of 0 (not applicable) as an unknown bit depth', async () => {
    const meta = ffprobeJson([
      { codec_type: 'audio', codec_name: 'mp3', duration: '10', bits_per_sample: 0 },
    ]);

    const probeResult = await probeWith(runner(meta, OK)).probe('/x.mp3');
    const result = probeResult._unsafeUnwrap();

    expect(result.bitDepth).toBeUndefined();
  });

  it('reads an empty-string numeric field as absent rather than zero', async () => {
    const meta = ffprobeJson([
      { codec_type: 'audio', codec_name: 'flac', duration: '10', sample_rate: '' },
    ]);

    const probeResult = await probeWith(runner(meta, OK)).probe('/x.flac');
    const result = probeResult._unsafeUnwrap();

    expect(result.sampleRate).toBeUndefined();
  });

  it('surfaces an InfraError naming ffprobe when it exits 0 with non-JSON output', async () => {
    // A successful exit that is not JSON is a broken/incompatible ffprobe (a `-print_format json`
    // run always emits JSON) — a boundary fault to surface, not a bad-file business outcome.
    const garbage = { code: 0, stdout: 'not json at all', stderr: '' };

    const result = await probeWith(runner(garbage, OK)).probe('/x.flac');

    const error = result._unsafeUnwrapErr();
    expect(error.kind).toBe('InfraError');
    expect(error.operation).toBe('ffmpeg.probe');
    expect(error.message).toContain('ffprobe');
  });

  it('surfaces an InfraError when ffprobe JSON violates the consumed contract shape', async () => {
    // Exit 0, valid JSON, but `streams` is not an array — a consumed field changed type, which the
    // tolerant schema rejects rather than silently degrading to all-undefined metadata.
    const drifted = { code: 0, stdout: JSON.stringify({ streams: 'not-an-array' }), stderr: '' };

    const result = await probeWith(runner(drifted, OK)).probe('/x.flac');

    const error = result._unsafeUnwrapErr();
    expect(error.kind).toBe('InfraError');
    expect(error.message).toContain('ffprobe');
  });

  it('surfaces a failure to spawn the binaries as an InfraError', async () => {
    const missing: CommandRunner = {
      run: () =>
        Promise.reject(Object.assign(new Error('spawn ffprobe ENOENT'), { code: 'ENOENT' })),
    };

    const result = await probeWith(missing).probe('/x.flac');

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'ffmpeg.probe',
    });
  });
});
