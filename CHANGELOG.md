# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

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
