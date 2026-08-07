import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The entrypoint, exercised as a process (change: mutation-gate-diff-scope).
 *
 * `verdict.ts` and `verdict-summary.ts` are pure and tested without one. This file exists for the
 * two properties that only a process has, and that are exactly the ones the shipped gate promises:
 *
 *   • **shadow never fails the job.** The verdict step carries no `continue-on-error`, deliberately,
 *     so ANY non-zero exit from this script fails the PR — including one this script did not choose.
 *     A crash on the way to printing is therefore a shadow-mode gate that blocks, which is the one
 *     thing shadow mode is defined not to do.
 *   • **the same input exits 0 under shadow and 1 under enforce**, so the measurement being taken in
 *     shadow is a measurement of the enforcing program.
 */

const ROOT = path.resolve(import.meta.dirname, '../..');

const workspaces: string[] = [];

afterAll(() => {
  for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
});

function workspace(): string {
  const made = mkdtempSync(path.join(tmpdir(), 'pr-verdict-'));
  workspaces.push(made);
  return made;
}

interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(args: readonly string[], env: Readonly<Record<string, string>> = {}): Run {
  // spawnSync rather than execFileSync: the latter discards stderr on a zero exit, and the shadow
  // scenarios below are precisely the ones that exit zero AND must have said something in the log.
  const result = spawnSync('pnpm', ['exec', 'tsx', 'scripts/mutation/pr-verdict.ts', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

const SURVIVOR_ON_LINE_20 = JSON.stringify({
  files: {
    'a.ts': {
      mutants: [
        {
          mutatorName: 'ConditionalExpression',
          status: 'Survived',
          location: { start: { line: 20 }, end: { line: 20, column: 20 } },
          replacement: 'true',
        },
      ],
    },
  },
});

const DIFF = ['diff --git a.ts a.ts', '--- a.ts', '+++ a.ts', '@@ -20 +20 @@', '+edited'].join(
  '\n',
);

function fixture(): { readonly diff: string; readonly report: string; readonly dir: string } {
  const dir = workspace();
  const diff = path.join(dir, 'changed.diff');
  const report = path.join(dir, 'mutation.json');
  writeFileSync(diff, DIFF);
  writeFileSync(report, SURVIVOR_ON_LINE_20);
  return { diff, report, dir };
}

describe('the shadow guarantee holds through the process', () => {
  it('exits 0 on a blocking finding and publishes it', () => {
    const { diff, report } = fixture();

    const result = run([diff, report]);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/would have blocked/i);
  });

  it('exits 0, and still explains itself, when the report cannot be opened at all', () => {
    // A path that EXISTS and is unreadable as a file — a directory is the cheap portable case, and
    // it stands in for EACCES, EISDIR and a TOCTOU race with the existence check. Reading it throws.
    // Unhandled, that throw escapes before anything is written, so the step exits non-zero with a
    // stack trace and no summary: shadow mode fails the PR. This is the regression this scenario
    // exists for, and the failure is silent in the worst way — it looks like the gate working.
    const { diff, dir } = fixture();

    const result = run([diff, dir]);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/## Mutation verdict/);
    expect(result.stdout).toMatch(/no report|could not (be )?read/i);
  });

  it('exits 0 when the diff cannot be opened, rather than crashing', () => {
    const { report, dir } = fixture();

    const result = run([dir, report]);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/## Mutation verdict/);
  });
});

describe('enforcement changes the exit code and nothing else', () => {
  it('exits 1 on the same finding shadow exited 0 on', () => {
    const { diff, report } = fixture();

    const shadow = run([diff, report]);
    const enforcing = run([diff, report], { MUTATION_GATE_ENFORCE: 'true' });

    expect(shadow.status).toBe(0);
    expect(enforcing.status).toBe(1);
    // The findings themselves are identical; only the banner and the exit code move.
    expect(enforcing.stdout).toContain('| `a.ts` | 20 |');
    expect(shadow.stdout).toContain('| `a.ts` | 20 |');
  });

  it('exits 1 under enforcement when the run wrote no report', () => {
    const { diff, dir } = fixture();

    const result = run([diff, path.join(dir, 'absent.json')], { MUTATION_GATE_ENFORCE: 'true' });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/no-report/);
  });

  it('names the blocking verdict on stderr, because stdout is the step summary', () => {
    const { diff, report } = fixture();

    // stdout is redirected into `$GITHUB_STEP_SUMMARY` by the workflow, so a reader of the JOB LOG
    // sees nothing at all unless the reason is written separately. Shadow included: a verdict
    // nobody can find in the log is the dead advisory channel this change exists to escape.
    expect(run([diff, report]).stderr).toMatch(/Would block \(shadow\)/);
  });
});
