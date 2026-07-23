## 1. Semantic app shell & token layer (done in the ui-theming spike)

- [x] 1.1 Add the two-tier token layer (`src/lib/styles/tokens.css`: primitives + the semantic "switchboard", including `--shell-*`/`--nav-dir` layout tokens)
- [x] 1.2 Add element-level base styles (`src/lib/styles/base.css`) that read only semantic tokens — shell grid, headings, buttons, forms, tables, badges/chips, nav, status bar
- [x] 1.3 Add `src/routes/+layout.svelte` app shell: `banner` masthead (wordmark + "Request a download" primary action), labelled active-aware primary `nav`, one `main`, `contentinfo` footer; import the global CSS in cascade order (tokens → base → skins)
- [x] 1.4 Set the server-rendered default skin (`data-skin="forum"`) on `<html>` in `app.html`
- [x] 1.5 Reconcile `Landing.svelte` (remove brand heading + nav now owned by the shell; it becomes the dashboard body) and update `Landing.ssr.test.ts`
- [x] 1.6 Confirm `pnpm run check:svelte` is clean and all three skins swap live via `data-skin` in the running app

## 2. Shipped skins (done in the ui-theming spike)

- [x] 2.1 `forum` skin (default) — subSilver palette, gradient title bars, zebra tables, beveled Win2k widgets, top-bar layout
- [x] 2.2 `glass` skin — deep-teal + serif, translucent surfaces, left-rail sidebar layout
- [x] 2.3 `terminal` skin — amber-CRT monospace, dense top-bar layout

## 3. Per-page chrome

- [x] 3.1 Define a `panel` + `region-head` (title-bar) convention as additive hooks and document it in the styles directory (rule: hooks are meaning-based; no visual/utility classes)
- [x] 3.2 Apply the panel / region-head chrome to the section pages (acquisitions master pane, reviews queue); other pages get chrome from the skin's heading-bar + table rules with no markup change
- [x] 3.3 Master-detail acquisitions view: a nested `/acquisitions` layout keeps the list as a persistent master pane and renders `[id]` detail (or the new form / empty placeholder) beside it; selected row marked from the URL
- [x] 3.4 Style the chrome per skin (forum gradient caption bars, glass panels, terminal hairline blocks); rendered DOM is identical across skins (CSS-only)

## 4. User-facing skin switcher

- [x] 4.1 Add an accessible skin-switcher control in the masthead (labelled group of choices) — `SkinSwitcher.svelte`, `role="group"` + `aria-label`
- [x] 4.2 Persist the choice (localStorage) and apply it by setting `data-skin` on `<html>`; resolve the stored preference on load without a flash of the wrong skin (no-flash `<head>` script in `app.html`)
- [x] 4.3 Progressive enhancement: with scripting disabled, the server default (`forum`) still applies and the page remains usable (switcher is JS-only; default lives on `<html>` in the server response)
- [x] 4.4 (Decided, per design Open Question) client-side resolution against the server default is sufficient — no flash observed; cookie-based SSR not implemented

## 5. Accessibility pass

- [x] 5.1 Audited: shell emits exactly one `main`, a labelled `nav` (`aria-label="Primary"`), `banner` header + `contentinfo` footer; one `h1` per page (page-owned; shell brand is a link, master pane uses a non-heading `.eyebrow`). Asserted in the root layout SSR test.
- [x] 5.2 DOM source order is masthead → nav → main → footer for every skin; skins reposition regions only via `grid-template-areas` (glass side-rail), never `order`/reordering of meaningful content (WCAG 1.3.2)
- [x] 5.3 CSS-off: the DOM is authored in reading order (banner, nav, content, footer), so it degrades to a correct, operable document
- [x] 5.4 Base defines a visible `:focus-visible` outline (2px `--focus`) applied under every skin; each skin sets a legible `--focus`/text contrast

## 6. Tests & coverage gate

- [x] 6.1 SSR test for `+layout.svelte`: asserts the landmark skeleton (single `main`, `header`, `footer`, labelled `nav`) and the attention-count badge branches
- [x] 6.2 Client tests for the skin switcher: sets `data-skin`, persists, mirrors the resolved skin (valid + invalid), and degrades when storage is unavailable
- [x] 6.3 The default `data-skin="forum"` is server-rendered on `<html>` in `app.html`; verified in the running app (Playwright) and confirmed live post-deploy
- [~] 6.4 Skin swap verified live via Playwright (data-skin toggle re-skins AND re-lays-out the same DOM, all three skins); an automated e2e spec for tab-order/CSS-off is a follow-up in the advisory e2e tier
- [x] 6.5 Web package is at 100% merged coverage (server + ssr + client); full `pnpm check` gate green with no new carve-outs

## 7. Validate & wrap up

- [ ] 7.1 `openspec validate` the change and run the full gate (`pnpm check`)
- [ ] 7.2 `/verify` the swap end-to-end in the running app (all skins, key routes)
- [ ] 7.3 Commit on a branch and open the PR per the workflow (no self-merge)
