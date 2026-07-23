import { ResultAsync } from 'neverthrow';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type { AudioProbePort } from '../../application/ports/outbound-ports.js';
import type { ProbedAudio } from '../../domain/validation/validators.js';
import type { Logger } from '../../application/logging/logger.js';
import { nodeCommandRunner } from './runner.js';
import type { CommandRunner } from './runner.js';

/**
 * The ffmpeg `AudioProbePort` adapter (D5). Playability comes from a full **decode-to-null** pass
 * (`ffmpeg -f null`), which catches truncated/corrupt P2P downloads a header parse would miss;
 * the audio metadata (codec, ground-truth duration, sample rate, bit depth, bitrate, channels)
 * comes from `ffprobe`. A bad/unreadable file is a *business* outcome (`decodedCleanly: false`),
 * not an infra fault — only a failure to spawn the binaries surfaces as an `InfraError`.
 */

interface FfprobeStream {
  readonly codec_type?: string;
  readonly codec_name?: string;
  readonly sample_rate?: string;
  readonly channels?: number;
  readonly bits_per_raw_sample?: string;
  readonly bit_rate?: string;
  readonly duration?: string;
}

interface FfprobeOutput {
  readonly streams?: readonly FfprobeStream[];
  readonly format?: { readonly duration?: string; readonly bit_rate?: string };
}

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

/** Parse a numeric ffprobe field, tolerating absence and the literal `N/A` ffprobe emits. */
function parseNumber(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Extract the first audio stream's metadata, or `undefined` when the file has no audio. */
function parseAudioMetadata(stdout: string): AudioMetadata | undefined {
  // A successful ffprobe exit with non-JSON stdout is a deterministic bad-file *business* outcome
  // (no readable audio), not a retryable infra fault — an unguarded parse would throw and be retried
  // forever on a permanent condition. Degrade to `undefined` (audio absent) instead.
  let output: FfprobeOutput;
  try {
    output = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    return undefined;
  }
  const audio = output.streams?.find((stream) => stream.codec_type === 'audio');
  if (audio === undefined) return undefined;

  const durationSec = parseNumber(audio.duration) ?? parseNumber(output.format?.duration);
  return {
    codec: audio.codec_name ?? '',
    durationMs: durationSec === undefined ? 0 : Math.round(durationSec * 1000),
    sampleRate: parseNumber(audio.sample_rate),
    bitDepth: parseNumber(audio.bits_per_raw_sample),
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

    const audio = meta.code === 0 ? parseAudioMetadata(meta.stdout) : undefined;
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
