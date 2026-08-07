# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [3.18.1](https://github.com/jgchk/music-downloader/compare/v3.18.0...v3.18.1) (2026-08-07)

### Bug Fixes

* **musicbrainz:** stop an uncomparable album title from bypassing the ambiguity guard ([a02bd2b](https://github.com/jgchk/music-downloader/commit/a02bd2b903a55b01fa285d9d54fdf3230ebdd2ac))
## [3.18.0](https://github.com/jgchk/music-downloader/compare/v3.17.5...v3.18.0) (2026-08-07)

### Features

* **downloader:** thread the correlation/causation pair through the downloader and the BFF ([1e0b445](https://github.com/jgchk/music-downloader/commit/1e0b4458e3aee682f9ce71b05aa5cbfa5b22e7f5))
* **importer:** thread the correlation/causation pair through the importer ([29892e8](https://github.com/jgchk/music-downloader/commit/29892e80752ecc25958bf68f3fb20bfae0b123e6))
* **seam:** carry the operation story across the context boundary ([30fa1d3](https://github.com/jgchk/music-downloader/commit/30fa1d32a32e71559471354fb9297dc8452e0947))

### Bug Fixes

* **correlation:** close cycle-2 review, including a regression the cycle-1 fix introduced ([28f1b51](https://github.com/jgchk/music-downloader/commit/28f1b515e35d5ed40d1354d285e29ece5b1178cc))
* **correlation:** close the gaps ten reviewers found in the first sweep ([6d4c339](https://github.com/jgchk/music-downloader/commit/6d4c33955cd9ad69cc5c6bc97c31251eecbea8cc))
* **correlation:** pin the seam with producer-rendered fixtures; own the cycle rule; guard the duplication ([72f9bc1](https://github.com/jgchk/music-downloader/commit/72f9bc10f5dcf76143e86bae053e54526d3b1504))
## [3.17.5](https://github.com/jgchk/music-downloader/compare/v3.17.4...v3.17.5) (2026-08-07)

### Bug Fixes

* **web:** stop an unknown login error code from resolving to a prototype member ([893d37a](https://github.com/jgchk/music-downloader/commit/893d37abb17fe402c2f64dd5760a499ce2f22a63))
## [3.17.4](https://github.com/jgchk/music-downloader/compare/v3.17.3...v3.17.4) (2026-08-07)

### Bug Fixes

* **events:** halt the downloader seam on a render defect, and drain before stop ([855c181](https://github.com/jgchk/music-downloader/commit/855c18159c371117f1e8f09f4f62e6fb5638f1d1))
* **events:** never infer a checkpoint position, and keep reset's promise honest ([023d3dc](https://github.com/jgchk/music-downloader/commit/023d3dc03fb3ceec39ee2ed55cc0f1b1b4cdcddf))
* **events:** report a failed checkpoint reset instead of claiming the replay was armed ([bb50207](https://github.com/jgchk/music-downloader/commit/bb502070633478a8a783bab74d7f475edaeaccca))
* **events:** serialize resets as a queue, and stop laundering rejections as Results ([9232b94](https://github.com/jgchk/music-downloader/commit/9232b948e5c6e3fb7064a2d1223dde1a5e510aa7))
* **lint:** correct the must-use-result blind spots and re-arm it for recorders ([1eee981](https://github.com/jgchk/music-downloader/commit/1eee981867f446f3e546bb13745de5e35d7f0d5d))
* **lint:** make "never ignore a Result" a real lint rule ([36b3854](https://github.com/jgchk/music-downloader/commit/36b385478483175670382c02cd8841c5458d61e7))
* **release:** stop a failed VCS read from truncating the changelog ([aeeeb9b](https://github.com/jgchk/music-downloader/commit/aeeeb9b278fabe2f93f8e85595d81ddc83739edf))
* **release:** validate the changelog preset shape instead of asserting it ([5262952](https://github.com/jgchk/music-downloader/commit/5262952989129b0778da5224a8d910ce533aca50))
## [3.17.3](https://github.com/jgchk/music-downloader/compare/v3.17.2...v3.17.3) (2026-08-06)

### Bug Fixes

* **slskd:** tell one story about a failed download, whichever path saw it ([d661f04](https://github.com/jgchk/music-downloader/commit/d661f04ad25b388de1824384fa378c9fe32c1542))
## [3.17.2](https://github.com/jgchk/music-downloader/compare/v3.17.1...v3.17.2) (2026-08-06)

### Bug Fixes

* **importer:** revive the hunt-replacement delivery the intake seam was swallowing ([2273f0f](https://github.com/jgchk/music-downloader/commit/2273f0fff52b1399c6ffd0b129870beecebee8ea))
## [3.17.1](https://github.com/jgchk/music-downloader/compare/v3.17.0...v3.17.1) (2026-08-06)

### Bug Fixes

* **ci:** publish the exact e2e-gated image instead of rebuilding ([1852b5d](https://github.com/jgchk/music-downloader/commit/1852b5d80652cd02e19b069357d89e97f6d00ec3))
* **release:** fail version:prep loudly when the version anchor finds no purchase ([3af055e](https://github.com/jgchk/music-downloader/commit/3af055e38a1dc3aac0aed4227ccb7b68540b709e))
## [3.17.0](https://github.com/jgchk/music-downloader/compare/v3.16.2...v3.17.0) (2026-08-06)

### Features

* **web:** require a server resource for admission and give sessions a role ([fe651a5](https://github.com/jgchk/music-downloader/commit/fe651a53cea6f1adbe121d24ea658cfc252b4d3f))

### Bug Fixes

* **web:** close the tripwire's scan hole and sharpen the refusal signals ([fc3dd76](https://github.com/jgchk/music-downloader/commit/fc3dd761eea51cc165d6681edc28fe5be6ff312a))
* **web:** keep the forged-server escalation unarmed and make refusals diagnosable ([827af22](https://github.com/jgchk/music-downloader/commit/827af228faeca99be2e611f0909af539583130ad))
* **web:** log the probe denial without detaching pino's receiver ([fd71c6e](https://github.com/jgchk/music-downloader/commit/fd71c6e6105ba82f02a26ed8d157a4a1845b0a70))
## [3.16.2](https://github.com/jgchk/music-downloader/compare/v3.16.1...v3.16.2) (2026-08-06)

### Bug Fixes

* **downloader:** default the event store to the populated upcaster registry ([0f7fdbd](https://github.com/jgchk/music-downloader/commit/0f7fdbdd9446ce02233bfecdef7b14894e010c85))
* **downloader:** encode the stalled flag tag-or-omit on the wire ([5de2876](https://github.com/jgchk/music-downloader/commit/5de2876a1a1f354f37159607815f4d5f832d562e))
* **importer:** project history onto the wire per kind, never by spread ([1f98ad3](https://github.com/jgchk/music-downloader/commit/1f98ad3db34914c4f2275bfd2a737296419759b0))
* **importer:** replay legacy events through the production upcaster registry ([0fbbb9e](https://github.com/jgchk/music-downloader/commit/0fbbb9e60982e8887020b24ecafa5cac9fa0222c))
* **web:** honest degrade arms and one-voice register at the wire lookups ([e69a6b3](https://github.com/jgchk/music-downloader/commit/e69a6b34a2343006df5ac5b3bb2a1e8413f861a3))
* **web:** restore compile pressure on the resolution-verb seams ([fd52753](https://github.com/jgchk/music-downloader/commit/fd52753d5a17ecd83a8c5e6f7f7856512ed155cd))
## [3.16.1](https://github.com/jgchk/music-downloader/compare/v3.16.0...v3.16.1) (2026-08-05)

### Bug Fixes

* **downloader:** back a failed landing off instead of re-firing the exhausted effect every tick ([024bdbf](https://github.com/jgchk/music-downloader/commit/024bdbf7c00e6d623c815445754a14a29b6493a6))
* **downloader:** bound and instrument the ffmpeg probe; decode subprocess output as a stream ([5f9ef50](https://github.com/jgchk/music-downloader/commit/5f9ef50db994db6358a057fbe2f6c4356bfbef7b))
* **downloader:** refuse to boot on a failed projection rebuild; harden the composed boot and shutdown ([f1f3956](https://github.com/jgchk/music-downloader/commit/f1f39562fec71eef10a13fec7f82f7a0b0f791d1))
* **downloader:** require the slskd client injected; redact peer usernames from logs ([581b9ef](https://github.com/jgchk/music-downloader/commit/581b9eff1051b9a5c2aea78b472e8254c51983a4))
* **importer:** contain reactor and seam-subscription defects; settle sibling effects independently ([4cf147d](https://github.com/jgchk/music-downloader/commit/4cf147d005f3ff2d455c3aeef78e5a582189e1d5))
* **importer:** count the files the bridge skips as unreadable on stderr ([7d736e7](https://github.com/jgchk/music-downloader/commit/7d736e7b5af7494fdc91185e354d21fa14394c4d))
## [3.16.0](https://github.com/jgchk/music-downloader/compare/v3.15.1...v3.16.0) (2026-08-02)

### Features

* **downloader:** download supervisor — the watch leaves the reactor dispatch ([e2806ad](https://github.com/jgchk/music-downloader/commit/e2806adea018c66fa2ecd5787e37b15c0e84ec10))
* **downloader:** record DownloadStarted and narrate the downloading phase ([58beaf6](https://github.com/jgchk/music-downloader/commit/58beaf60671c6e0f6c2f12d27d7398eba4d56bdd))
* **web:** honest downloading views — preparing vs live transfer ([7b16a2d](https://github.com/jgchk/music-downloader/commit/7b16a2d33aaa915f9bd29c6882a128a0cd02ac87))

### Bug Fixes

* **downloader:** close review cycle 2 — retirement, reservation, honest costs ([0509315](https://github.com/jgchk/music-downloader/commit/0509315617588ae41f0b0f9f1b1bee0d3a742430))
* **downloader:** harden the supervisor per review — guards, lifecycle, verdicts ([5b86abe](https://github.com/jgchk/music-downloader/commit/5b86abe683d9ed7e82b90c1429cd65291e00cd46))
## [3.15.1](https://github.com/jgchk/music-downloader/compare/v3.15.0...v3.15.1) (2026-08-02)

### Bug Fixes

* **importer:** complete the beets image environment — flac binary + discogs extra ([f89d559](https://github.com/jgchk/music-downloader/commit/f89d559d36d265e6a40df349687757450d587ffe))
## [3.15.0](https://github.com/jgchk/music-downloader/compare/v3.14.0...v3.15.0) (2026-08-02)

### Features

* **web:** align the /reviews surface with the copy register ([df51149](https://github.com/jgchk/music-downloader/commit/df5114938d4844e3eabf2d48a7528a37410ec161))

### Bug Fixes

* **web:** harden the review surface against review findings ([2df9e21](https://github.com/jgchk/music-downloader/commit/2df9e2135a0a021497d7b5e9baf74f49d0c164cb))
## [3.14.0](https://github.com/jgchk/music-downloader/compare/v3.13.0...v3.14.0) (2026-08-02)

### Features

* **downloader:** project full lifecycle history + requested-target echo onto the status facade ([3a641ab](https://github.com/jgchk/music-downloader/commit/3a641abbf0674325682fa747d63d033a5299eace))
* **web:** legible acquisition history — unified-voice timeline, live pending row, timestamps, disclosure, page register ([66f577f](https://github.com/jgchk/music-downloader/commit/66f577ffdfef8c86c379d7199029f130382f8f29))

### Bug Fixes

* **web:** review cycle 1 — honest settledness across the async hand-off + compile-pressured copy layer ([59d469c](https://github.com/jgchk/music-downloader/commit/59d469cd3138a2081e84b27af95a198e824efa39))
* **web:** review cycle 2 — watch through the rejection-revival race, non-absorbing refresh banner, drift-safe phase fallbacks ([af6ffd9](https://github.com/jgchk/music-downloader/commit/af6ffd94ca1bd0102d746c3c80a7da6007b8b64a))
* **web:** review cycle 2b — liveness policy extracted and fully unit-tested, remediation entry links to its review, album hint echoed ([4e73ea6](https://github.com/jgchk/music-downloader/commit/4e73ea621e4d8ccc7821eca977d42efc336000eb))
## [3.13.0](https://github.com/jgchk/music-downloader/compare/v3.12.0...v3.13.0) (2026-08-01)

### Features

* **web:** gate the web UI behind Plex-authenticated, share-approved sessions ([ea776f4](https://github.com/jgchk/music-downloader/commit/ea776f42378998b4189252581086c8f41735334f))

### Bug Fixes

* **web:** __Host- cookies, SPA-safe gate redirect, and distinct refusal logging per review cycle 2 ([e078de2](https://github.com/jgchk/music-downloader/commit/e078de25ee15dcb55f5fb387acb8d32a73a0f623))
* **web:** bind login PINs to the starting browser and harden the gate per review ([bbf519f](https://github.com/jgchk/music-downloader/commit/bbf519fd0f1e2c81b5d973b988101ac6ff84e349))
## [3.12.0](https://github.com/jgchk/music-downloader/compare/v3.11.0...v3.12.0) (2026-07-23)

### Features

* surface decided lifecycle and authorization facts (bff-decided-lifecycle-flags) ([04d3bb9](https://github.com/jgchk/music-downloader/commit/04d3bb930dcb31f859eff3b89692cb3dc067603e))
## [3.11.0](https://github.com/jgchk/music-downloader/compare/v3.10.1...v3.11.0) (2026-07-23)

### Features

* **importer:** speak the importer's own resolution vocabulary ([76f90ae](https://github.com/jgchk/music-downloader/commit/76f90ae9e8a7ca92a0489145acef47ecf7ba9258))

### Bug Fixes

* **importer:** tighten verdict-vocabulary review findings ([e0845e2](https://github.com/jgchk/music-downloader/commit/e0845e2838ea87e2f890229d8225f788eedc1786))
## [3.10.1](https://github.com/jgchk/music-downloader/compare/v3.10.0...v3.10.1) (2026-07-23)

### Bug Fixes

* whole-codebase review hardening ([44f2c8b](https://github.com/jgchk/music-downloader/commit/44f2c8b98bc863ce8e6944a9b17061ddf502db4c))
## [3.10.0](https://github.com/jgchk/music-downloader/compare/v3.9.0...v3.10.0) (2026-07-23)

### Features

* **lint:** adopt eslint-plugin-unicorn (recommended) across the codebase ([873a476](https://github.com/jgchk/music-downloader/commit/873a4761582622750e355249a043ea942ca53b6b)), references [Iterator#toArray](https://github.com/Iterator/issues/toArray)
## [3.9.0](https://github.com/jgchk/music-downloader/compare/v3.8.2...v3.9.0) (2026-07-23)

### Features

* **importer:** reactor-durability parity — durable retry budget + stalled read-model ([e9fc3e4](https://github.com/jgchk/music-downloader/commit/e9fc3e4f0fd758702a076348e956f9df3e920856))
## [3.8.2](https://github.com/jgchk/music-downloader/compare/v3.8.1...v3.8.2) (2026-07-23)

### Bug Fixes

* **domain:** schema-evolution — EditionCandidate.trackCount optional (0-was-unknown), importer match-review.best required ([f35b8c5](https://github.com/jgchk/music-downloader/commit/f35b8c517a677103428aedb3c0400f8dc27fba17))
## [3.8.1](https://github.com/jgchk/music-downloader/compare/v3.8.0...v3.8.1) (2026-07-23)

### Bug Fixes

* **web:** compact acquisitions master list — stop the queue table overflowing the detail ([e355b0d](https://github.com/jgchk/music-downloader/commit/e355b0d63762018aafc787c69d3ad70e0401085d))
## [3.8.0](https://github.com/jgchk/music-downloader/compare/v3.7.0...v3.8.0) (2026-07-23)

### Features

* **importer,web:** show actual differences in match reviews ([5198357](https://github.com/jgchk/music-downloader/commit/51983573579938e4a36dcc567b57d5786d01b53a))
## [3.7.0](https://github.com/jgchk/music-downloader/compare/v3.6.0...v3.7.0) (2026-07-23)

### Features

* **review:** add bounded-context reviewer agent ([26f4901](https://github.com/jgchk/music-downloader/commit/26f4901ffc23acc7378a6d05c966bb77a1dc895d))
* **web:** show the full download-through-import history on the acquisition page ([c103c3e](https://github.com/jgchk/music-downloader/commit/c103c3e1e3fe8c8bc1b6b229c023e31b5e393be6))
## [3.6.0](https://github.com/jgchk/music-downloader/compare/v3.5.4...v3.6.0) (2026-07-23)

### Features

* **web:** master-detail acquisitions view + panel/title-bar chrome ([26f683a](https://github.com/jgchk/music-downloader/commit/26f683aa1cad74eae92fa36959a0d2f7d6190f0d))
* **web:** swappable-skin theming — semantic shell, token layer, 3 skins, switcher ([cfb2ce1](https://github.com/jgchk/music-downloader/commit/cfb2ce1b4cc42eb28c811c0ae9ab3d09d2f0cb27))

### Bug Fixes

* **web:** address review — guard list read, wire active nav, dedupe skin list ([368497b](https://github.com/jgchk/music-downloader/commit/368497b0dff0ab8d637494640ce4d2002e9c61de))
## [3.5.4](https://github.com/jgchk/music-downloader/compare/v3.5.3...v3.5.4) (2026-07-23)

### Bug Fixes

* **web:** remove the dead 'Show reasons' disclosure from the acquisition badge ([513979c](https://github.com/jgchk/music-downloader/commit/513979c1bcebe7d0e2c0d14854827d98b4083965))
## [3.5.3](https://github.com/jgchk/music-downloader/compare/v3.5.2...v3.5.3) (2026-07-23)

### Bug Fixes

* **review:** address whole-codebase review findings across downloader/importer/web ([c6671a0](https://github.com/jgchk/music-downloader/commit/c6671a08df46f67caad360eaebf08ae184e5143e))
## [3.5.2](https://github.com/jgchk/music-downloader/compare/v3.5.1...v3.5.2) (2026-07-23)

### Bug Fixes

* **deps:** update dependency better-sqlite3 to v13 ([c7c26b0](https://github.com/jgchk/music-downloader/commit/c7c26b00ae542f05ccb824684d0f1d78e8ed0c06)), references [#88](https://github.com/jgchk/music-downloader/issues/88) [#83](https://github.com/jgchk/music-downloader/issues/83) [#84](https://github.com/jgchk/music-downloader/issues/84) [#85](https://github.com/jgchk/music-downloader/issues/85) [#87](https://github.com/jgchk/music-downloader/issues/87)
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
