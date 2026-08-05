import { spawn } from 'node:child_process';

/**
 * A minimal process-runner seam for the beets bridge adapter. It resolves with the child's exit
 * code and captured output for any completed run (a non-zero exit is how the bridge signals an
 * unexpected crash), flags a run that had to be killed on timeout, and rejects only when the
 * process cannot be spawned at all (e.g. the interpreter is missing) — which the adapter maps to
 * an `InfraError`.
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
      // corrupts under a per-chunk `Buffer#toString` — and this stdout is `JSON.parse`d, so a
      // split non-ASCII artist name would read back as a bridge crash.
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
