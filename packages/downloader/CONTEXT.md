# Downloader Context

Given a download request and a quality policy, finds, downloads, validates, deposits, and (on failure) retries the best-matching, highest-quality copy of a release across pluggable sources — one autonomous download per request, from acceptance to a terminal outcome.

## Language

Three altitudes, three words, and the code obeys them: a **download** is the whole saga, a **try** is one attempt at one candidate, and a **transfer** is one file moving from a peer. Verb forms stay verbs — a download is _downloading_, files are _downloaded_ — because only the noun is reserved.

### Intent & targeting

**Download**:
One autonomous saga to obtain one piece of music — from accepted request, through as many tries as it takes, to the music in the library or a terminal failure. The sole aggregate of this context; its id is the key the importer joins on. The noun "download" always means the whole saga — never one file transfer, never one try.
_Avoid_: acquisition (the retired name; it survives only where it spells a frozen wire or storage artifact — `acquisition.fulfilled`, `acquisitionId`, the `/acquisitions` routes, and the stored event tokens), download job, request (a request _starts_ a download)

**Download request**:
The caller's ask, in one of three kinds: a MusicBrainz release/recording id, a release-group id, or a descriptor (artist/title, optional album) to resolve. Retained forever so an unresolved download is still describable.
_Avoid_: acquisition request (the retired name), musical intent, query, search term

**Target**:
The normalized, source-agnostic description of exactly what is to be acquired: artist, title, track list with per-track durations, optional year and MusicBrainz id. The output of metadata resolution and the yardstick for all matching and validation.
_Avoid_: release, album (a target may be a single track)

**Release group**:
A MusicBrainz album _identity_ — the album as a work, distinct from any concrete release of it. Descriptor ambiguity is judged at this level.
_Avoid_: album (when the group/release distinction matters)

**Edition**:
One concrete MusicBrainz release within a release group (standard, deluxe, remaster…). Resolution selects one representative edition.
_Avoid_: version ("next best version" in older spec prose means the next _candidate_ — retire that phrase entirely)

**Edition option**:
One edition offered to a human in a manual-selection menu; deliberately lightweight and not a target.
_Avoid_: bare "candidate" (collides with the search candidate), candidate edition

