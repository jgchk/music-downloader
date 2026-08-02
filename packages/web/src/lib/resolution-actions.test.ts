import { describe, expect, it } from 'vitest';
import {
  actionButtonText,
  isDestructive,
  RESOLUTION_ACTIONS,
  resolutionEchoes,
  type ResolutionAction,
} from './resolution-actions.js';

/**
 * The verb inventory is the single source for an action's two tellings — imperative button copy
 * and past-tense timeline echo (design D1.6/D11). These tests pin the register rules the
 * inventory must obey, not every literal string.
 */

describe('RESOLUTION_ACTIONS', () => {
  it('names exactly the file-deleting verbs destructive', () => {
    const destructive = Object.entries(RESOLUTION_ACTIONS)
      .filter(([, action]) => action.destructive)
      .map(([verb]) => verb)
      .toSorted((a, b) => a.localeCompare(b));
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

  it('joins label and consequence with an em-dash, never parentheses', () => {
    for (const verb of Object.keys(RESOLUTION_ACTIONS) as (keyof typeof RESOLUTION_ACTIONS)[]) {
      expect(actionButtonText(verb)).not.toMatch(/[()]/u);
    }
  });

  it('renders a consequence-free verb as its bare label', () => {
    expect(actionButtonText('retry-enrichment')).toBe('Retry the failed steps');
  });

  it('hedges no deterministic outcome: no "may" in any consequence', () => {
    const actions: readonly ResolutionAction[] = Object.values(RESOLUTION_ACTIONS);
    for (const action of actions) {
      expect(action.consequence ?? '').not.toMatch(/\bmay\b/u);
    }
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

describe('resolutionEchoes', () => {
  it('provides a past-tense echo for every verb in the inventory', () => {
    const echoes = resolutionEchoes();
    for (const verb of Object.keys(RESOLUTION_ACTIONS)) {
      expect(echoes[verb]).toBeTypeOf('string');
      expect(echoes[verb]).toMatch(/^you /u);
    }
  });

  it('echoes the truthful revival on the unusable-delivery rejection', () => {
    expect(resolutionEchoes()['reject-unusable-delivery']).toBe(
      'you rejected the files — the search resumed',
    );
  });
});
