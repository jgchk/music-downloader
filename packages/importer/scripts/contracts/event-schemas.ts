import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ZodType } from 'zod';
import {
  RELEASE_VERDICT_TYPE,
  releaseVerdictEventSchema,
} from '../../src/interfaces/contracts/events/schemas.js';

/**
 * The published-event contract artifacts (change: outbound-release-verdicts): shared library for
 * the generator CLI (`generate-event-schemas.ts`) and the contract-test gate
 * (`test/contract/events.contract.test.ts`).
 *
 * Artifact layout (stable paths — consumer repos contract-test against these):
 *   contracts/events/<type>.schema.json            — the current JSON Schema, generated from zod
 *   contracts/events/history/<type>/<n>.schema.json — append-only snapshots, kept permanently
 *   test/contract/fixtures/events/<type>/*.json     — frozen payload fixtures, kept permanently
 */

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export interface PublishedEventSchemaSource {
  readonly type: string;
  readonly schema: ZodType;
}

/** The catalog of published event types — additive: future types join here. */
export const publishedEventSchemas: readonly PublishedEventSchemaSource[] = [
  { type: RELEASE_VERDICT_TYPE, schema: releaseVerdictEventSchema },
];

export const eventContractsDirectory = path.join(REPO_ROOT, 'contracts', 'events');

export function latestSchemaPath(type: string): string {
  return path.join(eventContractsDirectory, `${type}.schema.json`);
}

export function historyDirectory(type: string): string {
  return path.join(eventContractsDirectory, 'history', type);
}

export function eventFixturesDirectory(type: string): string {
  return path.join(REPO_ROOT, 'test', 'contract', 'fixtures', 'events', type);
}

export interface HistorySnapshot {
  readonly version: number;
  readonly path: string;
}

/** The committed history snapshots for a type, ordered oldest → newest. */
export function historySnapshots(type: string): readonly HistorySnapshot[] {
  const directory = historyDirectory(type);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .map((name) => /^(\d+)\.schema\.json$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ version: Number(match[1]), path: path.join(directory, match[0]) }))
    .toSorted((a, b) => a.version - b.version);
}

/**
 * Generate the publishable JSON Schema from the zod source. zod's output-mode schema closes every
 * object (`additionalProperties: false`) because parsing strips unknown keys — correct for our
 * outbound validation, but hostile to consumers pinned to an old version when a field is later
 * added. Published contracts must stay open to unknown fields (the tolerant-reader posture), so
 * closed-object markers are stripped.
 */
export function generateJsonSchema(source: PublishedEventSchemaSource): unknown {
  return openObjects(z.toJSONSchema(source.schema));
}

function openObjects(node: unknown): unknown {
  if (Array.isArray(node)) return node.map((member) => openObjects(member));
  if (!isRecord(node)) return node;
  const entries = Object.entries(node)
    .filter(([key, value]) => !(key === 'additionalProperties' && value === false))
    .map(([key, value]) => [key, openObjects(value)] as const);
  return Object.fromEntries(entries);
}

function isRecord(node: unknown): node is Record<string, unknown> {
  return typeof node === 'object' && node !== null && !Array.isArray(node);
}

function isSameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Structural additive-compatibility check: everything a consumer of `previous` may rely on must
 * survive in `next`. Non-additive (each returns a violation): removing or retyping a property,
 * dropping a required marker, removing an enum/anyOf alternative, or changing a declared default.
 * Purely additive changes — new optional properties, new enum values — pass.
 */
export function additivityViolations(previous: unknown, next: unknown): readonly string[] {
  const violations: string[] = [];
  walk(previous, next, '$', violations);
  return violations;
}

function walk(previous: unknown, next: unknown, path: string, out: string[]): void {
  if (!isRecord(previous) || !isRecord(next)) {
    if (!isSameJson(previous, next)) out.push(`${path}: schema changed`);
    return;
  }
  if (!isSameJson(previous.type, next.type)) {
    out.push(
      `${path}: type changed (${JSON.stringify(previous.type)} → ${JSON.stringify(next.type)})`,
    );
  }
  if ('const' in previous && !isSameJson(previous.const, next.const)) {
    out.push(`${path}: const changed`);
  }
  if ('default' in previous && !isSameJson(previous.default, next.default)) {
    out.push(`${path}: default changed`);
  }
  if (Array.isArray(previous.enum)) {
    const nextEnum = Array.isArray(next.enum) ? next.enum : [];
    for (const value of previous.enum) {
      if (nextEnum.every((candidate) => !isSameJson(candidate, value))) {
        out.push(`${path}: enum value ${JSON.stringify(value)} removed`);
      }
    }
  }
  if (isRecord(previous.properties)) {
    const nextProperties = isRecord(next.properties) ? next.properties : {};
    for (const [key, sub] of Object.entries(previous.properties)) {
      if (Object.hasOwn(nextProperties, key)) walk(sub, nextProperties[key], `${path}.${key}`, out);
      else out.push(`${path}.${key}: property removed`);
    }
    const previousRequired = Array.isArray(previous.required) ? previous.required : [];
    const nextRequired = Array.isArray(next.required) ? next.required : [];
    for (const key of previousRequired) {
      if (!nextRequired.includes(key)) {
        out.push(`${path}.${String(key)}: no longer required (consumers may rely on its presence)`);
      }
    }
  }
  if ('items' in previous) {
    walk(previous.items, isRecord(next) ? next.items : undefined, `${path}[]`, out);
  }
  if (Array.isArray(previous.anyOf)) {
    const nextAnyOf = Array.isArray(next.anyOf) ? next.anyOf : [];
    for (const [index, member] of previous.anyOf.entries()) {
      const isSurvives = nextAnyOf.some((candidate) => {
        const memberViolations: string[] = [];
        walk(member, candidate, path, memberViolations);
        return memberViolations.length === 0;
      });
      if (!isSurvives) out.push(`${path}: anyOf alternative ${index} removed or changed`);
    }
  }
}
