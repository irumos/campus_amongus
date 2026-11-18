# Campus Among Us IRL — Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Strict Role Privacy**: Public room state (`rooms/{roomCode}`) NEVER stores `role`, `fellowImpostors`, `assignedStations`, or `completedStations`. Roles live exclusively in `rooms/{roomCode}/privateRoles/{badgeId}`.
2. **Per-Wristband Read Isolation**: A verified user may `get` only `rooms/{roomCode}/privateRoles/{badgeId}` where `rooms/{roomCode}.badgeOwners[badgeId] == request.auth.uid`. Collection `list` on `privateRoles` is unconditionally denied (`allow list: if false;`).
3. **Immutable Host & Ownership Integrity**: `rooms/{roomCode}.hostUid` is set to `request.auth.uid` on room creation and cannot be mutated by updates. Only verified users (`request.auth != null && request.auth.token.email_verified == true`) can read or mutate room state.
4. **Atomic Match Start**: Creating or reassigning `privateRoles/{badgeId}` documents is restricted to the room host and verified via `getAfter(/databases/$(database)/documents/rooms/$(roomCode)).data.status == 'PLAYING'` to guarantee batch atomicity with `startMatch`.
5. **Bounded Payloads & Strict Schemas**: Every document write validates required keys, allowed keys (`hasOnly`), string length bounds, numeric ranges (`0 <= taskProgress <= 100`), regex-hardened path IDs (`roomCode` and `badgeId`), and server timestamp (`updatedAt == request.time`).
6. **Terminal State Lock**: Once `rooms/{roomCode}.status == 'ENDED'`, regular gameplay updates are rejected; only the room host can reset the room back to `'LOBBY'`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Room Read**: `auth = null`, `get /rooms/SVCE` -> `PERMISSION_DENIED`.
2. **Role Collection List Scraping**: Authenticated player attempts `list /rooms/SVCE/privateRoles` -> `PERMISSION_DENIED`.
3. **Cross-Player Role Peek**: Player owning `P07` attempts `get /rooms/SVCE/privateRoles/P03` -> `PERMISSION_DENIED`.
4. **Shadow Role Field in Public Room**: Host or player writes `roles: { P07: 'IMPOSTOR' }` inside `/rooms/SVCE` -> `PERMISSION_DENIED` (blocked by `hasOnly`).
5. **Self-Promotion / Role Tampering**: Player owning `P07` updates `privateRoles/P07` changing `role` from `'CREWMATE'` to `'IMPOSTOR'` -> `PERMISSION_DENIED`.
6. **Host Hijack**: Non-host player updates `/rooms/SVCE` changing `hostUid` to their own UID -> `PERMISSION_DENIED`.
7. **Orphaned PrivateRole Write Without Batch**: Host attempts to write `privateRoles/P07` while room remains in `'LOBBY'` (outside `startMatch` batch) -> `PERMISSION_DENIED` (blocked by `getAfter(...).data.status == 'PLAYING'`).
8. **Out-of-Bounds Task Progress**: Player updates `taskProgress: 999` or `-5` -> `PERMISSION_DENIED`.
9. **Resource Exhaustion / ID Poisoning**: Client writes `/rooms/${'A'.repeat(200)}` or `/rooms/SVCE/privateRoles/BAD_ID` -> `PERMISSION_DENIED`.
10. **Client Timestamp Forgery**: Client updates `/rooms/SVCE` with `updatedAt: 123456` instead of `serverTimestamp()` (`request.time`) -> `PERMISSION_DENIED`.
11. **Invalid Station Injection**: Player writes `completedStations: ['FAKE_ROOM']` not present in `assignedStations` -> `PERMISSION_DENIED`.
12. **Post-Game Mutation After Terminal State**: Non-host player attempts to mutate `winner` or `players` after `rooms/SVCE.status == 'ENDED'` -> `PERMISSION_DENIED`.
