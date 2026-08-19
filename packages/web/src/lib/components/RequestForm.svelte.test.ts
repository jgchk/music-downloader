import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
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
    // Under its own name: `title` is the submit contract's field for a descriptor request, and
    // an echo sharing it would be read as one.
    expect(data.get('displayTitle')).toBe('Graceland');
    expect(data.get('title')).toBeNull();
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

  it('says why it was refused, beside the button that was pressed', async () => {
    answerWith({ type: 'failure', data: { message: 'That acquisition already exists.' } });
    onTestFinished(resetAnswer);
    await render(RequestForm, { fields: { kind: 'release-group', mbid: 'mb-1' } });

    await page.getByRole('button', { name: 'Request' }).click();

    // A refusal at the top of a scrolled grid — or behind the detail view — is one nobody sees,
    // which is indistinguishable from a click that did not register. So they click again.
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('That acquisition already exists.');
    expect(document.querySelector('[role="status"]')).toBeNull();
    await expect.element(page.getByRole('button', { name: 'Request' })).toBeEnabled();
  });

  it('still says something when a refusal arrives with no words of its own', async () => {
    answerWith({ type: 'failure' });
    onTestFinished(resetAnswer);
    await render(RequestForm, { fields: { kind: 'release-group', mbid: 'mb-1' } });

    await page.getByRole('button', { name: 'Request' }).click();

    await expect.element(page.getByRole('alert')).toBeVisible();
  });

  it('clears the last outcome when asked again, rather than stacking answers', async () => {
    answerWith({ type: 'failure', data: { message: 'That acquisition already exists.' } });
    onTestFinished(resetAnswer);
    await render(RequestForm, { fields: { kind: 'release-group', mbid: 'mb-1' } });
    await page.getByRole('button', { name: 'Request' }).click();
    await expect.element(page.getByRole('alert')).toBeVisible();

    answerWith({ type: 'success', data: { requested: { acquisitionId: ACQUISITION } } });
    await page.getByRole('button', { name: 'Request' }).click();

    // A refusal sitting above a confirmation of the retry that fixed it is a page telling a
    // person two contradictory things about one button.
    await expect.element(page.getByRole('status')).toBeVisible();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('does not claim a request failed when the answer says it succeeded', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    onTestFinished(() => consoleError.mockRestore());
    answerWith({ type: 'success', data: { requested: { acquisitionId: '' } } });
    onTestFinished(resetAnswer);
    await render(RequestForm, { fields: { kind: 'release-group', mbid: 'mb-1' } });

    await page.getByRole('button', { name: 'Request' }).click();

    // The download was made; "try again" would have someone ask for it twice. And no
    // confirmation either, because linking to /acquisitions/undefined is no confirmation.
    expect(document.querySelector('[role="status"]')).toBeNull();
    await expect.element(page.getByRole('alert')).toHaveTextContent('may have gone through');
    expect(consoleError).toHaveBeenCalled();
  });

  it('tells someone whose session expired what would actually help', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    onTestFinished(() => consoleError.mockRestore());
    // A gated POST answers 403 with a plain-text body, which the framework cannot deserialize —
    // and this page is designed to be left open long enough for that to happen.
    answerWith({ type: 'error' });
    onTestFinished(resetAnswer);
    await render(RequestForm, { fields: { kind: 'release-group', mbid: 'mb-1' } });

    await page.getByRole('button', { name: 'Request' }).click();

    await expect.element(page.getByRole('alert')).toHaveTextContent('sign in again');
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
    expect(new FormData(form).get('displayTitle')).toBeNull();
  });
});
