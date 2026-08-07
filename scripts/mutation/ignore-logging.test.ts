import { describe, expect, it } from 'vitest';
import { ARID_LOGGING_REASON, isLoggerCall, shouldIgnoreMutant } from './ignore-logging.mjs';

/**
 * The one arid rule this repo configures rather than suppresses site-by-site.
 *
 * Log statements are behavior-free by construction here: the domain does not log at all
 * (bootstrap-acquisition-core D15), and
 * everywhere else a logger call's arguments reach a transport and nothing else. Mutating the message
 * of `logger.warn({ id }, 'retry scheduled')` produces a mutant no honest test can kill — the only
 * test that would is one asserting on log text, which is a test pinned to a diagnostic rather than
 * to behavior, and this repo does not write those.
 *
 * That makes 253 of the seeding run's mutants a single rule, not 253 findings. The waiver
 * doctrine is explicit about which form that should take: "A rejected rule is disabled once, in
 * configuration, with its reason — visible to everyone. A per-site suppression is the exception."
 * A `// Stryker disable` comment on each of the 121 log sites would also be the exact thing the
 * doctrine says to watch for — "a rising suppression count is the signal that the rule failed admission".
 *
 * The scenarios below hold the rule to its stated scope, because an over-broad arid rule is how a
 * mutation gate quietly stops auditing real code.
 */

const identifier = (name: string) => ({ type: 'Identifier', name });

const call = (callee: unknown) => ({ type: 'CallExpression', callee });

/** `<object>.<method>(…)` */
const method = (object: unknown, name: string) => ({
  type: 'MemberExpression',
  object,
  property: identifier(name),
  computed: false,
});

/** `<receiver>.<level>(…)` — the shape the rule is asked about throughout. */
const callOn = (receiver: unknown, name: string) => call(method(receiver, name));

describe('arid logging', () => {
  it('ignores a call on a bare logger', () => {
    expect(isLoggerCall(callOn(identifier('logger'), 'warn'))).toBe(true);
  });

  it('ignores a call on a logger reached through a dependency bundle', () => {
    // The shape the reactors and use-cases actually use: `this.dependencies.logger.error(…)`.
    const bundle = method(identifier('this'), 'dependencies');
    const dependencies = method(bundle, 'logger');

    expect(isLoggerCall(callOn(dependencies, 'error'))).toBe(true);
  });

  it.each(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])(
    'ignores a logger.%s call',
    (level) => {
      expect(isLoggerCall(callOn(identifier('logger'), level))).toBe(true);
    },
  );

  it('does not ignore a non-logging method on a logger', () => {
    // `logger.child({ … })` returns a logger that later code uses; emptying its bindings is a real
    // change to every line that logger writes, so it stays observed.
    expect(isLoggerCall(callOn(identifier('logger'), 'child'))).toBe(false);
  });

  it('does not ignore a logging-shaped method on something that is not a logger', () => {
    // The rule keys on the receiver, not the verb. `reporter.error(…)`, `result.error`, or a
    // domain `policy.warn(…)` are behavior, and a rule that matched them would blind the gate to it.
    expect(isLoggerCall(callOn(identifier('reporter'), 'error'))).toBe(false);
    expect(isLoggerCall(callOn(identifier('bridge'), 'info'))).toBe(false);
  });

  it('does not ignore a plain function call, a member read, or a non-call node', () => {
    expect(isLoggerCall(call(identifier('warn')))).toBe(false);
    expect(isLoggerCall(method(identifier('logger'), 'warn'))).toBe(false);
    expect(isLoggerCall(identifier('logger'))).toBe(false);
    expect(isLoggerCall(undefined)).toBe(false);
    expect(isLoggerCall(null)).toBe(false);
  });

  it('does not ignore a computed access that only looks like a level', () => {
    // `logger[level](…)` names no level statically; ignoring it would ignore a call the rule
    // cannot actually read.
    const computed = {
      type: 'MemberExpression',
      object: identifier('logger'),
      property: identifier('error'),
      computed: true,
    };

    expect(isLoggerCall(call(computed))).toBe(false);
  });

  it('states its reason, which is what Stryker records against every mutant it ignores', () => {
    expect(ARID_LOGGING_REASON).toMatch(/log/i);
    expect(ARID_LOGGING_REASON.length).toBeGreaterThan(20);
  });
});

describe('what the rule actually ignores', () => {
  /**
   * A stand-in for the babel path Stryker hands the plugin. Offsets are the real mechanism — the
   * containment check compares byte ranges — so they are modelled rather than mocked away.
   */
  const pathAt = (start: number, end: number, call: unknown) => ({
    node: { start, end },
    findParent: (isMatch: (parent: { node: unknown }) => boolean) =>
      isMatch({ node: call }) ? { node: call } : undefined,
  });

  /** `logger.warn({ id }, 'msg')` — callee spans 0-10, arguments span 11-20 and 21-30. */
  const loggerCall = {
    type: 'CallExpression',
    callee: {
      type: 'MemberExpression',
      object: { type: 'Identifier', name: 'logger' },
      property: { type: 'Identifier', name: 'warn' },
      computed: false,
      start: 0,
      end: 10,
    },
    arguments: [
      { start: 11, end: 20 },
      { start: 21, end: 30 },
    ],
  };

  it('ignores a mutant inside a log argument', () => {
    expect(shouldIgnoreMutant(pathAt(12, 19, loggerCall))).toBe(ARID_LOGGING_REASON);
    expect(shouldIgnoreMutant(pathAt(21, 30, loggerCall))).toBe(ARID_LOGGING_REASON);
  });

  it('does not ignore a mutant in the callee — changing which method is called is behavior', () => {
    expect(shouldIgnoreMutant(pathAt(0, 10, loggerCall))).toBeUndefined();
  });

  it('does not ignore a mutant in the statement around the call', () => {
    // The load-bearing narrowing: emptying a block that merely CONTAINS a log line can also drop a
    // `return`, so a node spanning wider than any argument stays observed.
    expect(shouldIgnoreMutant(pathAt(0, 40, loggerCall))).toBeUndefined();
    expect(shouldIgnoreMutant(pathAt(31, 39, loggerCall))).toBeUndefined();
  });

  it('does not ignore a mutant with no logger ancestor at all', () => {
    const notALogger = {
      type: 'CallExpression',
      callee: { type: 'Identifier', name: 'compute' },
      arguments: [],
    };

    expect(shouldIgnoreMutant(pathAt(12, 19, notALogger))).toBeUndefined();
  });
});
