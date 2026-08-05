import { describe, expect, it } from 'vitest';
import { nodeCommandRunner } from './runner.js';

describe('nodeCommandRunner', () => {
  it('captures stdout, stderr, and the exit code of a completed run', async () => {
    const result = await nodeCommandRunner.run(
      process.execPath,
      ['-e', 'console.log("out"); console.error("err"); process.exit(3)'],
      5000,
    );
    expect(result).toEqual({ code: 3, stdout: 'out\n', stderr: 'err\n', timedOut: false });
  });

  it('kills a run that exceeds its timeout and flags it', async () => {
    const result = await nodeCommandRunner.run(
      process.execPath,
      ['-e', 'setTimeout(() => undefined, 60_000)'],
      100,
    );
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
  });

  it('decodes multi-byte UTF-8 split across chunk boundaries intact', async () => {
    // A per-chunk `Buffer#toString` corrupts a code point whose bytes straddle two chunks — the
    // bridge's stdout is JSON.parsed, so a split non-ASCII artist name would read as a crash.
    const script =
      "const b = Buffer.from('✓', 'utf8');" +
      'process.stdout.write(b.subarray(0, 2));' +
      'setTimeout(() => { process.stdout.write(b.subarray(2)); }, 20);';

    const result = await nodeCommandRunner.run(process.execPath, ['-e', script], 5000);

    expect(result.stdout).toBe('✓');
  });

  it('rejects when the binary cannot be spawned at all', async () => {
    await expect(nodeCommandRunner.run('/nonexistent/interpreter', [], 1000)).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
  });
});