**Manual edition selection**:
The modeled human pause: a release-group request with editions but no official one neither guesses nor fails — it waits, retaining the menu, until a selection or a cancellation.
_Avoid_: manual review, match review (the importer's concept)

**Metadata resolution**:
Turning a download request into a target via a metadata source, before any search. Outcomes: resolved, unresolved, needs-selection.

**Metadata source**:
The provider of canonical identity (MusicBrainz first). Never bare "source" — that word belongs to the music source.

**Modal track count**:
For a release-group request, the most common track count among the group's official editions — the criterion that keeps a deluxe edition from winning.

### Candidates & search

**Candidate**:
One peer's copy of the target on the music source, grouped to the target's granularity (a folder for an album, a file for a track). Its advertised attributes are untrusted. In speech: "a copy", "the next candidate".
_Avoid_: result, hit, version, "source" (UI's "trying the next source" means candidate). The beets proposal on the importer side is a _metadata match_, never a candidate.

**Candidate identity**:
A candidate's stable cross-round identity: (username, path, size). Drives dedup and the rejected set.

**Music source**:
The shared peer network the system searches and downloads from (slskd/Soulseek first). Shared with human operators — hence the ownership ledger.
_Avoid_: slskd, Soulseek (in domain prose); "source" unqualified

**Peer**:
The individual person on the music source sharing a candidate's files ("the soulseek peer").
_Avoid_: user (collides with you, the operator — "the user rejected the download" must never be ambiguous), source

**Search round**:
One numbered pass of searching the source for a target, bounded by the retry policy's round budget.
_Avoid_: retry (overloaded), search attempt

**Harvest**:
Collecting a search's responses, permitted only once the source itself confirms the search complete. An unconfirmable harvest is a retryable fault, never an empty candidate set.

**Working set**:
The untried, ranked candidates currently in hand. Re-search fires only once it empties, so an incoming round is always the whole picture.
_Avoid_: queue, pool, candidate list

**Rejected set**:
The candidate identities already rejected for this download; never re-admitted, in this or any later round.

### Matching, ranking & quality

**Match confidence**:
A score in [0, 1], higher is better, of how likely a candidate is the target — judged from structure and names, never from embedded tags. A gate and a ranking tiebreak; never the authority (validation is). Distinct from the importer's distance, which measures tag agreement, not identity.
_Avoid_: match score, distance (the importer's inverted, lower-is-better metric)

**Match signal**:
One named, weighted contributor to match confidence (track count, duration, title, artist, year). Structural signals deliberately outweigh gameable name text.

**Alignment score**:
The fraction of expected track durations that line up, order-insensitively within tolerance, with actual ones. Shared by search-time matching and post-download validation.

**Gate**:
The pass/fail filter before ranking: a candidate must meet the match threshold and clear the quality floor. Sub-floor candidates are excluded, not penalized. "Match is a gate, quality is the optimization."

**Ranking**:
The lexicographic order of surviving candidates: quality bucket (per the policy's order), then match confidence, then source reliability, then identity for determinism.

**Quality bucket**:
An ordered tier resolved from probed (or advertised) audio attributes: lossless-hires, lossless, lossy-high, lossy-standard, lossy-low, unknown. A release's bucket is its _worst_ file's.
_Avoid_: bitrate, format, quality score (quality is bucketed, deliberately not continuous)

**Quality floor**:
The lowest acceptable bucket in a quality policy; below it a candidate is excluded outright.

### Policies

**Download policies**:
The per-download bundle carried from the first event: quality, match, retry, and download policies. Unspecified ones fall back to configured defaults at submission.
_Avoid_: acquisition policies (the retired name)

**Match policy**:
A single threshold used for both the search-time ranking gate and the post-download validation pass/fail.

**Retry policy**:
The ladder's termination bounds: max search rounds, max total tries, optional time budget. What guarantees the ladder terminates.
_Avoid_: conflating with the application-layer parked-effect backoff policy (an unrelated mechanism that shares the name in code)

**Try policy**:
A try's patience budget: the stall timeout and the max queue wait. Exceeding either abandons the try as failed.
_Avoid_: download policy (the saga owns that noun, and this bounds one try)

### Lifecycle & the ladder

**Retry ladder**:
The whole bounded loop: select next-best → download → validate → deposit, with rejection falling through to the next candidate, re-search on an empty working set, and exhaustion when budgets are spent.
_Avoid_: retry loop, the walk, next best version

**Try**:
One attempt to download one candidate, counted against the retry policy's total-try budget; it settles as completed-with-files or failed with one source-agnostic reason (peer unavailable, stalled, queue timeout, transfer error, file unavailable, cancelled). In speech: "it tried downloading from this peer and moved on."
_Avoid_: download (the saga owns that noun), attempt (the code word; also collides with a parked effect's retry attempt)

**Phase**:
Where the download stands: Empty, Pending, AwaitingManualSelection, Searching, Selecting, Downloading, Validating, Importing, Fulfilled, Exhausted, Cancelled, MetadataFailed, Conflicted. (`Importing`/`Imported` are legacy misnomers for the deposit step.)
_Avoid_: status (the wire-field name only)

**Terminal**:
A phase from which no further searches, tries, or deposits happen: Fulfilled, Exhausted, Cancelled, MetadataFailed, Conflicted.

**Absorbing**:
Terminal and irreversible — every terminal phase except Fulfilled. Nothing revives them.

**Stable-but-defeasible**:
The precise standing of Fulfilled: the download's resting state, yet revivable by exactly one thing — an external verdict naming its retained candidate.

**Fulfilment**:
A candidate passed validation and was deposited; the download records the deposited location and publishes the fulfilled fact.

**Deposit**:
This context's own move of validated staged files to their organized deposited location (the `Importing`/`Imported` steps). This is a hand-off, not a library placement: the deposit area is the importer's intake source, and only beets — via the importer — puts files in the actual library. Prefer "deposit" in any prose that could be read across contexts — "import" belongs to the importer.
_Avoid_: import (cross-context prose), hand-off, library placement

**Deposited location**:
The absolute directory the fulfilled release was deposited at — the namespace the importer's intake reads. (Configured as `DEPOSIT_ROOT`; the former `LIBRARY_ROOT` is still honoured with a deprecation warning. The real library is wherever beets moves the files.)
_Avoid_: library location (the actual library is beets'), destination, deposit path

**Import conflict**:
The deposited location the target would occupy is already taken: the download ends Conflicted, staged files are discarded, the occupied location is untouched.

**Revival**:
The one edge out of Fulfilled: an external verdict rejects the fulfilled candidate and re-enters the retry ladder, spending the same budgets — the same download, trying another copy. The full cross-context round trip is the revival loop.
_Avoid_: un-fulfil, reopen, re-download (it is not a second download)

**External verdict**:
A judgement made outside this context (the importer's release verdict) that a delivered candidate is unacceptable. Distinct from the internal validation verdict, which judges an in-flight candidate.

**Exhaustion**:
The terminal outcome when the ladder's budgets are spent — no search rounds remain or the try budget is consumed. An empty round spends its round and re-searches rather than exhausting.

**Stale outcome**:
An external report (a try's settlement, an external verdict) naming a candidate the ladder has already moved past. Absorbed as a no-op — never mis-attached, never an error.
_Avoid_: error (errors are reserved for illegal commands)

### Download & transfer

**Transfer**:
One per-file movement at the music source. A try's transfers aggregate into exactly one candidate-level outcome.
_Avoid_: download (the saga's noun — a transfer is one file of one try)

**Doomed candidate**:
One whose transfer has terminally failed; remaining transfers are cancelled and the candidate settles with the original failure's reason.

**Transfer supervisor**:
The storeless, level-triggered watch over an in-flight try: samples the source, judges the stall and queue-wait budgets, and delivers one candidate-level outcome without blocking other downloads.
_Avoid_: poller, watcher thread

**Staging area**:
Where the music source writes downloads before they may be deposited. The staged location is the source's own report, never recomputed.
_Avoid_: intake (the importer's word for its own, different directory)

**Staging cleanup**:
Removing staged files that will never be deposited, and pruning the emptied staging directory after a deposit.
_Avoid_: delete, purge

**Ownership ledger**:
The durable record of every remote resource this system created on the shared music source (searches, transfers), keyed to the owning download — so ownership is explicit, not inferred by name-matching, and the source stays safe for manual use.

**Startup sweep**:
At boot: remove source resources whose owning download is terminal, per-row fault isolation.

### Validation

**Validation**:
Post-download inspection of the actual bytes against the target — the authoritative confirmation, where search-time matching was the guess. It judges the unfixable axes only: playability (every file decodes fully) and structural identity (track count and decoded durations vs the target). Tags are deliberately ignored — description defects are fixable, and fixing them is the importer's job; a copy that fails here is unfixable and the only remedy is the next candidate.

**Validation verdict**:
The single combined judgement: a confidence plus reasons. Combination is weakest-link — confidence is the minimum validator score, and an empty pipeline vouches for nothing.
_Avoid_: verdict unqualified (the external verdict is a different thing)

**Passing verdict**:
A validation verdict whose confidence meets the download's match-policy threshold.

### Operational

**Stalled (download)**:
A download whose current effect dead-lettered — retry budget spent with no modeled failure to degrade to — awaiting an operator.
_Avoid_: conflating with the `Stalled` failure reason on a try (a transfer that made no progress); the two are unrelated

**Modeled landing**:
When an effect's retry budget is spent, an effect with a modeled business outcome degrades to it through the normal command path; one without is dead-lettered and the download exposed as stalled.
_Avoid_: silent drop, swallow

**Decided lifecycle flag**:
A lifecycle fact the download itself decides and publishes (cancellable, awaiting-selection, transfer-started) so consumers render rather than re-derive it from the phase name.

**Curated milestone**:
One entry of the download's deliberately curated history narrative. Curation is a rule: routine internals (ranking, validation passes, settlements) never surface.
_Avoid_: event log, audit trail
