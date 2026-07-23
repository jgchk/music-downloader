import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  bridgeApplyOutputSchema,
  bridgeProposeOutputSchema,
  bridgeValidateOutputSchema,
} from '../../src/adapters/beets/schemas.js';

/**
 * Conformance: every recorded bridge fixture must satisfy the same contract schemas the runtime
 * adapter enforces, and must have been recorded against the beets version the image pins. This is
 * what makes a beets upgrade a deliberate, verified event: bump the pin, re-record, and any
 * reshaped output fails here before it can ship.
 */

const FIXTURE_DIR = new URL('./fixtures/beets-bridge/', import.meta.url).pathname;
const REQUIREMENTS = new URL('../../src/adapters/beets/bridge/requirements.txt', import.meta.url)
  .pathname;

interface Fixture {
  readonly provenance: {
    readonly beets: string;
    readonly capturedAt: string;
    readonly recorder: string;
  };
  readonly verb: 'propose' | 'apply' | 'validate';
  readonly name: string;
  readonly output: unknown;
}

const schemaForVerb: Record<Fixture['verb'], z.ZodType> = {
  propose: bridgeProposeOutputSchema,
  apply: bridgeApplyOutputSchema,
  validate: bridgeValidateOutputSchema,
};

const fixtures: Fixture[] = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as Fixture);

function pinnedBeetsVersion(): string {
  const pin = /beets\[[^\]]*\]==([0-9.]+)/u.exec(readFileSync(REQUIREMENTS, 'utf8'));
  if (pin === null) throw new Error('no beets pin found in requirements.txt');
  return pin[1]!;
}

describe('recorded bridge fixtures', () => {
  it('cover every verb and both mood families (outcomes and refusals)', () => {
    const verbs = new Set(fixtures.map((fixture) => fixture.verb));
    expect([...verbs].sort()).toEqual(['apply', 'propose', 'validate']);
    expect(fixtures.some((fixture) => fixture.name.includes('doomed'))).toBe(true);
    expect(fixtures.some((fixture) => fixture.name.includes('applied'))).toBe(true);
  });

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    '%s carries provenance from the pinned beets',
    (_name, fixture) => {
      expect(fixture.provenance.beets).toBe(pinnedBeetsVersion());
      expect(fixture.provenance.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(fixture.provenance.recorder).toBe('test/contract/record-bridge-fixtures.sh');
    },
  );

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    '%s validates against the runtime contract schema',
    (_name, fixture) => {
      const result = schemaForVerb[fixture.verb].safeParse(fixture.output);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    },
  );
});

describe('fixture semantics the domain relies on', () => {
  // A strong proposal sits under, and a weak one over, the domain's auto-apply threshold — the
  // boundary that decides review vs. auto-import (see the ImportPolicy default).
  const AUTO_APPLY_MAX = 0.04;

  function output(name: string): Record<string, unknown> {
    const found = fixtures.find((fixture) => fixture.name === name);
    if (found === undefined) throw new Error(`missing fixture ${name}`);
    return found.output as Record<string, unknown>;
  }

  it('a pinned strong proposal carries a (data_source, album_id) keyed candidate at distance ~0', () => {
    const proposal = output('propose-pinned-strong') as {
      candidates: { data_source: string; album_id: string; distance: number; tracks: unknown[] }[];
    };
    expect(proposal.candidates).toHaveLength(1);
    expect(proposal.candidates[0]!.data_source).toBe('MusicBrainz');
    expect(proposal.candidates[0]!.album_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(proposal.candidates[0]!.distance).toBeLessThan(AUTO_APPLY_MAX);
    expect(proposal.candidates[0]!.tracks).toHaveLength(2);
  });

  it('a duration-mangled rip still resolves but with a failing distance and penalty detail', () => {
    const proposal = output('propose-weak-durations') as {
      candidates: { distance: number; penalties: { name: string }[] }[];
    };
    expect(proposal.candidates[0]!.distance).toBeGreaterThan(AUTO_APPLY_MAX);
    expect(proposal.candidates[0]!.penalties.map((penalty) => penalty.name)).toContain('tracks');
  });

  it('a retag/extra rip carries the concrete field-level differences behind the distance', () => {
    const proposal = output('propose-diff-detail') as {
      candidates: {
        tracks: {
          title: string;
          current?: { title: string; length: number };
          distance?: number;
        }[];
        extra_items?: { path: string; title: string }[];
        album_fields?: { year: number; media: string };
      }[];
    };
    const best = proposal.candidates[0]!;
    // A retagged track: the file's current title differs from the candidate's proposed title, and
    // the per-track distance records that this mapped pair is not a clean match.
    const retagged = best.tracks.find(
      (track) => track.current !== undefined && track.current.title !== track.title,
    );
    expect(retagged).toBeDefined();
    expect(retagged!.current!.length).toBeGreaterThan(0);
    expect(retagged!.distance).toBeGreaterThan(0);
    // A downloaded file that matched no candidate track (the `unmatched_tracks` penalty concretely).
    expect(best.extra_items!.length).toBeGreaterThan(0);
    // The candidate's album-level fields ride along for the album-field diff.
    expect(best.album_fields!.year).toBeGreaterThan(0);
    expect(best.album_fields!.media).not.toBe('');
  });

  it('a short rip surfaces the candidate tracks no file supplies (missing tracks)', () => {
    const proposal = output('propose-missing-track') as {
      candidates: { extra_tracks?: { title: string; index: number }[] }[];
    };
    // Only one file for the two-track release: the second track is missing (no file supplies it).
    expect(proposal.candidates[0]!.extra_tracks!.length).toBeGreaterThan(0);
    expect(proposal.candidates[0]!.extra_tracks![0]!.title).not.toBe('');
  });

  it('an incumbent surfaces as a duplicate on propose and blocks a plain apply', () => {
    const proposal = output('propose-with-incumbent') as { duplicates: unknown[] };
    expect(proposal.duplicates).toHaveLength(1);
    const apply = output('apply-skipped-duplicate') as { status: string; incumbents: unknown[] };
    expect(apply.status).toBe('skipped-duplicate');
    expect(apply.incumbents).toHaveLength(1);
  });

  it('a vanished candidate dooms the apply instead of guessing', () => {
    expect(output('apply-doomed-candidate-not-found')).toMatchObject({
      status: 'doomed',
      kind: 'candidate-not-found',
    });
  });

  it('validate reports the pinned beets version and the forced session overlay', () => {
    expect(output('validate-valid')).toMatchObject({
      beets_version: pinnedBeetsVersion(),
      plugins: ['musicbrainz'],
    });
    const overlay = (output('validate-valid') as { overlay: { import: Record<string, unknown> } })
      .overlay;
    expect(overlay.import).toMatchObject({ resume: false, incremental: false, timid: false });
  });
});
