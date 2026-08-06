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

/**
 * How long a killed child gets to reach 'close' before the run resolves without it. SIGKILL
 * cannot unstick uninterruptible I/O (a D-state read against a stalled staging mount — the very
 * scenario the timeout exists for), and 'close' additionally waits for stdio to drain; past this
 * grace the run resolves as timed out with whatever was captured, accepting an orphaned child
 * rather than a wedged reactor dispatch.
 */
const KILL_GRACE_MS = 1000;

export const nodeCommandRunner: CommandRunner = {
  run(command, arguments_, timeoutMs) {
    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(command, [...arguments_]);
      let stdout = '';
      let stderr = '';
      let graceTimer: NodeJS.Timeout | undefined;
      let isTimedOut = false;
      const timer = setTimeout(() => {
        // Already exited, 'close' merely pending on stdio drain: not a timeout — stamping one
        // would turn a completed decode into a retryable fault. Let 'close' report the truth.
        if (child.exitCode !== null) return;
        isTimedOut = true;
        child.kill('SIGKILL');
        graceTimer = setTimeout(() => {
          resolve({ code: null, stdout, stderr, timedOut: true });
        }, KILL_GRACE_MS);
      }, timeoutMs);
      // Decode the stream, not the chunks: a multi-byte code point split across two chunks
      // corrupts under a per-chunk `Buffer#toString`, and tag metadata is full of non-ASCII.
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => (stdout += chunk));
      child.stderr.on('data', (chunk: string) => (stderr += chunk));
      // A settled promise ignores later resolve/reject calls, so a 'close' that limps in after
      // the grace resolution needs no guard — it just clears the timers.
      child.on('error', (cause) => {
        clearTimeout(timer);
        clearTimeout(graceTimer);
        reject(cause);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        clearTimeout(graceTimer);
        resolve({ code, stdout, stderr, timedOut: isTimedOut });
      });
    });
  },
};
