# Importer Context

Proposes beets-powered metadata matches for each delivered directory of audio files, auto-applies confident matches into the library, and queues uncertain ones for human review. Beets' own library database — not this context's event stream — is the system of record for library state.

## Language

### The Import

**Import**:
The process that takes one submitted directory of audio files and drives it through beets to either land in the library or be rejected. The sole aggregate of this context.
_Avoid_: import job, import run, import task. (The downloader's `Importing`/`Imported` phases and the `library-import` capability are that context's staging→library move — a different concept.)

**Submitted directory**:
The directory of audio files an import is keyed by; the unit of work.
_Avoid_: intake directory, deposited directory, folder, "the release's files"

**Import cycle**:
One unit of work within an import's stream, opened by a request. A stream can hold several cycles: a replacement delivery for a previously rejected import reopens the same stream.
_Avoid_: attempt, run (the downloader's retry-ladder attempt is unrelated)

**Import hints**:
Optional pinning information supplied at submission (release id, artist, album). Hints pin the metadata search, never the verdict — a hinted match with a failing distance still routes to review.
_Avoid_: search hints, pinning hints, auxiliary hints, pins

**Auto-apply threshold**:
The distance at or below which a best match is applied with no human involvement.
_Avoid_: confidence threshold, match threshold (the downloader's threshold is a higher-is-better confidence floor — opposite polarity)

### Intake seam & provenance

**Delivery**:
One fulfilled-download fact arriving over the intake seam, translated into a native submission. A _new_ delivery has a feed position past the stream's seam watermark; at or below it is a _redelivery_.
_Avoid_: hand-off, seam event

**Feed position**:
A delivery's position in the intake feed, recorded on each seam-driven cycle.

**Seam watermark**:
The highest feed position any cycle of a stream ever recorded — the stream's convergence high-water mark. A manual resubmission (which carries no position) can never lower it.
_Avoid_: convergence watermark, stream watermark

**Originating download id**:
The downloader's identifier for the download that deposited the directory (wire name `acquisitionId`). A foreign id: recorded for convergence and echoed back on verdicts, never minted here.
_Avoid_: acquisition id (the wire/code name)

**Delivered copy**:
The identity of the downloaded copy as it arrived from the downloader (peer, path, size). Retained as opaque provenance so a later release verdict can name exactly which copy was judged; never interpreted here.
_Avoid_: delivered candidate, retained candidate (code names — and a metadata match is never a "candidate" here)

**Intake root**:
This context's own filesystem root that delivered locations are re-rooted onto. (The sender-side prefix they must arrive under is the _source root_.)
_Avoid_: staging (the downloader's word for its pre-library area), drop directory

### Matching & metadata matches

**Proposal**:
The result of running beets' matcher over the submitted directory: the metadata-match list plus any library incumbents, or a permanent refusal.
_Avoid_: matching, match run

**Re-propose**:
A second proposal over the same directory, triggered from review by supplying an id or refreshing candidates.
_Avoid_: refresh, re-search, search again

**Metadata match**:
One album match beets offers for the directory: its identity, headline artist/album, distance with per-penalty breakdown, per-track mapping, and field-level diff evidence. In speech: "pick a metadata match."
_Avoid_: proposed candidate, candidate (the code's names — and in the downloader "candidate" means a peer's copy of the files), release option

**Match reference**:
A metadata match's stable identity: the (metadata source, album id) pair. A bare MusicBrainz id is ambiguous because metadata sources are pluggable.
_Avoid_: candidate reference, candidate id (code names; the downloader's `CandidateIdentity` names a peer's copy)

**Distance**:
Beets' match quality for a metadata match: a scalar in [0, 1] where 0 is a perfect match — lower is better. Request-blind: it scores tag agreement with a canonical album, not conformance to what anyone requested (hints pin the search, never the verdict) — which is why it is not the downloader's match confidence at a later stage.
_Avoid_: match confidence, score (the downloader's higher-is-better vocabulary); match percent, Strong/Good/Weak match (presentation-only inversions)

**Penalty**:
One named component of a match's distance breakdown (e.g. tracks, missing tracks, year) with its amount.
_Avoid_: penalty detail, mismatch detail

**Track mapping**:
One entry of the file-to-track mapping beets computed for a match: the proposed title/index, the file's current tags, and that pair's own distance.
_Avoid_: per-track diff, retag diff

**Unmatched file**:
A downloaded file the match placed against no track.
_Avoid_: extra item (bridge wire name), unmatched track (the beets penalty name — it counts files, not tracks)

**Missing track**:
A track of the match that no downloaded file supplied.
_Avoid_: extra track (bridge wire name)

**Best match**:
The lowest-distance metadata match, re-derived by the domain rather than trusted from beets' ordering.
_Avoid_: best candidate, winning candidate (code/spec names)

**Pinned release id**:
The release id in play for a proposal: freshly supplied, folded from a prior supply-id, or from the original submission hint. Any identifier a loaded beets source can resolve — not MusicBrainz alone.
_Avoid_: hinted release id, mbReleaseId (field-name legacy)

**Incumbent**:
An album already in the library that a match would duplicate.
_Avoid_: the duplicate, existing release, duplicate album

### Review

**Open review**:
An import awaiting human action, carrying its review kind, kind-specific context, and its available actions.
_Avoid_: pending review, attention item (the web layer's cross-context queue word)

**Review kind**:
Why the import waits. Exactly four: `match-review` (matches exist but the best is too distant, or contradicts a pin), `no-match` (zero matches — deliberately distinct from a weak match), `duplicate-review` (the album already exists in the library), `remediation-review` (a post-move enrichment step failed after files moved).
_Avoid_: the UI chip labels ("Choose a match", "No match found", "Already in the library", "Fix after import") — asks, not kind names

**Resolution**:
The explicit verb a review is resolved through: apply-candidate, supply-id, refresh-candidates, manual-tags, import-as-is, reject, reject-unusable-delivery, accept, or retry-enrichment.
_Avoid_: action, resolution verb

**Available actions**:
The importer's own authoritative, curated set of resolution verbs legal for a given open review. Deliberately narrower than what the state machine would accept; never wider.
_Avoid_: permitted verbs, legal verbs, allowed actions

**Reject**:
"Wrong thing to have." Terminal rejection that deletes the release's files from intake and publishes nothing.

**Reject-unusable-delivery**:
"Right thing, bad copy." Everything reject does, plus a release verdict naming the originating download, the delivered copy, and the reviewer's reasons. Refused when no delivered copy is retained.
_Avoid_: reject-and-retry-download (the legacy stored token, upcast on replay — never use in prose)

**Manual tags**:
A full manual tag payload with an explicit track mapping, applied by beets with autotagging bypassed but plugins still firing.

**Duplicate resolution**:
How a duplicate is settled: replace the incumbent, or keep both.

**Remediation**:
The open item riding on an _applied_ import after a post-move enrichment step failed. Resolves only through accept (close, library untouched) or retry-enrichment (re-run beets in place). There is deliberately no `failed` phase — a partial apply lands applied-with-remediation.
_Avoid_: post-move failure, enrichment failure (those name the cause, not the item)

### Apply & terminality

**Beets bridge**:
The stateless two-verb CLI (propose, apply) that is the only way this context drives beets.
_Avoid_: the beets CLI, beet import

**Apply mode**:
How beets is asked to perform an apply: by match reference, as-is, or with manual tags.

**Location**:
The library path beets reports after a successful apply — where the files now live. (The intake seam also uses "location" for the _incoming_ delivered path; qualify which when ambiguous.)

**Doomed**:
A permanent, non-retryable refusal from the bridge that terminates the import as rejected with files untouched. Contrast with a retryable infrastructure fault.
_Avoid_: permanent failure, failed (not a phase in this context)

**Settled**:
Whether the import has reached a terminal phase (applied or rejected), decided by the domain so no consumer pattern-matches the phase enum.
_Avoid_: terminal (in exported prose). Note: internally a _review_ can also be "settled" (rejection recorded, deletion still owed) while the import is not — qualify which sense.

**Stalled**:
An import whose current effect exhausted its retry budget and now awaits an operator. Cleared once the stream drives successfully again.
_Avoid_: dead-lettered (the mechanism), parked (a pre-stall state where the retry tally is held), wedged

**Retry budget**:
The durable attempt tally bounding retries of a failing import effect; survives restarts so a resume continues the count rather than resetting it.

### Outbound

**Release verdict**:
The record-only fact published when a delivered copy is rejected as unusable: the originating download's id, the delivered copy's identity, the verdict, and the reviewer's reasons. Drives no effect and no state inside this context.
_Avoid_: adjudication, rejection notice, external validation verdict (the downloader's consumer-side name)

**Reasons**:
The reviewer's free-text rejection reasons, echoed on the release verdict verbatim as opaque provenance.
