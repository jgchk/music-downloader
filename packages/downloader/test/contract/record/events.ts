import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StoredEvent } from '../../../src/application/ports/event-store-port.js';
import type { AcquisitionEvent } from '../../../src/domain/acquisition/events.js';
import {
  importingHistory,
  matchingCandidate,
  sampleFiles,
} from '../../../src/domain/acquisition/__fixtures__/acquisition-fixtures.js';
import { publishedEventMapping } from '../../../src/interfaces/contracts/events/mapping.js';
import {
  eventFixturesDir,
  historySnapshots,
  publishedEventSchemas,
} from '../../../scripts/contracts/event-schemas.js';

/**
 * Records the frozen published-payload fixtures: real payloads rendered by the real mapping over a
 * deterministic fixture history. Run once per schema version (`pnpm tsx test/contract/record/events.ts`);
 * committed fixtures are FROZEN — never regenerate an existing version (webhook retries legitimately
 * deliver old-version events after deploys, so every historical version must stay verifiable).
 */

const OCCURRED_AT = '2026-07-19T12:00:00.000Z';
const LOCATION = '/library/Radiohead/Kid A (2000)';
const candidate = matchingCandidate('peer1');

const history: readonly AcquisitionEvent[] = [
  ...importingHistory([candidate]).map((event) =>
    event.type === 'TargetResolved'
      ? { ...event, target: { ...event.target, mbid: '6e335887-60ba-38f0-95af-fae8774d20fd' } }
      : event,
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
const dir = eventFixturesDir(type);
const path = join(dir, `v${String(version)}.json`);
mkdirSync(dir, { recursive: true });
writeFileSync(
  path,
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
console.log(`wrote ${path}`);
