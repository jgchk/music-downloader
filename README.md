# music-importer

An extensible, event-sourced music importer. Given music files — deposited by [music-downloader](https://github.com/jgchk/music-downloader) or pointed at manually — it proposes [beets](https://beets.io)-powered metadata matches, auto-imports confident ones into the library, and queues uncertain ones for human review, exposed over HTTP and MCP.

Beets remains the library's system of record; this tool narrates and drives the _import process_.

## Status

Bootstrap scaffold. The founding design lives in `openspec/changes/`.

## Development

- `pnpm check` — the full gate (format, lint, typecheck, build, tests w/ 100% coverage).
- `pnpm test:e2e` — out-of-process E2E against the built Docker image.

See `CLAUDE.md` and `docs/development/` for the development constitution.
