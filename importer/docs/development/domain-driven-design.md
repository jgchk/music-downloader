# Domain-Driven Design

The domain layer models the business, not the technology. We use DDD tactical patterns to keep it expressive, correct, and pure.

## Ubiquitous language

Names in code match the language of the domain. Types, tests, and conversation share one vocabulary. When the language is unclear, resolve it *before* coding — ambiguous names are a design smell, not a detail to sort out later.

## Building blocks

- **Entities** — identity that persists across change. Two entities are the same if their identity matches, regardless of attributes.
- **Value objects** — defined entirely by their attributes, immutable, freely shareable. Prefer them: they carry invariants and eliminate whole classes of bugs. Model concepts as value objects rather than bare primitives (avoid primitive obsession).
- **Aggregates** — a cluster with one root that forms a consistency boundary. Keep them small; reference other aggregates by identity, not by object reference.
- **Domain services** — behavior that doesn't belong to a single entity or value object, expressed in domain terms and kept pure.

## Aggregates & invariants

An aggregate is a transactional boundary: one command mutates one aggregate atomically and enforces its invariants. If a rule must always hold synchronously, it lives inside a single aggregate. Rules that span aggregates are handled with eventual consistency — never by enlarging an aggregate to swallow them.

## Keep the domain pure

The domain has no I/O, no logging, no clock or randomness, no framework imports. It takes inputs and returns outputs (or events); side effects live in the application and adapters. Purity is what makes the domain trivially testable, and it is enforced by the dependency rule.

## Rich model, not anemic

Behavior lives with the data it governs. Avoid anemic models where entities are bags of getters/setters and all logic sits in services. The type that owns an invariant enforces it.

## Model explicitly

- Make illegal states unrepresentable through types.
- Prefer explicit domain concepts over booleans and flags.
- Expected failures are part of the model (see error-handling.md), not exceptions.
