import { error, fail, redirect } from '@sveltejs/kit';
import { messageOf, statusOf } from '$lib/server/facade-errors.js';
import { resolveReviewForm } from '$lib/server/forms.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The review detail + resolution action (web-ui 6.4, at parity with the retired MCP tool). The
 * load finds the pending review by import id; an import with no open review 404s to the queue's
 * reality. The action dispatches the facade's resolve command; a stale resolution surfaces the
 * modeled conflict error on re-render (spec: "Stale resolution is a modeled error").
 */
export const load: PageServerLoad = ({ locals, params }) => {
  const pending = locals.facades.importer
    .listPendingReviews()
    .reviews.find((review) => review.importId === params.id);
  if (pending === undefined) {
    error(404, 'No open review for this import — it may have been settled already.');
  }
  return { pending };
};

export const actions: Actions = {
  resolve: async ({ request, locals, params }) => {
    const data = await request.formData();
    const result = await locals.facades.importer.resolveReview({
      id: params.id,
      resolution: resolveReviewForm(data),
    });
    if (!result.ok) {
      return fail(statusOf(result.error), { message: messageOf(result.error) });
    }
    redirect(303, '/reviews');
  },
};
