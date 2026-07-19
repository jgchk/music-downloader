# The Twelve-Factor Method

We follow the twelve-factor principles for services that are portable, disposable, and easy to operate.

- **Codebase** — one codebase in version control, many deploys.
- **Dependencies** — explicitly declared and isolated; never rely on implicit system-wide packages.
- **Config** — everything that varies between environments lives in the environment, not in code. No secrets in the repo.
- **Backing services** — databases, external services, and stores are attached resources, addressed by config and swappable without code changes.
- **Build, release, run** — strictly separate stages; a release is immutable and identifiable.
- **Processes** — stateless and share-nothing; persistent state lives in backing services, so any process can be replaced.
- **Port binding** — the service is self-contained and exports its interface by binding to a port.
- **Concurrency** — scale out via more processes, not by making one process bigger.
- **Disposability** — fast startup and graceful shutdown; a process can be killed at any moment without corrupting state (in-flight work drains or resumes).
- **Dev/prod parity** — keep environments as similar as possible.
- **Logs** — treat logs as event streams to stdout; don't manage files (see logging.md).
- **Admin processes** — run one-off tasks in an environment identical to the app.

## Consequences we rely on

- Config-via-environment makes backing services (the store, external sources) swappable and testable.
- Disposability + stateless processes work hand-in-hand with durable, resumable event-driven processing (see event-sourcing.md).
