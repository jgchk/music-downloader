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

function ffprobeJson(streams: unknown[], format: unknown = undefined): CommandResult {
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

    const result = (await probeWith(runner(meta, OK)).probe('/staging/01.flac'))._unsafeUnwrap();

    expect(result).toEqual({
      decodedCleanly: true,
      codec: 'flac',
      durationMs: 180500,
      sampleRate: 44100,
      bitDepth: 16,
      bitrate: 900000,
      channels: 2,
    });
  });

  it('marks a file unplayable when the decode pass fails', async () => {
    const meta = ffprobeJson([{ codec_type: 'audio', codec_name: 'flac', duration: '10' }]);
    const decodeFailed = { code: 1, stdout: '', stderr: 'Invalid data' };

    const result = (await probeWith(runner(meta, decodeFailed)).probe('/x.flac'))._unsafeUnwrap();

    expect(result.decodedCleanly).toBe(false);
    expect(result.codec).toBe('flac'); // metadata is still read from the header
    expect(result.durationMs).toBe(10000);
  });

  it('yields empty metadata when ffprobe itself fails', async () => {
    const probeFailed = { code: 1, stdout: '', stderr: 'not found' };

    const result = (await probeWith(runner(probeFailed, OK)).probe('/x.flac'))._unsafeUnwrap();

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

    const result = (await probeWith(runner(meta, OK)).probe('/cover.png'))._unsafeUnwrap();

    expect(result.decodedCleanly).toBe(false);
    expect(result.codec).toBe('');
  });

  it('handles ffprobe output with no streams at all', async () => {
    const meta = { code: 0, stdout: '{}', stderr: '' };

    const result = (await probeWith(runner(meta, OK)).probe('/empty'))._unsafeUnwrap();

    expect(result.decodedCleanly).toBe(false);
  });

  it('falls back to the format duration and tolerates N/A and a missing codec name', async () => {
    const meta = ffprobeJson(
      [{ codec_type: 'audio', bit_rate: 'N/A' }], // no codec_name, no stream duration
      { duration: '200' },
    );

    const result = (await probeWith(runner(meta, OK)).probe('/x.opus'))._unsafeUnwrap();

    expect(result).toEqual({
      decodedCleanly: true,
      codec: '',
      durationMs: 200000,
      sampleRate: undefined,
      bitDepth: undefined,
      bitrate: undefined,
      channels: undefined,
    });
  });

  it('defaults duration to zero when neither the stream nor the format declares one', async () => {
    const meta = ffprobeJson([{ codec_type: 'audio', codec_name: 'mp3' }]); // no format object

    const result = (await probeWith(runner(meta, OK)).probe('/x.mp3'))._unsafeUnwrap();

    expect(result.durationMs).toBe(0);
    expect(result.bitrate).toBeUndefined();
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
