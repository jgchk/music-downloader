import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { StoredEvent } from '../../../src/application/ports/event-store-port.js';
import type { AcquisitionEvent } from '../../../src/domain/acquisition/events.js';
import {
  importingHistory,
  matchingCandidate,
  sampleFiles,
  sampleTarget,
} from '../../../src/domain/acquisition/__fixtures__/acquisition-fixtures.js';
import { publishedEventMapping } from '../../../src/interfaces/contracts/events/mapping.js';
import { parseMbid } from '../../../src/domain/shared/mbid.js';
import { createTarget } from '../../../src/domain/target/target.js';
import {
  eventFixturesDirectory,
  historySnapshots,
} from '../../../scripts/contracts/event-schemas.js';

/**
 * Records the frozen published-payload fixtures: real payloads rendered by the real mapping over a
 * deterministic fixture history. Run once per schema version (`pnpm tsx test/contract/record/events.ts`);
 * committed fixtures are FROZEN — never regenerate an existing version (the durable catch-up
 * subscriptions replay old-version events from the log after deploys, so every historical version
 * must stay verifiable against the consumer's tolerant reader).
 *
 * Because of that freeze the default run VERIFIES rather than writes: an existing fixture is
 * compared against a fresh render and left untouched (exit 1 on drift). Pass `--overwrite` only to
 * record a version that has no fixture yet.
 */

const OCCURRED_AT = '2026-07-19T12:00:00.000Z';
const LOCATION = '/library/Radiohead/Kid A (2000)';
const candidate = matchingCandidate('peer1');

/**
 * The published payload carries an mbid, so the recorded history resolves to a target that has one.
 * Both the id and the target are built the way production builds them — `parseMbid` then
 * `createTarget` — rather than patched onto the fixture target: a spread would forge the `Target`
 * brand around whatever string was handed in, and the frozen fixture would then record a shape the
 * system can never actually hold.
 */
const identifiedTarget = createTarget({
  type: sampleTarget.type,
  artist: sampleTarget.artist,
  title: sampleTarget.title,
  year: sampleTarget.year,
  tracks: sampleTarget.tracks,
  mbid: parseMbid('6e335887-60ba-38f0-95af-fae8774d20fd')._unsafeUnwrap(),
})._unsafeUnwrap();

const history: readonly AcquisitionEvent[] = [
  ...importingHistory([candidate]).map((event) =>
    event.type === 'TargetResolved' ? { ...event, target: identifiedTarget } : event,
  ),
  { type: 'Imported', candidate: candidate.identity, location: LOCATION, files: sampleFiles },
  { type: 'AcquisitionFulfilled', location: LOCATION },
];

const prefix: readonly StoredEvent[] = history.map((event, index) => ({
  globalSeq: index + 1,
  streamId: '1e6cbf59-7f3f-4b39-8ad9-0d84b3d5c5f4',
  version: index,
  type: event.type,
  event,
  metadata: { acquisitionId: '1e6cbf59-7f3f-4b39-8ad9-0d84b3d5c5f4', occurredAt: OCCURRED_AT },
}));

const rendered = publishedEventMapping.render(prefix.at(-1)!, prefix);
if (rendered.isErr()) {
  console.error('rendering failed:', rendered.error);
  process.exit(1);
}

const type = rendered.value.type;
const version = historySnapshots(type).at(-1)?.version ?? 1;
const directory = eventFixturesDirectory(type);
const fixturePath = path.join(directory, `v${String(version)}.json`);
mkdirSync(directory, { recursive: true });

/**
 * An existing fixture is FROZEN, and every run re-stamps `recordedAt` — so writing unconditionally
 * would dirty the artifact even when the payload is identical, and "verified rather than
 * regenerated" would mean restoring from a backup afterwards. Default to VERIFY: re-render, compare
 * the payload the tier actually replays, and leave the file alone. `--overwrite` is the deliberate
 * escape hatch, needed only when a genuinely new schema version has no fixture yet.
 */
if (existsSync(fixturePath) && !process.argv.includes('--overwrite')) {
  const frozen = JSON.stringify(
    (JSON.parse(readFileSync(fixturePath, 'utf8')) as { event: unknown }).event,
    null,
    2,
  );
  const current = JSON.stringify(rendered.value, null, 2);
  if (frozen !== current) {
    console.error(`DRIFT: ${fixturePath} is not what the mapping renders today`);
    console.error(`frozen:\n${frozen}`);
    console.error(`rendered:\n${current}`);
    process.exit(1);
  }
  console.log(`verified ${fixturePath} — unchanged, nothing written`);
} else {
  writeFileSync(
    fixturePath,
    `${JSON.stringify(
      {
        provenance: {
          recordedAt: new Date().toISOString(),
          schemaVersion: version,
          note: 'Rendered by src/interfaces/contracts/events/mapping.ts over a deterministic fixture history. FROZEN — never regenerate.',
        },
        event: rendered.value,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`wrote ${fixturePath}`);
}
