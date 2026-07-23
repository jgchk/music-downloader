## Context

The web package renders clean, semantic, essentially unstyled markup: real `table`/`dl`/`progress`/`details` elements and a couple of stable hooks (`.badge[data-phase]`, `.chip[data-kind]`, `role="alert"`). There is no `+layout.svelte`, no global CSS, and no spec for presentation. We want presentation to be a swappable concern: one stable semantic skeleton that CSS alone re-themes *and* re-lays-out.

A spike (the `ui-theming` workspace) already ported the architecture and verified it: a two-tier token layer, an app shell, and three skins (`forum`, `glass`, `terminal`) that restyle **and** relocate layout purely by toggling `data-skin`, confirmed live in the running app with a clean `svelte-check`. This design records the decisions behind that spike and the remaining hardening (per-page chrome, the user switcher, tests/coverage, and the accessibility pass) so the whole thing lands as one specified capability.

Constraints from the project constitution: TypeScript strict; the domain and facades are untouched (this is BFF-presentation only); the web package must stay inside the 100% merged coverage gate (`server` + `ssr` + `client` projects) with no new carve-outs; conventional commits; jj.

## Goals / Non-Goals

**Goals:**

- A single semantic skeleton, authored in reading order, that CSS alone can retheme and re-lay-out with no DOM change.
- A token architecture where components read only semantic tokens; a skin is a remap of those tokens plus the shell's layout tokens.
- Three shipped skins, `forum` as the default, and a persisted user switch that avoids a flash of the wrong skin.
- Accessibility as a first-class, tested property: correct landmarks/headings, DOM order == reading/tab order, usable with CSS off, visible focus — under every skin.
- Everything covered by the existing web coverage gate.

**Non-Goals:**

- No domain, facade, event-schema, or wire-contract change; no new runtime dependency.
- No utility-first / Tailwind adoption (see Decisions — it is the opposite of the goal).
- No visual redesign of individual page *content* beyond the shell and the shared chrome conventions; per-page information architecture beyond that is future work.
- No theme authoring UI / user-defined skins; skins are code-shipped.

## Decisions

### Dependency direction: CSS-depends-on-HTML, not the reverse

There is no true separation of concerns, only a choice of which layer depends on the other. "Swap the stylesheet, keep the DOM" *requires* CSS to depend on a stable semantic HTML structure (the CSS Zen Garden model). Utility-first CSS (`class="grid grid-cols-3 gap-4"`) is the opposite dependency — it bakes theme and layout into markup, making them un-swappable. **We therefore forbid utility/visual classes on the swappable surface** and style through semantic elements + stable meaning-based hooks. *Alternative considered:* Tailwind for ergonomics — rejected for the swappable surface; its token output could still feed our primitive layer if desired later, but layout must stay in CSS, not in markup.

### Two-tier tokens; components read only the semantic tier

`tokens.css` defines primitives (raw spacing/type scales) and a semantic "switchboard" (`--surface`, `--accent`, `--cell-pad-y`, `--fs-h1`, …). `base.css` styles bare elements and the shell reading *only* semantic tokens. A skin file remaps the semantic tier. This is the standard primitive→semantic layering and is what lets "dense vs spacious" or "forum vs glass" be a token remap rather than a rewrite. *Alternative:* per-component style props only — rejected as the primary mechanism (doesn't give whole-app reskin from one place), though Svelte custom-property props remain available for component-local overrides.

### Layout is a token too: `grid-template-areas` on the shell

The shell is a CSS grid whose `grid-template-columns/rows/areas` and nav direction come from `--shell-*` / `--nav-dir` tokens. A skin redefines those, so the same DOM becomes a top-bar (`forum`/`terminal`) or a left-rail sidebar (`glass`). Region names are assigned once on the landmark children; only the area map changes per skin. *Alternative:* separate `data-layout` axis independent of theme — deferred; the current default couples layout to skin (simpler, and each skin has one intended layout), but the token seam makes decoupling a later, non-breaking change.

### Skin selection via `data-skin` on `<html>`, server-rendered default

The active skin is the `data-skin` attribute on the document root. The default (`forum`) is written into `app.html` so it is present in the server response — no flash. A small progressive-enhancement script resolves a stored preference and sets `data-skin` before/at first paint; with no script, the server default stands. *Alternative:* per-skin separate stylesheet `<link>` swap — rejected; all skins are cheap CSS and shipping them together makes switching instant and keeps SSR trivial. *Alternative:* a cookie read in the server `load` to server-render the *stored* skin — a viable enhancement to eliminate the switch's first-paint reconcile entirely; noted as an option, not required by the spec (which only requires no flash of the *wrong* skin for the resolved preference).

### Accessibility is the driver, not a tax

The properties that make the skeleton swappable are the same ones that make it accessible: correct landmarks give CSS its targeting hooks *and* screen-reader navigation; logical source order is both the reading order and the substrate the grid rearranges. The one hard limit — CSS `order`/grid placement changes visual order but never DOM (tab/AT) order — becomes a rule: author the DOM in true reading order; skins may only reposition non-meaningful sequence. This is captured as a spec requirement and enforced by tests (tab-order walk, CSS-off read).

### Per-page chrome via additive hooks

Panels and title bars (`region-head`) and an optional detail `aside` region are expressed as additive class/attribute hooks on existing pages — no change to any component's semantics. Skins style those hooks (e.g. `forum` renders `region-head` as a gradient caption bar). This keeps the "restyle needs no markup change" guarantee intact while giving pages richer structure.

### Coverage strategy for CSS + shell

CSS itself is not executable and is out of the coverage model; what counts is the new TypeScript/Svelte logic — the `+layout.svelte` shell (active-nav computation) and the skin-switcher client logic. These are exercised under the existing `ssr` and `client` vitest projects so the merged gate stays at 100% with no new carve-out. Visual/skin-swap behaviour is validated by Playwright e2e (no coverage threshold), reusing the existing e2e job.

## Risks / Trade-offs

- **A skin could smuggle layout into markup over time** (a contributor adds a utility class) → the spec forbids it and a review/lint check plus the "restyle needs no markup change" test guard it; document the rule in the styles directory.
- **`data-skin` default drift / FOUC** if the attribute is ever set only client-side → keep the default in `app.html` (server response) as the single source of the default; the switcher only *overrides*.
- **Meaningful reorder requested by a future skin** (content genuinely needed before nav in reading order) → cannot be done by CSS alone without a WCAG 1.3.2 violation; the DOM order is fixed up front for the worst case, and skins accept it. Flag any such request as a DOM-order change, not a skin change.
- **Coverage illusion** — CSS looks "covered" because components render, but skin correctness isn't line-coverable → rely on Playwright e2e for the swap behaviour rather than pretending unit coverage proves it; `log`/note that CSS is out of the coverage model deliberately.
- **`backdrop-filter` / `color-mix()` / `light-dark()` support** — all Baseline as of 2026 for our target (evergreen); acceptable, no fallback needed for the app's runtime.

## Migration Plan

Additive within the web package; no data or contract migration. Ship the styles, the shell, `data-skin="forum"` default, the switcher, and the reconciled `Landing`. Rollback is reverting the web package change — no persisted state depends on it beyond the client-stored skin preference, which is inert if unread. No homelab/deploy step beyond the normal image publish.

## Open Questions

- Should the stored skin be server-rendered from a cookie (eliminating the switcher's first-paint reconcile), or is client-side resolution against the server default sufficient? (Spec allows either; default to the simpler client resolution unless a flash is observed.)
- Do we expose `data-layout` as an independent axis now, or keep layout coupled to skin until a real need appears? (Design keeps it coupled; the seam is ready.)
