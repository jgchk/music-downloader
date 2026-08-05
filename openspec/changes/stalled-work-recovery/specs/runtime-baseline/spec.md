# runtime-baseline — delta for stalled-work-recovery

## MODIFIED Requirements

### Requirement: Each module runtime exposes a readiness snapshot

Each module runtime SHALL expose a synchronous, side-effect-free readiness snapshot reporting
whether that module is currently able to serve — reflecting in-memory runtime state (its store,
reactors, and seam subscription being live and not halted, and no persistent
outcome-delivery failure past its configured threshold), not a query computed against its event
store. Reading the snapshot SHALL NOT perform I/O, SHALL NOT scan the event store, SHALL NOT
reach any third-party dependency, and SHALL return a value rather than throwing. The snapshot
SHALL be readable by the composed process's interface layer without importing module-internal
code and without coupling one module's readiness to the other's. Stalled (dead-lettered) work
SHALL NOT degrade readiness: it is waiting on an operator, not a process fault, and it has its
own surface.

#### Scenario: Snapshot reflects a healthy runtime

- **WHEN** the interface reads a booted module runtime's readiness snapshot while its store, reactors, and seam subscription are live
- **THEN** the snapshot reports the module as up, returned as a value with no I/O and no event-store access

#### Scenario: Snapshot reflects a halted runtime

- **WHEN** a module runtime's seam subscription has halted (for example, parked on a poison event) and the interface reads its readiness snapshot
- **THEN** the snapshot reports the module as down without throwing

#### Scenario: Reading readiness has no side effects

- **WHEN** the readiness snapshot is read repeatedly, including at probe frequency
- **THEN** each read is free of I/O and side effects and does not advance, mutate, or scan the module's event store

#### Scenario: Persistent delivery failure degrades the snapshot

- **WHEN** a module's outcome delivery has failed persistently past its configured threshold and
  the interface reads its readiness snapshot
- **THEN** the snapshot reports the module degraded, still as a value with no I/O

#### Scenario: Stalled work does not degrade the snapshot

- **GIVEN** a module with dead-lettered, stalled streams but live machinery
- **WHEN** the interface reads its readiness snapshot
- **THEN** the snapshot reports the module as up — stalled work is an operator concern, not a
  process fault
