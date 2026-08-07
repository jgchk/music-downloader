import { cell, plural } from './markdown.ts';
import {
  ENFORCE_SWITCH,
  type SwitchReading,
  type UnauditedReason,
  type Verdict,
  type VerdictFinding,
} from './verdict.ts';

/**
 * Renders the changed-line verdict for a CI job summary (change: mutation-gate-diff-scope).
 *
 * The presenter to `verdict.ts`'s model, exactly as `summarize.ts` is the presenter to
 * `report-model.ts`. It decides nothing; it explains what was decided.
 *
 * Under shadow this text IS the product. The job's conclusion does not move, so a reader who cannot
 * tell "clean" from "would have blocked" from "nothing was audited" is looking at an advisory
 * channel with no consumer — the shape v3.18.0 already demonstrated on this repository when 45
 * survivors were reported into a step summary nothing read. Under enforcement the same text is what
 * the loop acts on, and a finding whose remedy is not obvious from its own report is one that gets
 * appeased rather than fixed.
 */

const HEADING = '## Mutation verdict — changed lines';

/**
 * The wall-clock at which design D2's recorded tuning lever — variant (B), range-scoping the
 * Stryker run itself with `--mutate 'path:start-end'` — becomes the thing to do. Named here so the
 * switch is triggered by a number in the summary rather than by somebody's patience.
 */
const LEVER_SECONDS = 15 * 60;

export interface RenderContext {
  readonly reading: SwitchReading;
  /** How long the Stryker step took, when the job measured it. */
  readonly strykerSeconds: number | undefined;
}

function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes === 0 ? `${rest}s` : `${minutes}m${String(rest).padStart(2, '0')}s`;
}

/** Shadow says what it *would* do; enforcement says what it *is* doing. Never both. */
function banner(reading: SwitchReading): readonly string[] {
  if (reading.enforcement === 'enforce') {
    return ['> **Enforcing.** A blocking verdict fails this job.'];
  }
  const unrecognised =
    reading.unrecognised === undefined
      ? []
      : [
          '',
          `> \`${ENFORCE_SWITCH}\` is set to \`${cell(reading.unrecognised)}\`, which is not recognised as on or off —`,
          '> it was ignored and the gate stayed in shadow.',
        ];
  return [
    '> **Shadow mode.** This verdict is published, not enforced: it does not fail the job.',
    `> Set \`${ENFORCE_SWITCH}=true\` on the \`mutation\` job to make it blocking, once the shadow`,
    '> measurement clears the ten-percent effective-false-positive bar (`mutation-gate` 4.1a/4.1b).',
    ...unrecognised,
  ];
}

function table(findings: readonly VerdictFinding[]): readonly string[] {
  return [
    '| File | Line | Status | Mutator | Replacement | Also on line |',
    '| --- | --- | --- | --- | --- | --- |',
    ...findings.map((finding) => {
      const also = finding.folded === 0 ? '—' : `+${finding.folded}`;
      return `| \`${finding.file}\` | ${finding.line} | ${finding.mutant.status} | ${finding.mutant.mutatorName} | \`${cell(finding.mutant.replacement ?? '')}\` | ${also} |`;
    }),
  ];
}

/**
 * One sentence per refusal, because "unaudited" with no cause gets re-run rather than fixed.
 *
 * A total record rather than an if-chain with a trailing `return`: that shape told a fourth reason,
 * confidently and wrongly, that the path spellings had drifted — sending a reader to debug a
 * normalisation bug that does not exist. `Record<UnauditedReason, …>` makes the next reason a build
 * break here instead.
 */
const UNAUDITED_SENTENCE: Record<UnauditedReason, readonly string[]> = {
  'no-mutants': [
    'The scope produced no mutants at all, so nothing was audited. This is not a clean run.',
  ],
  'all-ignored': [
    'Every mutant in this scope was ignored as arid or unmeasurable, so nothing here was actually',
    'audited. This is not a clean run.',
  ],
  'no-diff': [
    'No changed-line diff reached this step, so there was nothing to test the surviving mutants',
    'against. The mutation run itself may be fine — this is the step BEFORE it that failed: the',
    'scope step writes the diff, and either it did not run, wrote nothing, or wrote it somewhere',
    'this step did not look. Read the job log above rather than the mutants.',
  ],
  'no-file-joined': [
    'The mutation report names files the diff does not, so those mutants could not be tested against',
    'any changed line and that part of the scope was not audited. The two **path** spellings have',
    "drifted apart — the report is keyed relative to the run's working directory, the diff by",
    '`git diff --no-prefix` — and until they agree this gate measures less than it appears to.',
  ],
};

