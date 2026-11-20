// Security rule assertions mapped to security_spec.md Dirty Dozen payloads
export const DIRTY_DOZEN_CASES = [
  { id: 1, name: 'Unauthenticated read/write to /rooms/1234', expected: 'PERMISSION_DENIED' },
  { id: 2, name: 'Creating /rooms/1234 with foreign hostUid', expected: 'PERMISSION_DENIED' },
  { id: 3, name: 'Creating /rooms/1234 with mismatched code or oversized ID', expected: 'PERMISSION_DENIED' },
  { id: 4, name: 'Shadow field injection (isAdmin: true) on Room', expected: 'PERMISSION_DENIED' },
  { id: 5, name: 'Client-forged createdAt timestamp instead of request.time', expected: 'PERMISSION_DENIED' },
  { id: 6, name: 'Non-host modifying hostUid or maxPlayers', expected: 'PERMISSION_DENIED' },
  { id: 7, name: 'Player A modifying Player B private hand', expected: 'PERMISSION_DENIED' },
  { id: 8, name: 'Player B reading Player A secret lobby theme', expected: 'PERMISSION_DENIED' },
  { id: 9, name: 'Unbounded array (>100 usedWords or >25 cards)', expected: 'PERMISSION_DENIED' },
  { id: 10, name: 'Sender resolving own GIFT event to BLOCKED', expected: 'PERMISSION_DENIED' },
  { id: 11, name: 'Non-member reading/writing /rooms/1234/feed', expected: 'PERMISSION_DENIED' },
  { id: 12, name: 'Creating room directly in GAME_OVER state', expected: 'PERMISSION_DENIED' },
] as const;
