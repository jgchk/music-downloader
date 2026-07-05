// Domain layer — pure decider, policies, matching, ranking, validation verdict.
// Depends on nothing outward (the dependency rule, D9). No I/O, no logging (D15).
//
// The acquisition aggregate is reached solely through the `Acquisition` facade
// (`acquisition/acquisition.js`): it wraps the functional decider (`decide`/`evolve`/`react` and
// the folded state), which are private to `acquisition/` and lint-sealed from outer layers. Only
// the facade, commands, events, effects, and `AcquisitionPhase` are visible outside the domain.
export {};
