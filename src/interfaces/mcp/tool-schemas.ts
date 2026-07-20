import { z } from 'zod';
import {
  downloadPolicySchema,
  matchPolicySchema,
  qualityPolicySchema,
  retryPolicySchema,
  targetTypeSchema,
} from '../contracts/index.js';
import type { AcquisitionRequestDto, SubmitAcquisitionRequestDto } from '../contracts/index.js';

/**
 * MCP-local tool schemas (D12). Anthropic tool-use / Claude Desktop cannot consume a JSON-Schema
 * `oneOf`/`anyOf` union: the field silently degrades to type "any" and the model can no longer form
 * valid arguments. So while the shared HTTP/OpenAPI contract models the acquisition request as a
 * discriminated union (which REST clients handle fine), the MCP adapter advertises a *flat* request
 * object — a `kind` discriminator plus optional per-variant fields — and enforces the
 * "which fields are required for which kind" rule server-side with a refinement. The emitted JSON
 * Schema therefore contains no union keyword at all. The flat input is translated back into the
 * shared request DTO before it reaches the unchanged use-case path, so MCP behaviour is identical to
 * HTTP for well-formed calls.
 */

/** Flat, union-free acquisition request for the `submit_acquisition` tool. */
const flatRequestSchema = z
  .object({
    kind: z
      .enum(['musicbrainz', 'descriptor'])
      .describe(
        'Which kind of request. "musicbrainz" identifies a release by MusicBrainz id (needs mbid). "descriptor" identifies it by artist/title text (needs artist and title).',
      ),
    targetType: targetTypeSchema.describe('Whether to acquire a full "album" or a single "track".'),
    mbid: z
      .string()
      .min(1)
      .optional()
      .describe('MusicBrainz release id. Required when kind="musicbrainz"; ignored otherwise.'),
    artist: z
      .string()
      .min(1)
      .optional()
      .describe('Artist name. Required when kind="descriptor"; ignored otherwise.'),
    title: z
      .string()
      .min(1)
      .optional()
      .describe('Release or track title. Required when kind="descriptor"; ignored otherwise.'),
    album: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Optional album name to disambiguate a descriptor request (e.g. the album a track appears on).',
      ),
  })
  .meta({
    examples: [
      { kind: 'descriptor', targetType: 'album', artist: 'Radiohead', title: 'In Rainbows' },
      { kind: 'musicbrainz', targetType: 'album', mbid: '00000000-0000-0000-0000-000000000000' },
    ],
  })
  .superRefine((request, ctx) => {
    if (request.kind === 'musicbrainz') {
      if (request.mbid === undefined) {
        ctx.addIssue({ code: 'custom', message: 'kind=musicbrainz requires mbid', path: ['mbid'] });
      }
      return;
    }
    if (request.artist === undefined || request.title === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'kind=descriptor requires artist and title',
        path: [request.artist === undefined ? 'artist' : 'title'],
      });
    }
  });

/** Top-level input schema for the `submit_acquisition` tool: a flat request plus optional policies. */
export const submitAcquisitionToolSchema = z.object({
  request: flatRequestSchema,
  qualityPolicy: qualityPolicySchema.optional(),
  matchPolicy: matchPolicySchema.optional(),
  retryPolicy: retryPolicySchema.optional(),
  downloadPolicy: downloadPolicySchema.optional(),
});

export type SubmitAcquisitionToolInput = z.infer<typeof submitAcquisitionToolSchema>;

/** Prose description advertised for the tool, spelling out the conditional requirements + examples. */
export const submitAcquisitionToolDescription =
  'Submit an acquisition request; returns the acquisition id. The `request` object is flat: set `kind` to choose how the release is identified and `targetType` to "album" or "track". ' +
  'To grab an album by name: kind="descriptor", targetType="album", artist, title (album optional). ' +
  'To grab it by MusicBrainz release id: kind="musicbrainz", targetType="album", mbid. ' +
  'Rules enforced server-side: kind="musicbrainz" requires mbid; kind="descriptor" requires artist and title.';

/** Translate the flat, refinement-validated request into the shared request DTO. */
function toRequestDto(request: SubmitAcquisitionToolInput['request']): AcquisitionRequestDto {
  if (request.kind === 'musicbrainz') {
    // `mbid` is guaranteed present by the refinement for musicbrainz requests.
    return { kind: 'musicbrainz', mbid: request.mbid!, targetType: request.targetType };
  }
  // `artist`/`title` are guaranteed present by the refinement for descriptor requests.
  return {
    kind: 'descriptor',
    targetType: request.targetType,
    artist: request.artist!,
    title: request.title!,
    ...(request.album !== undefined ? { album: request.album } : {}),
  };
}

/** Translate the flat tool input into the shared submit DTO the use-case path already accepts. */
export function toSubmitAcquisitionDto(
  input: SubmitAcquisitionToolInput,
): SubmitAcquisitionRequestDto {
  return {
    request: toRequestDto(input.request),
    qualityPolicy: input.qualityPolicy,
    matchPolicy: input.matchPolicy,
    retryPolicy: input.retryPolicy,
    downloadPolicy: input.downloadPolicy,
  };
}
