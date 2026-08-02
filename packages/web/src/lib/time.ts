/**
 * Time rendering for the acquisition timeline (design D6): the hybrid display — relative phrasing
 * under 24 hours ("now" inside a minute), absolute date-and-time beyond — with the full timestamp
 * always available for the `time` element's hover metadata. Pure functions of their inputs: the
 * caller supplies "now" (the page load stamps it), so nothing here reads the wall clock.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function formatAbsolute(
  iso: string,
  timeZone: string | undefined,
  shouldShowSeconds: boolean,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: shouldShowSeconds ? '2-digit' : undefined,
    hour12: false,
  }).format(date);
  return `${day}, ${time}`;
}

/** The hybrid entry display: "now" < 1 min, minutes < 1 h, hours < 24 h, absolute beyond. */
export function entryTime(iso: string, nowIso: string, timeZone?: string): string {
  const age = new Date(nowIso).getTime() - new Date(iso).getTime();
  if (Number.isNaN(age)) return '';
  if (age < MINUTE_MS) return 'now';
  if (age < HOUR_MS) return `${Math.floor(age / MINUTE_MS)} min ago`;
  if (age < DAY_MS) return `${Math.floor(age / HOUR_MS)} h ago`;
  return formatAbsolute(iso, timeZone, false);
}

/** The complete absolute timestamp, for the `time` element's `title`. */
export function fullTime(iso: string, timeZone?: string): string {
  return formatAbsolute(iso, timeZone, true);
}

/** The calendar-date key a divider is inserted on when it changes between entries. */
export function dateKey(iso: string, timeZone?: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** The divider's human label for a calendar date. */
export function dateLabel(iso: string, timeZone?: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

/** The coarse whole-story duration appended to a settled story's closing entry. */
export function durationGloss(fromIso: string, toIso: string): string | undefined {
  const span = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (Number.isNaN(span) || span <= 0) return undefined;
  if (span < MINUTE_MS) return `${Math.floor(span / 1000)} s from request`;
  if (span < HOUR_MS) return `${Math.floor(span / MINUTE_MS)} min from request`;
  if (span < DAY_MS) return `${Math.floor(span / HOUR_MS)} h from request`;
  return `${Math.floor(span / DAY_MS)} d from request`;
}
