import { parseCandidateIdentity } from '../../domain/candidate/candidate.js';
import type {
  Candidate,
  CandidateFile,
  SourceReliability,
} from '../../domain/candidate/candidate.js';
import type { TargetType } from '../../domain/target/target.js';
import type { SlskdSearchFile, SlskdSearchResponse } from './schemas.js';

/**
 * Pure mapping from slskd search responses to source-agnostic {@link Candidate}s (D11, the
 * anti-corruption layer). Grouping follows the target's granularity — one candidate per file for a
 * track, one candidate per source folder for a release. Advertised audio attributes are carried as
 * hints only; validation inspects the real bytes later (D5). slskd advertises bitrate in kbps and
 * duration in seconds — both are normalized here to the domain's bits/sec and milliseconds. The
 * responses arrive already validated against the contract schema (D2), so this consumes the
 * inferred types directly.
 */

/** Soulseek paths are Windows-style; split on either separator to be safe. */
function lastSeparator(path: string): number {
  return Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
}

export function baseName(path: string): string {
  return path.slice(lastSeparator(path) + 1);
}

function folderOf(path: string): string {
  const index = lastSeparator(path);
  return index === -1 ? '' : path.slice(0, index);
}

function codecOf(filename: string): string | undefined {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? undefined : filename.slice(dot + 1).toLowerCase();
}

/** The resolved name is threaded in from the caller — only files with a name survive to here. */
function toCandidateFile(file: SlskdSearchFile, filename: string): CandidateFile {
  return {
    name: baseName(filename),
    sizeBytes: file.size ?? 0,
    codec: codecOf(filename),
    bitrate: file.bitRate === undefined ? undefined : file.bitRate * 1000,
    sampleRate: file.sampleRate,
    bitDepth: file.bitDepth,
    durationMs: file.length === undefined ? undefined : file.length * 1000,
  };
}

function reliabilityOf(response: SlskdSearchResponse): SourceReliability {
  return {
    speedBytesPerSec: response.uploadSpeed ?? 0,
    freeSlots: response.hasFreeUploadSlot === true ? 1 : 0,
    queueLength: response.queueLength ?? 0,
  };
}

function trackCandidates(
  username: string,
  files: readonly SlskdSearchFile[],
  source: SourceReliability,
): Candidate[] {
  return files.flatMap((file) => {
    // Parse at this ACL edge: a file with no username/path is unaddressable, so it is dropped
    // rather than admitted with a blank (collision-prone) dedup key.
    const filename = file.filename ?? '';
    const identity = parseCandidateIdentity({
      username,
      path: filename,
      sizeBytes: file.size ?? 0,
    });
    if (identity.isErr()) return [];
    return [{ identity: identity.value, files: [toCandidateFile(file, filename)], source }];
  });
}

function folderCandidates(
  username: string,
  files: readonly SlskdSearchFile[],
  source: SourceReliability,
): Candidate[] {
  const byFolder = new Map<string, { file: SlskdSearchFile; filename: string }[]>();
  for (const file of files) {
    const filename = file.filename ?? '';
    const folder = folderOf(filename);
    const entry = { file, filename };
    const bucket = byFolder.get(folder);
    if (bucket === undefined) byFolder.set(folder, [entry]);
    else bucket.push(entry);
  }
  return [...byFolder].flatMap(([folder, entries]) => {
    const identity = parseCandidateIdentity({
      username,
      path: folder,
      sizeBytes: entries.reduce((sum, entry) => sum + (entry.file.size ?? 0), 0),
    });
    if (identity.isErr()) return [];
    return [
      {
        identity: identity.value,
        files: entries.map((entry) => toCandidateFile(entry.file, entry.filename)),
        source,
      },
    ];
  });
}

/** Group slskd search responses into candidates at the target's granularity. */
export function mapSearchResponses(
  responses: readonly SlskdSearchResponse[],
  targetType: TargetType,
): Candidate[] {
  return responses.flatMap((response) => {
    const username = response.username ?? '';
    const source = reliabilityOf(response);
    const files = response.files ?? [];
    return targetType === 'track'
      ? trackCandidates(username, files, source)
      : folderCandidates(username, files, source);
  });
}

/**
 * Reconstruct the slskd remote filename to enqueue for a candidate file. A track candidate keeps
 * the full remote path in its identity; a folder candidate keeps the folder, so the file's base
 * name is re-appended. Uniform rule: if the candidate path already ends at this file, use it as-is.
 */
export function remoteFilename(candidatePath: string, fileName: string): string {
  return baseName(candidatePath) === fileName ? candidatePath : `${candidatePath}\\${fileName}`;
}
