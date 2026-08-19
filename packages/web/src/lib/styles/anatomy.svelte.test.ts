import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import CatalogDetail from '$lib/components/CatalogDetail.svelte';
import CatalogResults from '$lib/components/CatalogResults.svelte';
import type { DetailState } from '$lib/search/detail.js';
import type { CatalogSearchResultDto } from '@music/downloader';

// The whole global cascade, in the order the layout imports it — these are assertions about what
// the shipped stylesheets compute to, so nothing here may be stubbed or narrowed.
import '$lib/styles/tokens.css';
import '$lib/styles/base.css';
import '$lib/styles/skins/glass.css';
import '$lib/styles/skins/terminal.css';
import '$lib/styles/skins/forum.css';

/**
 * The request page's anatomy, measured rather than described: the register this regression
 * actually lives in is computed geometry, so these tests read boxes off a real layout under every
 * shipped skin. A skin is a token remap, and a token remap can move a box — so each fact is
 * asserted under each skin, not once under the default.
 */

/** Every shipped skin hook, `undefined` being the unskinned default the tokens ship. */
const SKINS = [undefined, 'forum', 'glass', 'terminal'] as const;

const RG = '19847822-1430-3380-9cf1-bc45545b34ac';
const ARTIST = '4d5447d7-c61c-4120-ba1b-d7f471d385b9';
const RECORDING = '0b6b4ba0-d36f-47bd-b4ea-6a5b91842d29';
const RELEASE = '1b022e01-4da6-387b-8658-8678046e4cef';

/** Long enough that a title which does not clip runs past its card under any type scale. */
const LONG_TITLE =
  'The Rise and Fall of Ziggy Stardust and the Spiders from Mars (2012 Remastered Deluxe Edition)';

function results(overrides: Partial<CatalogSearchResultDto> = {}): CatalogSearchResultDto {
  return {
    leading: 'release-group',
    releaseGroups: [
      {
        mbid: RG,
        title: LONG_TITLE,
        artistCredit: 'David Bowie',
        year: 1972,
        primaryType: 'Album',
        secondaryTypes: [],
      },
    ],
    artists: [{ mbid: ARTIST, name: 'David Bowie', disambiguation: 'English singer' }],
    recordings: [
      {
        mbid: RECORDING,
        title: 'Starman',
        artistCredit: 'David Bowie',
        release: { mbid: RELEASE, title: 'The Rise and Fall of Ziggy Stardust' },
      },
    ],
    ...overrides,
  };
}

const resultProps = (overrides: Record<string, unknown> = {}) => ({
  results: results(),
  filter: 'all' as const,
  query: 'ziggy stardust',
  onOpen: vi.fn(),
  onFilter: vi.fn(),
  ...overrides,
});

/**
 * A real album's worth of pressings — enough to overflow the panel, which is the state the
 * panel's own layout has to survive: a column that scrolls will shrink whatever lets it.
 */
const albumDetail = (): DetailState => ({
  kind: 'release-group',
  mbid: RG,
  title: LONG_TITLE,
  editions: {
    groups: [
      {
        representative: { mbid: RELEASE, title: 'Ziggy Stardust', formats: ['CD'], trackCount: 11 },
        editions: Array.from({ length: 28 }, (_unused, index) => ({
          mbid: index === 0 ? RELEASE : String(index).padStart(8, '0') + RELEASE.slice(8),
          title: 'Ziggy Stardust',
          formats: ['CD'],
          trackCount: 11,
        })),
      },
    ],
    bestMatch: { kind: 'pick', mbid: RELEASE },
  },
});

const detailProps = (detail: DetailState) => ({
  detail,
  tracklists: {},
  onTracklist: vi.fn(),
  pin: undefined,
  onPin: vi.fn(),
  onClose: vi.fn(),
});

/** Put the document in one skin for the length of a test, and take it off afterwards. */
function wearing(skin: string | undefined): void {
  if (skin === undefined) {
    delete document.documentElement.dataset.skin;
  } else {
    document.documentElement.dataset.skin = skin;
  }
  onTestFinished(() => {
    delete document.documentElement.dataset.skin;
  });
}

/** A window wide enough for the side-panel presentation — the bottom sheet has its own rules. */
async function wideViewport(): Promise<void> {
  await page.viewport(1280, 900);
}

function boxOf(selector: string): DOMRect {
  const element = document.querySelector(selector);
  if (element === null) {
    throw new Error(`nothing matched ${selector}`);
  }

  return element.getBoundingClientRect();
}

