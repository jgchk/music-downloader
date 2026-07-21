import { fail, redirect } from '@sveltejs/kit';
import { messageOf, statusOf } from '$lib/server/facade-errors.js';
import { submitAcquisitionForm, submitFormValues } from '$lib/server/forms.js';
import type { Actions } from './$types';

/**
 * The submit-acquisition action (web-ui 6.1): reshape the form, dispatch the downloader facade's
 * submit command, and either land on the new acquisition or re-render the form with the modeled
 * failure's message and the typed values (spec: "Rejected submission renders the modeled error").
 */
export const actions: Actions = {
  default: async ({ request, locals }) => {
    const data = await request.formData();
    const result = await locals.facades.downloader.submitAcquisition(submitAcquisitionForm(data));
    if (!result.ok) {
      return fail(statusOf(result.error), {
        message: messageOf(result.error),
        values: submitFormValues(data),
      });
    }
    redirect(303, `/acquisitions/${result.value.acquisitionId}`);
  },
};
