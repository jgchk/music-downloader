# Design — request-page anatomy fix

## Context

See `proposal.md`. The audit evidence: `.art` computes 2×2px (borders only) because
`align-items: center` from the global button rule makes the slot shrink-to-fit around
absolutely-positioned children; `.result-open`'s titles are centered nowrap runs that never
trigger their own `text-overflow`; `.track-rows .result-open` re-declares `display: flex` but not
`flex-direction`, inheriting `column`; the forum skin's `:root[data-skin='forum'] button`
out-specifies every anatomy class; `.linkish` appears in markup and in no stylesheet. The
research base: design-system prior art on chrome-by-class (Bootstrap/Tailwind/USWDS/Primer),
cascade-layer practice (Web Awesome, PrimeNG, MUI), and side-panel width specs (Carbon, SLDS,
Atlaskit, Polaris, Primer — consensus band 320–480px; the prototype's 420px is mid-band; the
shipped 286px is below all of them).

## Goals / Non-Goals

**Goals:** make the leak structurally unrepeatable, repair the four broken layouts, pin every
repair with a computed-geometry test, and put the detail view's width inside the industry band
under every skin.

**Non-Goals:** any interaction change (that is `search-ui-cleanup`); auditing non-catalog surfaces
for new container buttons (none exist today; the inversion protects future ones by construction).

## Decisions

1. **Chrome by class, not by element.** Bare `button` gets a minimal reset only — `font: inherit`,
   `color: inherit`, no background/border/padding, `cursor: pointer`, and the focus outline left
   alone (never `all: unset`, which silently kills keyboard focus indication). All widget chrome
   moves to `.btn`, which already exists and which most push buttons already carry; the rest are
   swept. Container buttons (`.result-open`, `.edition`, track rows) need no opt-out — they are
   plain by default. *Alternative rejected:* `button:not(.plain)` guards on every base and skin
   rule — the research rates it weakest (the forgotten-guard failure mode is exactly how this bug
   happened, and `:not()` escalates specificity).
2. **Cascade layers order the stylesheets, but the skin system stays on top.** Layer order is
   `reset, base, theme` — the skins' layer LAST, because skins must keep overriding base
   component styles (that is the skin system's whole contract; the research's
   components-above-theme ordering would break it). The layers' job here is narrower: a skin's
   plain single-class rule now beats any base selector without the `:root[data-skin]` specificity
   arms race. The order statement is **repeated at the head of every stylesheet**, not declared
   once: layer order is fixed by first appearance, so a single declaration would quietly make the
   layout's import order load-bearing — reorder those imports and `theme` registers first and
   then loses to the base everywhere. Restating it is idempotent and order-independent.
   What layers deliberately do NOT guarantee — a future skin re-chroming bare `button` — is
   pinned instead by a stylesheet-scanning test whose subject rule is **restrictive by default**:
   a selector is treated as reaching unclaimed buttons unless a class or id narrows it, so
   `:is(html, body) button`, `* button` and `button[type='submit']` are all caught rather than
   only the literal forms someone thought to enumerate. The scan test is the structural guard;
   the inversion makes it easy to obey.
3. **Layout facts get layout tests.** The browser-mode tier asserts computed geometry per shipped
   skin hook: the art slot's box is square and non-zero before any image loads; a long title's
   box does not exceed its card; a track row's children lay out horizontally with the request
   action in-row; `.linkish` computes without borders/background/shadow. These are the exact
   measurements the audit took; they are cheap, deterministic, and skin-parameterized.
   *Alternative rejected:* screenshot diffing — a new flaky tier for facts geometry can state.
4. **A failed image hides itself; the placeholder is what remains.** The `<img>` gets an on-error
   hook that removes it from rendering, leaving the initials placeholder it was painted over —
   the comment "an image that never loads paints nothing" is false for *errored* loads, which
   paint the broken-image glyph. The detail view's artwork adopts the same placeholder-under-image
   structure the grids use. *Alternative rejected:* CSS-only suppression — no reliable selector
   for an errored image exists.
5. **The width is a token with a self-defending default.** `--detail-size: max(340px, 26rem)` in
   `tokens.css` — rem so the panel keeps participating in each skin's type scale (the
   accessibility argument for rem chrome in a root-font-remapping architecture), floored at 340px
   so no skin can shrink it below the industry minimum again. Applied as
   `min(var(--detail-size), 75vw)`: the viewport share is what keeps the panel from dominating a
   700–1000px window, and it is the ONLY thing that caps the panel — a skin may remap the token
   as wide as it likes. *Two operands were tried and dropped as unreachable:* a `30rem` clamp
   ceiling could never bind (a rem ceiling above a rem preferred value never applies, whatever
   the root size), and `100vw` under `75vw` is dead by arithmetic. Both looked like guarantees
   and computed to nothing; the tests that appeared to hold them could not fail. Skins may remap
   the token; none has to. The ~640px bottom-sheet switch stays — it sits comfortably inside
   precedent (Material <600, Polaris/Primer 768).

## Risks / Trade-offs

- [The class sweep misses a push button] → it renders visibly bare (benign, obvious), and a
  convention test can flag chrome-less buttons that carry action-verb text; the browser tier's
  per-skin pass over key pages catches the important ones.
- [Wrapping skin files in `@layer theme` changes their standing against any unlayered rule]
  → unlayered rules beat all layers, so the same commit moves base rules into their layers;
  the scan test asserts no top-level rule sits outside a layer in these files.
- [Svelte component `<style>` blocks are unlayered] → none style `button` today; the scan test
  covers `lib/styles/` where the global rules live, which is where the hazard is.

## Open Questions

None — sizes, mechanism, and test strategy were settled in the 2026-08-19 grilling session.
