## ADDED Requirements

### Requirement: The application runs as a single composed process
The system SHALL run as one Node process whose entry point first wires both module runtimes — each module's event store, subscriptions, reactors, pollers, and timers — through the composition root, and then mounts the web interface handler (SvelteKit `adapter-node`), so the process is a daemon that also serves pages. The system SHALL NOT depend on a standalone HTTP framework server, on webhook peers, or on any second service process for its core loop.

#### Scenario: One process serves the whole loop
- **WHEN** the application starts
- **THEN** both module runtimes are active and the web interface answers on the same process and port, with no other application process required

#### Scenario: Module runtimes start before the interface accepts work
- **WHEN** the entry point boots
- **THEN** the composition root has wired both modules' stores and subscriptions before the web handler begins accepting requests

### Requirement: Each module's event store is a separate database file
The process SHALL open one SQLite event store file per module, at independently configured paths, and SHALL NOT attach both files to one connection or span a transaction across them. Cross-module coordination SHALL happen only through the subscription seam, whose checkpoint may lag but never lead the producer's store.

#### Scenario: Stores are independent files
- **WHEN** the application runs
- **THEN** the downloader's and importer's events persist in two distinct database files, each written only by its owning module

#### Scenario: No cross-file transaction exists
- **WHEN** any module commits a transaction
- **THEN** that transaction touches exactly one of the two database files

### Requirement: Configuration is consolidated in one environment
The system SHALL read one environment configuration surface covering both modules and the web interface, validated at startup with precise errors, sourced from the environment per twelve-factor. Webhook-era settings (peer URLs, signing and receiver secrets) SHALL NOT be read.

#### Scenario: Invalid configuration fails startup precisely
- **GIVEN** a missing or malformed required setting for either module
- **WHEN** the process starts
- **THEN** startup fails with an error naming the offending setting

#### Scenario: Webhook-era settings are inert
- **GIVEN** an environment still carrying webhook peer URLs or secrets
- **WHEN** the process starts
- **THEN** those settings are ignored and no webhook publisher or receiver is constructed
