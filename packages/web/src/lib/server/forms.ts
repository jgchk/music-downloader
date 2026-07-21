import type { SubmitAcquisitionRequestDto } from '@music/downloader';
import type { ResolveReviewRequestDto } from '@music/importer';

/**
 * Form-data translation: flat HTML form fields into the facades' nested wire DTOs. Deliberately
 * lenient — empty fields are omitted and numbers pass through as given — because the facade's zod
 * boundary owns validation; this layer only reshapes.
 */

function text(data: FormData, name: string): string | undefined {
  const value = data.get(name);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function num(data: FormData, name: string): number | undefined {
  const value = text(data, name);
  return value === undefined ? undefined : Number(value);
}

function compact<T extends Record<string, unknown>>(obj: T): T | undefined {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
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
      : { kind, targetType: text(data, 'targetType'), mbid: text(data, 'mbid') };

  const order = text(data, 'qualityOrder')
    ?.split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

  const dto: SubmitAcquisitionRequestDto = {
    request: request as SubmitAcquisitionRequestDto['request'],
    qualityPolicy: compact({ order, floor: text(data, 'qualityFloor') }) as never,
    matchPolicy: compact({ threshold: num(data, 'matchThreshold') }),
    retryPolicy: compact({
      maxSearchRounds: num(data, 'maxSearchRounds'),
      maxTotalAttempts: num(data, 'maxTotalAttempts'),
      timeBudgetMs: num(data, 'timeBudgetMs'),
    }),
    downloadPolicy: compact({
      stallTimeoutMs: num(data, 'stallTimeoutMs'),
      maxQueueWaitMs: num(data, 'maxQueueWaitMs'),
    }),
  };
  return JSON.parse(JSON.stringify(dto));
}

/** Repopulation echo of the submit form: what the user typed, keyed by field name. */
export function submitFormValues(data: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of data.entries()) {
    if (typeof value === 'string') values[key] = value;
  }
  return values;
}

/** The review resolution form: a `verb` field plus per-verb fields, reshaped to the union. */
export function resolveReviewForm(data: FormData): unknown {
  const verb = text(data, 'verb');
  switch (verb) {
    case 'apply-candidate':
      return compactResolution({
        verb,
        candidate: { dataSource: text(data, 'dataSource'), albumId: text(data, 'albumId') },
        duplicateAction: text(data, 'duplicateAction'),
      });
    case 'supply-id':
      return compactResolution({ verb, mbReleaseId: text(data, 'mbReleaseId') });
    case 'manual-tags':
      return compactResolution({
        verb,
        tags: {
          albumArtist: text(data, 'albumArtist'),
          album: text(data, 'album'),
          year: num(data, 'year'),
          tracks: manualTracks(data),
        },
      });
    case 'reject':
      return compactResolution({ verb, reason: text(data, 'reason') });
    case 'reject-and-retry-download': {
      const reasons = text(data, 'reasons')
        ?.split('\n')
        .map((s) => s.trim())
        .filter((s) => s !== '');
      return compactResolution({ verb, reasons });
    }
    // The remaining verbs carry no payload; unknown verbs pass through for the facade to refuse.
    default:
      return { verb };
  }
}

function manualTracks(data: FormData): unknown[] {
  const tracks: unknown[] = [];
  for (let i = 0; ; i += 1) {
    const path = text(data, `tracks.${i}.path`);
    const title = text(data, `tracks.${i}.title`);
    if (path === undefined && title === undefined) break;
    tracks.push(
      Object.fromEntries(
        Object.entries({
          path,
          title,
          artist: text(data, `tracks.${i}.artist`),
          trackNumber: num(data, `tracks.${i}.trackNumber`),
          discNumber: num(data, `tracks.${i}.discNumber`),
        }).filter(([, v]) => v !== undefined),
      ),
    );
  }
  return tracks;
}

function compactResolution(value: Record<string, unknown>): unknown {
  return JSON.parse(JSON.stringify(value)) as ResolveReviewRequestDto;
}
