import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { SKINS } from '$lib/skins.js';
import CatalogDetail from '$lib/components/CatalogDetail.svelte';
import CatalogResults from '$lib/components/CatalogResults.svelte';
import type { DetailState } from '$lib/search/detail.js';
import type { CatalogSearchResultDto } from '@music/downloader';

// The whole global cascade — these are assertions about what the shipped stylesheets compute to,
// so nothing here may be stubbed or narrowed. The skins are GLOBBED rather than listed for the
// same reason they are parameterized from `SKINS` below: a hand-list would give a newly added
// skin a green row measured against a stylesheet that was never loaded, which is worse than no
// row at all. Import order does not matter — every sheet restates the layer order.
import '$lib/styles/tokens.css';
import '$lib/styles/base.css';
const loadedSkins = import.meta.glob('$lib/styles/skins/*.css', { eager: true });

/**
 * The request page's anatomy, measured rather than described: the register this regression
 * actually lives in is computed geometry, so these tests read boxes off a real layout under every
 * shipped skin. A skin is a token remap, and a token remap can move a box — so each fact is
 * asserted under each skin, not once under the default.
 */

/**
 * Every shipped skin, plus the unskinned token layer. The skins come from their own source of
 * truth, so a fourth skin is measured the day it is added rather than the day someone remembers
 * this file. The tokens-only row never ships (app.html always writes a skin) but it is the
 * baseline every skin is a remap OF, so a break there is a break everywhere.
 */
const SKIN_ROWS: [label: string, skin: string | undefined][] = [
  ['(tokens only)', undefined],
  ...SKINS.map((skin): [string, string] => [skin, skin]),
];

/** How much of its card the artwork must fill before the slot counts as collapsed. */
const ART_FILLS_ITS_CARD = 0.8;
/** How much of the panel's width the detail cover must fill before it counts as collapsed. */
const ART_FILLS_THE_PANEL = 0.75;
/** How tall a track row may get, in thumbnails, before it has plainly stacked into a column. */
const ROW_IS_STACKED_ABOVE = 3;
/** The share of a window the panel may take. */
const PANEL_WINDOW_SHARE = 0.75;
/** What the active skin paints a link in — resolved from the token, not restated per skin. */
function accentColour(): string {
  const probe = document.createElement('span');
  probe.style.color = 'var(--accent)';
  document.body.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();

  return colour;
}
/** The width token's floor, restated from `tokens.css` so a drift reads as one. */
const READABLE_FLOOR_PX = 340;
/** The token's preferred width, in rem — what the panel gets when the window has room for it. */
const READABLE_PREFERRED_REM = 26;

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

/** Stand in for a skin that remaps the width token, for the length of one test. */
function askingForAWiderPanel(size: string): void {
  document.documentElement.style.setProperty('--detail-size', size);
  onTestFinished(() => {
    document.documentElement.style.removeProperty('--detail-size');
  });
}

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

describe('the cascade these measurements are taken against', () => {
  it('has a stylesheet loaded for every shipped skin', () => {
    const loaded = Object.keys(loadedSkins).map((path) => path.replace(/^.*\/(.*)\.css$/, '$1'));
    const byName = (a: string, b: string) => a.localeCompare(b);

    // Without this, adding a skin adds a row below that measures the UNSKINNED page and calls it
    // that skin — a green test asserting a fact it never took.
    expect(loaded.toSorted(byName)).toEqual([...SKINS].toSorted(byName));
  });
});

