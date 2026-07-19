# Architecture

We build in layers with a hexagonal (ports & adapters) boundary around a pure, domain-driven core. The shape serves one end: **business logic stays pure and testable; the messy outside world stays at the edges.**

## The layers

- **Domain** — business logic and rules. Pure: no I/O, no frameworks, no logging.
- **Application** — orchestrates use cases; declares the ports (interfaces) the outside world must satisfy.
- **Adapters** — concrete implementations of ports (databases, external services, filesystem).
- **Interfaces** — inbound entry points (HTTP, MCP, …) that translate incoming requests into use-case calls.
- **Composition** — the only layer that knows concrete types; wires everything together and starts the app.

## The dependency rule

Dependencies point **inward**. The domain depends on nothing. The application depends only on the domain and on the port interfaces it declares — never on a concrete adapter. Adapters and interfaces depend on the application's ports. Composition depends on everything.

We enforce this with lint import-boundary rules that fail CI. A boundary violation is a build break, not a style nit.

## Ports & adapters (hexagonal)

The application declares **ports** — narrow interfaces describing what it needs ("search for X", "store an event"). Adapters implement them. Control is inverted: the core owns the contract, the edges conform. We rely on the consequences:

- The core is testable with fakes; no real I/O in unit tests.
- New capabilities (a data source, an interface) are added by writing an adapter, not editing the core.
- Ports stay narrow and role-specific (see Interface Segregation in design-principles.md).

## Dependency injection — vanilla, no framework

Plain constructor injection. Dependencies are passed in; nothing reaches out to a global or a container.

- No DI framework, no container, no decorators, no service locator.
- A unit receives what it needs through its constructor and depends on **interfaces, not concretions**.
- The composition root constructs concrete adapters, injects them into the use cases, and starts the interfaces.
- Libraries (web servers, etc.) are called *from* composition; they are never used *as* a DI container.

## Why this shape

- **Testability** — the valuable logic is pure and fast to test.
- **Replaceability** — edges swap without touching the core.
- **Clarity** — dependencies flow one way; you always know what depends on what.
