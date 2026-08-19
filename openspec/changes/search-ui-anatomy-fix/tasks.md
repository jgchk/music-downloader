# Tasks — request-page anatomy fix

All production code test-first (red before green), per `docs/development/testing.md`. The failing
tests here are computed-geometry assertions in the browser-mode component tier — the register the
regression lives in.

## 1. The failing layout tests

- [ ] 1.1 Browser-mode geometry tests (red first), parameterized over every shipped skin hook:
      the album card's artwork slot is square and non-zero before any image loads; a
      long-titled card's title box does not exceed its card; a track row's thumb, text, and
      request action lay out horizontally; `.linkish` computes without background, border, or
      shadow; the detail view's side-panel width lands within the 340px floor and its ceiling

## 2. The chrome inversion

- [ ] 2.1 Demote bare `button` to a minimal reset in `base.css` (font/color inherit, no chrome,
      cursor, focus outline untouched — never `all: unset`); move all widget chrome to `.btn`
- [ ] 2.2 Sweep every real push button in `packages/web/src` onto `.btn` (most already carry it);
      the SSR/browser suites re-run green with buttons still styled
- [ ] 2.3 Declare `@layer reset, base, theme` once in `base.css`; move base rules into their
      layers; wrap each skin file's rules in `@layer theme`; skins re-point their chrome from
      `button` to `.btn` and drop the now-unneeded `:root[data-skin]` specificity escalation
      where layering makes it redundant
- [ ] 2.4 Stylesheet-scanning convention test (red first): in `lib/styles/`, no top-level rule
      outside a layer, and no chrome declarations on a bare `button` type selector outside the
      reset layer

## 3. The layout repairs

- [ ] 3.1 `.track-rows .result-open` declares `flex-direction: row`; the request action sits
      in-row (turns 1.1's track-row assertion green)
- [ ] 3.2 Result card/title/subline typography and clipping restored to surface sizes (turns
      1.1's title assertion green); forum skin themes cards, rows, and editions as flat bordered
      surfaces per the prototype's shared CSS, and `.linkish` as an underlined accent link
- [ ] 3.3 Failed images hide themselves (on-error hook) leaving the placeholder; the detail
      view's artwork adopts the placeholder-under-image structure (red first: a failed detail
      cover renders initials, not a blank box or glyph)
- [ ] 3.4 `--detail-size: clamp(340px, 26rem, 30rem)` token with width
      `min(var(--detail-size), 75vw, 100vw)` (turns 1.1's width assertion green)

## 4. Gate and ship

- [ ] 4.1 Full gate (`pnpm check`) green; 100% coverage without new waivers
- [ ] 4.2 Side-by-side against prototype D (`proto-d-hybrid.html`): art grid, track rows, and
      detail view re-screenshotted; the audit's visual items confirmed closed
- [ ] 4.3 `pnpm version:prep` patch bump (`fix`); one PR for this change
