# Design Principles

## SOLID

- **Single Responsibility** — a unit has one reason to change. Split modules that mix concerns (e.g. business logic and transport).
- **Open/Closed** — open for extension, closed for modification. New behavior is added by writing a new implementation, not editing existing code. (In the functional core this principle deliberately inverts — see below.)
- **Liskov Substitution** — any implementation of an interface is substitutable without breaking callers. Contract tests verify this across implementations.
- **Interface Segregation** — many narrow, role-specific interfaces over one fat one. A consumer depends only on the methods it actually uses.
- **Dependency Inversion** — depend on abstractions, not concretions. High-level policy defines the interfaces; low-level detail implements them.

### Across paradigms

We deliberately mix paradigms: a pure functional core (functions, immutable data, discriminated unions) inside an object-oriented shell (ports, adapters, constructor injection). SOLID still governs, but each principle must land where it has meaning:

- **Open/Closed has two regimes.** At the edges, where the axis of change is _new implementations_, classic OCP applies: a new capability is a new adapter behind an existing port, wired only in composition — the core never changes. In the core, where the axis of change is _correctness_, we invert it on purpose: unions are **closed** and matched exhaustively with no `default` arm, so adding a variant breaks the build at every match site until it is handled. That compiler-guided sweep is the goal, not a violation — the real OCP failure here is a `default` arm that lets a new variant fall through silently. Never "fix" a closed union by opening it.
- **Liskov is contract fidelity.** For a port implementation, substitutable means honoring the whole contract: errors returned as values on the declared channel — never a throw escaping a port method — and expected business outcomes kept distinct from infrastructure faults, exactly as the port documents.
- **Classes carry identity; functions carry logic.** Reach for a class only where effectful or mutable identity is real — a connection, a cursor, a queue, a lifecycle. Pure logic stays as functions over immutable data; a class there is ceremony.
- **Single Responsibility, Interface Segregation, and Dependency Inversion are paradigm-neutral.** They apply to modules, functions, and ports exactly as to classes: one reason to change, consumer-shaped interfaces, abstractions owned by the inner layer.

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