function unauditedSentence(
  reason: UnauditedReason,
  unjoined: readonly string[] | undefined,
): readonly string[] {
  const named =
    unjoined === undefined || unjoined.length === 0
      ? []
      : ['', 'Reported but not found in the diff:', ...unjoined.map((file) => `- \`${file}\``)];
  return [...UNAUDITED_SENTENCE[reason], ...named];
}

function body(verdict: Verdict, reading: SwitchReading): readonly string[] {
  if (verdict.kind === 'no-report') {
    return [
      'The run produced no report — it died before it could write one. A run that did not happen is',
      'not a run that found nothing. Read the job log above.',
    ];
  }
  if (verdict.kind === 'unreadable-report') {
    return [
      'The run wrote a report this verdict could not read — malformed JSON, or a shape it does not',
      'recognise (a Stryker upgrade?). Read the job log above.',
    ];
  }
  if (verdict.kind === 'unaudited') {
    return unauditedSentence(verdict.reason, verdict.unjoined);
  }

  const analysed = `Analysed **${plural(verdict.counted.mutants, 'mutant')}** across **${plural(verdict.counted.files, 'file')}**${
    verdict.counted.ignored > 0 ? ` (${verdict.counted.ignored} ignored — arid or static)` : ''
  }.`;

  if (verdict.kind === 'clean') {
    const elsewhere =
      verdict.reportedSurvivors === 0
        ? 'No surviving mutants anywhere in the scope.'
        : `${plural(verdict.reportedSurvivors, 'surviving mutant')} elsewhere in the changed files ${verdict.reportedSurvivors === 1 ? 'is' : 'are'} listed in the report above and did not block this branch — the reporting scope stays file-wide while the failure scope is the changed lines.`;
    return [
      'No surviving mutant sits on a line this branch added or modified.',
      '',
      analysed,
      '',
      elsewhere,
    ];
  }

  const verb =
    reading.enforcement === 'enforce'
      ? `**${plural(verdict.findings.length, 'finding')}** — this blocks this branch.`
      : `**${plural(verdict.findings.length, 'finding')}** — shadow mode **would have blocked** this branch.`;

  return [
    verb,
    '',
    analysed,
    '',
    'Each row is a change the whole suite failed to notice, on a span overlapping a line this branch',
    'wrote. Kill it',
    'with a test that asserts the behaviour, delete the code if it has none, or — if the line is',
    'genuinely arid — suppress it at the site with a written justification',
    '(`// Stryker disable next-line <mutator>: <reason>`).',
    '',
    'At most one mutant is named per line; a line carrying more is marked, and killing the named one',
    'usually kills its siblings.',
    '',
    ...table(verdict.findings),
  ];
}

/** How long the run took, and — past the threshold — what to do about it. */
function timing(seconds: number | undefined): readonly string[] {
  if (seconds === undefined) return [];
  const lever =
    seconds < LEVER_SECONDS
      ? []
      : [
          `> Past the ${duration(LEVER_SECONDS)} mark. Design D2's recorded lever is variant (B): build`,
          "> `--mutate 'path:start-end,…'` from the hunks so the run itself is range-scoped. It trades the",
          '> file-wide report at diff time for wall-clock; the weekly full run stays the wide channel.',
        ];
  return ['', `Stryker step: **${duration(seconds)}**.`, ...lever];
}

/** Markdown for a job summary: the banner, the decision, the evidence, the clock. */
export function renderVerdict(verdict: Verdict, context: RenderContext): string {
  return [
    HEADING,
    '',
    ...banner(context.reading),
    '',
    ...body(verdict, context.reading),
    ...timing(context.strykerSeconds),
    '',
  ].join('\n');
}
