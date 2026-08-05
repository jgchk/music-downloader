import { spawn } from 'node:child_process';

/**
 * A minimal process-runner seam for the ffmpeg/ffprobe adapters. It resolves with the child's
 * exit code and captured output for *any* completed run (a non-zero exit is a normal business
 * signal — an unplayable file), flags a run that had to be killed on timeout (a hung decode must
 * never wedge the reactor's dispatch forever), and rejects only when the process cannot be
 * spawned at all (e.g. the binary is missing) — which the adapter maps to an `InfraError`.
 */
export interface CommandResult {
  readonly code: number | null; // null when the process was terminated by a signal
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface CommandRunner {
  run(command: string, arguments_: readonly string[], timeoutMs: number): Promise<CommandResult>;
}

export const nodeCommandRunner: CommandRunner = {
  run(command, arguments_, timeoutMs) {
    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(command, [...arguments_]);
      let stdout = '';
      let stderr = '';
      let isTimedOut = false;
      const timer = setTimeout(() => {
        isTimedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      // Decode the stream, not the chunks: a multi-byte code point split across two chunks
      // corrupts under a per-chunk `Buffer#toString`, and tag metadata is full of non-ASCII.
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => (stdout += chunk));
      child.stderr.on('data', (chunk: string) => (stderr += chunk));
      child.on('error', (cause) => {
        clearTimeout(timer);
        reject(cause);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr, timedOut: isTimedOut });
      });
    });
  },
};
