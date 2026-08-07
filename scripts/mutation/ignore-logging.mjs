import { declareValuePlugin, PluginKind } from '@stryker-mutator/api/plugin';

/**
 * A Stryker ignore-plugin that marks log statements arid (change: mutation-gate).
 *
 * Google's mutation deployment calls these "arid nodes": code with no behavior worth asserting, for
 * which every generated mutant is a finding whose only honest fix would be a test pinned to a
 * diagnostic. This repo has exactly one large family of them — logging. The domain does not log at
 * all (bootstrap-acquisition-core D15, and `logging.md`'s "the pure domain performs no logging");
 * everywhere else a logger call's message and context reach a transport and influence nothing a
 * test should assert on. In the seeding run those were 253 mutants — roughly a third of all
 * survivors.
 *
 * Configured once, here, with its reason — rather than a `// Stryker disable` comment on each of the
 * 121 log call sites across 24 files that produced them. The waiver doctrine (`docs/development/quality-gates.md`) asks for
 * exactly that shape: "A rejected rule is disabled once, in configuration, with its reason —
 * visible to everyone. A per-site suppression is the exception." It also names the alternative as
 * an anti-signal: "a rising suppression count is the signal that the rule failed admission".
 *
 * SCOPE, deliberately narrow, because an over-broad arid rule is how a mutation gate stops auditing
 * real code without anyone noticing:
 *   • Only mutants *inside the argument list of* a logger call. The statement around the call is
 *     untouched — emptying a block that happens to contain a log line can also drop a `return`, and
 *     that mutant stays observed.
 *   • Only statically-named levels on a statically-named logger. `logger[level](…)` is not matched:
 *     the rule cannot read what it would be ignoring.
 *   • `logger.child(…)` is NOT matched. Its bindings flow into every line that child logger later
 *     writes, so it is not the same arid thing as a single message.
 *   • The receiver must actually be a logger. The rule keys on the receiver, never on the verb, so
 *     `reporter.error(…)` and a domain `policy.warn(…)` stay observed.
 *
 * Known limitation, accepted and owned here rather than deferred to a doc that does not say it: an
 * expression with a side effect evaluated inside a log call would be ignored along with the call.
 * No such site exists today, and one would be a defect on its own terms — a log argument that
 * changes behaviour makes the log statement load-bearing. Nothing enforces that, so it is a real
 * blind spot, not a proof.
 */

export const ARID_LOGGING_REASON =
  'Arid: log statement. Log message and context reach a transport and nothing else, so no mutant ' +
  'here is killable by a test of behavior (mutation-gate, D6).';

/** The levels pino exposes that write a record and return nothing anyone reads. */
const LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

/** Identifiers we accept as naming a logger, anywhere along the receiver's member chain. */
const LOGGER_NAMES = new Set(['logger', 'log']);

/**
 * True when a node names a logger — either directly (`logger`) or as the tail of a member chain
 * that ends in one (`this.dependencies.logger`, `deps.log`).
 */
function namesLogger(node) {
  let current = node;
  while (current !== null && current !== undefined && typeof current === 'object') {
    if (current.type === 'Identifier') return LOGGER_NAMES.has(current.name);
    if (current.type !== 'MemberExpression' || current.computed === true) return false;
    current = current.property;
  }
  return false;
}

/** True for `<logger>.<level>(…)` with both the receiver and the level named statically. */
export function isLoggerCall(node) {
  if (node === null || node === undefined || typeof node !== 'object') return false;
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (
    callee === null ||
    callee === undefined ||
    typeof callee !== 'object' ||
    callee.type !== 'MemberExpression' ||
    callee.computed === true
  ) {
    return false;
  }
  const level = callee.property;
  if (level === null || level === undefined || level.type !== 'Identifier') return false;
  if (!LOG_LEVELS.has(level.name)) return false;
  return namesLogger(callee.object);
}

/**
 * Stryker hands the babel path of each node it is about to mutate. A mutant is arid when it sits
 * within the arguments of a logger call — `findParent` walks outward, and the argument containment
 * check is what keeps the surrounding statement in scope.
 */
export function shouldIgnoreMutant(path) {
  // Deliberately NOT `path.findParent?.(…)`. If a Stryker/Babel upgrade removes this method, the
  // optional call would make the plugin silently ignore nothing — surfacing as ~253 unexplained
  // new survivors, which is an invitation to appease them. A plain call fails loudly instead.
  const call = path.findParent((parent) => isLoggerCall(parent.node));
  if (call === null || call === undefined) return;
  // Only mutants inside an ARGUMENT are arid. A mutant in the callee (`logger.warn` itself) changes
  // which method is called, and one in the statement around the call can drop a `return` — both
  // stay observed. This narrowing is the rule's whole blast-radius bound.
  const withinArguments = call.node.arguments.some(
    (argument) => argument.start <= path.node.start && path.node.end <= argument.end,
  );
  return withinArguments ? ARID_LOGGING_REASON : undefined;
}

export const aridLogging = { shouldIgnore: shouldIgnoreMutant };

/** The name here is what `stryker.config.mjs` must list in `ignorers`. */
export const ARID_LOGGING_IGNORER = 'arid-logging';

export const strykerPlugins = [
  declareValuePlugin(PluginKind.Ignore, ARID_LOGGING_IGNORER, aridLogging),
];
