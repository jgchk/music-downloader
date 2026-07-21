import { spawn } from 'node:child_process';

/**
 * A minimal process-runner seam for the ffmpeg/ffprobe adapters. It resolves with the child's
 * exit code and captured output for *any* completed run (a non-zero exit is a normal business
 * signal — an unplayable file), and rejects only when the process cannot be spawned at all
 * (e.g. the binary is missing) — which the adapter maps to an `InfraError`.
 */
export interface CommandResult {
  readonly code: number | null; // null when the process was terminated by a signal
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunner {
  run(command: string, args: readonly string[]): Promise<CommandResult>;
}

export const nodeCommandRunner: CommandRunner = {
  run(command, args) {
    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(command, [...args]);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  },
};
