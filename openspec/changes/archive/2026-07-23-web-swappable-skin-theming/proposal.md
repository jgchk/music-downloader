## Why

The web UI is clean semantic markup but has no shared shell, no styling system, and no spec governing its presentation — structure, look, and accessibility are all undefined. We want the markup to be a stable semantic skeleton that **CSS alone** can retheme *and* re-lay-out (the CSS Zen Garden ideal, in a Svelte component model), so the visual direction can change — or several skins can coexist — without touching components. A spike already proved this end to end: three deliberately opposite skins (`forum`, `glass`, `terminal`) drive the same DOM into different themes *and* layouts, verified live in the running app. This change turns that spike into a specified, tested, accessible capability, with the mid-2000s-forum skin (`forum`) as the shipped default.

## What Changes

- **A two-tier CSS token system** (primitive → semantic "switchboard") plus element-level base styles that semantic markup reads *only through tokens*. No utility-first classes on the swappable surface — a deliberate dependency-direction choice (CSS-depends-on-HTML), which is precisely what makes DOM-free restyling possible.
- **A semantic app shell** (`+layout.svelte`): a landmark skeleton (banner / navigation / main / contentinfo) authored in reading order, with a primary "Request a download" action and wayfinding-only primary navigation.
- **Interchangeable skins selected by `data-skin` on `<html>`.** Each skin remaps semantic tokens *and* swaps the shell's `grid-template-areas` / nav direction, so switching a skin changes theme **and** layout with no DOM change. Ship `forum` (default), `glass`, `terminal`.
- **A user-facing skin switcher** that persists the choice and sets `data-skin`; the default is server-rendered on `<html>` to avoid a flash of unstyled/ mis-themed content.
- **Richer per-page chrome**: a panel / title-bar (`region-head`) convention and an optional detail-`aside` region, expressed through the same token + stable-hook system (additive classes/attributes only — no change to any component's semantics).
- **Accessibility guarantees made explicit**: exactly one `main`, labelled landmarks, author-set heading levels, DOM source order == reading/tab order (WCAG 1.3.2 Meaningful Sequence), and the page remaining a sensible, correctly-ordered document with CSS disabled.
- **Reconcile `Landing`**: its brand heading and navigation (now owned by the shell) are removed; it becomes the dashboard body. Behaviour is unchanged — the facade-backed counts still render.
- **Tests + 100% coverage** for the shell and any new client logic (skin switcher), under the web package's existing merged coverage gate — with no new carve-outs.

## Capabilities

### New Capabilities

- `web-ui-presentation`: the web UI's presentation modeled as a semantic landmark skeleton that CSS alone restyles — theme **and** layout — via a two-tier token system and interchangeable `data-skin` skins; the accessibility guarantees that keep the skeleton sound under any skin; and a user-facing, persisted skin switch.

### Modified Capabilities

_(none — the behavioural `web-ui` requirements are unchanged; the new shell and switcher source fall under `web-ui`'s existing "UI package meets the coverage gate" requirement, adding no carve-out.)_

## Impact

- **`packages/web` only.** New `src/lib/styles/tokens.css`, `src/lib/styles/base.css`, `src/lib/styles/skins/{forum,glass,terminal}.css`; new `src/routes/+layout.svelte` app shell; `app.html` gains the default `data-skin`; a skin-switcher component with its persistence; additive presentation hooks (classes / `data-*`) on existing route pages and components for the panel / detail-aside chrome. `Landing.svelte` and its SSR test are reconciled.
- **No domain, facade, event-schema, or wire-contract changes; no breaking changes.** No new runtime dependencies — pure CSS plus a small progressive-enhancement client script for the switcher.
- Builds directly on the `ui-theming` spike (typecheck-clean; three skins verified live via `data-skin` toggling). Complements, but does not depend on, other in-flight web work.
