import type { Candidate, CandidateRef } from '../candidate/candidate.js';
import type { AcquisitionPolicies } from '../policy/policies.js';
import type { Target } from '../target/target.js';
import type { ValidationVerdict } from '../validation/verdict.js';
import type { AcquisitionRequest, DownloadFailureReason, DownloadedFile } from './events.js';

/**
 * Commands drive `decide`. External effect *results* re-enter as `Record*` commands so `decide`
 * acts as the single guard for stale/duplicate outcomes (D2/D3).
 */
export type AcquisitionCommand =
  | {
      readonly type: 'SubmitAcquisition';
      readonly request: AcquisitionRequest;
      readonly policies: AcquisitionPolicies;
    }
  | { readonly type: 'RecordTarget'; readonly target: Target }
  | { readonly type: 'RecordMetadataFailed' }
  | { readonly type: 'RecordSearchResults'; readonly candidates: readonly Candidate[] }
  | { readonly type: 'RecordDownloadCompleted'; readonly files: readonly DownloadedFile[] }
  | {
      readonly type: 'RecordDownloadFailed';
      readonly reason: DownloadFailureReason;
      // The already-completed staged files of the abandoned/aborted candidate, reported by the
      // adapter so `decide` can stamp them onto the rejection for cleanup (design D2). Optional:
      // a download that failed before staging (or with an unresolvable subset) carries none.
      readonly files?: readonly DownloadedFile[];
    }
  | { readonly type: 'RecordValidationPassed'; readonly verdict: ValidationVerdict }
  | { readonly type: 'RecordValidationFailed'; readonly verdict: ValidationVerdict }
  | { readonly type: 'RecordImported'; readonly location: string }
  | { readonly type: 'RecordImportConflict'; readonly location: string }
  | {
      // Validation that ran outside the system judged a delivered candidate unacceptable
      // (fulfillment-external-verdict D1). On a Fulfilled acquisition whose retained candidate the
      // reference names, `decide` revives the retry ladder; anywhere else — stale, mismatched,
      // legacy, or redelivered — it converges to a no-op, never an error.
      readonly type: 'RecordExternalValidationFailed';
      readonly candidate: CandidateRef;
      readonly reasons: readonly string[];
    }
  | { readonly type: 'CancelAcquisition' };

export type AcquisitionCommandType = AcquisitionCommand['type'];
