import type { DownloadFailureReason } from '../../domain/acquisition/events.js';
import type { DownloadProgress } from '../../application/ports/outbound-ports.js';
import type { SlskdTransfer, SlskdTransfersPayload } from './schemas.js';

/**
 * Pure interpretation of slskd's rich transfer reality into the small, source-agnostic facts the
 * domain sees (D10). slskd's per-file transfer state machine and byte counters are folded into one
 * candidate-level outcome plus an ephemeral progress snapshot; a source-specific failure is mapped
 * to the domain's small reason enum. Payloads arrive already validated against the contract schema
 * (D2), so these functions consume the inferred types directly.
 */

/** A transfer we own: narrowed to a known `filename` (the polls filter foreign/filenameless ones). */
export type OwnedTransfer = SlskdTransfer & { readonly filename: string };

/**
 * slskd's `GET …/downloads/{username}` returns a single user object whose transfers are grouped by
 * directory under `directories`; flatten those groups to a flat file list.
 */
export function flattenDownloads(payload: SlskdTransfersPayload): SlskdTransfer[] {
  // Stryker disable next-line ArrayDeclaration: seeding the fallback with an element cannot be
  // observed. It is consumed only by the flatMap below, which reads `.files` off each element and
  // contributes nothing for one that has none — so a seeded fallback flattens to the same empty
  // list. (The `?? []` on the line below is a different node and stays measured.)
  const groups = payload.directories ?? [];
  return groups.flatMap((directory) => directory.files ?? []);
}

/**
 * slskd's state flags for a transfer, as text. An absent state reads as an empty one: every caller
 * asks the text whether it *contains* one of slskd's words, and a state slskd did not report
 * contains none of them.
 */
function stateOf(transfer: SlskdTransfer): string {
  // Stryker disable next-line StringLiteral: the empty default is only ever substring-matched
  // against slskd's own words ('completed', 'succeeded', 'queued', 'cancel') and concatenated into
  // the failure haystack, which is matched against the FAILURE_VOCABULARY spellings. Stryker's
  // replacement text contains none of them, so every caller reads it exactly as it reads '' — the
  // mutant has no observable difference.
  //
  // That equivalence is CONTINGENT on the fallback staying meaningless, and this single waiver now
  // stands in for five former call sites — all upstream of decisions that matter: the failure
  // classification in `reasonFromTransfer` and the `isTransferComplete`/`isTransferSucceeded`
  // teardown guards. Give the fallback a meaning any caller matches on and the argument lapses for
  // all five at once, silently. Delete this waiver in the same change that does so.
  return transfer.state ?? '';
}

type TransferStatus = 'succeeded' | 'failed' | 'queued' | 'transferring';

function statusOf(state: string): TransferStatus {
  const normalized = state.toLowerCase();
  if (normalized.includes('completed')) {
    return normalized.includes('succeeded') ? 'succeeded' : 'failed';
  }
  if (normalized.includes('queued')) return 'queued';
  // Stryker disable next-line StringLiteral: the none-of-the-above arm. No caller compares against
  // 'transferring' — the three that read a status test it against 'succeeded', 'failed' and
  // 'queued' — so this spelling names the case for a reader and decides nothing.
  return 'transferring';
}

/**
 * Whether a transfer has reached slskd's terminal `Completed` flag — the guard slskd's synchronous
 * record removal is gated on (design D1). A terminal transfer can be removed (`?remove=true`); an
 * in-flight one must first be cancelled and left to transition before its record can be removed.
 */
export function isTransferComplete(transfer: SlskdTransfer): boolean {
  return stateOf(transfer).toLowerCase().includes('completed');
}

/** Whether a transfer completed *successfully* — its file is staged and can be resolved (D2). */
export function isTransferSucceeded(transfer: SlskdTransfer): boolean {
  return statusOf(stateOf(transfer)) === 'succeeded';
}

