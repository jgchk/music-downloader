import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

const LAYOUT_DATA = {
  username: 'jake',
  attentionCount: 0,
  pathname: '/acquisitions/new',
  acquisitions: [],
  listFailed: false,
  selectedId: undefined,
  detailActive: true,
};

/** The page as the server sends it, with whatever a refused submission carried. */
const body = (form: { message: string; values: Record<string, string> } | null = null): string =>
  render(Page, { props: { data: LAYOUT_DATA, params: {}, form } }).body;

describe('the request page’s fallback form', () => {
  /** Exactly the names `submitFormValues` and the request contract read. */
  const POLICY_FIELDS = [
    'qualityFloor',
    'qualityOrder',
    'matchThreshold',
    'maxSearchRounds',
    'maxTotalAttempts',
    'timeBudgetMs',
    'stallTimeoutMs',
    'maxQueueWaitMs',
  ];

  it.each(POLICY_FIELDS.map((field) => [field]))(
    'offers %s, so the page can express what the request contract accepts',
    (field) => {
      // The server reshaper reads these exact strings; nothing else joins the two halves, so a
      // typo on either side would silently drop the policy with both suites green.
      expect(body()).toContain(`name="${field}"`);
    },
  );

  it('can request a single track by artist and title, not only an album', () => {
    const html = body();

    expect(html).toContain('name="targetType"');
    expect(html).toContain('value="track"');
  });

  it('gives back what was typed, including the policies, when a submission is refused', () => {
    const html = body({
      message: 'Invalid input: artist is required',
      values: { kind: 'descriptor', artist: 'Paul Simon', timeBudgetMs: '60000' },
    });

    expect(html).toContain('value="Paul Simon"');
    expect(html).toContain('value="60000"');
  });
});

describe('new acquisition page (SSR)', () => {
  it('serves the search surface, ready for the first keystroke', () => {
    const { body } = render(Page, {
      props: { data: LAYOUT_DATA, params: {}, form: null },
    });

    expect(body).toContain('<h1>Request a download</h1>');
    expect(body).toContain('data-testid="catalog-query"');
    expect(body).toContain('data-testid="search-hint"');
  });

  it('serves a way to request without JavaScript, since the search needs it and this does not', () => {
    const { body } = render(Page, {
      props: { data: LAYOUT_DATA, params: {}, form: null },
    });

    expect(body).toContain('data-testid="native-form"');
    expect(body).toContain('name="artist"');
    expect(body).toContain('name="title"');
    expect(body).toContain('method="POST"');
  });

  it('renders a rejected submission’s message where a person will read it', () => {
    const { body } = render(Page, {
      props: {
        data: LAYOUT_DATA,
        params: {},
        form: { message: 'Invalid input: artist is required', values: { artist: '' } },
      },
    });

    expect(body).toContain('Invalid input: artist is required');
    expect(body).toContain('data-testid="form-error"');
  });
});