describe.each(SKINS)('request-page anatomy under skin %s', (skin) => {
  it('reserves the artwork slot its full square before any cover arrives', async () => {
    wearing(skin);
    await wideViewport();
    await render(CatalogResults, resultProps());

    const art = boxOf('.art-grid .art');
    const card = boxOf('.art-grid > .result');

    // A collapsed slot is the bug: the grid reflows as covers land, and the card reads as text.
    // The square is measured against its card rather than in pixels, because every skin's type
    // scale sizes the grid's tracks differently and all of them are correct.
    expect(art.width).toBeGreaterThan(card.width * 0.8);
    expect(Math.abs(art.height - art.width)).toBeLessThanOrEqual(1);
  });

  it('keeps a long title inside the card it belongs to', async () => {
    wearing(skin);
    await wideViewport();
    await render(CatalogResults, resultProps());

    const card = boxOf('.art-grid > .result');
    const title = boxOf('.art-grid .result-title');

    // Unclipped, the title paints across its neighbours — the card is what bounds it.
    expect(title.width).toBeLessThanOrEqual(card.width);
    expect(title.right).toBeLessThanOrEqual(card.right + 1);
  });

  it('lays a track row out as a row', async () => {
    wearing(skin);
    await wideViewport();
    await render(CatalogResults, resultProps());

    const thumb = boxOf('.track-rows .art');
    const title = boxOf('.track-rows .result-title');
    const request = boxOf('.track-rows .request');
    const row = boxOf('.track-rows > .result');

    expect(thumb.right).toBeLessThanOrEqual(title.left + 1);
    expect(Math.abs(thumb.top + thumb.height / 2 - (title.top + title.height / 2))).toBeLessThan(
      thumb.height,
    );
    // The request action rides the row rather than stacking below a column of text.
    expect(request.left).toBeGreaterThanOrEqual(title.right - 1);
    expect(row.height).toBeLessThan(thumb.height * 3);
  });

  it('renders a link-affordance as a link, not as a raised button', async () => {
    wearing(skin);
    await wideViewport();
    await render(
      CatalogResults,
      resultProps({ results: results({ artists: [] }), filter: 'artist' }),
    );

    const link = document.querySelector('.linkish');
    if (link === null) {
      throw new Error('the zero-result cross-link did not render');
    }

    const style = getComputedStyle(link);
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(style.borderTopWidth).toBe('0px');
    expect(style.boxShadow).toBe('none');
    expect(style.cursor).toBe('pointer');
    // It has to read as a link: the surrounding prose colour would make it invisible as one.
    expect(style.color).not.toBe(getComputedStyle(document.body).color);
  });

  it('opens the detail view at a readable width', async () => {
    wearing(skin);
    await wideViewport();
    await render(CatalogDetail, detailProps(albumDetail()));

    const panel = boxOf('.catalog-detail');
    const rootFontSize = Number(
      getComputedStyle(document.documentElement).fontSize.replace('px', ''),
    );

    // The floor is the industry band's minimum; no skin's type scale may crush it below that.
    expect(panel.width).toBeGreaterThanOrEqual(340);
    expect(panel.width).toBeLessThanOrEqual(Math.max(340, 30 * rootFontSize) + 1);
    // And it never takes the window over, however narrow the window is.
    expect(panel.width).toBeLessThanOrEqual(window.innerWidth * 0.75 + 1);
  });

  it('gives the detail view the same reserved artwork square the grids have', async () => {
    wearing(skin);
    await wideViewport();
    await render(CatalogDetail, detailProps(albumDetail()));

    const art = boxOf('.catalog-detail .art');
    const panel = boxOf('.catalog-detail');

    // The panel is a scrolling column: without saying so, a slot whose height comes from its
    // width and whose contents are positioned is free to shrink away to nothing.
    expect(art.width).toBeGreaterThan(panel.width * 0.5);
    expect(Math.abs(art.height - art.width)).toBeLessThanOrEqual(1);
  });

  it('shows the placeholder, not a broken-image glyph, when a cover cannot be fetched', async () => {
    wearing(skin);
    await wideViewport();
    await render(CatalogResults, resultProps());

    // The artwork endpoint is not served here, so every cover errors — exactly what an archive
    // outage does in production.
    await vi.waitFor(() => {
      expect(document.querySelector('.art-grid .art img')).toBeNull();
    });
    await expect.element(page.getByText('TR', { exact: true }).first()).toBeVisible();
  });
});
