import type { DownloaderFacadeError } from '@music/downloader';
import type { ImporterFacadeError } from '@music/importer';

/**
 * The BFF's one mapping from facade error values to what a user sees: an actionable message and
 * an HTTP status for the form-action response. Mirrors the retired HTTP layer's status semantics
 * (validation → 400, absence → 404, conflict-shaped kinds → 409, infrastructure → 500) so error
 * behavior survives the transport change.
 */

type FacadeError = DownloaderFacadeError | ImporterFacadeError;

export function statusOf(error: FacadeError): 400 | 404 | 409 | 500 {
  switch (error.kind) {
    case 'ValidationFailed':
    case 'InvalidPolicy':
    case 'InvalidResolution':
    case 'UnknownCandidate':
    case 'UnknownEdition': {
      return 400;
    }
    case 'NotFound':
    case 'UnknownImport': {
      return 404;
    }
    case 'AlreadyExists':
    case 'IllegalTransition':
    case 'NoOpenReview':
    case 'NoRetainedCandidate':
    case 'ConcurrencyConflict': {
      return 409;
    }
    case 'InfraError': {
      return 500;
    }
  }
}

export function messageOf(error: FacadeError): string {
  switch (error.kind) {
    case 'ValidationFailed': {
      return `Invalid input: ${error.message}`;
    }
    case 'InvalidPolicy': {
      return 'The requested policy is invalid.';
    }
    case 'NotFound': {
      return 'No such acquisition.';
    }
    case 'AlreadyExists': {
      return 'That acquisition already exists.';
    }
    case 'IllegalTransition': {
      return `That action is not available while the acquisition is ${error.phase}.`;
    }
    case 'UnknownImport': {
      return 'No such import.';
    }
    case 'NoOpenReview': {
      return 'This review has already been settled.';
    }
    case 'InvalidResolution': {
      return `Invalid resolution: ${error.detail}`;
    }
    case 'UnknownCandidate': {
      return `Unknown candidate: ${error.candidate}.`;
    }
    case 'UnknownEdition': {
      return `Unknown edition: ${error.releaseMbid}. It is not among the offered candidates — reload and choose from the list.`;
    }
    case 'NoRetainedCandidate': {
      // One-voice register: no module nouns in user-visible copy; the refusal is deterministic
      // (no retained candidate ⇒ the verb is refused), so it is stated plainly, not hedged.
      return 'These files didn\u{2019}t come from a tracked download, so rejecting them can\u{2019}t resume a search for a replacement. A plain reject is still available.';
    }
    case 'ConcurrencyConflict': {
      return 'The record changed while you were working - reload and try again.';
    }
    case 'InfraError': {
      return `Something went wrong (${error.operation}). Try again.`;
    }
  }
}