describe.each(SKIN_ROWS)('request-page anatomy under skin %s', (_label, skin) => {
  it('reserves the artwork slot its full square before any cover arrives', async () => {
    wearing(skin);
    await wideViewport();
    await render(CatalogResults, resultProps());

    const art = boxOf('.art-grid .art');
    const card = boxOf('.art-grid > .result');

    // A collapsed slot is the bug: the grid reflows as covers land, and the card reads as text.
    // The square is measured against its card rather than in pixels, because every skin's type
    // scale sizes the grid's tracks differently and all of them are correct.
    expect(art.width).toBeGreaterThan(card.width * ART_FILLS_ITS_CARD);
    expect(Math.abs(art.height - art.width)).toBeLessThanOrEqual(1);
  });

  it('clips a long title rather than painting it across its neighbours', async () => {
    wearing(skin);
    await wideViewport();
    await render(CatalogResults, resultProps());

    const title = document.querySelector('.art-grid .result-title');
    if (title === null) {
      throw new Error('no result title rendered');
    }

    // Measured, not inferred: a box cannot see overflowing INK. The title's rect is stretched to
    // its card whether or not it clips, so the fact worth asserting is that there is more text
    // than fits AND that the surplus is cut off rather than painted over the next card.
    expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
    const style = getComputedStyle(title);
    expect(style.overflow).toBe('hidden');
    expect(style.textOverflow).toBe('ellipsis');
    expect(boxOf('.art-grid .result-title').right).toBeLessThanOrEqual(
      boxOf('.art-grid > .result').right + 1,
    );
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
    expect(row.height).toBeLessThan(thumb.height * ROW_IS_STACKED_ABOVE);
  });

  it('gives the artist result a round bubble rather than a card-wide square', async () => {
    wearing(skin);
    await wideViewport();
    await render(CatalogResults, resultProps());

    const bubble = document.querySelector('.artist-row .art');
    if (bubble === null) {
      throw new Error('no artist result rendered');
    }

    const box = bubble.getBoundingClientRect();
    const card = boxOf('.artist-row > .result');

    // The footprint is how an artist is told from an album at a glance: a centred bubble rather
    // than the card-wide square an album wears. Roundness is left to each skin — the forum skin
    // squares it deliberately, and that is a look, not a break.
    expect(box.width).toBeLessThan(card.width);
    expect(Math.abs(box.height - box.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.left - card.left - (card.right - box.right))).toBeLessThanOrEqual(1);
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
    // Positively the accent, not merely "different from the body": the paragraph around it is
    // already muted, so comparing against body text passes with `.linkish` styled by nothing.
    expect(style.color).toBe(accentColour());
    expect(style.color).not.toBe(getComputedStyle(link.parentElement ?? link).color);
  });

  it('renders the tracklist disclosure as a link too', async () => {
    wearing(skin);
    await wideViewport();
    await render(CatalogDetail, detailProps(albumDetail()));

    const disclosure = document.querySelector('.tracklist-open');
    if (disclosure === null) {
      throw new Error('the tracklist disclosure did not render');
    }

    const style = getComputedStyle(disclosure);
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(style.borderTopWidth).toBe('0px');
    expect(style.color).toBe(accentColour());
  });

  it('opens the detail view at a readable width', async () => {
    wearing(skin);
    await wideViewport();
    await render(CatalogDetail, detailProps(albumDetail()));

    const panel = boxOf('.catalog-detail');
    const rootFontSize = Number(
      getComputedStyle(document.documentElement).fontSize.replace('px', ''),
    );

    // The floor is the industry band's minimum; no skin's type scale may crush it below that,
    // and above the floor the panel is the type scale's own 26rem rather than anything wider.
    expect(panel.width).toBeGreaterThanOrEqual(READABLE_FLOOR_PX);
    expect(panel.width).toBeLessThanOrEqual(
      Math.max(READABLE_FLOOR_PX, READABLE_PREFERRED_REM * rootFontSize) + 1,
    );
  });

  it('leaves a middling window most of itself even when a skin asks for more', async () => {
    wearing(skin);
    // The token is a skin's to remap — which is exactly when the viewport share has something to
    // do. At the shipped widths the token is always the smaller term, so asserting the share
    // without remapping asserts nothing. The stand-in skin asks in px rather than rem, so the
    // ask outgrows the window under every type scale rather than only the larger ones.
    askingForAWiderPanel('900px');
    await page.viewport(760, 900);
    await render(CatalogDetail, detailProps(albumDetail()));

    const panel = boxOf('.catalog-detail');

    expect(panel.width).toBeLessThanOrEqual(window.innerWidth * PANEL_WINDOW_SHARE + 1);
  });

  it('gives the detail view the same reserved artwork square the grids have', async () => {
    wearing(skin);
    await wideViewport();
    await render(CatalogDetail, detailProps(albumDetail()));

    const art = boxOf('.catalog-detail .art');
    const panel = boxOf('.catalog-detail');

    // The panel is a scrolling column: without saying so, a slot whose height comes from its
    // width and whose contents are positioned is free to shrink away to nothing.
    expect(art.width).toBeGreaterThan(panel.width * ART_FILLS_THE_PANEL);
    expect(Math.abs(art.height - art.width)).toBeLessThanOrEqual(1);
  });
});
