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

- [ ] 3.1 Define a `panel` + `region-head` (title-bar) convention as additive hooks and document it in the styles directory (rule: hooks are meaning-based; no visual/utility classes)
- [ ] 3.2 Apply the panel / region-head chrome to the section pages (acquisitions list, reviews queue, review detail, acquisition detail) without changing any component's semantics
- [ ] 3.3 Introduce an optional detail-`aside` region in the shell grid for detail routes (e.g. acquisition detail), placed via each skin's shell layout tokens
- [ ] 3.4 Style the chrome per skin (forum gradient caption bars, glass panels, terminal hairline blocks) and confirm the rendered DOM is identical across skins

## 4. User-facing skin switcher

- [x] 4.1 Add an accessible skin-switcher control in the masthead (labelled group of choices) — `SkinSwitcher.svelte`, `role="group"` + `aria-label`
- [x] 4.2 Persist the choice (localStorage) and apply it by setting `data-skin` on `<html>`; resolve the stored preference on load without a flash of the wrong skin (no-flash `<head>` script in `app.html`)
- [x] 4.3 Progressive enhancement: with scripting disabled, the server default (`forum`) still applies and the page remains usable (switcher is JS-only; default lives on `<html>` in the server response)
- [x] 4.4 (Decided, per design Open Question) client-side resolution against the server default is sufficient — no flash observed; cookie-based SSR not implemented

## 5. Accessibility pass

- [ ] 5.1 Audit landmarks (exactly one `main`, labelled `nav`, `banner`/`contentinfo`) and heading levels (one `h1` per page, no skipped levels, no reliance on sectioning) across all routes
- [ ] 5.2 Verify DOM source order == reading/tab order under every skin; ensure no skin uses `order`/grid to reorder meaningful content (WCAG 1.3.2)
- [ ] 5.3 Verify a sensible, operable document with all CSS disabled on each route
- [ ] 5.4 Ensure a visible keyboard focus indicator under every skin and check text/control colour-contrast for each skin

## 6. Tests & coverage gate

- [ ] 6.1 SSR test for `+layout.svelte`: renders the landmark set (banner/nav/main/contentinfo) in order and marks the active nav item
- [ ] 6.2 Client/SSR tests for the skin switcher: sets `data-skin`, persists, resolves a stored preference, and degrades without scripting
- [ ] 6.3 Assert the default `data-skin` is present in the served document (server/ssr)
- [ ] 6.4 Playwright e2e (no coverage threshold): toggling a skin re-skins **and** re-lays-out the same DOM; plus a tab-order and a CSS-off check
- [ ] 6.5 Restore the web package to 100% merged coverage (server + ssr + client) with no new carve-outs

## 7. Validate & wrap up

- [ ] 7.1 `openspec validate` the change and run the full gate (`pnpm check`)
- [ ] 7.2 `/verify` the swap end-to-end in the running app (all skins, key routes)
- [ ] 7.3 Commit on a branch and open the PR per the workflow (no self-merge)
