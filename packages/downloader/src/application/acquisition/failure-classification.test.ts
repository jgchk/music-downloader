import { describe, expect, it } from 'vitest';
import { classifyCommandError, describeCommandError } from './failure-classification.js';
import { infraError, permanentInfraError } from '../ports/errors.js';

describe('classifyCommandError', () => {
  it('classifies transient infrastructure faults and concurrency conflicts as retryable', () => {
    expect(classifyCommandError(infraError('mb', 'down'))).toBe('retryable');
    expect(
      classifyCommandError({ kind: 'ConcurrencyConflict', streamId: 'acq-1', expectedVersion: 1 }),
    ).toBe('retryable');
  });

  it('classifies adapter-marked permanent faults as permanent', () => {
    expect(classifyCommandError(permanentInfraError('mb', 'schema drift'))).toBe('permanent');
  });

  it('classifies every domain refusal as a rejection — the stream already settled it', () => {
    expect(classifyCommandError({ kind: 'AlreadyExists' })).toBe('rejection');
    expect(
      classifyCommandError({
        kind: 'IllegalTransition',
        command: 'RecordTarget',
        phase: 'Searching',
      }),
    ).toBe('rejection');
    expect(classifyCommandError({ kind: 'UnknownEdition', releaseMbid: 'boot-1' })).toBe(
      'rejection',
    );
  });
});

describe('describeCommandError', () => {
  it('renders infra faults as operation-message and domain errors as their JSON shape', () => {
    expect(describeCommandError(infraError('mb', 'down'))).toBe('mb: down');
    expect(describeCommandError({ kind: 'AlreadyExists' })).toContain('AlreadyExists');
  });
});
