# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [3.5.1](https://github.com/jgchk/music-downloader/compare/v3.5.0...v3.5.1) (2026-07-23)


### Bug Fixes

* **downloader:** review hardening — fault on id-less create, witness integrity fields, close test gaps ([1a0c440](https://github.com/jgchk/music-downloader/commit/1a0c44091aa26ebb16dc6fe90f098b3989d76618))
* **downloader:** spend the retry ladder on an empty search round instead of exhausting ([c281512](https://github.com/jgchk/music-downloader/commit/c28151200801b6c5af0bfc284dbedf1b0b8bce52))
* **downloader:** trust only a confirmed-complete, self-consistent slskd search harvest ([91beec7](https://github.com/jgchk/music-downloader/commit/91beec79144e43818411020f22cc0c4d4622a262))

## [3.5.0](https://github.com/jgchk/music-downloader/compare/v3.4.0...v3.5.0) (2026-07-22)


### Features

* **web:** unify human-attention work into one cross-module attention queue ([444279c](https://github.com/jgchk/music-downloader/commit/444279c08299a7f4d7e6cb1096255c8d3cb38c50))

## [3.4.0](https://github.com/jgchk/music-downloader/compare/v3.3.4...v3.4.0) (2026-07-22)


### Features

* **downloader:** add parked-effect store, backoff policy, and permanent-fault classification ([8ca3bf6](https://github.com/jgchk/music-downloader/commit/8ca3bf69c091f586077f6242e4892ac04212cbd9))
* **downloader:** expose dead-lettered acquisitions as stalled with retention ([c915bbb](https://github.com/jgchk/music-downloader/commit/c915bbbbca0aa1731a29cee6cabe5f74247b4274))
* **downloader:** park failing effects per stream and advance the reactor checkpoint ([e746599](https://github.com/jgchk/music-downloader/commit/e746599defaa942b5d4f7b08982a40e18d7271cc))
* **downloader:** re-drive pending effects at startup and re-attach live downloads ([ff68328](https://github.com/jgchk/music-downloader/commit/ff683281575bfbd8758c7940af859cdd5ffd9b6c))

## [3.3.4](https://github.com/jgchk/music-downloader/compare/v3.3.3...v3.3.4) (2026-07-22)


### Bug Fixes

* **web:** map facade errors to HTTP status exhaustively ([41265da](https://github.com/jgchk/music-downloader/commit/41265da29a3b9858849544cf2d460724e9912415))

## [3.3.3](https://github.com/jgchk/music-downloader/compare/v3.3.2...v3.3.3) (2026-07-22)


### Bug Fixes

* **downloader:** treat a 404 transfer listing as an empty collection, not a retryable fault ([e695f6c](https://github.com/jgchk/music-downloader/commit/e695f6ccf80aa52e7f82d364745e80fdb33f68c3))

## [3.3.2](https://github.com/jgchk/music-downloader/compare/v3.3.1...v3.3.2) (2026-07-22)


### Bug Fixes

* **downloader:** treat an slskd enqueue rejection as a candidate failure, not an infra fault ([913455f](https://github.com/jgchk/music-downloader/commit/913455f8105996602c9bbef8cbbe254a3bf1312e))

## [3.3.1](https://github.com/jgchk/music-downloader/compare/v3.3.0...v3.3.1) (2026-07-22)


### Bug Fixes

* **downloader:** tolerate null MusicBrainz metadata fields and bound HTTP requests ([c61287a](https://github.com/jgchk/music-downloader/commit/c61287ab7bfc4c4e3ee12ca76420ff512c2b48e5))

## [3.3.0](https://github.com/jgchk/music-downloader/compare/v3.2.1...v3.3.0) (2026-07-22)


### Features

* **downloader:** pause in AwaitingManualSelection and resume via SelectEdition ([be50d01](https://github.com/jgchk/music-downloader/commit/be50d01714bbeb753e1b6547c27a8aafd8af0715))
* **downloader:** wire needsSelection through the interpreter and add the selectEdition use-case ([3320f62](https://github.com/jgchk/music-downloader/commit/3320f62cfa4ffa3b9001736924494595654fa54f))
* **downloader:** yield needsSelection with candidate editions when a release group has no official edition ([ba4320a](https://github.com/jgchk/music-downloader/commit/ba4320affb3ed960dbf496250e3cb78369212d16))
* **web:** surface awaiting-selection acquisitions and the choose-edition action ([d091371](https://github.com/jgchk/music-downloader/commit/d09137190355e8f1e087a63cdc9c3e022d6ae00b))


### Bug Fixes

* **downloader:** harden manual selection per review — empty-menu guard, drift registry, diagnostics ([79a49e7](https://github.com/jgchk/music-downloader/commit/79a49e7cc8f627b1cc81720c6b4488358ff4b8d7))

## [3.2.1](https://github.com/jgchk/music-downloader/compare/v3.2.0...v3.2.1) (2026-07-22)


### Bug Fixes

* **downloader:** treat MusicBrainz 400 (invalid mbid) as unresolved, not a retryable fault ([4ae0133](https://github.com/jgchk/music-downloader/commit/4ae01333127383f4221b0f7b7e625c161fce9095))

## [3.2.0](https://github.com/jgchk/music-downloader/compare/v3.1.0...v3.2.0) (2026-07-22)


### Features

* **web:** add GET /health readiness+version endpoint (add-health-endpoint) ([17d3553](https://github.com/jgchk/music-downloader/commit/17d3553f6078776a8be653b917565ed4b7d62916))

## [3.1.0](https://github.com/jgchk/music-downloader/compare/v3.0.1...v3.1.0) (2026-07-22)


### Features

* **downloader:** resolve acquisitions by MusicBrainz release-group id ([ed78b7f](https://github.com/jgchk/music-downloader/commit/ed78b7fb17bae016ad01e09250b9094b151c0d3e))

## [3.0.1](https://github.com/jgchk/music-downloader/compare/v3.0.0...v3.0.1) (2026-07-22)


### Bug Fixes

* **web:** load root .env in dev via kit.env.dir + $env/dynamic/private ([4fb0ec9](https://github.com/jgchk/music-downloader/commit/4fb0ec9e4ab5124a9b5e838a876d3bb2bcece8d7))

## [3.0.0](https://github.com/jgchk/music-downloader/compare/v2.5.1...v3.0.0) (2026-07-21)

One product: [music-importer](https://github.com/jgchk/music-importer)'s history and capabilities are merged into this repository as a modular monolith — two bounded-context packages (`packages/downloader`, `packages/importer`) integrating through durable in-process catch-up subscriptions, one SvelteKit web interface, one process, one image. Implements `openspec/changes/merge-modular-monolith`.

### ⚠ BREAKING CHANGES

* **interfaces:** the standalone HTTP API and MCP endpoints are retired on both modules; the web UI over wire-shaped module facades is the product's interface ([c29efae](https://github.com/jgchk/music-downloader/commit/c29efaeed888826fff37c6f50abc67fb592c7f54))
* **seam:** the intake and verdict webhook endpoints no longer exist; cross-module delivery is in-process over each module's event store, and webhook-era configuration is inert ([91edb3e](https://github.com/jgchk/music-downloader/commit/91edb3e43d0e538615229b3266585cdeb4e32b2a))
* the repository is a pnpm workspace; the deployable is a single image running `node packages/web/build` ([c96a692](https://github.com/jgchk/music-downloader/commit/c96a692e84992d126423ef9db69bca975961562c))

### Features

* **facade:** wire-shaped module facades; interfaces become facade consumers ([4ffc213](https://github.com/jgchk/music-downloader/commit/4ffc213b34baaa98618c2884e944ec3b40ae2206))
* **web:** SvelteKit web foundation — composed daemon, three-tier UI testing at 100% ([939174d](https://github.com/jgchk/music-downloader/commit/939174d09ccd1caf41436e1459c7e6aa5bcfcc07))
* **web:** parity UI — acquisitions and review resolution over the facades ([62b9d61](https://github.com/jgchk/music-downloader/commit/62b9d61bbce7db52648082e9298406d0cc072a59))

### Bug Fixes

* **runtime:** close the reactor startup-drain gap; intake source-root defaults to the deposit root ([220b536](https://github.com/jgchk/music-downloader/commit/220b53632ec55dda06aba478a20b3f9eddf9e054))

## [2.5.1](https://github.com/jgchk/music-downloader/compare/v2.5.0...v2.5.1) (2026-07-21)


### Bug Fixes

* **mcp:** remove OAuth resource-server auth from the MCP endpoint ([fd643d2](https://github.com/jgchk/music-downloader/commit/fd643d2927fb94b4cfb7e62689728ba36aec0391)), closes [#51](https://github.com/jgchk/music-downloader/issues/51)

## [2.5.0](https://github.com/jgchk/music-downloader/compare/v2.4.2...v2.5.0) (2026-07-20)


### Features

* **mcp:** OAuth resource-server auth on the MCP endpoint (config-dormant) ([8f7f924](https://github.com/jgchk/music-downloader/commit/8f7f924e4d51d1caa0381bbb061249c8e7befbbc))

## [2.4.2](https://github.com/jgchk/music-downloader/compare/v2.4.1...v2.4.2) (2026-07-20)


### Bug Fixes

* **mcp:** flatten submit_acquisition input schema for tool-use compatibility ([fba2f37](https://github.com/jgchk/music-downloader/commit/fba2f3746b48ccaf8662dd723374d852de7fdf8d))

## [2.4.1](https://github.com/jgchk/music-downloader/compare/v2.4.0...v2.4.1) (2026-07-19)


### Bug Fixes

* **musicbrainz:** prefer the exactly-titled release group over derivative-named siblings ([3f565a0](https://github.com/jgchk/music-downloader/commit/3f565a0f22b2fcd4d91fe838bac2fe2ab63e402f))

## [2.4.0](https://github.com/jgchk/music-downloader/compare/v2.3.0...v2.4.0) (2026-07-19)


### Features

* **acquisition:** revive fulfilled acquisitions on external validation failure ([4c15cc4](https://github.com/jgchk/music-downloader/commit/4c15cc492833542c6df558a8447f460b1cdc738b))

## [2.3.0](https://github.com/jgchk/music-downloader/compare/v2.2.2...v2.3.0) (2026-07-19)


### Features

* **events:** publish acquisition.fulfilled to webhook subscribers ([61b70e6](https://github.com/jgchk/music-downloader/commit/61b70e6efc02657a4e6758f3ecf277571c31524e))

## [2.2.2](https://github.com/jgchk/music-downloader/compare/v2.2.1...v2.2.2) (2026-07-18)


### Bug Fixes

* **slskd:** fully tear down abandoned candidates ([b150fe1](https://github.com/jgchk/music-downloader/commit/b150fe1fb5b1dca858b3d26c2638d9696dd4c971))

## [2.2.1](https://github.com/jgchk/music-downloader/compare/v2.2.0...v2.2.1) (2026-07-18)


### Bug Fixes

* **slskd:** report completed downloads at slskd's actual on-disk location ([36adb9a](https://github.com/jgchk/music-downloader/commit/36adb9a98de0faa947b68c0c673a76f2e98e8a49))

## [2.2.0](https://github.com/jgchk/music-downloader/compare/v2.1.3...v2.2.0) (2026-07-06)


### Features

* **acquisition:** steward slskd resources via an ownership ledger ([08d7939](https://github.com/jgchk/music-downloader/commit/08d7939967448eb79267ceb6de5f0fcdec2d7059))

## [2.1.3](https://github.com/jgchk/music-downloader/compare/v2.1.2...v2.1.3) (2026-07-05)


### Bug Fixes

* **metadata:** resolve descriptor albums via release-group grouping ([ba9e3e7](https://github.com/jgchk/music-downloader/commit/ba9e3e7ffcab6bd708a1b14574dd8ff9668b33d9))

## [2.1.2](https://github.com/jgchk/music-downloader/compare/v2.1.1...v2.1.2) (2026-07-05)


### Bug Fixes

* **acquisition:** react against post-event state via prefix fold ([49f7145](https://github.com/jgchk/music-downloader/commit/49f7145dd7785e476fee3794302dcef80cb8dab6))

## [2.1.1](https://github.com/jgchk/music-downloader/compare/v2.1.0...v2.1.1) (2026-07-05)


### Bug Fixes

* **acquisition:** model AcquisitionState as a phase discriminated union and close staging-cleanup gaps ([1f9289e](https://github.com/jgchk/music-downloader/commit/1f9289eba2ce1079fe5907d2ef98339ddbe848ce))

## [2.1.0](https://github.com/jgchk/music-downloader/compare/v2.0.1...v2.1.0) (2026-07-05)


### Features

* **release:** pre-merge version bump + idempotent release pipeline ([7a2ec81](https://github.com/jgchk/music-downloader/commit/7a2ec8109e16a0d800ee6abb7549cdb76baa0276))

## [2.0.1](https://github.com/jgchk/music-downloader/compare/v2.0.0...v2.0.1) (2026-07-05)


### Bug Fixes

* **contract:** tolerate slskd's {version} path templating in drift checker ([70cab98](https://github.com/jgchk/music-downloader/commit/70cab98c89dbaf7757160497533a2df36a628554))

# [2.0.0](https://github.com/jgchk/music-downloader/compare/v1.0.2...v2.0.0) (2026-07-05)


* feat(mcp)!: serve MCP over streamable HTTP, drop stdio transport ([f4758d4](https://github.com/jgchk/music-downloader/commit/f4758d470ef1e6e2ccabbceee565b762f838a879))


### BREAKING CHANGES

* the stdio MCP transport is removed. Spawn-the-process client
configs (command/args) no longer work and must move to the streamable HTTP URL
(http://<host>:<port>/mcp). Owner-approved, per-change exemption from the
no-breaking-change policy; MCP tool and resource contracts are unchanged.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01T5dwkdccyQVXWZreja9kKP

## [1.0.2](https://github.com/jgchk/music-downloader/compare/v1.0.1...v1.0.2) (2026-07-05)


### Bug Fixes

* **slskd:** parse the real per-user downloads response shape ([491fc54](https://github.com/jgchk/music-downloader/commit/491fc548b5f33d003ea83813530163898e5c3113))

## [1.0.1](https://github.com/jgchk/music-downloader/compare/v1.0.0...v1.0.1) (2026-07-05)


### Bug Fixes

* **deps:** update dependency better-sqlite3 to v12 ([#14](https://github.com/jgchk/music-downloader/issues/14)) ([8f79922](https://github.com/jgchk/music-downloader/commit/8f79922818e41b3be31c5f2488f65b4be85902bf))
* **deps:** update dependency pino to v10 ([#15](https://github.com/jgchk/music-downloader/issues/15)) ([66447c9](https://github.com/jgchk/music-downloader/commit/66447c9d16f150e851587233398be47fcec3c86a))

# 1.0.0 (2026-07-04)


### Features

* bootstrap event-sourced music downloader ([d2ccc0a](https://github.com/jgchk/music-downloader/commit/d2ccc0a67f0d4867a92ccb48abca69432907cb1a))
