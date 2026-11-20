export type RoomStatus = 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'ROUND_END' | 'GAME_OVER';

export type TurnMode = 'SIMULTANEOUS' | 'TURN_BASED';

export type RuleVariant = 'CLASSIC' | 'CHAOS';

export type ActionCardType = 'THEME_SWAP' | 'GIFT' | 'TIME_TURBO' | 'SHIELD';

export interface PlayerMeta {
  uid: string;
  name: string;
  avatar: string;
  isJunior: boolean;
  cardCount: number;
  score: number;
  finishedRound: number;
  secretThemeCount: number;
}

export interface RoomData {
  code: string;
  hostUid: string;
  status: RoomStatus;
  maxPlayers: number;
  turnMode: TurnMode;
  ruleVariant: RuleVariant;
  penaltyEnabled: boolean;
  roundDurationSec: 15 | 20 | 30;
  targetScore: number;
  selectedCategory: string;
  deckThemes: string[];
  currentThemeIndex: number;
  currentTheme: string;
  roundNumber: number;
  turnEndsAt: number;
  activeTurnUid: string;
  playerOrder: string[];
  playersMeta: Record<string, PlayerMeta>;
  usedWords: string[];
  winnersOrder: string[];
  lastActionNotice: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PlayerData {
  uid: string;
  name: string;
  avatar: string;
  isJunior: boolean;
  cards: string[];
  cardCount: number;
  actionCards: ActionCardType[];
  score: number;
  roundDealt: number;
  finishedRound: number;
  lastScoredRound: number;
  secretThemeCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SecretThemeDoc {
  id: string;
  uid: string;
  hostUid: string;
  theme: string;
  createdAt?: unknown;
}

export interface FeedEntry {
  id: string;
  uid: string;
  playerName: string;
  avatar: string;
  word: string;
  letter: string;
  theme: string;
  roundNumber: number;
  valid: boolean;
  reason: string;
  undone: boolean;
  visibleTo: string[];
  createdAt?: { seconds: number; nanoseconds: number } | unknown;
}

export interface ChaosEvent {
  id: string;
  type: 'GIFT';
  fromUid: string;
  fromName: string;
  toUid: string;
  letter: string;
  status: 'PENDING' | 'ACCEPTED' | 'BLOCKED';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CustomDeck {
  id: string;
  name: string;
  themes: string[];
  updatedAt: number;
}

export interface LocalPlayerProfile {
  name: string;
  avatar: string;
  isJunior: boolean;
}
