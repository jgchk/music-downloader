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

### Locally

```bash
corepack enable
pnpm install
pnpm run build
cp .env.example .env    # then edit LIBRARY_ROOT / STAGING_ROOT (and slskd/MusicBrainz)
env $(grep -v '^#' .env | xargs) node dist/composition/index.js
```

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
