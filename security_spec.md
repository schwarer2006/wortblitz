# WortBlitz Firestore Security Specification

## 1. Data Invariants
1. **Room Ownership & Lifecycle**: A room `/rooms/{roomId}` can only be created by an authenticated user whose `uid` matches `hostUid`, with `status == 'LOBBY'` and `code == roomId` (4 digits). Once `status == 'GAME_OVER'`, state transitions are locked unless reset by the host.
2. **Player Ownership**: A player document `/rooms/{roomId}/players/{playerId}` can only be created or updated by the user whose `request.auth.uid == playerId`, and `uid` must be immutable.
3. **Secret Lobby Themes**: A secret theme `/rooms/{roomId}/secretThemes/{themeId}` can only be read by its author (`uid == request.auth.uid`) or the room's host (`hostUid == request.auth.uid`), preventing other players from spying in the lobby.
4. **Feed Entries**: A feed entry `/rooms/{roomId}/feed/{entryId}` must reference a valid existing room, match `request.auth.uid`, and only `undone` may be toggled by the entry's author.
5. **Chaos Events**: A gift event `/rooms/{roomId}/events/{eventId}` can only be created by `fromUid == request.auth.uid` for a target player in the room, and only the recipient `toUid == request.auth.uid` can resolve it from `PENDING` to `ACCEPTED` or `BLOCKED`.
6. **No PII**: No emails, phone numbers, or sensitive personal data are stored anywhere in `/rooms` or its subcollections.

## 2. "Dirty Dozen" Adversarial Payloads
1. Unauthenticated read/write to `/rooms/1234` -> `PERMISSION_DENIED`
2. Creating `/rooms/1234` with `hostUid` set to another user's UID -> `PERMISSION_DENIED`
3. Creating `/rooms/1234` with `code` != `roomId` or 1MB junk string -> `PERMISSION_DENIED`
4. Shadow field injection (`isAdmin: true`) in `/rooms/1234` -> `PERMISSION_DENIED`
5. Client-forged `createdAt` timestamp instead of `request.time` -> `PERMISSION_DENIED`
6. Non-host user attempting to change `hostUid` or `maxPlayers` on `/rooms/1234` -> `PERMISSION_DENIED`
7. Player A modifying Player B's `/players/{playerB}` hand -> `PERMISSION_DENIED`
8. Player B reading Player A's `/secretThemes/{id}` -> `PERMISSION_DENIED`
9. Unbounded array (>100 `usedWords` or >25 `cards`) -> `PERMISSION_DENIED`
10. Sender `fromUid` trying to mark their own `GIFT` event as `BLOCKED` or `ACCEPTED` -> `PERMISSION_DENIED`
11. Non-member trying to read/write `/rooms/1234/feed/{id}` -> `PERMISSION_DENIED`
12. Creating `/rooms/1234` directly in `GAME_OVER` status -> `PERMISSION_DENIED`
