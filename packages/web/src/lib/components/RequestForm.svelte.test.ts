import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { describe, expect, it, onTestFinished } from 'vitest';
import { answerWith, holdSubmissions, resetAnswer } from '../../../test/stubs/app-forms.js';
import RequestForm from './RequestForm.svelte';

const ACQUISITION = 'acq-9';

/** What the request action answers when the download was made, for the length of one test. */
function theRequestSucceeds(): void {
  answerWith({ type: 'success', data: { requested: { acquisitionId: ACQUISITION } } });
  onTestFinished(resetAnswer);
}

describe('RequestForm', () => {
  it('says what to request in fields a form submission can carry', async () => {
    await render(RequestForm, {
      fields: { kind: 'release-group', mbid: 'mb-1' },
      title: 'Graceland',
    });

    const form = document.querySelector<HTMLFormElement>('form.request-form')!;
    const data = new FormData(form);
    expect(data.get('kind')).toBe('release-group');
    expect(data.get('mbid')).toBe('mb-1');
    // The title rides along so the answer can name what was asked for without re-reading it.
    expect(data.get('title')).toBe('Graceland');
  });

  it('confirms at the form that submitted, with a way to open what was made', async () => {
    theRequestSucceeds();
    await render(RequestForm, { fields: { kind: 'release-group', mbid: 'mb-1' } });

    await page.getByRole('button', { name: 'Request' }).click();

    // Beside the record it is about — five requests from one search leave five confirmations.
    await expect.element(page.getByRole('status')).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'open it' }))
      .toHaveAttribute('href', `/acquisitions/${ACQUISITION}`);
  });

  it('keeps the page where it was, rather than applying the action over it', async () => {
    theRequestSucceeds();
    await render(RequestForm, { fields: { kind: 'release-group', mbid: 'mb-1' } });

    await page.getByRole('button', { name: 'Request' }).click();
    await expect.element(page.getByRole('status')).toBeVisible();

    // Still requestable afterwards: the form did not reset, reload, or navigate.
    await expect.element(page.getByRole('button', { name: 'Request' })).toBeEnabled();
  });

  it('leaves a refused request to the page, rather than confirming one that was not made', async () => {
    answerWith({ type: 'failure', data: { message: 'Invalid input: no target' } });
    onTestFinished(resetAnswer);
    await render(RequestForm, { fields: { kind: 'release-group', mbid: 'mb-1' } });

    await page.getByRole('button', { name: 'Request' }).click();

    // No confirmation, and the button comes back: the refusal renders where the page renders
    // refusals, and this form is ready to be corrected and sent again.
    expect(document.querySelector('[role="status"]')).toBeNull();
    await expect.element(page.getByRole('button', { name: 'Request' })).toBeEnabled();
  });

  it('goes busy while its own request is in flight', async () => {
    const submission = holdSubmissions();
    onTestFinished(() => submission.release());
    await render(RequestForm, { fields: { kind: 'release-group', mbid: 'mb-1' } });

    await page.getByRole('button', { name: 'Request' }).click();

    await expect.element(page.getByRole('button', { name: 'Requesting…' })).toBeDisabled();
  });

  it('omits a title it was not given, rather than sending an empty one', async () => {
    await render(RequestForm, { fields: { kind: 'release-group', mbid: 'mb-1' } });

    const form = document.querySelector<HTMLFormElement>('form.request-form')!;
    expect(new FormData(form).get('title')).toBeNull();
  });
});
