# web-ui-presentation — delta for reviews-register-alignment

## ADDED Requirements

### Requirement: Decision-surface anatomy is structural once and themed per skin

The review surface's decision anatomy — low-emphasis destructive action styling, the in-page
destructive confirmation block, word-level diff highlight marks with their direction cue,
de-emphasized unchanged diff rows, and the per-candidate disclosure element — SHALL be defined
once at the semantic skeleton/token layer as meaning-based hooks and semantic tokens (including
a destructive/danger token family), alongside the existing timeline anatomy. Every shipped skin
SHALL theme this anatomy deliberately, with no skin leaving it unstyled browser-default and no
skin rendering a destructive affordance indistinguishable from a safe one. Danger color SHALL
never be the only signal of destructiveness — the affordance's text SHALL carry the consequence
on its own.

#### Scenario: Anatomy is shared, themes differ

- **WHEN** the active skin changes between shipped skins on a review page
- **THEN** the page's DOM is identical and only CSS differs, while each skin presents
  deliberately styled destructive affordances, confirmation block, and diff marks

#### Scenario: Destructiveness is never color-alone

- **WHEN** a destructive resolution affordance renders under any shipped skin
- **THEN** its label and consequence text convey the destructiveness on their own, with danger
  styling as reinforcement, and the affordance is visibly distinct from safe actions
