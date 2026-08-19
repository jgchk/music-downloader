// Domain layer — pure decider, policies, matching, ranking, validation verdict.
// Depends on nothing outward (the dependency rule, D9). No I/O, no logging (D15).
//
// The download aggregate is reached solely through the `Download` facade
// (`download/download.js`): it wraps the functional decider (`decide`/`evolve`/`react` and
// the folded state), which are private to `download/` and lint-sealed from outer layers. Only
// the facade, commands, events, effects, and `DownloadPhase` are visible outside the domain.
export {};
