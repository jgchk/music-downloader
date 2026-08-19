# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring
the codebase.

## Before exploring, read these

1. **`CONTEXT-MAP.md`** at the repo root — the cross-context map: which context owns which
   concept, and the homonym table for terms that mean different things on each side.
2. **The relevant `packages/<context>/CONTEXT.md`** — per-context glossaries: canonical
   terms, and the words that context deliberately avoids.
3. **`openspec/specs/<capability>/spec.md`** — the _living_ capability specs: what is true
   of the system today.
4. **`openspec/changes/<change>/design.md`** — decisions and their rationale for work in
   flight. Shipped decisions live in `openspec/changes/archive/<date>-<change>/`.
5. **`docs/development/*.md`** — the constitution: how we build, independent of what.

If a file doesn't exist, proceed silently. Don't flag its absence or suggest creating it
upfront; `/domain-modeling` creates them lazily when terms actually get resolved.

## This repo has no `docs/adr/` — OpenSpec is the ADR

Deliberately. `CLAUDE.md` splits the two altitudes: `docs/development/` holds durable,
project-agnostic principles with **no** domain specifics, and every code-level design
decision — aggregates, ports, event schemas, policies, endpoints — belongs in
`openspec/changes/<change>/design.md`.

So when a skill says "read the ADRs for this area", read the OpenSpec `design.md` files —
active for in-flight work, `archive/` for shipped. **Do not create `docs/adr/`.** A second
home for decisions is exactly the split the constitution warns against.

## File structure

```
/
├── CONTEXT-MAP.md                      ← cross-context map + homonym table
├── docs/development/                   ← the constitution (how we build)
├── openspec/
│   ├── specs/<capability>/spec.md      ← living specs (what is true now)
│   └── changes/<change>/
│       ├── design.md                   ← decisions + rationale (the ADR)
│       ├── proposal.md
│       ├── specs/                      ← delta specs (NOT current truth)
│       └── tasks.md
└── packages/
    ├── downloader/CONTEXT.md
    ├── importer/CONTEXT.md
    ├── web/CONTEXT.md
    └── eventing/                       ← no CONTEXT.md yet
```

Note the two spec locations. `openspec/specs/` is what the system does today;
`openspec/changes/<change>/specs/` is a delta not yet shipped. Reading a delta as current
truth is the easy mistake.

`packages/eventing` has no glossary. If you resolve a term there, that's the signal to
start one.

## Use the glossary's vocabulary

When your output names a domain concept — an issue title, a refactor proposal, a
hypothesis, a test name — use the term as defined in the owning context's `CONTEXT.md`.
Don't drift to synonyms the glossary explicitly lists as avoided.

Watch the homonym table in `CONTEXT-MAP.md`: a word that is canonical in one context may be
a banned synonym in the other. Name the context when ambiguity is possible.

If the concept isn't in the glossary yet, that's a signal — either you're inventing language
the project doesn't use (reconsider), or there's a real gap (note it for `/domain-modeling`).

## Flag conflicts with recorded decisions

If your output contradicts a decision recorded in an OpenSpec `design.md`, surface it
explicitly rather than silently overriding:

> _Contradicts the halt-only seam decision in
> `openspec/changes/archive/…-extract-eventing-package/design.md` — but worth reopening because…_
