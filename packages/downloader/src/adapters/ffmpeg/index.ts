// ffmpeg adapters (D5): the audio-probe port (decode-to-null playability + probed metadata) and
// its process-runner seam.
export { FfmpegAudioProbe } from './probe.js';
export type { FfmpegConfig } from './probe.js';
export { nodeCommandRunner } from './runner.js';
export type { CommandResult, CommandRunner } from './runner.js';
