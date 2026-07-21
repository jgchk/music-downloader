# Design Principles

## SOLID

- **Single Responsibility** — a unit has one reason to change. Split modules that mix concerns (e.g. business logic and transport).
- **Open/Closed** — open for extension, closed for modification. New behavior is added by writing a new implementation, not editing existing code.
- **Liskov Substitution** — any implementation of an interface is substitutable without breaking callers. Contract tests verify this across implementations.
- **Interface Segregation** — many narrow, role-specific interfaces over one fat one. A consumer depends only on the methods it actually uses.
- **Dependency Inversion** — depend on abstractions, not concretions. High-level policy defines the interfaces; low-level detail implements them.

## OOP design patterns

Patterns are a shared vocabulary, reached for when a problem calls for one — never applied speculatively. The ones we favor:

- **Strategy** — interchangeable algorithms behind one interface. The default for "we'll add more of these later."
- **Ports & Adapters (Hexagonal)** — the whole architecture: abstractions owned by the core, implementations at the edge.
- **Anti-Corruption Layer** — translate external models into our own at the boundary so foreign concepts never leak inward.
- **Repository** — collection-like access to persisted aggregates behind an interface.
- **Factory** — encapsulate construction when it's non-trivial or must guarantee invariants.
- **Decorator** — layer behavior (caching, retry, logging) around a type without modifying it.

## Guidance

- Prefer **composition over inheritance**. Use inheritance only for genuine substitutable is-a relationships.
- Program to interfaces, not implementations.
- **Immutability by default**; mutate only where there's a clear reason.
- A pattern that adds indirection without solving a real problem is a liability. Simplicity first; reach for a pattern when duplication or change-pressure justifies it.
