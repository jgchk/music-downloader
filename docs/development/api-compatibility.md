# API Compatibility & Versioning

Public interfaces are contracts. Once shipped, we don't break them.

## No breaking changes

Within a published version, changes are **additive only**: new optional fields, new endpoints, new capabilities. We never remove or repurpose an existing field, tighten a contract, or change a response shape a consumer depends on. A genuinely breaking change means a *new version*, with the old one kept working.

## What counts as public

Any surface a consumer depends on: the HTTP API, the MCP tools/resources, and — because they are persisted and replayed — **event schemas**. All follow the same policy (event schemas evolve via upcasting; see event-sourcing.md).

## Versioning

Public APIs are explicitly versioned. Consumers opt into a version and are never surprised by a change beneath them. Versions may run side by side; a version is retired through a deprecation process, never by breaking it.

## A single source of truth for contracts

A contract is defined once and drives everything derived from it — request validation, published schema/docs, and consumer-facing type definitions. Derived artifacts can't drift because they share one source.

## Enforce compatibility mechanically

Breaking changes are caught by a **contract test in CI**, not by reviewer vigilance. A change that would break a published version fails the build. Compatibility is a gate, not a guideline.

## Semantic versioning

Releases follow semver, and the version bump is derived from commit history (see development-workflow.md), so a breaking change can't ship silently.
