import { error, fail, redirect } from '@sveltejs/kit';
import {
  KNOWN_VERBS,
  isDestructive,
  type ConfirmState,
  type DestructiveVerb,
  type ResolutionVerb,
} from '$lib/resolution-actions.js';
import { reviewTitle } from '$lib/reviews.js';
import { messageOf, statusOf } from '$lib/server/facade-errors.js';
import { resolveReviewForm, text } from '$lib/server/forms.js';
import { acquisitionTitleFor } from '$lib/server/review-titles.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The review detail + resolution action (web-ui 6.4, at parity with the retired MCP tool). The
 * load finds the pending review by import id — titled by its musical intent
 * (reviews-register-alignment D3) — and an import with no open review 404s to the queue's
 * reality. The action dispatches the facade's resolve command; a stale resolution surfaces the
 * modeled conflict error on re-render (spec: "Stale resolution is a modeled error").
 *
 * The file-deleting verbs — discovered from the verb inventory's own destructive flags, never a
 * hand-kept list — commit only through the in-page confirmation (reviews-register-alignment D5):
 * an unconfirmed destructive submit dispatches nothing — it re-renders the page with the pending
 * confirmation, whose outcome-named choices either re-post with the `confirmed` marker or return
 * to the review unchanged. The `confirmed` marker is deliberate UX, not enforcement: any client
 * that hand-crafts the field skips the step, which is inherent to the stateless no-JS pattern.
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
    title: reviewTitle(pending.path, acquisitionTitleFor(locals.facades, params.id, locals.logger)),
  };
};

/**
 * The destructive gate reads the SAME trimmed field reading `resolveReviewForm` dispatches on
 * (shared `text`), so the two cannot parse one POST apart — a padded " reject " must confirm,
 * not slip through and dispatch.
 */
function destructiveVerbOf(data: FormData): DestructiveVerb | undefined {
  const verb = text(data, 'verb');
  if (verb === undefined || !KNOWN_VERBS.has(verb)) return undefined;
  const known = verb as ResolutionVerb;
  return isDestructive(known) ? known : undefined;
}

/** Per-verb echo of the user's typed input into the pending confirmation (discriminated). */
function confirmStateOf(verb: DestructiveVerb, data: FormData): ConfirmState {
  switch (verb) {
    case 'reject': {
      return { verb, reason: text(data, 'reason') };
    }
    case 'reject-unusable-delivery': {
      return { verb, reasons: text(data, 'reasons') };
    }
  }
}

export const actions: Actions = {
  resolve: async ({ request, locals, params }) => {
    const data = await request.formData();
    const destructive = destructiveVerbOf(data);
    if (destructive !== undefined && text(data, 'confirmed') === undefined) {
      return { confirm: confirmStateOf(destructive, data) };
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
