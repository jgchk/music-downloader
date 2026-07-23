# Design

## Context

A match-review exists because beets returned a candidate whose distance exceeded the auto-apply threshold (or a hint was in play and confidence was still low). The human must now choose a resolution. Today the only evidence they get is beets' distance decomposition — a bag of `(penalty-name, weighted-amount)` pairs — which is scoring telemetry, not a diff. This change turns the review into a legible account of what actually differs, using data beets already computes.

The full data path (unchanged in shape, enriched in payload):

```
beets AlbumMatch → bridge.py serialize_match → bridgeCandidateSchema → ProposedCandidate
  → CandidatesProposed (event store) → facade candidateSchema (DTO) → web ReviewDetail
```

## Decisions

### D1 — The reference point for a diff is the files' current tags, with the hint shown as intent

A candidate can be compared against two things: the submission **hint** (artist/album/mbReleaseId the downloader intended) and the **current embedded tags** of the staged files (what Soulseek actually delivered). We render both, at different altitudes:

- **Album headline** — "you intended _hint.artist — hint.album_ (release _hint.mbReleaseId_)" vs "candidate _artist — album_ (_data_source_, _album_id_)". Answers *did I even get the right album?* The hint is optional; when absent the headline is just the candidate identity.
- **Per-track and album-field diff** — the files' **current tags** vs the candidate's **proposed tags**. Answers *will importing this retag my files sensibly, and is the download complete?*

Current tags are always available (beets read them off the items to build `match.mapping`); the hint may be absent. So the track/field diff — the always-present, most actionable part — keys off current tags, and the hint enriches the headline when present. This matches the earlier exploration conclusion: *hint answers "right album?", file tags answer "good retag?"*.

### D2 — Persist the diff on the event; never re-propose to render a review

The review DTO is rebuilt by folding the event store, so the diff evidence must live on `CandidatesProposed`. The alternative — re-running `propose` when the page loads — is rejected: it hits the network (MusicBrainz/Discogs), is non-deterministic (the candidate set can change between propose and render), and would make a recorded review contradict itself. The proposal is a **fact**; its evidence is recorded with it. This grows event size, which is acceptable for the low volume of reviews.

### D3 — New fields are optional; old reviews degrade to the score-only view

Events already in the store were written by today's `serialize_match` and carry none of the new fields. Every added field on `TrackMapping`, `ProposedCandidate`, and the DTO is therefore **optional**. The web renders the rich diff when the fields are present and falls back to the current distance/penalty table when they are not. **No backfill** is attempted — the only way to enrich a historical event is to re-propose, which D2 rules out. This is the standard additive-DTO discipline (`api-compatibility.md`): additive-only, tolerant reader.

### D4 — What `serialize_match` newly emits

beets' `AlbumMatch` already holds everything; the change is purely what we serialize:

| New field (per candidate) | beets source | Renders as |
|---|---|---|
| per-track `current` tags (title, artist, track no., length) | `item` in `match.mapping` | before-side of each track row |
| per-track `distance` | `match.distance.tracks[TrackInfo]` | flags *which* tracks differ (the `tracks` penalty made concrete) |
| `extraItems` (unmatched files) | `match.extra_items` | "⊘ extra file — matched no track" |
| `missingTracks` (title, index) | `match.extra_tracks` | "✗ missing — no file for this track" |
| album fields (year, media, label, catalognum, country, disambig) | `match.info.*` | album-field diff vs the files' current album tags |

The existing `data_source`, `album_id`, `distance`, `penalties`, and per-track proposed `title`/`index` all stay. The contract fixture under `test/contract/` is re-recorded (or a new richer one added) so the schema drift is caught at the boundary and the replay test covers the new shape.

### D5 — The penalty breakdown is retained, demoted, and glossed

The weights are still the honest decomposition of the distance (they sum to it), and they remain useful as a "why is this the score" footnote. They move from the primary content to a secondary position, each shown as a label on the concrete evidence it summarizes where possible (e.g. the `tracks` weight sits beside the track diff; `data_source` beside the source line). A short plain-language gloss accompanies the raw beets key names so `album_id`/`unmatched_tracks`/`missing_tracks` are not bare jargon.

### D6 — The honest hint signal is derived in presentation, not re-modeled in the domain

`ReviewCause` keeps its `hinted: boolean` (a persisted event field; leaving it is the additive-safe choice). To word the page truthfully we need the pinned/hinted release id at render time, which the match-review DTO does not carry today. We add it (the id from the import's `pinnedId`/`hints.mbReleaseId`, available in folded state) as an **optional** DTO field, and the web derives the wording:

```
pinnedId present  && best.albumId !== pinnedId  →  "The release you pinned wasn't the best match"
pinnedId present  && best.albumId === pinnedId  →  "Matched your pinned release, but confidence is low"
no pinnedId                                      →  (no hint line)
```

This corrects the false "(hint contradicted)" without churning the domain event's meaning. The diff headline (D1) already shows the concrete release mismatch, so this line becomes a short, accurate summary rather than the sole signal.

### D7 — ID entry becomes source-agnostic; no new verb

The existing `supply-id` verb feeds beets' `search_ids`, which every loaded source plugin tries to resolve — it was never actually MusicBrainz-only, only labeled so. We relabel the field ("release ID", with a hint that any source beets knows is accepted) and keep the verb and its wire contract unchanged. Generalizing the domain field name (`mbReleaseId`) is **not** done here — a rename is not additive-safe and is not required for the behavior. This is the smallest honest change that matches the now-visible non-MusicBrainz candidates.

## Out of scope (deferred)

- **Free-text re-search** (a `refine-search` verb carrying `{artist?, album?}` back into a re-propose). The outbound port and `bridge.py` already accept `--search-artist`/`--search-album`; only the inbound verb, reactor wiring, and a form are missing. Left for a follow-up per the user's "pick from a list + enter an ID for now" scope.
- **Renaming the `mbReleaseId` domain field** to a source-qualified identity (see D7).

## Risks

- **Event-size growth.** Full per-track current+proposed tags on every candidate enlarges `CandidatesProposed`. Low review volume makes this acceptable; if it ever matters, the diff could be trimmed to changed fields only.
- **Contract fixture churn.** The richer `serialize_match` changes recorded bridge output; the contract test must be re-recorded against the pinned beets version, not hand-edited, so it stays a true replay.
