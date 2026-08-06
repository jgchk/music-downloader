import type { Role, SessionClaims } from './session.js';

/**
 * The permission question, answered in ONE place (web-authorization). This is the PEP/PDP split:
 * call sites are enforcement points that name an *action* and obey the answer; this module is the
 * decision point that knows how the answer is reached. The mechanism behind it is RBAC today — a
 * table from action to the role it requires — and can become attribute- or policy-based later
 * without a single call site changing, because no caller ever learns that roles exist.
 *
 * Like the session codec, this is deliberately NOT a port: a pure decision has no external actor
 * behind it, so there is nothing to fake and tests exercise the real path with minted claims.
 */

/**
 * Every action privilege can be asked about — closed and compile-checked, the same discipline as
 * the web verb inventory: a new privileged action must be added here, which forces it into the
 * decision table below.
 *
 * `system:redrive` is the reserved first member (the operator verb the stall-surfacing change
 * adds); no route references it yet.
 */
export type PrivilegedAction = 'system:redrive';

/**
 * The decision table: the minimum role each action requires. Exhaustive by construction — `Record`
 * over the closed union means an unmapped action does not compile, so no action can be silently
 * permitted by falling off the end of a lookup.
 */
const REQUIRED_ROLE: Record<PrivilegedAction, Role> = {
  'system:redrive': 'owner',
};

/**
 * Roles as a ladder, so the table reads as a MINIMUM rather than an exact match: an owner must
 * satisfy anything a guest satisfies. (Equality would quietly refuse an owner the day an action
 * is gated at the guest rung.)
 */
const RANK: Record<Role, number> = { guest: 0, owner: 1 };

/** The answer is a value (errors-as-values): a refusal is an outcome to render, never a throw. */
export type AuthorizationDecision = { readonly kind: 'permitted' } | { readonly kind: 'refused' };

/**
 * May this session perform this action? Total and deterministic: the decision depends on the
 * presenting claims and the action name alone — no ambient state, no clock, no upstream call.
 */
export function authorize(session: SessionClaims, action: PrivilegedAction): AuthorizationDecision {
  return RANK[session.role] >= RANK[REQUIRED_ROLE[action]]
    ? { kind: 'permitted' }
    : { kind: 'refused' };
}
