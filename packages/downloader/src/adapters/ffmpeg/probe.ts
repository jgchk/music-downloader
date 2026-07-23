import { ResultAsync } from 'neverthrow';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type { AudioProbePort } from '../../application/ports/outbound-ports.js';
import type { ProbedAudio } from '../../domain/validation/validators.js';
import type { Logger } from '../../application/logging/logger.js';
import { nodeCommandRunner } from './runner.js';
import type { CommandRunner } from './runner.js';
import { ffprobeOutputSchema } from './schemas.js';
import type { FfprobeOutput, FfprobeStream } from './schemas.js';

/**
 * The ffmpeg `AudioProbePort` adapter (D5). Playability comes from a full **decode-to-null** pass
 * (`ffmpeg -f null`), which catches truncated/corrupt P2P downloads a header parse would miss;
 * the audio metadata (codec, ground-truth duration, sample rate, bit depth, bitrate, channels)
 * comes from `ffprobe`. A bad/unreadable file is a *business* outcome (`decodedCleanly: false`),
 * not an infra fault — only a failure to spawn the binaries surfaces as an `InfraError`.
 */

interface AudioMetadata {
  readonly codec: string;
  readonly durationMs: number;
  readonly sampleRate?: number;
  readonly bitDepth?: number;
  readonly bitrate?: number;
  readonly channels?: number;
}

export interface FfmpegConfig {
  readonly ffprobePath?: string;
  readonly ffmpegPath?: string;
}

/**
 * Parse a numeric ffprobe field, tolerating absence, an empty string, and the literal `N/A` ffprobe
 * emits — each reads as *absent*. `Number('')` is `0`, not `NaN`, so an empty read is guarded
 * explicitly rather than silently becoming a real zero.
 */
function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Bit depth from `bits_per_raw_sample` (a string) when present, else `bits_per_sample` (a number).
 * ffprobe reports `0` for "not applicable", which reads as unknown rather than a real 0-bit depth.
 */
function parseBitDepth(stream: FfprobeStream): number | undefined {
  const depth = parseNumber(stream.bits_per_raw_sample) ?? stream.bits_per_sample;
  return depth === undefined || depth === 0 ? undefined : depth;
}

/**
 * Parse and validate ffprobe's JSON stdout against the consumer contract. A successful ffprobe exit
 * that is non-JSON, or whose JSON violates the tolerant schema (a consumed field changed type), is a
 * broken/incompatible ffprobe — a boundary failure, surfaced by throwing so the caller's
 * `ResultAsync.fromPromise` maps it to a modeled `InfraError` naming ffprobe rather than degrading
 * silently to all-`undefined` metadata.
 */
function parseFfprobeOutput(stdout: string): FfprobeOutput {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch (error) {
    throw new Error('ffprobe emitted non-JSON output', { cause: error });
  }
  const parsed = ffprobeOutputSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`ffprobe output failed contract validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Extract the first audio stream's metadata, or `undefined` when the file has no audio. */
function parseAudioMetadata(output: FfprobeOutput): AudioMetadata | undefined {
  const audio = output.streams?.find((stream) => stream.codec_type === 'audio');
  if (audio === undefined) return undefined;

  const durationSec = parseNumber(audio.duration) ?? parseNumber(output.format?.duration);
  return {
    codec: audio.codec_name ?? '',
    durationMs: durationSec === undefined ? 0 : Math.round(durationSec * 1000),
    sampleRate: parseNumber(audio.sample_rate),
    bitDepth: parseBitDepth(audio),
    bitrate: parseNumber(audio.bit_rate) ?? parseNumber(output.format?.bit_rate),
    channels: audio.channels,
  };
}

export class FfmpegAudioProbe implements AudioProbePort {
  private readonly ffprobe: string;
  private readonly ffmpeg: string;

  constructor(
    private readonly logger: Logger,
    private readonly runner: CommandRunner = nodeCommandRunner,
    config: FfmpegConfig = {},
  ) {
    this.ffprobe = config.ffprobePath ?? 'ffprobe';
    this.ffmpeg = config.ffmpegPath ?? 'ffmpeg';
  }

  probe(filePath: string): ResultAsync<ProbedAudio, InfraError> {
    return ResultAsync.fromPromise(this.runProbe(filePath), (cause) =>
      infraError('ffmpeg.probe', String(cause), cause),
    );
  }

  private async runProbe(filePath: string): Promise<ProbedAudio> {
    this.logger.debug({ filePath }, 'probing audio file');
    const [meta, decode] = await Promise.all([
      this.runner.run(this.ffprobe, [
        '-v',
        'error',
        '-show_streams',
        '-show_format',
        '-print_format',
        'json',
        filePath,
      ]),
      this.runner.run(this.ffmpeg, ['-v', 'error', '-i', filePath, '-f', 'null', '-']),
    ]);

    const audio = meta.code === 0 ? parseAudioMetadata(parseFfprobeOutput(meta.stdout)) : undefined;
    return {
      decodedCleanly: decode.code === 0 && audio !== undefined,
      codec: audio?.codec ?? '',
      durationMs: audio?.durationMs ?? 0,
      sampleRate: audio?.sampleRate,
      bitDepth: audio?.bitDepth,
      bitrate: audio?.bitrate,
      channels: audio?.channels,
    };
  }
}
