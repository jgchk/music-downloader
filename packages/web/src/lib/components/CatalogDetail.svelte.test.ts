import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { holdSubmissions } from '../../../test/stubs/app-forms.js';
import CatalogDetail from './CatalogDetail.svelte';
import { QUALITY_FLOORS } from '$lib/search/view.js';
import type { DetailState, ChosenEdition, TracklistState } from '$lib/search/detail.js';

const RG = '19847822-1430-3380-9cf1-bc45545b34ac';
const PICK = '1b022e01-4da6-387b-8658-8678046e4cef';
const OTHER = 'ef6e0c0a-9f1f-41af-820a-e3ca91560c13';

const edition = (mbid: string, overrides: Record<string, unknown> = {}) => ({
  mbid,
  title: 'Graceland',
  formats: ['CD'],
  trackCount: 11,
  date: '1986-08-29',
  country: 'DE',
  ...overrides,
});

const releaseGroupDetail = (bestMatch: {
  kind: 'pick' | 'selection-required';
  mbid?: string;
}): DetailState => ({
  kind: 'release-group',
  mbid: RG,
  title: 'Graceland',
  editions: {
    groups: [
      {
        representative: edition(PICK),
        editions: [edition(PICK), edition(OTHER, { country: 'US' })],
      },
      {
        representative: edition('9b4c6e1a-1111-4111-8111-111111111111', { trackCount: 19 }),
        editions: [edition('9b4c6e1a-1111-4111-8111-111111111111', { trackCount: 19 })],
      },
    ],
    bestMatch,
  },
});

const props = (
  detail: DetailState,
  tracklists: Record<string, TracklistState> = {},
  chosen?: ChosenEdition,
) => ({
  detail,
  tracklists,
  onTracklist: vi.fn(),
  chosen,
  onChoose: vi.fn(),
  onClose: vi.fn(),
});

