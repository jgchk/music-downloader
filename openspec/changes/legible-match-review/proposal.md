## Why

The match-review page speaks beets' internal scoring vocabulary and nothing else. A real review reads:

> Match review · 1 candidate — best 16.5% away (hint contradicted)
> Penalties: album_id 9.8% · tracks 4.8% · data_source 2.0%

Every number names the *category* of a mismatch and its weighted contribution to the distance, but never the two values being compared. `album_id 9.8%` — different from _what_? `tracks 4.8%` — _which_ tracks, changed _how_? The user cannot tell what actually differs between what they intended to download and what beets found, so they cannot choose intelligently between the resolution verbs the system already offers (pick a listed candidate, supply an ID, manual tags, import as-is, reject).

The evidence to answer "what's actually different?" already exists and is thrown away. beets' `AlbumMatch` carries the file-to-track mapping (each staged file with its **current** embedded tags), the unmatched downloaded files, the missing candidate tracks, the per-track distances, and every album-level field. The bridge's `serialize_match` reduces all of it to the candidate's proposed naming plus the opaque penalty weights, discarding the entire before-side of every diff.

Separately, "(hint contradicted)" is asserted whenever a hint merely *existed* and the match was weak — even when the best candidate is exactly the pinned release. In that case the label is simply untrue: the hint was honored, confidence was just low.

## What Changes

- **The bridge emits the actual differences.** `propose` output carries, per matched track, the file's current tags beside the candidate's proposed tags; the unmatched downloaded files and the missing candidate tracks; the album-level field values (year, media, label, catalog number, country, disambiguation); and each track's distance. Additive to the JSON contract — the existing penalty breakdown stays.
- **The diff flows inward** through the bridge schema, adapter, domain `ProposedCandidate`/`TrackMapping` (persisted on `CandidatesProposed` as optional additive fields), and the facade DTO, to the web review page.
- **The review page renders differences, not scores.** A headline ("you intended _X_; best candidate is _Y_ from _source_, release _id_"), an album-field diff, and a per-track diff that marks retags, extra files, and missing tracks. The penalty weights become secondary labels on that evidence rather than the primary content.
- **The candidate list becomes a legible "pick one of these" surface** (the existing per-row apply, made readable by the diff view), and the ID box is reframed from "MusicBrainz release ID" to a source-agnostic "release ID" (beets' `search_ids` already resolves any loaded source's id). These are the two resolution paths the user keeps for now. **Free-text re-search is explicitly out of scope** (deferred to a later change).
- **The hint signal becomes honest.** The page says the hint was not honored only when the best candidate's release id actually differs from the pinned/hinted id; a weak match on the pinned release reads as "matched your pinned release, but confidence is low", not "contradicted".

## Capabilities

### Modified Capabilities

- `beets-bridge`: `propose` emits the field-level diff evidence (current-vs-proposed track tags, extra/missing tracks, album fields, per-track distance) additively alongside the existing distance and penalty breakdown.
- `match-review`: a match-review item carries the actual differences between the downloaded files and each candidate as decision evidence; the hint signal distinguishes not-honored from low-confidence; ID entry is source-agnostic.
- `web-ui`: the review detail page renders the differences and presents pick-a-candidate and enter-a-release-id as the two clear resolution paths.

## Impact

- **packages/importer**: `bridge.py` (`serialize_match`), `adapters/beets/schemas.ts`, the bridge adapter mapping, `domain/import/events.ts` types, `facade/schemas.ts` + `facade/mapping.ts`. A new/updated contract fixture under `test/contract/` captures the richer `propose` output.
- **packages/web**: `ReviewDetail.svelte`, `CandidateTable.svelte`, `lib/reviews.ts`.
- **Additive at every layer.** New DTO and event fields are optional; imports proposed before this change render with today's score-only view. **No backfill** — re-proposing to enrich old imports would hit the network and could return a different candidate set, so historical reviews degrade gracefully instead.
- **No new resolution verb, no new domain command.** The honest-hint fix is presentation-layer (the DTO carries the pinned id; the web derives the wording). The free-text re-search verb is deferred.
