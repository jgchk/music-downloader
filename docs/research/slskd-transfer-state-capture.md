# Deterministically capturing real slskd transfer states for contract fixtures — live network, local lab, or hybrid

**Question.** The downloader's contract tier replays fixtures recorded from a live slskd, but the
only recorded transfer is `Completed, Succeeded`. The consumed failure/queue vocabulary — the
compound `state` strings, the `exception` text, `placeInQueue`, and enqueue-rejection response
bodies — has never been witnessed from a real slskd; hand-written stubs calibrate the production
classifier instead (a substring matcher with a prod misclassification history). How do we capture
the missing states deterministically: (1) opportunistic capture against the live Soulseek network,
(2) a local lab (an open-source Soulseek server + controlled slskd peers in Docker), or (3) a
hybrid? The team leans lab-if-viable — that is a leaning, not a conclusion; this doc gathers the
evidence.

**Method.** Research date 2026-08-05 (all URLs accessed that day unless noted). Primary sources
were read as source code, not summaries: shallow clones of [slskd](https://github.com/slskd/slskd)
(master @ `43a4ff6` **and** the tag `0.22.5` matching the deployed instance),
[Soulseek.NET](https://github.com/jpdillingham/Soulseek.NET) (master @ `ae0f906` **and** tag
`7.0.3`, the version slskd 0.22.5 pins), and
[soulfind](https://github.com/soulfind-dev/soulfind) (HEAD `f196bcd`, 2026-08-05); plus this
repo's adapter/recorder/contract-tier source (file:line); plus the Nicotine+ protocol document and
GitHub code/issue search for prior art. Claims verifiable only second-hand are marked
**[secondary]**; sources that came back empty or unreachable are named as such (the
raw.githubusercontent fetch of `TransferStates.cs` 404'd — the enum was read from the clone
instead; Nicotine+'s DEVELOPING page turned out not to mention soulfind — the endorsement lives in
its protocol doc). Sources are collected at the end. Nothing here is normative until it lands in
an OpenSpec change.

---

## 1. What the adapter consumes, and what the fixtures currently witness

The consumed transfer vocabulary is small and entirely string-shaped
(`packages/downloader/src/adapters/slskd/transfers.ts`):

- `statusOf(state)` (L26–33): substring match on the lowercased `state` — `completed` +
  `succeeded` → succeeded, `completed` without it → failed, `queued` → queued, else transferring.
- `reasonFromTransfer` (L50–57): substring match on **`state` + `exception` concatenated** —
  `cancel` → `Cancelled`, `reject` → `FileUnavailable`, `offline`/`unavailable` →
  `PeerUnavailable`, `timed` → `Stalled`, else `TransferError`.
- `enqueueRejectionReason(body)` (L65–71): substring match on the enqueue rejection body —
  `connect`/`offline`/`unavailable` → `PeerUnavailable`, else `TransferError`.
- `aggregate` (L86–107): reads `placeInQueue` off the polled transfers.

The contract schema (`src/adapters/slskd/schemas.ts`, `slskdTransferSchema`) pins `id`,
`filename`, `state`, `size`, `bytesTransferred`, `placeInQueue`, `exception`. The one recorded
transfer fixture (`test/contract/fixtures/slskd/transfers-poll.json`, produced by
`test/contract/record/slskd.ts`) captures a healthy download; the recorder's own doc comment
(record/slskd.ts L86–92) documents that `events.json` is **coupled** to `transfers-poll.json` by
`transfer.id` and must be re-recorded as one set with the search and enqueue captures.

What the unit stubs meanwhile assert against (grep of `transfers.test.ts` + `download.test.ts`):
`InProgress` ×40, `Completed, Succeeded` ×12, `Completed, Errored` ×11, `Queued, Remotely` ×6,
`Completed, Cancelled` ×5, **`Completed, Rejected` ×2, `Completed, TimedOut` ×1**. Section 3 shows
the last two model states the deployed slskd pairing never serves terminally.

## 2. The state vocabulary, from source

### 2.1 The enum and its serialization

`state` is Soulseek.NET's `TransferStates`, a `[Flags]` enum
([`src/TransferStates.cs`](https://github.com/jpdillingham/Soulseek.NET/blob/master/src/TransferStates.cs)):
`None=0, Requested=1, Queued=2, Initializing=4, InProgress=8, Completed=16, Succeeded=32,
Cancelled=64, TimedOut=128, Errored=256, Rejected=512, Aborted=1024, Locally=2048, Remotely=4096`.
The enum's own remark: *"The Completed state will be accompanied by one other flag consisting of
Succeeded, Cancelled, TimedOut or Errored."* slskd registers `JsonStringEnumConverter`
(`src/slskd/Program.cs` L980), so the API serializes the flags with .NET's standard
comma-space join — exactly the `"Completed, Succeeded"`, `"Queued, Remotely"` phrasings the
adapter matches on. The already-recorded fixture confirms the format for the success case.

### 2.2 The download lifecycle (Soulseek.NET 7.0.3, as pinned by slskd 0.22.5)

From `SoulseekClient.cs` @ tag 7.0.3: a download's `stateChanged` fires
`Queued, Locally` (L3139, momentary, before the peer is asked) → `Requested` (L3162) →
`Queued, Remotely` (L3176/L3199, when the peer defers) *or* `Initializing` (L3182/L3215, when the
peer starts immediately) → `InProgress` (L3282) → terminal `Completed | <disposition>` fired from
the catch/finally chain (L3322–3420):

| Library exception | Disposition flag | Exception message shape |
| --- | --- | --- |
| `TransferRejectedException` | `Rejected` | `"Transfer rejected: {peer message}"` (L3194) |
| `TransferSizeMismatchException` | `Aborted` | size mismatch text |
| `OperationCanceledException` | `Cancelled` | .NET's default cancellation text |
| `TimeoutException` | `TimedOut` | "...timed out..." text |
| anything else | `Errored` | wrapped as `"Failed to download file {f} from user {u}: {inner}"` |
| `UserOfflineException` | (thrown before transfer starts) | `"User {username} appears to be offline"` (L3585) |

### 2.3 What slskd 0.22.5 persists — and the collapse that matters

slskd's `DownloadService` (tag 0.22.5, `src/slskd/Transfers/Downloads/DownloadService.cs`)
persists every `stateChanged` via `WithSoulseekTransfer` (state + `exception = ex?.Message`,
`Extensions.cs` L22–41) — **and then its own catch overwrites the terminal record** (L370–397):

- `catch (OperationCanceledException)` → `State = Completed | Cancelled`, `Exception = ex.Message`;
- `catch (Exception)` → `State = Completed | Errored`, `Exception = ex.Message` — **for every
  other failure**: rejections, timeouts, size mismatches, peer deaths, offline users.

So on the deployed pairing (slskd 0.22.5 + Soulseek.NET 7.0.3), the *terminal* states the REST API
can serve for downloads are exactly three: `Completed, Succeeded`, `Completed, Cancelled`,
`Completed, Errored`. `Completed, Rejected` / `Completed, TimedOut` / `Completed, Aborted` exist
only as a transient race (persisted by the library's `stateChanged` for the instants before
slskd's catch overwrites the row). All failure *differentiation* on 0.22.5 therefore lives in the
`exception` text, which is where the classifier's `reject`/`offline`/`timed` substrings do their
real work — and why the two `Completed, Rejected` and one `Completed, TimedOut` unit stubs encode
a provenance the deployed provider cannot produce.

### 2.4 `placeInQueue` is pull, not push

`Transfer.PlaceInQueue` (slskd `Transfers/Types/Transfer.cs`; the field even carries the remark
*"May be wildly innacurate to the point of uselessness"*) is `null` until something calls
`GET /api/v0/transfers/downloads/{username}/{id}/position`, which asks the peer, writes the value
into the row, and persists it (`DownloadService.GetPlaceInQueueAsync`, 0.22.5 L475–500). Only
after that does the poll payload carry `placeInQueue`. The adapter never calls the position
endpoint — it only reads the field off the poll — so in production the field is populated only if
some other client of the same slskd (e.g. its web UI) has asked. A fixture with a non-null
`placeInQueue` **must** include the position call in the recording scenario.

### 2.5 Cancel and remove semantics

`DELETE /api/v0/transfers/downloads/{username}/{id}?remove=false` (0.22.5 controller L66–97) calls
`TryCancel` → `cts.Cancel()` → the library throws `OperationCanceledException` → the row lands in
`Completed, Cancelled` and **stays visible in subsequent polls**. With `?remove=true` the
controller additionally calls `Remove(guid)`, which throws unless the row already has the
`Completed` flag (0.22.5 L594–600) — matching the adapter's documented cancel-then-remove
discipline (`transfers.ts` L36–42). Cancellation is fully API-driven: no peer cooperation needed.

### 2.6 The enqueue rejection body

`POST /api/v0/transfers/downloads/{username}` (0.22.5 controller L205–225) wraps
`EnqueueAsync`; any failure surfaces as **HTTP 500 with `ex.Message` as the body**. Two
deterministic flavors:

- **Peer rejects the file**: slskd's upload side answers a queue request for an unshared file with
  `DownloadEnqueueException("File not shared.")` (0.22.5 `UploadService.cs` L256); the
  downloading side throws `TransferRejectedException("Transfer rejected: File not shared.")`,
  collected into an `AggregateException` whose message becomes the 500 body
  (`DownloadService` L404–434). A transfer row is also created and ends `Completed, Errored` with
  that exception text — one scenario yields both the rejection body **and** a failed-transfer poll.
- **Peer offline**: `EnqueueAsyncInternal` calls `ConnectToUserAsync` *before* creating any rows
  (L207–208), so an offline peer produces a 500 body containing
  `"User {username} appears to be offline"` and **no** transfer record.

Both bodies hit the classifier's substrings (`reject` → `FileUnavailable`; `offline`/`connect` →
`PeerUnavailable`).

## 3. Version drift: the vocabulary is moving

The deployed instance is 0.22.5; upstream is at 0.26.0. Release notes and master source show the
transfer machinery being rebuilt in exactly the area we consume **[secondary for the notes; the
master code was read directly]**:

- 0.23.0 — transfers DB migrations; Soulseek.NET bump to 7.1.0.
- 0.24.0 — enqueue/download split, "resolving 'stuck' and failing transfers".
- 0.26.0 — **failed download retries**: master's `Transfer` gains `Attempts`/`NextAttemptAt`;
  downloads now *start* as `Queued, Locally` (master `DownloadService.cs` L487), failed attempts
  are mapped `OperationCanceledException → Cancelled, TimeoutException → TimedOut, else Errored`
  (L1063–1067 — note `TimedOut` **is** now a terminal download state), and a failed transfer can
  transition *back* to `Queued, Locally` for retry (L1223–1227) — a terminal-then-not-terminal
  pattern the current adapter (`isTransferComplete` = has `Completed` flag) has never seen.

Consequence: fixtures are only meaningful **per pinned slskd version** (the contract tier already
pins 0.22.5 via `test/contract/slskd-spec/provenance.json`), and a lab makes re-recording the
whole set against a new version a command, not an expedition — which the 0.26 upgrade will
require.

## 4. Option 1 — opportunistic live capture (steelman)

The current recorder's approach, extended. Its honest strengths: zero new infrastructure; the
captured peers are *real* heterogeneous clients (Nicotine+, SoulseekQt, slskd…), so exception
texts reflect the true wire diversity; the existing sanitize/projection discipline
(`record/slskd.ts`) already handles the PII problem. What it can and cannot get:

- `Completed, Cancelled` — **deterministic**: enqueue, wait for any non-terminal poll, DELETE
  without `remove`, poll again (§2.5). No peer cooperation needed.
- `Queued, Remotely` (+ `placeInQueue`) — **a timing race**: poll immediately after enqueue and
  hope the chosen peer's slots are busy; must also call the position endpoint (§2.4). Retry-loop
  over candidate peers makes it *likely* but never guaranteed.
- Errored / rejected / offline / enqueue-rejection — **not orchestratable**: they require a peer
  to misbehave on cue. Capturable only by luck or by deliberately requesting from flaky peers,
  with unbounded runtime. These remain documented gaps under this option.
- Every capture keeps the full PII-scrub burden (real usernames, share tokens) and consumes real
  peers' bandwidth/queue slots — repeated failure-hunting runs are impolite to the network.

## 5. Option 2 — the local lab

### 5.1 Is soulfind alive and viable? Yes.

- **Maintenance**: active — commits on the research date itself (`f196bcd`, 2026-08-05); ~589 of
  the recent commits are by `mathiascode`, the lead Nicotine+ maintainer (GitHub contributors
  API), i.e. the people with the strongest incentive to keep a test server protocol-accurate.
- **Stated purpose**: the README opens with *"Note that Soulfind exists for local testing, and
  should not be used in production."* — this is exactly the local-testing use case.
- **Client-side endorsement**: Nicotine+'s protocol documentation: *"If you want a Soulseek
  server, Soulfind is an open source implementation… It handles the protocol well enough for
  development and testing of client implementations."* (`doc/SLSKPROTOCOL.md` L315–318).
- **Docker**: official image `ghcr.io/soulfind-dev/soulfind` (scratch-based, port 2242); config in
  a SQLite db managed by the bundled `soulsetup` CLI.
- **Registration**: open by default — an unknown username is auto-registered at first login
  (`src/server/user.d` L136–180; `default_private_mode = false` in `src/defines.d` L18), so the
  two slskd instances just log in with invented credentials.
- **Protocol coverage** (read from `src/server/messages.d` / `msghandler.d`): everything slskd
  needs — `Login(1)`, `SetWaitPort(2)`, `GetPeerAddress(3)`, `ConnectToPeer(18)` +
  `CantConnectToPeer(1001)` (indirect-connection brokering), `FileSearch(26)`,
  `SharedFoldersFiles(35)`, `SetStatus(28)`, and the distributed-network login parameters
  (`HaveNoParent(71)`, `ParentMinSpeed(83)`, `ParentSpeedRatio(84)`, `WishlistInterval(104)`).
  Unimplemented codes are logged and ignored, not fatal (`msghandler.d` L779–786). On the client
  side, Soulseek.NET's connect hard-waits only for the `LoginResponse`
  (`ConnectInternalAsync`) — no other server message gates login.
- **Peering on a LAN**: soulfind reports each peer's server-observed address for
  `GetPeerAddress`, which on a compose network is the container IP — mutually routable — and
  brokers `ConnectToPeer` for the indirect path. Search distribution is server-fanned (soulfind
  sends `FileSearch` to connected users directly), so no distributed-network tree is required.
- **The gap**: I found **no documented instance of slskd specifically running against
  soulfind** — not in slskd's repo/issues, not in soulfind's issues (one unrelated hit), not via
  GitHub code search. The protocol-level analysis above says it should work, and soulfind's
  maintainers test *clients* against it routinely, but slskd-on-soulfind is unwitnessed prior
  art. Budget a smoke test (login + search + one transfer) before committing the lab design.

### 5.2 Alternatives considered

- **slskd's own test infrastructure**: no help. `slskd.Tests.Unit` mocks `ISoulseekClient`;
  Soulseek.NET's `Soulseek.Tests.Integration` logs into the **real** network with env credentials
  and tests connectivity only — neither provokes failure states end-to-end. There is no
  slskd-maintained docker lab.
- **Other server implementations**: [bh90210/soul](https://github.com/bh90210/soul) (Go) includes
  a mock server aimed at protocol unit tests, not a runnable multi-client daemon **[secondary —
  README only]**; aeyoll/slsk-rs and michel/soulseek-rs are client libraries. Soulfind is the only
  maintained, runnable, Dockerized server.
- **Cross-client interop prior art**: the slskr/slskdN fork family ships a
  `run-slskdn-cross-client-interop.sh` harness (two clients + API-driven transfer assertions), but
  it targets the **live** server (`vps.slsknet.org` default) — useful as a shape precedent, not a
  soulfind lab **[secondary]**.
- **Nicotine+ as an extra peer**: its rejection strings differ from slskd's (peer-dependent
  `TransferRejectedException` messages travel over the wire), so a headless Nicotine+ container
  could later widen the witnessed `exception` vocabulary. Not needed for the first pass.

### 5.3 Lab topology

```yaml
# test/contract/lab/compose.yaml (sketch — names illustrative)
services:
  soulfind:
    image: ghcr.io/soulfind-dev/soulfind      # Soulseek server, port 2242
    volumes: [soulfind-data:/data]
  peer: # upload-side slskd, the controlled counterparty
    image: slskd/slskd:0.22.5                 # pin = deployed version (provenance.json)
    environment:
      - SLSKD_SLSK_ADDRESS=soulfind
      - SLSKD_SLSK_PORT=2242
      - SLSKD_SLSK_USERNAME=peer1             # auto-registered by soulfind on first login
      - SLSKD_SLSK_PASSWORD=…
      - SLSKD_SHARED_DIR=/music               # seeded flac corpus (a real, non-infringing file)
      - SLSKD_UPLOAD_SLOTS=1                  # min is 1 (Range(1,∞)) — 0 is not configurable
      - SLSKD_UPLOAD_SPEED_LIMIT=1            # 1 KiB/s floor → hours-long InProgress window
    volumes: [./corpus:/music:ro]
  sut: # download-side slskd — the instance the recorder points at
    image: slskd/slskd:0.22.5
    environment:
      - SLSKD_SLSK_ADDRESS=soulfind
      - SLSKD_SLSK_PORT=2242
      - SLSKD_SLSK_USERNAME=sut
      - SLSKD_SLSK_PASSWORD=…
      # + web.authentication.api_keys via config for the recorder
```

The recorder (an extended `record/slskd.ts` given `SLSKD_BASE_URL` = the `sut` container) then
orchestrates per target state — every step is an existing consumed API call except the position
endpoint and `docker` verbs:

1. **Queued + placeInQueue**: enqueue big file A from `peer` (fills the single slot; at 1 KiB/s a
   100 MiB file holds it for ~28 h), enqueue file B → B polls as `Queued, Remotely`; call
   `GET …/downloads/peer1/{idB}/position`; re-poll → `placeInQueue` present (§2.4).
2. **Cancelled**: `DELETE …/downloads/peer1/{idA}?remove=false` mid-`InProgress`; poll →
   `Completed, Cancelled` (§2.5).
3. **Enqueue rejection + errored transfer**: `POST …/downloads/peer1` naming a filename `peer`
   does not share → 500 body `…Transfer rejected: File not shared.…` **and** a
   `Completed, Errored` row with that `exception` (§2.6).
4. **Peer offline**: `docker stop peer`; `POST …/downloads/peer1` → 500 body
   `User peer1 appears to be offline` (§2.6).
5. **Errored mid-transfer**: restart `peer`, begin a slow transfer, `docker kill peer` →
   `Completed, Errored` with a connection-flavored `exception`.
6. *(Optional, experimental)* **stall/timeout text**: `docker pause peer` mid-transfer and wait
   out the inactivity timeout → `Completed, Errored` with "timed out" text (the `Stalled`
   calibration). Timing behavior unverified — treat as an experiment, not a promise.

Fixtures come out with invented usernames (`peer1`, `sut`) and a corpus we control — the PII
scrub reduces to the existing share-token normalization, and the whole set (search → enqueue →
polls → events → rejections) is re-recordable as one coupled session, preserving the
`events.json` ↔ `transfers-poll.json` `transfer.id` coupling (recorder doc, L86–92). Note the
success-path capture must still complete one real (small-file) download so `DownloadFileComplete`
appears in `events.json`; failure scenarios emit no such event.

### 5.4 What the lab still cannot produce

- `Completed, TimedOut` / `Completed, Rejected` / `Completed, Aborted` as **terminal** download
  states — but on 0.22.5 that is fidelity, not a gap: the provider itself cannot serve them
  (§2.3). The right response is to correct the stubs, not to chase the states. (On ≥0.26,
  `TimedOut` becomes reachable and the lab can chase it after the upgrade.)
- The **full diversity of real peers' exception texts** (other client implementations word their
  rejections differently). Lab peers are slskd, so the witnessed vocabulary is slskd-peer-shaped;
  live capture or a Nicotine+ peer container would widen it.
- Genuine network pathologies (NAT-failed indirect connections, half-open sockets at internet
  latency). Out of scope for state-vocabulary fixtures.

## 6. Option 3 — hybrid

Given §5, the hybrid nearly collapses into "lab": every target fixture on the list is
lab-orchestratable, and the states the lab can't produce are ones the deployed provider can't
serve either. The live network retains two roles: (a) the already-shipped success-path recording
discipline (real search responses from hundreds of heterogeneous peers are themselves contract
data the lab cannot fake at scale), and (b) periodically widening the witnessed `exception`
vocabulary from non-slskd peers. Hand-written stubs stay only as *schema-gated* placeholders for
vocabulary a **newer** pinned slskd is known (from source) to emit before the deployment catches
up — each carrying a source citation, in the spirit of the existing spec-snapshot tier.

## Verdict

**The evidence supports Option 2 (lab) as the primary mechanism, with Option 1 retained only for
the roles the lab can't play (heterogeneous search responses, peer-text diversity) — i.e. a
hybrid whose center of gravity is the lab.** Concretely:

1. **Soulfind is viable**: actively maintained (commits the day of research) by the Nicotine+
   lead, explicitly built for local client testing, officially Dockerized, open-registration by
   default, and covers every server message slskd's login and transfer flows need. The one
   unknown — no documented slskd↔soulfind pairing anywhere — is bounded by a one-session smoke
   test; if that fails, fall back to Option 1 for `Cancelled`/`Queued` and schema-gated stubs for
   the rest (the documented last resort).
2. **Topology**: `soulfind` + two pinned `slskd/slskd:0.22.5` (`peer` with `UPLOAD_SLOTS=1`,
   `UPLOAD_SPEED_LIMIT=1`, seeded read-only corpus; `sut` fronting the recorder), one compose
   network — §5.3, with the six orchestration recipes.
3. **Fixture set**: queued-with-placeInQueue, cancelled, errored-with-rejection-text,
   enqueue-rejection body ("File not shared."), offline-rejection body ("appears to be offline"),
   errored-by-peer-death — all deterministic; stall-text as an experiment.
4. **Correct the stubs while at it**: on the deployed pairing, terminal download states are only
   `Succeeded`/`Cancelled`/`Errored`; the `Completed, Rejected` and `Completed, TimedOut` stubs
   describe an impossible provenance, and the classifier's real inputs are `exception` texts. Any
   stub kept (e.g. for ≥0.26 vocabulary) should be schema-gated and cite the provider source line
   it models.
5. **Uncapturable per option** — live: rejected/errored/offline/enqueue-rejection (peer-dependent,
   unbounded); lab: non-slskd peer wording, true network pathologies, and (until the 0.26 upgrade)
   nothing that matters; stubs: everything, which is the problem.

**Pitfall checklist** for the implementation change:

- [ ] Smoke-test slskd 0.22.5 login + search + transfer against soulfind before building the
      recorder extension (the unwitnessed-prior-art risk).
- [ ] Pin lab slskd to the deployed version from `test/contract/slskd-spec/provenance.json`;
      re-record the **whole coupled set** (search → enqueue → polls → events) per version bump —
      never `events.json` alone (recorder L86–92).
- [ ] `placeInQueue` requires the `/position` call in the scenario — a poll alone will show
      `null` (§2.4); the position endpoint is a **new consumed operation** only if the recorder's
      calls count as consumption — keep it out of the manifest if only the recorder uses it, or
      add it deliberately.
- [ ] `UPLOAD_SLOTS` has a floor of 1 (`Range(1, int.MaxValue)`) — "zero slots" is achieved by
      occupying the single slot with a slow transfer, not by configuration.
- [ ] The 500 enqueue-rejection body is an exception **message string** (AggregateException
      wording included) — capture it verbatim; don't normalize it into JSON.
- [ ] Failure fixtures contain `exception` texts with usernames (`"User peer1 appears to be
      offline"`) — invented lab names make this safe, but keep the sanitize pass anyway so a
      future live re-record can't leak.
- [ ] Docker-on-this-host: the e2e tier's NAT kernel-module caveat applies to any new compose
      network (`modprobe -a nf_nat iptable_nat xt_MASQUERADE …`).
- [ ] Don't point the lab recorder at the production slskd (192.168.1.238:5030) — the recipes
      stop containers and poison the transfer list.
- [ ] On the 0.26 upgrade: expect `Queued, Locally`, terminal `Completed, TimedOut`,
      retry-induced `Completed → Queued, Locally` transitions, and `Attempts`/`NextAttemptAt`
      fields — re-run the lab against the new pin before trusting the classifier.

## Sources

**This repo** (read 2026-08-05):

- `packages/downloader/src/adapters/slskd/transfers.ts` (consumed vocabulary; L26–33, L36–57, L65–71, L86–107)
- `packages/downloader/src/adapters/slskd/schemas.ts` (`slskdTransferSchema`)
- `packages/downloader/test/contract/record/slskd.ts` (recorder; coupling note L86–92)
- `packages/downloader/test/contract/README.md` (tier design, spec snapshot, re-record procedure)
- `packages/downloader/src/adapters/slskd/{transfers,download}.test.ts` (stub state inventory)

**slskd** ([github.com/slskd/slskd](https://github.com/slskd/slskd), clone; tag `0.22.5` = deployed, master @ `43a4ff6`):

- [`src/slskd/Transfers/Downloads/DownloadService.cs` @ 0.22.5](https://github.com/slskd/slskd/blob/0.22.5/src/slskd/Transfers/Downloads/DownloadService.cs) — enqueue flow L200–445; terminal-catch collapse L370–397; `GetPlaceInQueueAsync` L475–500; `Remove` completed-guard, `TryCancel` L619–625
- [`src/slskd/Transfers/API/Controllers/TransfersController.cs` @ 0.22.5](https://github.com/slskd/slskd/blob/0.22.5/src/slskd/Transfers/API/Controllers/TransfersController.cs) — DELETE `?remove` L66–97; POST → 500 `ex.Message` L205–225; GET grouping L265–294; `/position` L331+
- [`src/slskd/Transfers/Uploads/UploadService.cs` @ 0.22.5](https://github.com/slskd/slskd/blob/0.22.5/src/slskd/Transfers/Uploads/UploadService.cs) — `"File not shared."` L256
- [`src/slskd/Core/Options.cs` @ 0.22.5](https://github.com/slskd/slskd/blob/0.22.5/src/slskd/Core/Options.cs) — `SLSK_ADDRESS`/`SLSK_PORT` (default `vps.slsknet.org:2271`), `SHARED_DIR`, `UPLOAD_SLOTS` `Range(1,∞)`, `UPLOAD_SPEED_LIMIT`, listen port 50300
- `src/slskd/Program.cs` L980 (`JsonStringEnumConverter`); `src/slskd/Transfers/Types/Transfer.cs` (fields; `PlaceInQueue` remark; master adds `Attempts`/`NextAttemptAt`)
- master `DownloadService.cs` L487, L1063–1067, L1223–1227 (0.26 state machine); `Transfers/Types/TransferStateCategories.cs`
- Releases [0.23.0](https://github.com/slskd/slskd/releases/tag/0.23.0), [0.24.0](https://github.com/slskd/slskd/releases/tag/0.24.0), [0.26.0](https://github.com/slskd/slskd/releases/tag/0.26.0) **[secondary — release-note prose]**

**Soulseek.NET** ([github.com/jpdillingham/Soulseek.NET](https://github.com/jpdillingham/Soulseek.NET), clone; tag `7.0.3` = slskd 0.22.5's pin, master @ `ae0f906`):

- [`src/TransferStates.cs`](https://github.com/jpdillingham/Soulseek.NET/blob/master/src/TransferStates.cs) — the `[Flags]` enum and its Completed-disposition remark
- `src/SoulseekClient.cs` @ 7.0.3 — lifecycle L3139–3282; terminal catches L3322–3420; `"Transfer rejected: {message}"` L3194; `"User {username} appears to be offline"` L3585; `ConnectInternalAsync` login wait
- `tests/Soulseek.Tests.Integration/Settings.cs` — live-network creds via env; connectivity-scope only

**soulfind** ([github.com/soulfind-dev/soulfind](https://github.com/soulfind-dev/soulfind), clone @ `f196bcd`, 2026-08-05):

- `README.md` ("exists for local testing"; `ghcr.io/soulfind-dev/soulfind`; port 2242; `soulsetup`)
- `src/server/user.d` L136–180 (auto-registration; `SVRPRIVATE`); `src/defines.d` (`default_port 2242`, `default_private_mode false`)
- `src/server/messages.d` (message coverage incl. codes 1, 2, 3, 18, 26, 28, 35, 71, 83, 84, 104, 1001); `src/server/msghandler.d` L779–786 (unknown codes ignored)
- `Dockerfile`; contributors via GitHub API (`mathiascode` 589 commits)

**Prior art & ecosystem:**

- Nicotine+ [`doc/SLSKPROTOCOL.md`](https://github.com/nicotine-plus/nicotine-plus/blob/master/doc/SLSKPROTOCOL.md) L315–318 (soulfind endorsement; quoted §5.1). Its [DEVELOPING page](https://nicotine-plus.org/doc/DEVELOPING.html) does **not** mention soulfind (checked).
- [snapetech/slskr `scripts/run-slskdn-cross-client-interop.sh`](https://github.com/snapetech/slskr) — two-client interop harness, live-server default **[secondary; fork ecosystem]**
- [bh90210/soul](https://github.com/bh90210/soul) — Go protocol impl with mock-server aims **[secondary — README]**
- GitHub code/issue search (2026-08-05): no soulfind mentions in slskd or Soulseek.NET repos; one unrelated soulfind issue mentioning slskd; `fiso64/slsk-batchdl` contains no soulfind usage.

---

*These findings are input to a design decision, not normative for the codebase. They become
binding only when adopted into an OpenSpec change under `openspec/changes/`.*
