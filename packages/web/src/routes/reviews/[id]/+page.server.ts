import { error, fail, redirect } from '@sveltejs/kit';
import { isDestructive, type ResolutionVerb } from '$lib/resolution-actions.js';
import { reviewTitle } from '$lib/reviews.js';
import { messageOf, statusOf } from '$lib/server/facade-errors.js';
import { resolveReviewForm } from '$lib/server/forms.js';
import { acquisitionTitleFor } from '$lib/server/review-titles.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The review detail + resolution action (web-ui 6.4, at parity with the retired MCP tool). The
 * load finds the pending review by import id — titled by its musical intent (design D3) — and an
 * import with no open review 404s to the queue's reality. The action dispatches the facade's
 * resolve command; a stale resolution surfaces the modeled conflict error on re-render (spec:
 * "Stale resolution is a modeled error").
 *
 * The two file-deleting verbs commit only through the in-page confirmation (design D5): an
 * unconfirmed destructive submit dispatches nothing — it re-renders the page with the pending
 * confirmation, whose outcome-named choices either re-post with the `confirmed` marker or return
 * to the review unchanged.
 */
export const load: PageServerLoad = ({ locals, params }) => {
  const pending = locals.facades.importer
    .listPendingReviews()
    .reviews.find((review) => review.importId === params.id);
  if (pending === undefined) {
    error(404, 'No open review for this import — it may have been settled already.');
  }
  return {
    pending,
    title: reviewTitle(pending.path, acquisitionTitleFor(locals.facades, params.id)),
  };
};

function text(data: FormData, name: string): string | undefined {
  const value = data.get(name);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

type DestructiveVerb = ResolutionVerb & ('reject' | 'reject-unusable-delivery');

function destructiveVerbOf(data: FormData): DestructiveVerb | undefined {
  const verb = text(data, 'verb');
  return (verb === 'reject' || verb === 'reject-unusable-delivery') && isDestructive(verb)
    ? verb
    : undefined;
}

export const actions: Actions = {
  resolve: async ({ request, locals, params }) => {
    const data = await request.formData();
    const destructive = destructiveVerbOf(data);
    if (destructive !== undefined && text(data, 'confirmed') === undefined) {
      return {
        confirm: {
          verb: destructive,
          reason: text(data, 'reason'),
          reasons: text(data, 'reasons'),
        },
      };
    }
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