/**
 * How slskd's words for failure map onto the domain's reasons — the project's single calibration of
 * Soulseek failure vocabulary, in priority order.
 *
 * There is one table because a failure must tell one story regardless of where we happen to observe
 * it. slskd reports the same event two ways: a peer refusing a file surfaces as the enqueue's
 * rejection body *and*, when a row got created first, as that row's `exception`. Those paths used to
 * own separate substring lists, so the identical refusal produced `FileUnavailable` down one path
 * and `TransferError` down the other. Splitting the vocabulary is what let them drift; keeping one
 * table is what stops it.
 *
 * Priority matters. slskd 0.22.5 collapses rejections, timeouts and dead peers alike into
 * `Completed, Errored`, so the state is nearly uninformative and these texts do the real work. The
 * order is defensive rather than resolving a known collision: no recorded witness currently matches
 * two entries, and first-match-wins keeps it that way if a future re-wording makes one ambiguous.
 *
 * Cancellation is deliberately NOT in this table — see {@link reasonFromTransfer}.
 *
 * The spellings are whole recorded *phrases*, not bare words, and that is a security property
 * rather than a stylistic one. Some of these texts embed the peer's own chosen username verbatim
 * ("User <name> appears to be offline"), so the haystack must be treated as third-party input
 * throughout: matching on `reject` or `connect` would let a peer called `rejectbot` decide which
 * failure the user is shown. Phrases raise that bar; callers additionally pass the peer's name so it
 * can be removed from the sentence entirely before matching (see {@link redactPeer}), which is what
 * actually clears it — a peer named `transfer rejected: lol` defeats phrase matching alone.
 *
 * Every spelling carries at least one entry in `witnesses`: the full text, as recorded, that it was
 * calibrated against. The contract tier checks all three parts of that claim — each witness still classifies
 * to its reason, each witness appears verbatim in a fixture recorded from a real slskd of the
 * pinned version, and no spelling is left without a witness that exercises it. That last one is the
 * point: a spelling is data inside a `.some()`, not a branch, so an unwitnessed one is invisible to
 * the coverage gate — exactly how the unreachable `Completed, Rejected` stubs survived one level up.
 * Two spellings that had no recorded backing were dropped rather than kept on faith.
 */
/** Every reason this table can produce — `Cancelled` is ours to assert, never slskd's text's. */
type TextDerivedReason = Exclude<DownloadFailureReason, 'Cancelled'>;

const FAILURE_VOCABULARY: readonly {
  readonly spellings: readonly string[];
  readonly reason: TextDerivedReason;
  // Non-empty by type: an entry with no witness would contribute no rows to FAILURE_WITNESSES, so
  // its spellings would appear in neither side of the contract tier's unexercised-spelling check
  // and the guard would pass green on exactly the case it exists to catch — a brand-new entry.
  readonly witnesses: readonly [string, ...string[]];
}[] = [
  {
    // The peer has the slot but not the file.
    spellings: ['transfer rejected:'],
    reason: 'FileUnavailable',
    witnesses: ['Transfer rejected: File not shared.'],
  },
  {
    // The peer is gone — whether the server said so, or the connection simply failed. A peer that
    // dropped mid-transfer ("Read error: Remote connection closed") lands here too: a source that
    // vanished halfway is a source that is no longer there.
    spellings: [
      'appears to be offline',
      'failed to connect',
      'failed to establish',
      'connection closed',
    ],
    reason: 'PeerUnavailable',
    witnesses: [
      'User peer1 appears to be offline',
      'Failed to connect to user peer1: Failed to establish a direct or indirect message connection to peer1 (<peer-address>)',
      'Transfer failed: Read error: Remote connection closed',
    ],
  },
  {
    // The peer is present but never answered. slskd double-wraps this one; the witness is the
    // whole body as recorded, because a hand-trimmed "inner" message is a guess again.
    spellings: ['timed out'],
    reason: 'Stalled',
    witnesses: [
      'One or more errors occurred. (One or more errors occurred. (The wait timed out after 15000 milliseconds))',
    ],
  },
];

