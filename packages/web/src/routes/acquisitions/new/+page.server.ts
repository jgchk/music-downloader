import { fail, redirect } from '@sveltejs/kit';
import { messageOf, statusOf } from '$lib/server/facade-errors.js';
import { submitAcquisitionForm, submitFormValues } from '$lib/server/forms.js';
import type { Actions } from './$types';

/**
 * The submit-acquisition actions (web-ui 6.1): reshape the form, dispatch the downloader facade's
 * submit command, and either say what was created or re-render with the modeled failure's message
 * and the typed values (spec: "Rejected submission renders the modeled error").
 *
 * Two actions, one command. They differ only in what SUCCESS means to the caller, which is the
 * thing a name can carry and a hidden flag cannot:
 *
 * - `submit` lands on the new download. It is the no-JS path and the page's own form, where a
 *   full-page round trip is the only thing that can happen anyway. Named rather than `default`
 *   because SvelteKit forbids a default action alongside named ones — and a page that offers two
 *   meanings of success has to name both.
 * - `request` answers with the download it made. It is what a result's own request form posts to,
 *   because navigating away would throw out the query, its results, and whatever was open — the
 *   whole reason a person can ask for five records from one search.
 */
async function submit(request: Request, locals: App.Locals) {
  const data = await request.formData();
  const result = await locals.facades.downloader.submitAcquisition(
    submitAcquisitionForm(data),
    locals.correlationId,
  );

  return { data, result };
}

const refusal = (data: FormData, error: Parameters<typeof messageOf>[0]) =>
  fail(statusOf(error), { message: messageOf(error), values: submitFormValues(data) });

export const actions: Actions = {
  submit: async ({ request, locals }) => {
    const { data, result } = await submit(request, locals);
    if (!result.ok) return refusal(data, result.error);
    redirect(303, `/acquisitions/${result.value.acquisitionId}`);
  },

  request: async ({ request, locals }) => {
    const { data, result } = await submit(request, locals);
    if (!result.ok) return refusal(data, result.error);

    // The title rides the form so the confirmation can name what was asked for rather than only
    // its identifier — the page already had it on screen, and re-reading it to say it back would
    // be a round trip for a word.
    const title = data.get('title');

    return {
      requested: {
        acquisitionId: result.value.acquisitionId,
        title: typeof title === 'string' && title !== '' ? title : undefined,
      },
    };
  },
};
