# Tasks — auth-roles

Every production edit follows red-first TDD: the failing test lands before the code, visible in
commit order. All work is in `packages/web` unless a task says otherwise.

## 1. The tightened membership predicate

- [ ] 1.1 Extend `plexResourcesSchema` (red first): tolerant optional `provides` and `owned`
      fields; unit tests pin absent-field decoding and the real comma-list shapes.
- [ ] 1.2 Replace the `some(clientIdentifier === machineId)` predicate (red first): membership
      requires the identifier match AND a trimmed, case-insensitive `provides` list containing
      `server`; tests cover the matching server, the matching non-server device (denied — the
      finding's attack shape), the multi-value list, and the absent `provides`.
- [ ] 1.3 Timeboxed verification of the server-side forgery question (design Risks): consult
      plex.tv docs/community sources on whether a hostile PMS can register an arbitrary machine
      identifier; record the answer (and the account-id-pin fallback trigger, if live) in the
      design doc.

## 2. Role derivation and the session claim

- [ ] 2.1 Widen the membership result (red first): the adapter returns the matched entry's role
      (`owned === true` ⇒ `owner`, else `guest`); tests pin owned-true, owned-false, and
      owned-absent derivations.
- [ ] 2.2 Add the optional `role` claim to the session codec (red first): `SessionIdentity`
      carries it, `signSession` embeds it, decode defaults an absent claim to `guest`; tests pin
      the pre-role cookie decoding as guest and the round-trip of both roles.
- [ ] 2.3 Thread the role through the login callback (red first): the minted session carries the
      derived role; callback tests assert the owner and guest paths end-to-end through the flow.

## 3. The authorize seam

- [ ] 3.1 Create `lib/server/authz.ts` (red first): the closed `PrivilegedAction` union with
      `'system:redrive'` as its reserved first member, the `Record<PrivilegedAction, Role>`
      decision table, and `authorize(claims, action)` returning the permitted/refused value;
      tests pin guest-refused, owner-permitted, absent-role-refused, and decision determinism.
- [ ] 3.2 Boundary check: confirm no route or component imports the decision table or branches
      on `role` directly — `authorize` is the only reader (grep-backed test or lint note per
      house convention).

## 4. Contract tier

- [ ] 4.1 Widen the plextv recorder's projection to `provides` and `owned` (consumed-fields
      discipline; secret-scrub unchanged).
- [ ] 4.2 Re-record the owner-account fixture against live plex.tv so both new fields are
      witnessed; update the replay test to drive the real predicate to a grant carrying
      `role: owner`, and document in the contract test why the guest variant has no recorded
      fixture (unit-tier tolerant-default coverage instead).

## 5. Gate and done

- [ ] 5.1 Full gate (`pnpm check`) green; e2e harness cookie-minting updated for the new
      identity shape; local out-of-process e2e run passes.
- [ ] 5.2 Post-deploy manual verification (with Jake): owner login carries `owner`, a
      share-guest login still succeeds as `guest`, and pre-existing sessions behave as guests.