describe('CatalogDetail', () => {
  it('draws no detail line for a pressing the catalog says nothing else about', async () => {
    const bare = { mbid: PICK, title: 'Graceland', formats: [] as string[] };
    await render(
      CatalogDetail,
      props({
        kind: 'release-group',
        mbid: RG,
        title: 'Graceland',
        editions: {
          groups: [{ representative: bare, editions: [bare] }],
          bestMatch: { kind: 'pick', mbid: PICK },
        },
      }),
    );

    // No date, country, format or track count — so no line, rather than an empty one that reads
    // as a fact the catalog stated.
    await expect.element(page.getByTestId('best-match')).toBeVisible();
    expect(document.querySelector('.edition-summary')).toBeNull();
  });

  it('says the catalog lists no pressings, without offering a format filter over nothing', async () => {
    await render(
      CatalogDetail,
      props({
        kind: 'release-group',
        mbid: RG,
        title: 'Graceland',
        editions: { groups: [], bestMatch: { kind: 'selection-required' } },
      }),
    );

    await expect.element(page.getByTestId('editions-unknown')).toBeVisible();
    expect(document.querySelector('.format-filter')).toBeNull();
  });

  it('states what the system would take, above everything and outside the filter', async () => {
    await render(CatalogDetail, props(releaseGroupDetail({ kind: 'pick', mbid: PICK })));

    // Groups sort by shared tracklist and the pick is chosen on other grounds, so it is regularly
    // inside a collapsed group — a badge down there is a pick nobody can check.
    await expect.element(page.getByTestId('best-match')).toBeVisible();
  });

  it('hands the choice back to the system when its own summary is selected', async () => {
    const onChoose = vi.fn();
    await render(CatalogDetail, {
      ...props(releaseGroupDetail({ kind: 'pick', mbid: PICK })),
      chosen: { album: RG, edition: OTHER },
      onChoose,
    });

    await page.getByTestId('best-match').click();

    // Called with nothing at all: "no chosen edition" is the absence of one, not a value.
    expect(onChoose).toHaveBeenCalledWith();
  });

  it('keeps the summary on screen while a format is being looked at', async () => {
    await render(CatalogDetail, props(releaseGroupDetail({ kind: 'pick', mbid: PICK })));

    await page.getByRole('button', { name: 'Vinyl', exact: true }).click();

    // What the system would take does not change because someone is browsing the vinyl.
    await expect.element(page.getByTestId('best-match')).toBeVisible();
  });

  it('says when a format has no pressings, rather than showing an empty listing', async () => {
    await render(CatalogDetail, props(releaseGroupDetail({ kind: 'pick', mbid: PICK })));

    await page.getByRole('button', { name: 'Vinyl', exact: true }).click();

    await expect.element(page.getByTestId('no-editions-in-format')).toBeVisible();
  });

  it('narrows to the pressings of a format that does have some', async () => {
    await render(CatalogDetail, props(releaseGroupDetail({ kind: 'pick', mbid: PICK })));

    await page.getByRole('button', { name: 'CD', exact: true }).click();

    expect(document.querySelector('[data-testid="no-editions-in-format"]')).toBeNull();
    expect(document.querySelectorAll('.editions .edition').length).toBeGreaterThan(0);
  });

  it('asks the archive for the album cover, at the size the panel renders', async () => {
    await render(CatalogDetail, props(releaseGroupDetail({ kind: 'pick', mbid: PICK })));

    // Without this the panel can quietly stop asking: the slot still reserves its square and the
    // initials still show, so a missing request looks exactly like a record with no cover.
    expect(document.querySelector('.art-detail img')?.getAttribute('src')).toBe(
      `/cover-art/release-group/${RG}?size=500`,
    );
  });

  it('renders nothing at all while nothing is open', async () => {
    await render(CatalogDetail, {
      detail: undefined,
      tracklists: {},
      onTracklist: vi.fn(),
      chosen: undefined,
      onChoose: vi.fn(),
      onClose: vi.fn(),
    });

    expect(document.querySelector('[data-testid="detail"]')).toBeNull();
  });

  it('says it is reading the catalog before it has anything to show', async () => {
    await render(CatalogDetail, props({ kind: 'loading', mbid: RG, title: 'Graceland' }));

    await expect.element(page.getByTestId('detail-loading')).toBeVisible();
  });

  it('reports a catalog it could not read, rather than an empty edition list', async () => {
    await render(
      CatalogDetail,
      props({
        kind: 'failed',
        mbid: RG,
        title: 'Graceland',
        message: 'The catalog could not be reached.',
      }),
    );

    await expect.element(page.getByTestId('detail-error')).toBeVisible();
    await expect.element(page.getByText('The catalog could not be reached.')).toBeVisible();
  });

  it('groups the editions by tracklist, opening the most common one', async () => {
    await render(CatalogDetail, props(releaseGroupDetail({ kind: 'pick', mbid: PICK })));

    const groups = [...document.querySelectorAll('details.edition-group')];
    expect(groups).toHaveLength(2);
    expect((groups[0] as HTMLDetailsElement).open).toBe(true);
    expect((groups[1] as HTMLDetailsElement).open).toBe(false);
    await expect.element(page.getByText('most common')).toBeVisible();
  });

  it('names in words which edition the system would choose, not by colour alone', async () => {
    await render(CatalogDetail, props(releaseGroupDetail({ kind: 'pick', mbid: PICK })));

    await expect.element(page.getByTestId('system-pick')).toBeVisible();
    await expect.element(page.getByText('the system’s default')).toBeVisible();
  });

  it('says when the system would ask rather than choose', async () => {
    await render(CatalogDetail, props(releaseGroupDetail({ kind: 'selection-required' })));

    await expect.element(page.getByTestId('selection-required')).toBeVisible();
    expect(document.querySelector('[data-testid="system-pick"]')).toBeNull();
  });

  it('requests the album itself until a pressing is chosen', async () => {
    await render(CatalogDetail, props(releaseGroupDetail({ kind: 'pick', mbid: PICK })));

    const form = document.querySelector<HTMLFormElement>('.catalog-detail form.request-form')!;
    expect(new FormData(form).get('kind')).toBe('release-group');
    expect(new FormData(form).get('mbid')).toBe(RG);
    await expect.element(page.getByRole('button', { name: 'Request download' })).toBeVisible();
  });

  it('asks for the pressing that was clicked, named with the album it was clicked on', async () => {
    const chosen = props(releaseGroupDetail({ kind: 'pick', mbid: PICK }));
    await render(CatalogDetail, chosen);

    await page.getByRole('button', { name: /1986-08-29 · US/ }).click();

    expect(chosen.onChoose).toHaveBeenCalledWith({ album: RG, edition: OTHER });
  });

  it('lets a chosen pressing be unchosen, back to the system’s own default', async () => {
    const chosen = props(
      releaseGroupDetail({ kind: 'pick', mbid: PICK }),
      {},
      {
        album: RG,
        edition: OTHER,
      },
    );
    await render(CatalogDetail, chosen);

    await page.getByRole('button', { name: /1986-08-29 · US/ }).click();

    expect(chosen.onChoose).toHaveBeenCalledWith(undefined);
  });

  it('shows the chosen pressing as the one that would be requested', async () => {
    await render(
      CatalogDetail,
      props(releaseGroupDetail({ kind: 'pick', mbid: PICK }), {}, { album: RG, edition: OTHER }),
    );

    const form = document.querySelector<HTMLFormElement>('.catalog-detail form.request-form')!;
    expect(new FormData(form).get('kind')).toBe('musicbrainz');
    expect(new FormData(form).get('mbid')).toBe(OTHER);
    await expect.element(page.getByRole('button', { name: 'Request this edition' })).toBeVisible();
  });

  it('can be dismissed from the keyboard, as an overlay should be', async () => {
    const onClose = vi.fn();
    await render(CatalogDetail, {
      ...props({ kind: 'loading', mbid: RG, title: 'Graceland' }),
      onClose,
    });

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  it('offers every quality floor the request contract accepts, and no other', async () => {
    // The options are written out in markup, so this is what keeps them from drifting away from
    // the contract's own buckets — in either direction.
    await render(CatalogDetail, props({ kind: 'recording', mbid: PICK, title: 'A Track' }));

    const options = [...document.querySelectorAll('select[name="qualityFloor"] option')].map(
      (option) => (option as HTMLOptionElement).value,
    );

    expect(options).toEqual(['', ...Object.keys(QUALITY_FLOORS)]);
  });

  it('stays open for any other key, so typing is not a way to lose the page', async () => {
    const onClose = vi.fn();
    await render(CatalogDetail, {
      ...props({ kind: 'loading', mbid: RG, title: 'Graceland' }),
      onClose,
    });

    await userEvent.keyboard('a');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks for a tracklist only when a person asks to see one', async () => {
    const onTracklist = vi.fn();
    await render(CatalogDetail, {
      ...props(releaseGroupDetail({ kind: 'pick', mbid: PICK })),
      onTracklist,
    });

    expect(onTracklist).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'View tracklist' }).first().click();

    expect(onTracklist).toHaveBeenCalledWith(PICK);
  });

  it('shows the running order once it has been read', async () => {
    await render(
      CatalogDetail,
      props(releaseGroupDetail({ kind: 'pick', mbid: PICK }), {
        [PICK]: {
          kind: 'loaded',
          tracklist: {
            tracks: [{ position: 1, title: 'The Boy in the Bubble', durationMs: 239_000 }],
          },
        },
      }),
    );

    await expect.element(page.getByText('The Boy in the Bubble')).toBeVisible();
    await expect.element(page.getByText('3:59')).toBeVisible();
  });

  it('says a tracklist is being read, and reports one that could not be', async () => {
    await render(
      CatalogDetail,
      props(releaseGroupDetail({ kind: 'pick', mbid: PICK }), { [PICK]: { kind: 'loading' } }),
    );

    await expect.element(page.getByText('Reading the tracklist…')).toBeVisible();
  });

  it('reports a tracklist the catalog would not give', async () => {
    await render(
      CatalogDetail,
      props(releaseGroupDetail({ kind: 'pick', mbid: PICK }), {
        [PICK]: { kind: 'failed', message: 'Could not read the tracklist.' },
      }),
    );

    await expect.element(page.getByText('Could not read the tracklist.')).toBeVisible();
  });

  it('requests a track as a track, with a quality floor to raise', async () => {
    await render(
      CatalogDetail,
      props({ kind: 'recording', mbid: PICK, title: 'The Boy in the Bubble' }),
    );

    const form = document.querySelector<HTMLFormElement>('.catalog-detail form.request-form')!;
    expect(new FormData(form).get('targetType')).toBe('track');
    await expect.element(page.getByLabelText('Quality floor')).toBeVisible();
  });

  it('will not send a second request while the first is still going', async () => {
    const submission = holdSubmissions();
    onTestFinished(() => submission.release());
    await render(CatalogDetail, props(releaseGroupDetail({ kind: 'pick', mbid: PICK })));

    await page.getByRole('button', { name: 'Request download' }).click();

    // The same words and the same disabling every request action in the app uses — the panel's
    // request is not a different kind of request.
    await expect.element(page.getByRole('button', { name: 'Requesting…' })).toBeDisabled();
  });

  it('closes when asked', async () => {
    const onClose = vi.fn();
    await render(CatalogDetail, {
      ...props({ kind: 'loading', mbid: RG, title: 'Graceland' }),
      onClose,
    });

    await page.getByRole('button', { name: 'Close' }).click();

    expect(onClose).toHaveBeenCalled();
  });
});
