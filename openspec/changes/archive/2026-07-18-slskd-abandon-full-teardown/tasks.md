## 1. Verify slskd cancel/remove semantics (spike) — RESOLVED

- [x] 1.1 ~~Confirm slskd's `?remove=true` semantics.~~ **Resolved by reading slskd 0.22.5 source** (see design D1): `TransfersController.cs:82` calls `TryCancel` then a guarded `Remove`; `Remove` throws unless `State.HasFlag(Completed)` (`DownloadService.cs:598`) and is a soft delete (record only, no file touched); the cancel→`Completed, Cancelled` transition is async (`DownloadService.cs:372`). ⇒ a single `?remove=true` on an in-flight transfer cancels-but-doesn't-remove (and 500s); a two-step "cancel → poll-to-terminal → remove" is required. No live probe needed.

## 2. Confirm the source record is gone before marking the ledger removed (D1)

- [x] 2.1 Write failing tests in `download.test.ts` for `removeOwned`: after the `?remove=true` cancel pass over in-flight transfers, it re-polls the user's transfers and re-issues `?remove=true` for any of ours still present (now terminal), bounded; it `markRemoved`s a row **only** once its transfer is absent, and leaves a row live when the record cannot be confirmed gone. Cover: all-succeeded (removed first pass, no re-poll needed), mixed in-flight (cancel → re-poll → remove), and give-up-after-bound (row left live, no `markRemoved`).
- [x] 2.2 Implement the confirm-and-retry removal loop in `download.ts` `removeOwned`, keeping it best-effort (a source fault never fails a settled/abandoned outcome) and idempotent.
- [x] 2.3 Write failing tests for `SlskdResourceRemover.remove` (`resource-remover.test.ts`) applying the same confirm semantics for the sweep arm; implement so `sweep.ts` only marks a row removed once the record is confirmed gone (an unconfirmed row stays live for the next boot).

## 3. Clean the abandoned candidate's already-completed files (D2/D3)

- [x] 3.1 Write failing tests that `DownloadResult`'s `failed` variant carries the abandoned candidate's partial staged files, and that the adapter resolves the `Completed, Succeeded` subset of `mine` via the events resolver on the abandon / doomed-failure / abort paths and reports them.
- [x] 3.2 Implement the adapter change in `download.ts` (`abandon`, the `hasFailure` doom path, `doAbort`): resolve the completed subset's source-reported paths (reusing `resolveStagedPaths`) and put them on the failed outcome. Keep it best-effort (D3): a resolution error yields `failed` with no files, never an infra fault.
- [x] 3.3 Update `outbound-ports.ts` `DownloadResult` (`failed` gains `files?: readonly DownloadedFile[]`) and `commands.ts` `RecordDownloadFailed` (gains `files?`); write failing tests.
- [x] 3.4 Write failing `decide`/`state`/`acquisition.test.ts` cases: `decide` stamps the failed command's partial files onto the `CandidateRejected` minted in `rejectAndAdvance`, so `react`'s `Cleanup` carries them; fields additive/optional with an upcast default for legacy history.
- [x] 3.5 Implement 3.3–3.4 through `commands`/`decide`/`events`; keep the pure core I/O-free and the slskd adapter free of filesystem deletes.
- [x] 3.6 Update `interpreter.ts` to thread `result.files` from a failed download into `RecordDownloadFailed`; write failing tests.

## 4. E2E / contract fidelity

- [x] 4.1 Add an in-process (`composition/e2e.test.ts`) or out-of-process scenario for an abandoned multi-file candidate with a completed subset: assert the completed files are discarded from staging (no residue) and the failed outcome keeps its reason.
- [x] 4.2 Add a stub/assertion that an abandoned candidate's in-flight transfers are confirmed removed (no lingering `Completed, Cancelled` record) — the source double is queried for residual transfer records after teardown.

## 5. Gate

- [x] 5.1 Run `pnpm check` (format → lint → typecheck → build → test w/ 100% coverage) and resolve any gaps.
- [x] 5.2 Update `download.ts` / `resource-remover.ts` / adapter doc comments: teardown confirms record removal before marking the ledger, and an abandoned candidate's already-completed files are cleaned via the domain's `discardStaging`; note the sweep as the backstop for unconfirmed removals.
