# out-of-process-e2e — delta for e2e-review-resolution-loop

## ADDED Requirements

### Requirement: The review-resolution revival loop is proven end to end

The e2e tier SHALL include an isolated phase that drives a human review resolution over the web
interface's HTTP endpoints against the real image and witnesses the full cross-context
consequence: a genuinely low-confidence import (real beets scoring a seeded fixture into the
band between auto-apply and no-match) queues a review; resolving it as the unusable-delivery
rejection publishes the verdict; the downloader consumes it, revives the hunt, and delivers a
second candidate; and the story completes into the library. The phase SHALL assert the review
actually queued before resolving — so a metadata-scoring shift under a future beets version
fails the phase loudly at the setup assertion rather than silently downgrading the scenario —
and SHALL assert the first delivery's rejection left no partial state behind (the rejected
files are gone from staging per the rejection's contract). The phase SHALL drive resolution
through the same HTTP surface a user submits, not a facade or store back-door.

#### Scenario: A rejected delivery revives the hunt and completes

- **GIVEN** the image running with a seeded source whose best match scores into the review band
  and a stub source offering a second, better candidate
- **WHEN** the phase confirms the review queued, then resolves it as reject-unusable-delivery
  over HTTP
- **THEN** the downloader resumes the hunt without a new submission, the second candidate is
  delivered and imported, the story reaches its ordinary completed outcome, and the review queue
  is empty

#### Scenario: The setup asserts its own premise

- **WHEN** the seeded fixture no longer scores into the review band (for example, after a beets
  version change)
- **THEN** the phase fails at its explicit review-queued assertion, naming the premise that
  broke, rather than passing vacuously or failing obscurely downstream
