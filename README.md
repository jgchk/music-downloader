# music-downloader

An extensible, event-sourced music downloader. Given a musical intent and a quality policy, it
finds, downloads, validates, and (on failure) retries the best-matching, highest-quality release
across pluggable sources, exposed over HTTP and MCP.

The architecture, principles, and rationale live in [`CLAUDE.md`](CLAUDE.md) and
[`docs/development/`](docs/development); the capability specs and design decisions live in
[`openspec/changes/bootstrap-acquisition-core/`](openspec/changes/bootstrap-acquisition-core).

## How it works

A submission (`{artist, title}` or a MusicBrainz id, plus optional quality/match/retry/download
policies) is accepted asynchronously and runs as an event-sourced workflow:

```
resolve metadata → search sources → rank candidates → download → validate (decode + structure) → import
                                        ↑___________ on failure: reject, pick next, re-search __________|
```

Only business-meaningful transitions are events; high-frequency transfer progress is an ephemeral
read model. The pure domain (`decide`/`evolve`/`react`) holds all the intelligence; flaky I/O is
isolated behind ports (slskd, MusicBrainz, ffmpeg, filesystem, SQLite).

## Requirements

- **Node** — version pinned in [`.nvmrc`](.nvmrc); **pnpm** (via `corepack enable`).
- **ffmpeg / ffprobe** on `PATH` — used to decode-validate downloads (baked into the container image).
- A reachable **slskd** (Soulseek) instance for the search/download source.
- Outbound access to **MusicBrainz** for metadata resolution.

## Configuration

All configuration comes from the environment (12-factor); invalid config fails startup fast. See
[`.env.example`](.env.example).

| Variable                 | Required | Default                 | Description                                    |
| ------------------------ | -------- | ----------------------- | ---------------------------------------------- |
| `LIBRARY_ROOT`           | yes      | —                       | Where validated releases are organized.        |
| `STAGING_ROOT`           | yes      | —                       | Where in-flight downloads stage before import. |
| `HTTP_PORT`              | no       | `3000`                  | HTTP API port.                                 |
| `HTTP_HOST`              | no       | `0.0.0.0`               | HTTP API bind host.                            |
| `DATABASE_FILE`          | no       | `data/events.db`        | SQLite event-store file.                       |
| `LOG_LEVEL`              | no       | `info`                  | pino level (`debug`/`info`/`warn`/`error`).    |
| `MUSICBRAINZ_BASE_URL`   | no       | public MusicBrainz      | Metadata API base URL.                         |
| `MUSICBRAINZ_USER_AGENT` | no       | built-in                | User-Agent sent to MusicBrainz.                |
| `SLSKD_BASE_URL`         | no       | `http://localhost:5030` | slskd API base URL.                            |
| `SLSKD_API_KEY`          | no       | —                       | slskd API key (secret; never commit).          |

## Running

The product runs as **one composed process** (modular monolith): the SvelteKit server boots both
module runtimes — event stores, reactors, source pollers, and the two cross-module seam
subscriptions — in its `init` hook, _before_ it accepts any request, then serves the web
interface. Background processing never depends on page traffic.

### Development (Vite)

```bash
corepack enable
pnpm install
cp packages/web/.env.example packages/web/.env   # then edit the roots + slskd/beets settings
pnpm dev                                          # Vite dev server, real daemon booted in-process
```

Dev and prod run the SAME composition: Vite's dev server loads `src/hooks.server.ts`, whose
`init` boots the real module runtimes with the facades wired into SSR — there is no mock daemon
and no sidecar process.

### Production (adapter-node build)

```bash
pnpm run build
env $(grep -v '^#' packages/web/.env | xargs) node packages/web/build
```

The daemon composition lives in `packages/web/src/lib/server/` (the only code allowed to touch
the modules' `./runtime` entries — lint-enforced); routes and components see the module facades
only, via `event.locals.facades`. Server-only code stays under `$lib/server`, which SvelteKit
refuses to bundle into the client — a client-side import of the daemon is a build error, not a
code-review catch.

### Web e2e smoke (Playwright)

```bash
pnpm test:e2e:web
```

Self-contained: `packages/web/tests/serve.sh` builds and serves the **real adapter-node entry**
against scratch filesystem roots and a minimal real beets config (validated by the real bridge at
boot); slskd and MusicBrainz point at a closed port, so the smoke drives the true server routes
without any network. Threshold-free by design — the 100% coverage gate lives in the vitest tiers.

### Container (ffmpeg included)

```bash
docker build -t music-downloader .
docker run --rm -p 3000:3000 \
  -e LIBRARY_ROOT=/music/library -e STAGING_ROOT=/music/staging \
  -e SLSKD_BASE_URL=http://slskd:5030 -e SLSKD_API_KEY=... \
  -v /host/music:/music music-downloader
```

Images are published to GHCR on merge to `main`.

## Interfaces

Both surfaces map onto the same application use-cases and derive from one shared zod schema source.

**HTTP API** (versioned under `/api/v1`; OpenAPI served at `/docs`):

| Method + path                            | Purpose                            |
| ---------------------------------------- | ---------------------------------- |
| `POST /api/v1/acquisitions`              | Submit an acquisition → `202`.     |
| `GET /api/v1/acquisitions`               | List acquisitions.                 |
| `GET /api/v1/acquisitions/{id}`          | Current status + attempt history.  |
| `GET /api/v1/acquisitions/{id}/progress` | Live download progress.            |
| `POST /api/v1/acquisitions/{id}/cancel`  | Cancel a non-terminal acquisition. |

**MCP** — tools `submit_acquisition` / `cancel_acquisition`; resources `md://acquisitions`,
`md://acquisitions/{id}`, `md://acquisitions/{id}/progress`. Served over the **streamable HTTP**
transport by the same server at `POST /mcp` (i.e. `http://<HTTP_HOST>:<HTTP_PORT>/mcp`), so HTTP and
MCP clients share one process and one set of acquisitions. Point an MCP client at that URL:

```jsonc
{ "mcpServers": { "music-downloader": { "url": "http://localhost:3000/mcp" } } }
```

> **Breaking change:** the stdio transport has been removed. A spawn-the-process MCP config
> (`command`/`args`) no longer works — migrate it to the URL form above. This is an intentional,
> owner-approved break to the MCP connection contract; the tool and resource contracts are unchanged.

## Development

Test-first, red-green-refactor; the domain is pure; dependencies point inward; 100% coverage is
enforced. One command runs the whole gate:

```bash
pnpm run check   # format + lint (incl. layer boundaries) + typecheck + build + test @ 100% coverage
```

Every commit must pass it; CI is the hard wall. See [`docs/development/`](docs/development) for the
full constitution.
