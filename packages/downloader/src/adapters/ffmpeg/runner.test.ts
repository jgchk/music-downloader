import { describe, expect, it } from 'vitest';
import { nodeCommandRunner } from './runner.js';

// Exercise the real spawn wiring against the always-present Node binary, so the adapter logic
// can be unit-tested against a fake runner while this proves the process glue itself.
const node = process.execPath;

describe('nodeCommandRunner', () => {
  it('captures stdout, stderr, and the exit code of a completed process', async () => {
    const result = await nodeCommandRunner.run(
      node,
      ['-e', "process.stdout.write('out'); process.stderr.write('err'); process.exit(2)"],
      5000,
    );

    expect(result).toEqual({ code: 2, stdout: 'out', stderr: 'err', timedOut: false });
  });

  it('kills a run that exceeds its timeout and flags it', async () => {
    // A hung decode (a pathological stream, a stalled network read under the staging mount) must
    // never wedge the caller forever — the run is killed and flagged, like the beets runner's.
    const result = await nodeCommandRunner.run(
      node,
      ['-e', 'setTimeout(() => undefined, 60_000)'],
      100,
    );

    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
  });

  it('decodes multi-byte UTF-8 split across chunk boundaries intact', async () => {
    // A per-chunk `Buffer#toString` corrupts a code point whose bytes straddle two chunks; the
    // runner must decode the stream, not the chunks (metadata is full of non-ASCII titles).
    const script =
      "const b = Buffer.from('✓', 'utf8');" +
      'process.stdout.write(b.subarray(0, 2));' +
      'setTimeout(() => { process.stdout.write(b.subarray(2)); }, 20);';

    const result = await nodeCommandRunner.run(node, ['-e', script], 5000);

    expect(result.stdout).toBe('✓');
  });

  it('rejects when the command cannot be spawned', async () => {
    await expect(nodeCommandRunner.run('md-no-such-binary-xyz', [], 1000)).rejects.toBeInstanceOf(
      Error,
    );
  });

  it('resolves within the post-kill grace even when stdio never closes (the D-state shape)', async () => {
    // SIGKILL cannot unstick uninterruptible I/O, and 'close' additionally waits for stdio to
    // drain — a grandchild holding the inherited stdout simulates exactly that: the child is
    // killed at the timeout but 'close' stays pending. The run must resolve as timed out after
    // a short grace instead of wedging the reactor's dispatch behind a pipe that never closes.
    const script =
      "const { spawn } = require('node:child_process');" +
      "spawn(process.execPath, ['-e', 'setTimeout(() => undefined, 2000)'], { stdio: ['ignore', 'inherit', 'inherit'] });" +
      'setTimeout(() => undefined, 60_000);';
    const startedAt = Date.now();

    const result = await nodeCommandRunner.run(node, ['-e', script], 100);

    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(1900); // resolved by grace, not by the pipe
  });

  it('never stamps a false timeout on a process that already exited', async () => {
    // The exit→close window can span the timeout deadline when stdio is still draining (here: a
    // grandchild holds stdout after the child exits cleanly). The timer must recognize the
    // process as already exited and leave the result untainted — a completed decode reported as
    // a timeout would turn a good verdict into a retryable fault.
    const script =
      "const { spawn } = require('node:child_process');" +
      "spawn(process.execPath, ['-e', 'setTimeout(() => undefined, 1200)'], { stdio: ['ignore', 'inherit', 'inherit'] }).unref();" +
      "process.stdout.write('done');";

    const result = await nodeCommandRunner.run(node, ['-e', script], 300);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('done');
  });
});
