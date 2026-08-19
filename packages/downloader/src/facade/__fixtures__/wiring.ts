import { FakeEventStore, fixedClock, sequentialIds } from '../../application/__fixtures__/fakes.js';
import { fixedCorrelation } from '../../application/__fixtures__/correlation.js';
import {
  DownloadStatusProjection,
  ProgressReadModel,
  StalledReadModel,
} from '../../application/projections/read-models.js';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import { fakeCatalog } from '../../application/__fixtures__/catalog.js';
import type { CatalogSearchPort } from '../../application/ports/catalog-search-port.js';
import type { UseCaseDependencies } from '../../application/download/use-cases.js';
import { createDownloaderFacade } from '../index.js';
import type { DownloaderFacade } from '../index.js';

/**
 * A minimal in-memory wiring of the use-case dependencies for interface tests. `sync()` pumps the
 * store into the status projection, standing in for the reactor/projection catch-up so a query
 * reflects a just-submitted download.
 */
export interface TestWiring {
  readonly deps: UseCaseDependencies;
  readonly facade: DownloaderFacade;
  readonly store: FakeEventStore;
  readonly status: DownloadStatusProjection;
  readonly progress: ProgressReadModel;
  readonly sync: () => void;
}

export function testWiring(): TestWiring {
  const store = new FakeEventStore();
  const status = new DownloadStatusProjection();
  const progress = new ProgressReadModel();
  const dependencies: UseCaseDependencies = {
    store,
    clock: fixedClock(),
    ids: sequentialIds(),
    correlation: fixedCorrelation(),
    status,
    progress,
    stalled: new StalledReadModel(),
  };
  return {
    deps: dependencies,
    facade: createDownloaderFacade(dependencies, { catalog: fakeCatalog(), logger: silentLogger() }),
    store,
    status,
    progress,
    sync: () => status.rebuild(store.all()),
  };
}

/**
 * A wiring whose catalog is the one under test. The acquisition side is still real so a catalog
 * read and a command can be exercised against the same facade instance.
 */
export function catalogSearchWiring(catalog: CatalogSearchPort): TestWiring {
  const base = testWiring();
  return {
    ...base,
    facade: createDownloaderFacade(base.deps, { catalog, logger: silentLogger() }),
  };
}
