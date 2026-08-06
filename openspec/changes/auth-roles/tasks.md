# Tasks — auth-roles

Every production edit follows red-first TDD: the failing test lands before the code, visible in
commit order. All work is in `packages/web` unless a task says otherwise.

## 1. The tightened membership predicate

- [x] 1.1 Extend `plexResourcesSchema` (red first): tolerant optional `provides` and `owned`
      fields; unit tests pin absent-field decoding and the real comma-list shapes.
- [x] 1.2 Replace the `some(clientIdentifier === machineId)` predicate (red first): membership
      requires the identifier match AND a trimmed, case-insensitive `provides` list containing
      `server`; tests cover the matching server, the matching non-server device (denied — the
      finding's attack shape), the multi-value list, and the absent `provides`.
- [x] 1.3 Timeboxed verification of the server-side forgery question (design Risks): consult
      plex.tv docs/community sources on whether a hostile PMS can register an arbitrary machine
      identifier; record the answer (and the account-id-pin fallback trigger, if live) in the
      design doc.

## 2. Role derivation and the session claim

- [x] 2.1 Widen the membership result (red first): the adapter returns the matched entry's role
      (`owned === true` ⇒ `owner`, else `guest`); tests pin owned-true, owned-false, and
      owned-absent derivations.
- [x] 2.2 Add the optional `role` claim to the session codec (red first): `SessionIdentity`
      carries it, `signSession` embeds it, decode defaults an absent claim to `guest`; tests pin
      the pre-role cookie decoding as guest and the round-trip of both roles.
- [x] 2.3 Thread the role through the login callback (red first): the minted session carries the
      derived role; callback tests assert the owner and guest paths end-to-end through the flow.

## 3. The authorize seam

- [x] 3.1 Create `lib/server/authz.ts` (red first): the closed `PrivilegedAction` union with
      `'system:redrive'` as its reserved first member, the `Record<PrivilegedAction, Role>`
      decision table, and `authorize(claims, action)` returning the permitted/refused value;
      tests pin guest-refused, owner-permitted, absent-role-refused, and decision determinism.
- [x] 3.2 Boundary check: confirm no route or component imports the decision table or branches
      on `role` directly — `authorize` is the only reader (grep-backed test or lint note per
      house convention).

## 4. Contract tier

- [x] 4.1 Widen the plextv recorder's projection to `provides` and `owned` (consumed-fields
      discipline; secret-scrub unchanged).
- [ ] 4.2 Re-record the owner-account fixture against live plex.tv so both new fields are
      witnessed; update the replay test to drive the real predicate to a grant carrying
      `role: owner`, and document in the contract test why the guest variant has no recorded
      fixture (unit-tier tolerant-default coverage instead).
      **PARTIAL — the re-record is a Jake handoff.** Done: the replay test drives the real
      predicate against the recording (fail-closed denial witnessed on wire data), the
      guest-variant absence is documented in the contract test, and the recorder refuses to write
      a listing with no server entry. Not done: the re-record itself — it needs an interactive
      plex.tv PIN approval on Jake's account (`pnpm tsx packages/web/test/contract/record/plextv.ts`).
      Until then the committed listing predates the `provides`/`owned` projection (its provenance
      note says so) and cannot witness the GRANT path; grant + role derivation are covered at the
      unit tier. The contract test's grant assertion becomes real the moment the fixture lands.

## 5. Gate and done

- [x] 5.1 Full gate (`pnpm check`) green; e2e harness cookie-minting updated for the new
      identity shape; local out-of-process e2e run passes.
- [ ] 5.2 Post-deploy manual verification (with Jake): owner login carries `owner`, a
      share-guest login still succeeds as `guest`, and pre-existing sessions behave as guests.
      **Jake handoff — requires real Plex credentials for both an owner and a share-guest
      account; no agent can complete it.** Everything verifiable without an interactive login
      (health, unauthenticated redirect behaviour, cookie shape) is covered by the e2e/contract
      tiers and the post-deploy verification.
