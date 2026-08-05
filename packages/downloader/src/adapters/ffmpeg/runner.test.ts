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
});
