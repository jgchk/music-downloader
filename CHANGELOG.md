# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

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
