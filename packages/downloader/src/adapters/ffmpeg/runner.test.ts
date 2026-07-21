import { describe, expect, it } from 'vitest';
import { nodeCommandRunner } from './runner.js';

// Exercise the real spawn wiring against the always-present Node binary, so the adapter logic
// can be unit-tested against a fake runner while this proves the process glue itself.
const node = process.execPath;

describe('nodeCommandRunner', () => {
  it('captures stdout, stderr, and the exit code of a completed process', async () => {
    const result = await nodeCommandRunner.run(node, [
      '-e',
      "process.stdout.write('out'); process.stderr.write('err'); process.exit(2)",
    ]);

    expect(result).toEqual({ code: 2, stdout: 'out', stderr: 'err' });
  });

  it('rejects when the command cannot be spawned', async () => {
    await expect(nodeCommandRunner.run('md-no-such-binary-xyz', [])).rejects.toBeInstanceOf(Error);
  });
});