/**
 * The recorded texts this classifier is calibrated against, each paired with the reason it must
 * produce and the spellings it exercises — published so the contract tier can hold them to their
 * fixtures. The table's ordering and its matching stay private; this is the evidence, flattened.
 */
export const FAILURE_WITNESSES: readonly {
  readonly text: string;
  readonly reason: TextDerivedReason;
  readonly spellings: readonly string[];
}[] = FAILURE_VOCABULARY.flatMap(({ witnesses, reason, spellings }) =>
  witnesses.map((text) => ({ text, reason, spellings })),
);

/** The reason slskd's words name, or `undefined` when they name nothing this table knows. */
function recognise(text: string): TextDerivedReason | undefined {
  const haystack = text.toLowerCase();
  return FAILURE_VOCABULARY.find(({ spellings }) =>
    spellings.some((spelling) => haystack.includes(spelling)),
  )?.reason;
}

/** Read slskd's account of a failure as one of the domain's reasons (D10). */
function classify(text: string): TextDerivedReason {
  return recognise(text) ?? 'TransferError';
}

/**
 * Take the peer's chosen name out of a sentence slskd wrote around it, so the only span of the text
 * the peer controls cannot steer the verdict. Case-insensitive, because slskd echoes back whatever
 * casing the peer registered rather than the one we enqueued; and a no-op for an empty name, since
 * `replaceAll('')` would interleave the sentinel between every character and degrade every failure
 * to the catch-all.
 */
