import { describe, expect, it } from 'vitest';
import { dateKey, dateLabel, durationGloss, entryTime, fullTime } from './time.js';

const NOW = '2026-08-01T12:00:00Z';

describe('entryTime — the hybrid display', () => {
  it('reads as now within the first minute', () => {
    expect(entryTime('2026-08-01T11:59:30Z', NOW, 'UTC')).toBe('now');
  });

  it('reads in minutes under an hour', () => {
    expect(entryTime('2026-08-01T11:56:00Z', NOW, 'UTC')).toBe('4 min ago');
    expect(entryTime('2026-08-01T11:59:00Z', NOW, 'UTC')).toBe('1 min ago');
  });

  it('reads in hours under a day', () => {
    expect(entryTime('2026-08-01T09:00:00Z', NOW, 'UTC')).toBe('3 h ago');
  });

  it('reads as an absolute date and time beyond a day', () => {
    expect(entryTime('2026-07-23T14:41:00Z', NOW, 'UTC')).toBe('23 Jul 2026, 14:41');
  });

  it('a timestamp from the future degrades to now rather than a negative age', () => {
    expect(entryTime('2026-08-01T12:00:30Z', NOW, 'UTC')).toBe('now');
  });
});

describe('fullTime', () => {
  it('renders the complete absolute timestamp for hover metadata', () => {
    expect(fullTime('2026-07-23T14:41:07Z', 'UTC')).toBe('23 Jul 2026, 14:41:07');
  });
});

describe('dateKey and dateLabel — the divider vocabulary', () => {
  it('keys entries by calendar date', () => {
    expect(dateKey('2026-07-23T14:41:00Z', 'UTC')).toBe('2026-07-23');
    expect(dateKey('2026-07-23T23:59:59Z', 'UTC')).toBe('2026-07-23');
  });

  it('labels a divider with the full date', () => {
    expect(dateLabel('2026-07-23T14:41:00Z', 'UTC')).toBe('23 July 2026');
  });
});

describe('durationGloss — the closing-row summary', () => {
  it('reads in seconds under a minute', () => {
    expect(durationGloss('2026-08-01T10:00:00Z', '2026-08-01T10:00:42Z')).toBe('42 s from request');
  });

  it('reads in minutes under an hour', () => {
    expect(durationGloss('2026-08-01T10:00:00Z', '2026-08-01T10:06:30Z')).toBe(
      '6 min from request',
    );
  });

  it('reads in hours under a day', () => {
    expect(durationGloss('2026-08-01T10:00:00Z', '2026-08-01T13:30:00Z')).toBe('3 h from request');
  });

  it('reads in days beyond that', () => {
    expect(durationGloss('2026-07-29T10:00:00Z', '2026-08-01T10:00:00Z')).toBe('3 d from request');
  });

  it('yields nothing for an inverted or degenerate span', () => {
    expect(durationGloss('2026-08-01T10:00:00Z', '2026-08-01T09:00:00Z')).toBeUndefined();
  });
});

describe('malformed timestamps degrade visibly instead of throwing (tolerant reader)', () => {
  it('renders the raw value for an unparseable timestamp — never a silent blank', () => {
    expect(entryTime('not-a-date', NOW, 'UTC')).toBe('not-a-date');
    expect(fullTime('not-a-date', 'UTC')).toBe('not-a-date');
    expect(dateLabel('not-a-date', 'UTC')).toBe('not-a-date');
  });

  it('suppresses the date divider (typed undefined) for an unparseable timestamp', () => {
    expect(dateKey('not-a-date', 'UTC')).toBeUndefined();
  });

  it('a malformed clock still renders each entry’s own absolute time', () => {
    expect(entryTime('2026-07-23T14:41:00Z', 'not-a-clock', 'UTC')).toBe('23 Jul 2026, 14:41');
  });
});

describe('boundaries', () => {
  it('a full day exactly reads as absolute, not hours', () => {
    expect(entryTime('2026-07-31T12:00:00Z', NOW, 'UTC')).toBe('31 Jul 2026, 12:00');
  });

  it('a zero-length story span yields no duration gloss', () => {
    expect(durationGloss('2026-08-01T10:00:00Z', '2026-08-01T10:00:00Z')).toBeUndefined();
  });
});
