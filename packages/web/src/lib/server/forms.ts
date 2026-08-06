import type { ResolutionVerb } from '$lib/resolution-actions.js';

/**
 * Form-data translation: flat HTML form fields into the facades' nested wire DTOs. Deliberately
 * lenient — empty fields are omitted and numbers pass through as given — because the facade's zod
 * boundary owns validation; this layer only reshapes.
 */

/** The one reading of a form field, shared so no two consumers can parse the same POST apart. */
export function text(data: FormData, name: string): string | undefined {
  const value = data.get(name);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function number_(data: FormData, name: string): number | undefined {
  const value = text(data, name);
  return value === undefined ? undefined : Number(value);
}

function compact<T extends Record<string, unknown>>(object: T): T | undefined {
  const entries = Object.entries(object).filter(([, v]) => v !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

/** The submit form's flat fields, reshaped to `submitAcquisitionRequestSchema`'s nesting. */
export function submitAcquisitionForm(data: FormData): unknown {
  const kind = text(data, 'kind');
  const request =
    kind === 'descriptor'
      ? {
          kind,
          targetType: text(data, 'targetType'),
          artist: text(data, 'artist'),
          title: text(data, 'title'),
          album: text(data, 'album'),
        }
      : kind === 'release-group'
        ? // A release group is album-only: the target type is fixed here, not read from the form,
          // so a stale UI value cannot smuggle in an invalid track request.
          { kind, targetType: 'album', mbid: text(data, 'mbid') }
        : { kind, targetType: text(data, 'targetType'), mbid: text(data, 'mbid') };

  const order = text(data, 'qualityOrder')
    ?.split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

  // Built as a plain unknown record (the resolveReviewForm shape): the facade's zod boundary is
  // the validator, and impersonating the DTO type here would silence the compile pressure a DTO
  // shape change should exert on this reshaper.
  const dto: Record<string, unknown> = {
    request,
    qualityPolicy: compact({ order, floor: text(data, 'qualityFloor') }),
    matchPolicy: compact({ threshold: number_(data, 'matchThreshold') }),
    retryPolicy: compact({
      maxSearchRounds: number_(data, 'maxSearchRounds'),
      maxTotalAttempts: number_(data, 'maxTotalAttempts'),
      timeBudgetMs: number_(data, 'timeBudgetMs'),
    }),
    downloadPolicy: compact({
      stallTimeoutMs: number_(data, 'stallTimeoutMs'),
      maxQueueWaitMs: number_(data, 'maxQueueWaitMs'),
    }),
  };
  return structuredClone(dto);
}

/** Repopulation echo of the submit form: what the user typed, keyed by field name. */
export function submitFormValues(data: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of data) {
    if (typeof value === 'string') values[key] = value;
  }
  return values;
}

/** Reshapes one verb's per-verb form fields into its resolution payload. */
type VerbReshaper = (verb: string, data: FormData) => unknown;

const noPayload: VerbReshaper = (verb) => ({ verb });

/**
 * One reshaper per known verb, `satisfies`-proven total over the importer's verb union: a new
 * wire verb without an entry here is a compile error, not a silently payload-less POST. Unknown
 * verb strings (a stale form, a hand-crafted POST — including Object.prototype key names, which
 * the `Object.hasOwn` guard keeps from resolving inherited members) fall through to a bare
 * pass-through for the facade to refuse — the same dual regime as the copy layer's gloss maps.
 */
const VERB_RESHAPERS = {
  'apply-candidate': (verb, data) =>
    compactResolution({
      verb,
      candidate: { dataSource: text(data, 'dataSource'), albumId: text(data, 'albumId') },
      duplicateAction: text(data, 'duplicateAction'),
    }),
  'supply-id': (verb, data) => compactResolution({ verb, mbReleaseId: text(data, 'mbReleaseId') }),
  'manual-tags': (verb, data) =>
    compactResolution({
      verb,
      tags: {
        albumArtist: text(data, 'albumArtist'),
        album: text(data, 'album'),
        year: number_(data, 'year'),
        tracks: manualTracks(data),
      },
    }),
  reject: (verb, data) => compactResolution({ verb, reason: text(data, 'reason') }),
  'reject-unusable-delivery': (verb, data) => {
    const reasons = text(data, 'reasons')
      ?.split('\n')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    return compactResolution({ verb, reasons });
  },
  'refresh-candidates': noPayload,
  'import-as-is': noPayload,
  accept: noPayload,
  'retry-enrichment': noPayload,
} satisfies Record<ResolutionVerb, VerbReshaper>;

/** The review resolution form: a `verb` field plus per-verb fields, reshaped to the union. */
export function resolveReviewForm(data: FormData): unknown {
  const verb = text(data, 'verb');
  if (verb === undefined || !Object.hasOwn(VERB_RESHAPERS, verb)) return { verb };
  return VERB_RESHAPERS[verb as keyof typeof VERB_RESHAPERS](verb, data);
}

function manualTracks(data: FormData): unknown[] {
  const tracks: unknown[] = [];
  for (let index = 0; ; index += 1) {
    const path = text(data, `tracks.${index}.path`);
    const title = text(data, `tracks.${index}.title`);
    if (path === undefined && title === undefined) break;
    tracks.push(
      Object.fromEntries(
        Object.entries({
          path,
          title,
          artist: text(data, `tracks.${index}.artist`),
          trackNumber: number_(data, `tracks.${index}.trackNumber`),
          discNumber: number_(data, `tracks.${index}.discNumber`),
        }).filter(([, v]) => v !== undefined),
      ),
    );
  }
  return tracks;
}

function compactResolution(value: Record<string, unknown>): unknown {
  return structuredClone(value);
}
