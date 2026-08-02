import type { PendingReviewDto } from '@music/importer';

/**
 * The resolution verb inventory (design D1.6/D11): one entry per verb carrying the imperative
 * button copy AND the timeline's past-tense retelling, so a verb cannot diverge its two tellings.
 * Labels follow the affordance register: verb-led sentence-case fragments naming their object,
 * consequence after an em-dash (never a parenthesized aside), stated as the composed system's
 * actual contract — rejecting a delivery as unusable resumes the search; a plain rejection ends
 * the story (the importer never publishes it, so nothing more is tried).
 */

export type ResolutionVerb = NonNullable<PendingReviewDto['availableActions']>[number];

export interface ResolutionAction {
  /** Imperative verb-led label; the object is named where the verb alone is ambiguous. */
  readonly label: string;
  /** The em-dash consequence clause — the system's actual contract, not a hedge. */
  readonly consequence?: string;
  /** The timeline's past-tense retelling — same verb, tense-shifted (one verb per action). */
  readonly echo: string;
  /** File-deleting verbs render low-emphasis danger and confirm in-page before dispatch. */
  readonly destructive: boolean;
}

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
  },
  accept: {
    label: 'Accept it as-is',
    consequence: 'leave the failed steps undone',
    echo: 'you accepted it despite the failed steps',
    destructive: false,
  },
} satisfies Record<ResolutionVerb, ResolutionAction>;

/** The rendered button text: label, with its consequence joined by an em-dash when one exists. */
export function actionButtonText(verb: ResolutionVerb): string {
  const action: ResolutionAction = RESOLUTION_ACTIONS[verb];
  return action.consequence === undefined
    ? action.label
    : `${action.label} \u{2014} ${action.consequence}`;
}

export function isDestructive(verb: ResolutionVerb): boolean {
  return RESOLUTION_ACTIONS[verb].destructive;
}

/** The timeline echoes keyed by verb — the narration side of the single verb inventory. */
export function resolutionEchoes(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(RESOLUTION_ACTIONS).map(([verb, action]) => [verb, action.echo]),
  );
}
