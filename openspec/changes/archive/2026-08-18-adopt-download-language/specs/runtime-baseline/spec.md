## MODIFIED Requirements

### Requirement: Configuration is consolidated in one environment

The system SHALL read one environment configuration surface covering both modules and the web interface, validated at startup with precise errors, sourced from the environment per twelve-factor. Webhook-era settings (peer URLs, signing and receiver secrets) SHALL NOT be read. The deposit directory (where the downloader deposits fulfilled releases for the importer's intake) SHALL be configured as `DEPOSIT_ROOT`; the legacy name `LIBRARY_ROOT` SHALL remain honored as a fallback when `DEPOSIT_ROOT` is absent, with a startup warning naming the deprecation. When both names are set with differing values, startup SHALL fail with an error naming both settings; when both are set with the same value, the setting SHALL be accepted without a warning.

#### Scenario: Invalid configuration fails startup precisely

- **GIVEN** a missing or malformed required setting for either module
- **WHEN** the process starts
- **THEN** startup fails with an error naming the offending setting

#### Scenario: Webhook-era settings are inert

- **GIVEN** an environment still carrying webhook peer URLs or secrets
- **WHEN** the process starts
- **THEN** those settings are ignored and no webhook publisher or receiver is constructed

#### Scenario: The legacy deposit-directory name still works, with a warning

- **GIVEN** an environment setting only `LIBRARY_ROOT`
- **WHEN** the process starts
- **THEN** the deposit directory is taken from `LIBRARY_ROOT` and a startup warning names `DEPOSIT_ROOT` as the current setting

#### Scenario: Conflicting deposit-directory names fail startup

- **GIVEN** an environment setting `DEPOSIT_ROOT` and `LIBRARY_ROOT` to different paths
- **WHEN** the process starts
- **THEN** startup fails with an error naming both settings and the conflict
