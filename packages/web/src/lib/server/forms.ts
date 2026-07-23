import type { SubmitAcquisitionRequestDto } from '@music/downloader';

/**
 * Form-data translation: flat HTML form fields into the facades' nested wire DTOs. Deliberately
 * lenient — empty fields are omitted and numbers pass through as given — because the facade's zod
 * boundary owns validation; this layer only reshapes.
 */

function text(data: FormData, name: string): string | undefined {
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

  const dto: SubmitAcquisitionRequestDto = {
    request: request as SubmitAcquisitionRequestDto['request'],
    qualityPolicy: compact({ order, floor: text(data, 'qualityFloor') }) as never,
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

/** The review resolution form: a `verb` field plus per-verb fields, reshaped to the union. */
export function resolveReviewForm(data: FormData): unknown {
  const verb = text(data, 'verb');
  switch (verb) {
    case 'apply-candidate': {
      return compactResolution({
        verb,
        candidate: { dataSource: text(data, 'dataSource'), albumId: text(data, 'albumId') },
        duplicateAction: text(data, 'duplicateAction'),
      });
    }
    case 'supply-id': {
      return compactResolution({ verb, mbReleaseId: text(data, 'mbReleaseId') });
    }
    case 'manual-tags': {
      return compactResolution({
        verb,
        tags: {
          albumArtist: text(data, 'albumArtist'),
          album: text(data, 'album'),
          year: number_(data, 'year'),
          tracks: manualTracks(data),
        },
      });
    }
    case 'reject': {
      return compactResolution({ verb, reason: text(data, 'reason') });
    }
    case 'reject-unusable-delivery': {
      const reasons = text(data, 'reasons')
        ?.split('\n')
        .map((s) => s.trim())
        .filter((s) => s !== '');
      return compactResolution({ verb, reasons });
    }
    // The remaining verbs carry no payload; unknown verbs pass through for the facade to refuse.
    default: {
      return { verb };
    }
  }
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
