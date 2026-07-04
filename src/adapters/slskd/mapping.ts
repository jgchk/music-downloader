import type {
  Candidate,
  CandidateFile,
  CandidateIdentity,
  SourceReliability,
} from '../../domain/candidate/candidate.js';
import type { TargetType } from '../../domain/target/target.js';

/**
 * Pure mapping from slskd search responses to source-agnostic {@link Candidate}s (D11, the
 * anti-corruption layer). Grouping follows the target's granularity — one candidate per file for a
 * track, one candidate per source folder for a release. Advertised audio attributes are carried as
 * hints only; validation inspects the real bytes later (D5). slskd advertises bitrate in kbps and
 * duration in seconds — both are normalized here to the domain's bits/sec and milliseconds.
 */

interface SlskdSearchFile {
  readonly filename?: string;
  readonly size?: number;
  readonly bitRate?: number; // kbps
  readonly sampleRate?: number; // Hz
  readonly bitDepth?: number; // bits per sample
  readonly length?: number; // seconds
}

interface SlskdSearchResponse {
  readonly username?: string;
  readonly hasFreeUploadSlot?: boolean;
  readonly uploadSpeed?: number; // bytes/sec
  readonly queueLength?: number;
  readonly files?: readonly SlskdSearchFile[];
}

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

function toCandidateFile(file: SlskdSearchFile): CandidateFile {
  const filename = file.filename ?? '';
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
  return files.map((file) => {
    const identity: CandidateIdentity = {
      username,
      path: file.filename ?? '',
      sizeBytes: file.size ?? 0,
    };
    return { identity, files: [toCandidateFile(file)], source };
  });
}

function folderCandidates(
  username: string,
  files: readonly SlskdSearchFile[],
  source: SourceReliability,
): Candidate[] {
  const byFolder = new Map<string, SlskdSearchFile[]>();
  for (const file of files) {
    const folder = folderOf(file.filename ?? '');
    const bucket = byFolder.get(folder);
    if (bucket === undefined) byFolder.set(folder, [file]);
    else bucket.push(file);
  }
  return [...byFolder].map(([folder, folderFiles]) => {
    const identity: CandidateIdentity = {
      username,
      path: folder,
      sizeBytes: folderFiles.reduce((sum, file) => sum + (file.size ?? 0), 0),
    };
    return { identity, files: folderFiles.map(toCandidateFile), source };
  });
}

/** Group raw slskd search responses into candidates at the target's granularity. */
export function mapSearchResponses(json: unknown, targetType: TargetType): Candidate[] {
  const responses = (json as readonly SlskdSearchResponse[] | undefined) ?? [];
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
