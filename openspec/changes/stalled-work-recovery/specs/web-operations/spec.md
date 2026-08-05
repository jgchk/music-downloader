# web-operations — delta for stalled-work-recovery

## Purpose

Give the system's operator a gated surface for work only an operator can do: see everything
currently stalled across the modules with the diagnostics an intervention needs, and recover it
with the redrive verb — paired with the domain's own give-up — without shell access, DB surgery,
or a restart.

## ADDED Requirements

### Requirement: The operations surface is owner-gated through the authorization seam

The operations surface — its pages and every verb it offers — SHALL be reachable only when the
authorization seam permits the presenting session the corresponding privileged action (see
`web-authorization`); the redrive verbs SHALL be gated by the `system:redrive` action. A refusal
SHALL produce no side effects and SHALL NOT reveal the surface's content. The surface SHALL NOT
appear in the base navigation shown to guest sessions.

#### Scenario: A guest cannot reach the surface

- **WHEN** a request with a valid guest-role session targets the operations surface or submits a
  redrive
- **THEN** the authorization seam refuses it, nothing is listed or executed, and the response
  reveals no operational detail

#### Scenario: The owner reaches the surface

- **WHEN** a request with a valid owner-role session targets the operations surface
- **THEN** the stalled-work list is served

### Requirement: The operations surface lists exactly the stalled work

The operations surface SHALL list every currently stalled item across both modules, composed by
the web layer from each module facade's own stalled-work read — introducing no cross-module
contract — and ordered longest-stalled first using the dead-letter ledger's recorded time. Each
item SHALL identify the work it belongs to (linked to its detail page), when it stalled, and the
recorded failure diagnostics. This surface speaks the operator's register: technical diagnostics
(error text, subscription names) MAY render verbatim, and the one-voice narration register does
not apply. When one module's read fails, the other module's items SHALL still render alongside a
modeled error for the failed section.

#### Scenario: Stalled items from both modules appear with diagnostics

- **GIVEN** a stalled import and a stalled acquisition
- **WHEN** the owner opens the operations surface
- **THEN** both appear in one list, longest-stalled first, each linking to its detail page and
  showing when it stalled and the recorded error text

#### Scenario: Nothing stalled renders an empty state

- **WHEN** the owner opens the operations surface while no work is stalled
- **THEN** an explicit all-clear empty state renders, not a blank page

#### Scenario: One module failing does not empty the surface

- **GIVEN** one module's stalled-work read fails
- **WHEN** the owner opens the operations surface
- **THEN** the other module's items are listed and the failed section renders a modeled error

### Requirement: Redrive is offered per item, with give-up as the domain's own verb

Each stalled item SHALL offer a redrive action, and the surface SHALL offer a redrive-all
convenience that is one iteration of the per-item verb. Submitting a redrive SHALL be
fire-and-forget: the response acknowledges acceptance and the outcome is read from the existing
status surfaces — the item leaves the stalled list, and either progresses or returns to it. The
surface SHALL NOT offer any dismiss/ignore verb that clears letters without redriving; where
giving up is wanted, the surface SHALL point to (or offer, where it already exists) the work's
own domain cancellation, in its ordinary destructive-confirmation form.

#### Scenario: Redriving a stalled item

- **GIVEN** a stalled import whose underlying cause has been repaired
- **WHEN** the owner submits its redrive
- **THEN** the response acknowledges acceptance without awaiting settlement, and the item
  disappears from the stalled list while the work resumes

#### Scenario: A failed redrive re-stalls honestly

- **GIVEN** a stalled item whose underlying cause persists
- **WHEN** the owner redrives it and the effect exhausts its fresh retry budget again
- **THEN** the item returns to the stalled list with fresh diagnostics, and nothing is lost

#### Scenario: No dismiss verb exists

- **WHEN** the owner views a stalled item's actions
- **THEN** the offered verbs are redrive and the domain's cancellation — there is no
  clear-without-redrive affordance
