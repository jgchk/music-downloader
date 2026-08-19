# Request-page anatomy fix — the button-chrome inversion

## Why

The shipped search-first request page (v3.21.0) is visibly broken, and the 2026-08-19 audit
against prototype D traced every page-breaking visual to one root cause: the global `button` rule
in `packages/web/src/lib/styles/base.css` styles every button element as a push-button widget
(centered flex content, nowrap, small bold font — and each skin re-styles `button` again with
higher-specificity chrome). The page's container buttons — a whole album card, each track row,
each edition row, the link-styled actions — reset display and padding but not those properties,
so the widget styling leaks in. Measured consequences: the album artwork slot computes to 0×0
(violating the presentation requirement that the artwork slot reserves its space), card titles
render centered, shrink-to-fit, and unclipped — painting across neighboring cards — track rows
stack vertically as huge centered columns with a detached Request button, edition rows and result
cards wear raised Win2k widget chrome under the forum skin, and `.linkish` (styled nowhere) renders
the zero-result cross-links and "View tracklist" as raised buttons instead of links.

Research across design systems (Bootstrap Reboot, Tailwind Preflight, USWDS, Primer, the modern
reset lineage) is unanimous that the guard-every-rule alternative (`button:not(.marker)`) is the
weakest fix — every future skin rule must remember the guard, and the failure mode silently
recurs. The consensus is the inversion: bare `button` carries only a minimal reset, and widget
chrome is opt-in via a class.

## What Changes

- **Widget-button chrome becomes opt-in.** Bare `button` is demoted to a minimal reset (font and
  color inherit, no chrome, focus outline untouched); all push-button styling moves to the
  existing `.btn` class, and every real push button in the app is swept onto it. Container
  buttons then need no opt-out — they are plain surfaces by default, and the leak cannot recur
  because new code has to *add* chrome rather than remember to remove it.
- **The stylesheets gain cascade layers** (`reset`, `base`, `theme`) so a skin's single-class rule
  beats the base layer without specificity escalation, and a source-scan test pins the convention
  that no chrome rides a bare `button` type selector outside the reset.
- **The broken layouts are repaired and pinned**: the track row lays out as a row again, the
  artwork slot genuinely reserves its square, titles clip inside their cards, `.linkish` renders
  as a link in every skin, a failed image shows the placeholder instead of the browser's
  broken-image glyph, and the detail view's artwork gets the same initials placeholder the result
  grids have. Browser-mode component tests assert the computed geometry — the register this
  regression actually lives in — under every shipped skin's hook.
- **The detail view's width joins the token layer**: `--detail-size` defaulting to
  `clamp(340px, 26rem, 30rem)` (rem-preferred so it tracks each skin's type scale, a pixel floor
  no skin can crush — today's forum skin renders it at 286px, below every design system's
  side-panel band — and a ceiling), applied as `min(var(--detail-size), 75vw, 100vw)` so the
  panel cannot dominate a small window. Skins may remap the token but never have to.
- **Non-goals:** every interaction change (artist browse, request confirmation, dismissal, result
  caps, drawer context) — those are the `search-ui-cleanup` change, which builds on this one.

## Capabilities

### Modified Capabilities

- `web-ui-presentation`: the catalog-search anatomy requirement gains the chrome-opt-in rule
  (container buttons and link-affordances are surfaces and links, never widget buttons, under
  every skin), the broken-image suppression, the detail-view artwork placeholder, and the
  detail-view width band. The requirement's own prose adopts the settled term "detail view".

## Impact

- **Code:** `packages/web` only — `base.css` (reset/layers/chrome inversion, width token),
  the three skin files (wrapped in the theme layer; chrome moved from `button` to `.btn`;
  container surfaces and links themed deliberately), a mechanical class sweep over existing push
  buttons in the Svelte components, `.track-rows` flex direction, the detail-view artwork
  placeholder markup, and an image on-error hook.
- **Tests:** new browser-mode layout assertions (geometry, per skin) plus a stylesheet-scanning
  convention test; no contract or facade change of any kind.
- **Release semantics:** `fix` (patch) — this is the broken-page hotfix, deliberately separated
  so it is not hostage to the feature change's review.
