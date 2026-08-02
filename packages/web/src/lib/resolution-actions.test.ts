import { describe, expect, it } from 'vitest';
import {
  actionButtonText,
  confirmConsequence,
  isDestructive,
  RESOLUTION_ACTIONS,
  type ResolutionAction,
  type ResolutionVerb,
} from './resolution-actions.js';

/**
 * The verb inventory is the single source for an action's tellings — imperative button copy,
 * the destructive confirm step's consequence, and the past-tense timeline echo (design
 * reviews-register-alignment D1.6/D11). These tests pin the register rules the inventory must
 * obey as properties over the whole table, so a new verb inherits the rules automatically.
 */

const VERBS = Object.keys(RESOLUTION_ACTIONS) as ResolutionVerb[];
const ACTIONS: readonly (readonly [ResolutionVerb, ResolutionAction])[] = VERBS.map((verb) => [
  verb,
  RESOLUTION_ACTIONS[verb],
]);

describe('RESOLUTION_ACTIONS', () => {
  it('names exactly the file-deleting verbs destructive', () => {
    const destructive = VERBS.filter((verb) => isDestructive(verb)).toSorted((a, b) =>
      a.localeCompare(b),
    );
    expect(destructive).toEqual(['reject', 'reject-unusable-delivery']);
  });

  it('states the composed contract on the unusable-delivery rejection: the search resumes', () => {
    expect(actionButtonText('reject-unusable-delivery')).toBe(
      'Reject the files — delete them and search for a replacement',
    );
  });

  it('states the composed contract on the plain rejection: nothing more will be tried', () => {
    expect(actionButtonText('reject')).toBe(
      'Reject the import — delete the files; nothing more will be tried',
    );
  });

  it.each(ACTIONS)('verb %s carries no parenthesized aside in any telling', (verb, action) => {
    expect(actionButtonText(verb)).not.toMatch(/[()]/u);
    expect(action.echo).not.toMatch(/[()]/u);
  });

  it.each(ACTIONS)('verb %s hedges no deterministic outcome in any telling', (_verb, action) => {
    const tellings = [
      action.label,
      action.consequence ?? '',
      action.echo,
      action.destructive ? action.confirmConsequence : '',
    ];
    for (const telling of tellings) {
      expect(telling).not.toMatch(/\bmay\b/u);
    }
  });

  it('joins a consequence-bearing label with an em-dash', () => {
    expect(actionButtonText('import-as-is')).toBe('Import as-is — keep the current tags');
  });

  it('renders a consequence-free verb as its bare label', () => {
    expect(actionButtonText('retry-enrichment')).toBe('Retry the failed steps');
  });

  it.each(ACTIONS)('verb %s echoes in the user’s past-tense voice', (_verb, action) => {
    expect(action.echo).toMatch(/^you /u);
  });
});

describe('isDestructive', () => {
  it('is true only for the deleting verbs', () => {
    expect(isDestructive('reject')).toBe(true);
    expect(isDestructive('reject-unusable-delivery')).toBe(true);
    expect(isDestructive('accept')).toBe(false);
    expect(isDestructive('apply-candidate')).toBe(false);
  });
});

describe('confirmConsequence', () => {
  it('restates the deletion plus the composed contract for each destructive verb', () => {
    expect(confirmConsequence('reject')).toBe(
      'This deletes the downloaded files. Nothing more will be tried — request the release again for another attempt.',
    );
    expect(confirmConsequence('reject-unusable-delivery')).toBe(
      'This deletes the downloaded files. The search for a replacement continues.',
    );
  });
});
