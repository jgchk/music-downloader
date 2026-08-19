# Tasks — request-page anatomy fix

All production code test-first (red before green), per `docs/development/testing.md`. The failing
tests here are computed-geometry assertions in the browser-mode component tier — the register the
regression lives in.

## 1. The failing layout tests

- [x] 1.1 Browser-mode geometry tests (red first), parameterized over every shipped skin hook:
      the album card's artwork slot is square and non-zero before any image loads; a
      long-titled card clips its title rather than painting it across its neighbours; a track
      row's thumb, text, and request action lay out horizontally; `.linkish` and the tracklist
      disclosure compute as the skin's accent link; the artist bubble keeps its own centred
      footprint; the detail view's side-panel width holds its 340px floor and the share of the
      window it is allowed — the last two proven against a stand-in skin that would otherwise
      break them, since at the shipped widths neither bound can bind

## 2. The chrome inversion

- [x] 2.1 Demote bare `button` to a minimal reset in `base.css` (font/color inherit, no chrome,
      cursor, focus outline untouched — never `all: unset`); move all widget chrome to `.btn`
- [x] 2.2 Sweep every real push button in `packages/web/src` onto `.btn` (most already carry it),
      and pin the sweep: a markup scan asserts every `<button>` declares its kind — the widget
      class or one of the named plain kinds — because since the inversion a forgotten `.btn`
      ships as unstyled text and nothing else would notice
- [x] 2.3 Declare `@layer reset, base, theme` at the head of EVERY stylesheet, not once: layer
      order is fixed by first appearance, so one declaration would silently make the layout's
      import order load-bearing. Move the base and token rules into their layers; wrap each skin
      file's rules in `@layer theme`; skins re-point their chrome from `button` to `.btn`. The
      `:root[data-skin]` prefixes stay: they are each skin's activation condition, not
      specificity escalation, so layering makes none of them redundant
- [x] 2.4 Stylesheet-scanning convention test (red first): in `lib/styles/`, no top-level rule
      outside a layer, and no chrome declarations on a bare `button` type selector outside the
      reset layer

## 3. The layout repairs

- [x] 3.1 `.track-rows .result-open` declares `flex-direction: row`; the request action sits
      in-row (turns 1.1's track-row assertion green)
- [x] 3.2 Result card/title/subline typography and clipping restored to surface sizes (turns
      1.1's title assertion green); forum skin themes cards, rows, and editions as flat bordered
      surfaces per the prototype's shared CSS, and `.linkish` as an underlined accent link
- [x] 3.3 Failed images hide themselves (on-error hook) leaving the placeholder; the detail
      view's artwork adopts the placeholder-under-image structure (red first: a failed detail
      cover renders initials, not a blank box or glyph)
- [x] 3.4 `--detail-size: max(340px, 26rem)` token with width `min(var(--detail-size), 75vw)`
      (turns 1.1's width assertion green). No rem ceiling and no `100vw` term: neither could ever
      bind, and the viewport share is what actually stops the panel becoming the page

## 4. Gate and ship

- [x] 4.1 Full gate (`pnpm check`) green; 100% coverage without new waivers
- [x] 4.2 Side-by-side against prototype D (`proto-d-hybrid.html`): art grid, track rows, and
      detail view re-screenshotted under forum and glass; the audit's visual items confirmed
      closed. This is what caught the detail view's artwork collapsing in a scrolling column
      (`flex: none`), which the first round of geometry tests had not reached
- [ ] 4.3 `pnpm version:prep` patch bump (`fix`); one PR for this change