function redactPeer(body: string, username: string): string {
  if (username === '') return body;
  const peer = new RegExp(escapeRegExp(username), 'gi');
  // The placeholder has to be non-empty. Deleting the name instead of replacing it would let a peer
  // whose name sits INSIDE a vocabulary spelling splice the two halves back together and choose the
  // verdict — `tiXmed out` with the peer named `X` reads as `timed out`. Pinned by `reads past a
  // peer whose name splices itself into a failure phrase`.
  return body.replaceAll(peer, '<peer>');
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * Translate a Soulseek failure into the domain's source-agnostic reason (D10). The state and the
 * exception are read together because on the pinned slskd the state alone rarely distinguishes
 * anything — the differentiation lives in the exception text.
 *
 * Cancellation is the exception, and is read from the *state* alone. `Cancelled` is the one reason
 * that describes something **this** context did rather than something that happened to us, and
 * slskd's failure texts embed the peer's own chosen username verbatim ("User <name> appears to be
 * offline") — so matching the word in free text would let a peer called `cancelbot` assert that we
 * cancelled a download we did not. The state is slskd's own flags enum, which no peer can author,
 * and `transfer-vocabulary.json` records that `Completed, Cancelled` is the one disposition slskd
 * 0.22.5 keeps distinct. So the structured signal is both safer and sufficient.
 */
export function reasonFromTransfer(
  transfer: SlskdTransfer,
  username: string,
): DownloadFailureReason {
  const state = stateOf(transfer);
  if (state.toLowerCase().includes('cancel')) return 'Cancelled';
  // The exception is peer-adjacent too — slskd wraps other failures as "…from user <name>: …" — so
  // the name comes out here exactly as it does on the enqueue path. This is the path that actually
  // runs on the pinned slskd, so protecting only the other one would protect nothing.
  // Stryker disable next-line StringLiteral: same argument as {@link stateOf} — an absent exception
  // contributes an empty span to the haystack, and Stryker's replacement text matches no spelling
  // in FAILURE_VOCABULARY, so the classification is identical either way.
  const exception = transfer.exception ?? '';
  return classify(redactPeer(`${state} ${exception}`, username));
}

/**
 * Translate an slskd enqueue *rejection* into the candidate-level failure reason (D10). An HTTP
 * rejection from slskd means slskd itself is up and answered — the candidate, not the
 * infrastructure, failed. Transport-level failures (slskd unreachable) never come here — they stay
 * infrastructure faults and are retried.
 *
 * A rejected enqueue often leaves no transfer row at all (slskd resolves the peer before it creates
 * one), so this body is the only account of the failure that will ever exist. It can never report
 * `Cancelled`: an enqueue slskd refused is not something we cancelled.
 *
 * NOTE — on the pinned slskd this function's answer currently reaches no decision for the
 * peer-caused failures it was calibrated against. slskd 0.22.5 answers *every* enqueue failure with
 * HTTP 500 (witnessed for offline, file-not-shared and unresponsive peers alike), and
 * `SlskdDownload.start` routes `>= 500` to a retryable infrastructure fault; it reads the body only
 * to log what it would have said. Correcting that means deciding how to tell "slskd is unwell" from
 * "slskd says this peer is bad" — a separate change; see the contract tier's
 * `answers every enqueue failure with a 500` test, which pins the evidence.
 */
export function recogniseRejection(
  body: string,
  username: string,
): DownloadFailureReason | undefined {
  // For diagnostics only. `TransferError` is both a real classification and the catch-all, so a
  // caller that just wants to know "did slskd's body say anything we understand?" cannot learn it
  // from {@link enqueueRejectionReason} — an unrecognised body and a genuine generic error are the
  // same answer there. Returning the miss distinctly is what lets a log say `unrecognised` and mean
  // it, which is the whole point of the field: an overloaded slskd says nothing we recognise, a
  // dead peer says something we do.
  return recognise(redactPeer(body, username));
}

export function enqueueRejectionReason(body: string, username: string): DownloadFailureReason {
  // Take the peer's name out of the sentence before reading it. slskd frames these messages around
  // the username ("User <name> appears to be offline", "Failed to connect to user <name>: …"), so
  // the name is the one span of attacker-chosen text inside them — and a peer calling itself
  // `transfer rejected: lol` would otherwise pick which failure the user is shown. Phrase matching
  // alone raises that bar; removing the name clears it. The caller passes the username it enqueued
  // against, which is the only name that can legitimately appear here.
  return classify(redactPeer(body, username));
}

export interface TransferAggregate {
  readonly progress: DownloadProgress;
  /** Every transfer succeeded. */
  readonly succeeded: boolean;
  /** Every transfer is still queued (nothing has started). */
  readonly allQueued: boolean;
  /** At least one transfer has failed terminally (dooms the candidate before the rest settle). */
  readonly hasFailure: boolean;
  /** The reason to report if the candidate is failing (the first failed transfer's reason). */
  readonly failureReason: DownloadFailureReason;
}

/** Fold a candidate's per-file transfers into one outcome-shaped aggregate. */
export function aggregate(
  transfers: readonly SlskdTransfer[],
  username: string,
): TransferAggregate {
  const statuses = transfers.map((transfer) => statusOf(stateOf(transfer)));
  const bytesTransferred = transfers.reduce((sum, t) => sum + (t.bytesTransferred ?? 0), 0);
  const bytesTotal = transfers.reduce((sum, t) => sum + (t.size ?? 0), 0);
  const queuePosition = transfers
    .map((transfer) => transfer.placeInQueue)
    .find((place) => place !== undefined);
  const failed = transfers.find((transfer) => statusOf(stateOf(transfer)) === 'failed');

  return {
    progress: {
      percent: bytesTotal === 0 ? 0 : (bytesTransferred / bytesTotal) * 100,
      bytesTransferred,
      bytesTotal,
      queuePosition,
    },
    succeeded: statuses.length > 0 && statuses.every((s) => s === 'succeeded'),
    allQueued: statuses.length > 0 && statuses.every((s) => s === 'queued'),
    hasFailure: failed !== undefined,
    failureReason: failed === undefined ? 'TransferError' : reasonFromTransfer(failed, username),
  };
}

export { type SlskdTransfer } from './schemas.js';
