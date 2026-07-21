# Coding Standards

## TypeScript

- **Strict mode, always.** Never loosen compiler options to make an error go away.
- **No `any`.** Reach for precise types, generics, or `unknown` with narrowing. `any` defeats the purpose of the type system.
- Prefer `readonly` and immutable data; model with discriminated unions; make illegal states unrepresentable.
- No unchecked type assertions to paper over a real mismatch.

## Linting & formatting

- Lint with typescript-eslint; format with Prettier. Formatting is automated and never hand-tweaked or debated.
- Lint and format both run in the commit gate; a violation fails the build.
- Import-boundary rules enforce the architecture's dependency rule.

## Style

- **Match the surrounding code** — its naming, structure, and idioms — over personal preference.
- Names reveal intent and use the domain's language. No abbreviations that obscure meaning.
- Small, focused units with one responsibility. Prefer pure functions where possible.
- Comments explain **why**, not **what**; the code says what. Delete dead code rather than commenting it out.
- Errors are values (see error-handling.md); no throwing for expected failures.

## Configuration

- All configuration comes from the environment; nothing environment-specific is hardcoded (see twelve-factor.md).
- No secrets in source, ever.
