import type { PendingReviewDto } from '@music/importer';

/**
 * The resolution verb inventory (reviews-register-alignment D1.6/D11): one entry per verb
 * carrying the imperative button copy, the destructive confirm step's consequence, and the
 * timeline's past-tense retelling, so a verb cannot diverge its tellings. Labels follow the
 * affordance register: verb-led sentence-case fragments naming their object, consequence after
 * an em-dash (never a parenthesized aside), stated as the composed system's actual contract —
 * rejecting a delivery as unusable resumes the search; a plain rejection ends the story (the
 * importer never publishes it, so nothing more is tried — reviews-register-alignment D2).
 */

export type ResolutionVerb = NonNullable<PendingReviewDto['availableActions']>[number];

interface ResolutionTelling {
  /** Imperative verb-led label; the object is named where the verb alone is ambiguous. */
  readonly label: string;
  /** The em-dash consequence clause — the system's actual contract, not a hedge. */
  readonly consequence?: string;
  /** The timeline's past-tense retelling — same verb, tense-shifted (one verb per action). */
  readonly echo: string;
}

/**
 * File-deleting verbs render low-emphasis danger and confirm in-page before dispatch
 * (reviews-register-alignment D5); the shape compile-forces each destructive entry to carry the
 * confirm step's consequence copy, and only those entries to carry it.
 */
export type ResolutionAction = ResolutionTelling &
  (
    | { readonly destructive: false }
    | { readonly destructive: true; readonly confirmConsequence: string }
  );

export const RESOLUTION_ACTIONS = {
  'apply-candidate': {
    label: 'Approve this match',
    echo: 'you approved a match',
    destructive: false,
  },
  'supply-id': {
    label: 'Search with this release ID',
    echo: 'you supplied a release ID — the candidates were searched again',
    destructive: false,
  },
  'refresh-candidates': {
    label: 'Refresh the candidates',
    consequence: 'search the connected sources again',
    echo: 'you refreshed the candidates',
    destructive: false,
  },
  'manual-tags': {
    label: 'Import with these tags',
    echo: 'you imported it with your own tags',
    destructive: false,
  },
  'import-as-is': {
    label: 'Import as-is',
    consequence: 'keep the current tags',
    echo: 'you imported it as-is',
    destructive: false,
  },
  reject: {
    label: 'Reject the import',
    consequence: 'delete the files; nothing more will be tried',
    echo: 'you rejected the import',
    destructive: true,
    confirmConsequence:
      'This deletes the downloaded files. Nothing more will be tried — request the release again for another attempt.',
  },
  'retry-enrichment': {
    label: 'Retry the failed steps',
    echo: 'you retried the failed steps',
    destructive: false,
  },
  'reject-unusable-delivery': {
    label: 'Reject the files',
    consequence: 'delete them and search for a replacement',
    echo: 'you rejected the files — the search resumed',
    destructive: true,
    confirmConsequence:
      'This deletes the downloaded files. The search for a replacement continues.',
  },
  accept: {
    label: 'Accept it as-is',
    consequence: 'leave the failed steps undone',
    echo: 'you accepted it despite the failed steps',
    destructive: false,
  },
} as const satisfies Record<ResolutionVerb, ResolutionAction>;

/**
 * The destructive subset, DERIVED from the inventory's own flags — never a hand-kept literal
 * list (review finding: a parallel list would let a future destructive verb silently bypass the
 * confirmation gate). A new `destructive: true` entry widens this union and breaks every
 * exhaustive consumer at compile time.
 */
export type DestructiveVerb = {
  [K in ResolutionVerb]: (typeof RESOLUTION_ACTIONS)[K] extends { destructive: true } ? K : never;
}[ResolutionVerb];

export function isDestructive(verb: ResolutionVerb): verb is DestructiveVerb {
  return RESOLUTION_ACTIONS[verb].destructive;
}

/** The rendered button text: label, with its consequence joined by an em-dash when one exists. */
export function actionButtonText(verb: ResolutionVerb): string {
  const action: ResolutionAction = RESOLUTION_ACTIONS[verb];
  return action.consequence === undefined
    ? action.label
    : `${action.label} \u{2014} ${action.consequence}`;
}

/** The confirm step's consequence line — inventory-owned, so the three tellings share one home. */
export function confirmConsequence(verb: DestructiveVerb): string {
  return RESOLUTION_ACTIONS[verb].confirmConsequence;
}

/**
 * The pending destructive resolution awaiting its in-page confirmation
 * (reviews-register-alignment D5). Discriminated per verb so an arm can only carry its own
 * echoed payload — a plain reject with `reasons` is unrepresentable. The verb arms intersect the
 * inventory-derived destructive set, so a new destructive verb breaks the route's exhaustive
 * construction at compile time rather than silently skipping confirmation.
 */
export type ConfirmState =
  | { verb: DestructiveVerb & 'reject'; reason?: string }
  | { verb: DestructiveVerb & 'reject-unusable-delivery'; reasons?: string };

/** The known verbs as a runtime set, for narrowing an untrusted form value. */
export const KNOWN_VERBS: ReadonlySet<string> = new Set(Object.keys(RESOLUTION_ACTIONS));
