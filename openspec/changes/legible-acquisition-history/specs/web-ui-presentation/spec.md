# web-ui-presentation — delta for legible-acquisition-history

## ADDED Requirements

### Requirement: Timeline anatomy is structural once and themed per skin

The acquisition timeline's visual anatomy — a per-entry arrangement of marker slot, content, and
time; an animated in-progress entry state; attention and failure/success entry states; date
dividers; and the per-entry disclosure element — SHALL be defined once at the semantic
skeleton/token layer as meaning-based hooks and semantic marker tokens (routine, pending,
attention, failure, success). Every shipped skin SHALL theme this anatomy deliberately, with no
skin leaving the timeline unstyled browser-default. Marker color SHALL never be the only signal
of an entry's state — the entry text SHALL carry the meaning on its own.

#### Scenario: Anatomy is shared, themes differ

- **WHEN** the active skin changes between shipped skins on the acquisition detail
- **THEN** the timeline's DOM is identical and only CSS differs, while each skin presents a
  deliberately styled timeline (markers, in-progress animation, meta alignment, disclosure)

#### Scenario: State is never color-alone

- **WHEN** a timeline entry conveys failure, attention, or completion
- **THEN** the entry's text conveys that state on its own, with marker color as reinforcement
