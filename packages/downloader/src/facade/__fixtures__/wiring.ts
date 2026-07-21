import { FakeEventStore, fixedClock, sequentialIds } from '../../application/__fixtures__/fakes.js';
import {
  AcquisitionStatusProjection,
  ProgressReadModel,
} from '../../application/projections/read-models.js';
import type { UseCaseDeps } from '../../application/acquisition/use-cases.js';
import { createDownloaderFacade } from '../index.js';
import type { DownloaderFacade } from '../index.js';

/**
 * A minimal in-memory wiring of the use-case dependencies for interface tests. `sync()` pumps the
 * store into the status projection, standing in for the reactor/projection catch-up so a query
 * reflects a just-submitted acquisition.
 */
export interface TestWiring {
  readonly deps: UseCaseDeps;
  readonly facade: DownloaderFacade;
  readonly store: FakeEventStore;
  readonly status: AcquisitionStatusProjection;
  readonly progress: ProgressReadModel;
  readonly sync: () => void;
}

export function testWiring(): TestWiring {
  const store = new FakeEventStore();
  const status = new AcquisitionStatusProjection();
  const progress = new ProgressReadModel();
  const deps: UseCaseDeps = {
    store,
    clock: fixedClock(),
    ids: sequentialIds(),
    status,
    progress,
  };
  return {
    deps,
    facade: createDownloaderFacade(deps),
    store,
    status,
    progress,
    sync: () => status.rebuild(store.all()),
  };
}
