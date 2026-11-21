import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  createAnnouncement,
  pickBotMoveLine,
  pickGiftCardLine,
  pickHandFinishedLine,
  pickInvalidWordLine,
  pickLowCardsLine,
  pickRoundEndLine,
  pickRoundStartLine,
  pickShieldBlockLine,
  pickThemeSwapLine,
  pickTimeTurboLine,
  pickTimeUpThemeLine,
  pickValidWordHighlightLine,
  pickVictoryLine,
} from '../data/moderatorLines';
import {
  AVATARS,
  calculateRoundPoints,
  dealActionCards,
  dealLetterHand,
  drawSingleLetterCard,
  shuffleArray,
} from '../data/themesAndCards';
import type {
  ActionCardType,
  BotDifficulty,
  FeedEntry,
  LocalPlayerProfile,
  PlayerData,
  PlayerMeta,
  RoomData,
  RuleVariant,
  SecretThemeDoc,
  TurnMode,
} from '../types/game';
import { getDb, handleFirestoreError, OperationType } from './firebase';

export interface HostSetupConfig {
  maxPlayers: number;
  turnMode: TurnMode;
  ruleVariant: RuleVariant;
  penaltyEnabled: boolean;
  roundDurationSec: 15 | 20 | 30;
  selectedCategory: string;
  deckThemes: string[];
  tableDisplayActive: boolean;
}

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
export const ROUND_END_DELAY_MS = 1200;

const BOT_NAMES = [
  'Blitz-Berta',
  'Turbo-Toni',
  'Schlau-Sam',
  'Wort-Willi',
  'Pfiff-Paula',
  'Knobel-Karl',
  'Fix-Fritzi',
];

export const BOT_DIFFICULTY_META: Record<
  Exclude<BotDifficulty, 'NONE'>,
  { label: string; minMs: number; maxMs: number; desc: string }
> = {
  SLOW: { label: 'Gemütlich', minMs: 7000, maxMs: 13000, desc: '7–13 Sek.' },
  NORMAL: { label: 'Normal', minMs: 4000, maxMs: 8000, desc: '4–8 Sek.' },
  FAST: { label: 'Blitzschnell', minMs: 2000, maxMs: 4000, desc: '2–4 Sek.' },
};

async function deleteSubcollectionDocs(roomId: string, subName: string): Promise<void> {
  const db = getDb();
  const snap = await getDocs(collection(db, 'rooms', roomId, subName));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}

export async function cleanupExpiredRooms(): Promise<void> {
  const db = getDb();
  const cutoff = Date.now() - TWELVE_HOURS_MS;
  try {
    const expiredQuery = query(
      collection(db, 'rooms'),
      where('createdAtMs', '<', cutoff)
    );
    const snap = await getDocs(expiredQuery);
    for (const roomDoc of snap.docs) {
      const roomId = roomDoc.id;
      await Promise.all([
        deleteSubcollectionDocs(roomId, 'players'),
        deleteSubcollectionDocs(roomId, 'secretThemes'),
        deleteSubcollectionDocs(roomId, 'feed'),
        deleteSubcollectionDocs(roomId, 'events'),
      ]);
      await deleteDoc(roomDoc.ref);
    }
  } catch (error) {
    // Do not block room creation if cleanup encounters a transient query issue
    console.warn('Hinweis bei automatischer 12h-Raumbereinigung:', error);
  }
}

export async function generateUniqueRoomCode(): Promise<string> {
  const db = getDb();
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    try {
      const snap = await getDoc(doc(db, 'rooms', code));
      if (!snap.exists()) return code;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `rooms/${code}`);
    }
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

export async function createRoom(
  hostUid: string,
  profile: LocalPlayerProfile,
  config: HostSetupConfig
): Promise<string> {
  const db = getDb();
  await cleanupExpiredRooms();

  const code = await generateUniqueRoomCode();
  const cleanName = profile.name.trim().slice(0, 24) || 'Gastgeber';
  const themes = shuffleArray(config.deckThemes.slice(0, 60));
  const isTable = Boolean(config.tableDisplayActive);

  const initialPlayerOrder = isTable ? [] : [hostUid];
  const initialPlayersMeta: Record<string, PlayerMeta> = isTable
    ? {}
    : {
        [hostUid]: {
          uid: hostUid,
          name: cleanName,
          avatar: profile.avatar,
          isJunior: profile.isJunior,
          isBot: false,
          botDifficulty: 'NONE',
          cardCount: 0,
          score: 0,
          finishedRound: 0,
          secretThemeCount: 0,
        },
      };

  const roomPayload: RoomData = {
    code,
    hostUid,
    tableDisplayActive: isTable,
    status: 'LOBBY',
    maxPlayers: Math.min(8, Math.max(2, config.maxPlayers)),
    turnMode: config.turnMode,
    ruleVariant: config.ruleVariant,
    penaltyEnabled: config.penaltyEnabled,
    roundDurationSec: config.roundDurationSec,
    targetScore: 20,
    selectedCategory: config.selectedCategory.slice(0, 80),
    deckThemes: themes,
    currentThemeIndex: 0,
    currentTheme: '',
    roundNumber: 0,
    turnEndsAt: 0,
    activeTurnUid: '',
    playerOrder: initialPlayerOrder,
    playersMeta: initialPlayersMeta,
    usedWords: [],
    winnersOrder: [],
    lastActionNotice: isTable
      ? 'Tisch-Bildschirm eröffnet — tretet per QR-Code bei!'
      : `${cleanName} hat den Raum eröffnet`,
    latestAnnouncement: null,
    createdAtMs: Date.now(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'rooms', code), roomPayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `rooms/${code}`);
  }

  if (!isTable) {
    const playerPayload: PlayerData = {
      uid: hostUid,
      name: cleanName,
      avatar: profile.avatar,
      isJunior: profile.isJunior,
      isBot: false,
      botDifficulty: 'NONE',
      cards: [],
      cardCount: 0,
      actionCards: [],
      score: 0,
      roundDealt: 0,
      finishedRound: 0,
      lastScoredRound: 0,
      secretThemeCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(doc(db, 'rooms', code, 'players', hostUid), playerPayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `rooms/${code}/players/${hostUid}`);
    }
  }

  return code;
}

export async function joinRoom(
  rawCode: string,
  uid: string,
  profile: LocalPlayerProfile
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const db = getDb();
  const code = rawCode.trim();
  if (!/^[0-9]{4}$/.test(code)) {
    return { ok: false, error: 'Bitte gib einen gültigen 4-stelligen Raum-Code ein.' };
  }

  let snap;
  try {
    snap = await getDoc(doc(db, 'rooms', code));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `rooms/${code}`);
  }

  if (!snap.exists()) {
    return { ok: false, error: `Raum ${code} wurde nicht gefunden.` };
  }

  const room = snap.data() as RoomData;
  const cleanName = profile.name.trim().slice(0, 24) || 'Mitspieler';

  // Host in Table Display mode reconnecting
  if (room.hostUid === uid && room.tableDisplayActive) {
    return { ok: true, code };
  }

  // Already in room -> reconnect
  if (room.playerOrder.includes(uid)) {
    const playerRef = doc(db, 'rooms', code, 'players', uid);
    try {
      const pSnap = await getDoc(playerRef);
      if (!pSnap.exists()) {
        await setDoc(playerRef, {
          uid,
          name: cleanName,
          avatar: profile.avatar,
          isJunior: profile.isJunior,
          isBot: false,
          botDifficulty: 'NONE',
          cards: [],
          cardCount: 0,
          actionCards: [],
          score: room.playersMeta[uid]?.score ?? 0,
          roundDealt: 0,
          finishedRound: 0,
          lastScoredRound: 0,
          secretThemeCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `rooms/${code}/players/${uid}`);
    }
    return { ok: true, code };
  }

  if (room.status !== 'LOBBY') {
    return { ok: false, error: 'Dieses Spiel läuft bereits. Beitritt nur in der Lobby möglich.' };
  }

  if (room.playerOrder.length >= room.maxPlayers) {
    return { ok: false, error: `Der Raum ist bereits voll (${room.maxPlayers}/${room.maxPlayers} Spieler).` };
  }

  const newMeta: PlayerMeta = {
    uid,
    name: cleanName,
    avatar: profile.avatar,
    isJunior: profile.isJunior,
    isBot: false,
    botDifficulty: 'NONE',
    cardCount: 0,
    score: 0,
    finishedRound: 0,
    secretThemeCount: 0,
  };

  try {
    await updateDoc(doc(db, 'rooms', code), {
      playerOrder: [...room.playerOrder, uid],
      [`playersMeta.${uid}`]: newMeta,
      lastActionNotice: `${cleanName} ist beigetreten`,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${code}`);
  }

  const playerPayload: PlayerData = {
    uid,
    name: cleanName,
    avatar: profile.avatar,
    isJunior: profile.isJunior,
    isBot: false,
    botDifficulty: 'NONE',
    cards: [],
    cardCount: 0,
    actionCards: [],
    score: 0,
    roundDealt: 0,
    finishedRound: 0,
    lastScoredRound: 0,
    secretThemeCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'rooms', code, 'players', uid), playerPayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `rooms/${code}/players/${uid}`);
  }

  return { ok: true, code };
}

export async function addBotToLobby(
  room: RoomData,
  difficulty: Exclude<BotDifficulty, 'NONE'>
): Promise<void> {
  const db = getDb();
  if (room.playerOrder.length >= room.maxPlayers || room.playerOrder.length >= 8) return;

  const existingBotsCount = room.playerOrder.filter(
    (uid) => room.playersMeta[uid]?.isBot
  ).length;
  const botUid = `bot_${Date.now()}_${existingBotsCount + 1}`;
  const usedNames = new Set(Object.values(room.playersMeta).map((p) => p.name));
  const botName =
    BOT_NAMES.find((n) => !usedNames.has(n)) ?? `KI-Bot ${existingBotsCount + 1}`;
  const botAvatar = AVATARS[(existingBotsCount + 7) % AVATARS.length].id;

  const meta: PlayerMeta = {
    uid: botUid,
    name: botName,
    avatar: botAvatar,
    isJunior: false,
    isBot: true,
    botDifficulty: difficulty,
    cardCount: 0,
    score: 0,
    finishedRound: 0,
    secretThemeCount: 0,
  };

  const botPlayer: PlayerData = {
    uid: botUid,
    name: botName,
    avatar: botAvatar,
    isJunior: false,
    isBot: true,
    botDifficulty: difficulty,
    cards: [],
    cardCount: 0,
    actionCards: [],
    score: 0,
    roundDealt: 0,
    finishedRound: 0,
    lastScoredRound: 0,
    secretThemeCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'rooms', room.code, 'players', botUid), botPlayer);
    await updateDoc(doc(db, 'rooms', room.code), {
      playerOrder: [...room.playerOrder, botUid],
      [`playersMeta.${botUid}`]: meta,
      lastActionNotice: `🤖 ${botName} (${BOT_DIFFICULTY_META[difficulty].label}) hinzugefügt`,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `rooms/${room.code}/players/${botUid}`);
  }
}

export async function removeBotFromLobby(room: RoomData, botUid: string): Promise<void> {
  const db = getDb();
  const nextOrder = room.playerOrder.filter((id) => id !== botUid);
  const nextMeta = { ...room.playersMeta };
  delete nextMeta[botUid];

  try {
    await deleteDoc(doc(db, 'rooms', room.code, 'players', botUid));
    await updateDoc(doc(db, 'rooms', room.code), {
      playerOrder: nextOrder,
      playersMeta: nextMeta,
      lastActionNotice: 'KI-Bot entfernt',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `rooms/${room.code}/players/${botUid}`);
  }
}

export async function updateBotDifficultyInLobby(
  roomCode: string,
  botUid: string,
  difficulty: Exclude<BotDifficulty, 'NONE'>
): Promise<void> {
  const db = getDb();
  try {
    await updateDoc(doc(db, 'rooms', roomCode, 'players', botUid), {
      botDifficulty: difficulty,
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'rooms', roomCode), {
      [`playersMeta.${botUid}.botDifficulty`]: difficulty,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomCode}/players/${botUid}`);
  }
}

export async function updatePlayerProfileInLobby(
  code: string,
  uid: string,
  profile: LocalPlayerProfile
): Promise<void> {
  const db = getDb();
  const cleanName = profile.name.trim().slice(0, 24) || 'Mitspieler';
  try {
    await updateDoc(doc(db, 'rooms', code, 'players', uid), {
      name: cleanName,
      avatar: profile.avatar,
      isJunior: profile.isJunior,
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'rooms', code), {
      [`playersMeta.${uid}.name`]: cleanName,
      [`playersMeta.${uid}.avatar`]: profile.avatar,
      [`playersMeta.${uid}.isJunior`]: profile.isJunior,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${code}/players/${uid}`);
  }
}

export async function updateHostLobbySettings(
  code: string,
  settings: Partial<HostSetupConfig>
): Promise<void> {
  const db = getDb();
  try {
    await updateDoc(doc(db, 'rooms', code), {
      ...settings,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${code}`);
  }
}

export async function submitSecretLobbyTheme(
  code: string,
  hostUid: string,
  uid: string,
  theme: string,
  currentCount: number
): Promise<void> {
  const db = getDb();
  const clean = theme.trim().slice(0, 80);
  if (clean.length < 2 || currentCount >= 2) return;

  try {
    await addDoc(collection(db, 'rooms', code, 'secretThemes'), {
      uid,
      hostUid,
      theme: clean,
      createdAt: serverTimestamp(),
    });
    const nextCount = currentCount + 1;
    await updateDoc(doc(db, 'rooms', code, 'players', uid), {
      secretThemeCount: nextCount,
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'rooms', code), {
      [`playersMeta.${uid}.secretThemeCount`]: nextCount,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `rooms/${code}/secretThemes`);
  }
}

export async function startMatch(room: RoomData, _hostUid: string): Promise<void> {
  const db = getDb();
  let secretThemes: string[] = [];
  try {
    const snap = await getDocs(collection(db, 'rooms', room.code, 'secretThemes'));
    secretThemes = snap.docs.map((d) => (d.data() as SecretThemeDoc).theme);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `rooms/${room.code}/secretThemes`);
  }

  const combined = shuffleArray([...room.deckThemes, ...secretThemes]).slice(0, 80);
  const firstTheme = combined[0] || 'Dinge im Alltag';

  try {
    await updateDoc(doc(db, 'rooms', room.code), {
      deckThemes: combined,
      currentThemeIndex: 0,
      currentTheme: firstTheme,
      roundNumber: 1,
      status: 'COUNTDOWN',
      turnEndsAt: Date.now() + 3600,
      activeTurnUid: room.turnMode === 'TURN_BASED' ? (room.playerOrder[0] || '') : '',
      usedWords: [],
      winnersOrder: [],
      lastActionNotice:
        secretThemes.length > 0
          ? `Runde 1 startet (+${secretThemes.length} geheime Themen eingemischt!)`
          : 'Runde 1 startet — macht euch bereit!',
      latestAnnouncement: createAnnouncement(pickRoundStartLine(1, firstTheme)),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
  }
}

export async function dealHandForParticipant(
  code: string,
  uid: string,
  roundNumber: number,
  isJunior: boolean,
  ruleVariant: RuleVariant
): Promise<void> {
  const db = getDb();
  const cardCount = isJunior ? 7 : 8;
  const cards = dealLetterHand(cardCount);
  const actionCards: ActionCardType[] = ruleVariant === 'CHAOS' ? dealActionCards(2) : [];

  try {
    await updateDoc(doc(db, 'rooms', code, 'players', uid), {
      cards,
      cardCount: cards.length,
      actionCards,
      roundDealt: roundNumber,
      finishedRound: 0,
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'rooms', code), {
      [`playersMeta.${uid}.cardCount`]: cards.length,
      [`playersMeta.${uid}.finishedRound`]: 0,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${code}/players/${uid}`);
  }
}

export async function dealAllBotsForRound(room: RoomData): Promise<void> {
  const botUids = room.playerOrder.filter((uid) => room.playersMeta[uid]?.isBot);
  if (botUids.length === 0) return;

  const db = getDb();
  for (const botUid of botUids) {
    try {
      const snap = await getDoc(doc(db, 'rooms', room.code, 'players', botUid));
      if (snap.exists()) {
        const bot = snap.data() as PlayerData;
        if (bot.roundDealt < room.roundNumber) {
          await dealHandForParticipant(
            room.code,
            botUid,
            room.roundNumber,
            false,
            room.ruleVariant
          );
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}/players/${botUid}`);
    }
  }
}

export async function getBotPlayerData(roomCode: string, botUid: string): Promise<PlayerData | null> {
  const db = getDb();
  try {
    const snap = await getDoc(doc(db, 'rooms', roomCode, 'players', botUid));
    return snap.exists() ? (snap.data() as PlayerData) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `rooms/${roomCode}/players/${botUid}`);
  }
}

export async function transitionCountdownToPlaying(room: RoomData): Promise<void> {
  const db = getDb();
  try {
    await updateDoc(doc(db, 'rooms', room.code), {
      status: 'PLAYING',
      turnEndsAt: Date.now() + room.roundDurationSec * 1000,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
  }
}

export function getNextActiveTurnUid(room: RoomData, excludeUid?: string): string {
  const activePlayers = room.playerOrder.filter(
    (uid) => uid !== excludeUid && !room.winnersOrder.includes(uid)
  );
  if (activePlayers.length === 0) return '';
  const currentIdx = room.playerOrder.indexOf(room.activeTurnUid);
  for (let offset = 1; offset <= room.playerOrder.length; offset++) {
    const candidate = room.playerOrder[(currentIdx + offset) % room.playerOrder.length];
    if (!room.winnersOrder.includes(candidate) && candidate !== excludeUid) {
      return candidate;
    }
  }
  return activePlayers[0];
}

export async function advanceTheme(
  room: RoomData,
  notice = 'Zeit um – nächstes Thema!'
): Promise<void> {
  const db = getDb();
  try {
    await runTransaction(db, async (tx) => {
      const roomRef = doc(db, 'rooms', room.code);
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists()) return;
      const latest = roomSnap.data() as RoomData;

      if (
        latest.status !== 'PLAYING' ||
        latest.roundNumber !== room.roundNumber ||
        latest.currentThemeIndex !== room.currentThemeIndex
      ) {
        return;
      }

      const remainingPlayers = latest.playerOrder.filter(
        (uid) => !latest.winnersOrder.includes(uid)
      );
      if (latest.playerOrder.length >= 2 && remainingPlayers.length <= 1) {
        return;
      }

      const nextIndex =
        (latest.currentThemeIndex + 1) % Math.max(1, latest.deckThemes.length);
      const nextTheme = latest.deckThemes[nextIndex] || 'Bunte Alltagswörter';

      tx.update(roomRef, {
        currentThemeIndex: nextIndex,
        currentTheme: nextTheme,
        usedWords: [],
        status: 'COUNTDOWN',
        turnEndsAt: Date.now() + 3400,
        activeTurnUid:
          latest.turnMode === 'TURN_BASED' ? getNextActiveTurnUid(latest) : '',
        lastActionNotice: notice.slice(0, 160),
        latestAnnouncement: createAnnouncement(pickTimeUpThemeLine(nextTheme)),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
  }
}

export async function advanceTurnInTurnBasedMode(
  room: RoomData,
  notice: string
): Promise<void> {
  const db = getDb();
  try {
    await runTransaction(db, async (tx) => {
      const roomRef = doc(db, 'rooms', room.code);
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists()) return;
      const latest = roomSnap.data() as RoomData;
      if (latest.status !== 'PLAYING' || latest.turnMode !== 'TURN_BASED') return;

      const remainingPlayers = latest.playerOrder.filter(
        (uid) => !latest.winnersOrder.includes(uid)
      );
      if (latest.playerOrder.length >= 2 && remainingPlayers.length <= 1) return;

      const nextUid = getNextActiveTurnUid(latest);
      const nextName = latest.playersMeta[nextUid]?.name ?? 'Nächster';
      tx.update(roomRef, {
        activeTurnUid: nextUid,
        turnEndsAt: Date.now() + latest.roundDurationSec * 1000,
        lastActionNotice: notice.slice(0, 160),
        latestAnnouncement: createAnnouncement(
          `Zeit abgelaufen – jetzt ist ${nextName} am Zug!`
        ),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
  }
}

export async function finalizeRoundEndAfterDelay(
  roomCode: string,
  expectedRoundNumber: number
): Promise<void> {
  const db = getDb();
  try {
    await runTransaction(db, async (tx) => {
      const roomRef = doc(db, 'rooms', roomCode);
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists()) return;
      const latest = roomSnap.data() as RoomData;

      if (
        latest.status !== 'PLAYING' ||
        latest.roundNumber !== expectedRoundNumber
      ) {
        return;
      }

      const remainingPlayers = latest.playerOrder.filter(
        (uid) => !latest.winnersOrder.includes(uid)
      );
      if (latest.playerOrder.length >= 2 && remainingPlayers.length > 1) {
        return;
      }

      tx.update(roomRef, {
        status: 'ROUND_END',
        activeTurnUid: '',
        turnEndsAt: 0,
        lastActionNotice: 'Runde beendet – Punkte werden gezählt!',
        latestAnnouncement: createAnnouncement(
          pickRoundEndLine(latest.roundNumber)
        ),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    console.warn('Hinweis beim Rundenabschluss:', error);
  }
}

export async function recordAcceptedWord(params: {
  room: RoomData;
  player: PlayerData;
  word: string;
  normalizedWord: string;
  matchedLetter: string;
  cardIndex: number;
  reason: string;
}): Promise<
  | { accepted: true; feedId: string; shouldEndRound: boolean }
  | { accepted: false; reason: string }
> {
  const db = getDb();
  const { room, player, word, normalizedWord, matchedLetter, cardIndex, reason } =
    params;

  let txResult: {
    accepted: boolean;
    failReason: string;
    shouldEndRound: boolean;
    activeTheme: string;
    roundNumber: number;
    playerOrder: string[];
  } = {
    accepted: false,
    failReason: 'Zug konnte nicht abgeschlossen werden.',
    shouldEndRound: false,
    activeTheme: room.currentTheme,
    roundNumber: room.roundNumber,
    playerOrder: room.playerOrder,
  };

  try {
    await runTransaction(db, async (tx) => {
      const roomRef = doc(db, 'rooms', room.code);
      const playerRef = doc(db, 'rooms', room.code, 'players', player.uid);

      const [roomSnap, playerSnap] = await Promise.all([
        tx.get(roomRef),
        tx.get(playerRef),
      ]);

      if (!roomSnap.exists() || !playerSnap.exists()) {
        txResult.failReason = 'Raum oder Spieler nicht gefunden.';
        return;
      }

      const latestRoom = roomSnap.data() as RoomData;
      const latestPlayer = playerSnap.data() as PlayerData;

      if (
        latestRoom.status !== 'PLAYING' ||
        latestRoom.roundNumber !== room.roundNumber
      ) {
        txResult.failReason = 'Die Runde läuft gerade nicht mehr.';
        return;
      }

      if (
        latestRoom.turnMode === 'TURN_BASED' &&
        latestRoom.activeTurnUid !== player.uid
      ) {
        txResult.failReason = 'Du bist aktuell nicht am Zug.';
        return;
      }

      if (latestRoom.usedWords.includes(normalizedWord)) {
        txResult.failReason = `"${word}" wurde gerade eben schon genannt!`;
        return;
      }

      let resolvedCardIndex =
        latestPlayer.cards[cardIndex] === matchedLetter
          ? cardIndex
          : latestPlayer.cards.indexOf(matchedLetter);

      if (resolvedCardIndex === -1) {
        txResult.failReason = 'Diese Karte wurde bereits abgelegt.';
        return;
      }

      const newCards = latestPlayer.cards.filter((_, idx) => idx !== resolvedCardIndex);
      const hasFinished = newCards.length === 0;
      const newScore = Math.min(200, latestPlayer.score + 1);
      const newWinnersOrder =
        hasFinished && !latestRoom.winnersOrder.includes(player.uid)
          ? [...latestRoom.winnersOrder, player.uid]
          : latestRoom.winnersOrder;

      const remainingPlayers = latestRoom.playerOrder.filter(
        (uid) => !newWinnersOrder.includes(uid)
      );
      const shouldEndRound =
        latestRoom.playerOrder.length >= 2 && remainingPlayers.length <= 1;

      const nextTurnUid =
        latestRoom.turnMode === 'TURN_BASED' && !shouldEndRound
          ? getNextActiveTurnUid(latestRoom, hasFinished ? player.uid : undefined)
          : '';

      const notice = hasFinished
        ? `${latestPlayer.name} hat alle Karten abgelegt! (+1 Punkt)`
        : `${latestPlayer.name}: "${word}" (${matchedLetter === 'JOKER' ? '★ Joker' : matchedLetter}) +1 P.`;

      let announcementText: string | null = null;
      if (hasFinished) {
        announcementText = pickHandFinishedLine(latestPlayer.name);
      } else if (newCards.length <= 2) {
        announcementText = pickLowCardsLine(latestPlayer.name, newCards.length);
      } else if (latestPlayer.isBot) {
        announcementText = pickBotMoveLine(latestPlayer.name);
      } else if (
        matchedLetter === 'JOKER' ||
        latestRoom.usedWords.length === 0 ||
        Math.random() < 0.45
      ) {
        announcementText = pickValidWordHighlightLine(latestPlayer.name);
      }

      tx.update(playerRef, {
        cards: newCards,
        cardCount: newCards.length,
        score: newScore,
        finishedRound: hasFinished
          ? latestRoom.roundNumber
          : latestPlayer.finishedRound,
        updatedAt: serverTimestamp(),
      });

      const roomUpdates: Record<string, unknown> = {
        usedWords: [...latestRoom.usedWords, normalizedWord].slice(0, 100),
        winnersOrder: newWinnersOrder,
        // Keep status 'PLAYING' during the 1.2s delay; set turnEndsAt to 0 to halt timer immediately
        status: latestRoom.status,
        activeTurnUid: shouldEndRound ? '' : nextTurnUid,
        turnEndsAt: shouldEndRound
          ? 0
          : latestRoom.turnMode === 'TURN_BASED'
            ? Date.now() + latestRoom.roundDurationSec * 1000
            : latestRoom.turnEndsAt,
        [`playersMeta.${player.uid}.cardCount`]: newCards.length,
        [`playersMeta.${player.uid}.score`]: newScore,
        [`playersMeta.${player.uid}.finishedRound`]: hasFinished
          ? latestRoom.roundNumber
          : latestPlayer.finishedRound,
        lastActionNotice: notice.slice(0, 160),
        updatedAt: serverTimestamp(),
      };

      if (announcementText) {
        roomUpdates.latestAnnouncement = createAnnouncement(announcementText);
      }

      tx.update(roomRef, roomUpdates);

      txResult = {
        accepted: true,
        failReason: '',
        shouldEndRound,
        activeTheme: latestRoom.currentTheme,
        roundNumber: latestRoom.roundNumber,
        playerOrder: latestRoom.playerOrder,
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `rooms/${room.code}`);
  }

  if (!txResult.accepted) {
    return { accepted: false, reason: txResult.failReason };
  }

  let feedId = '';
  try {
    const feedRef = await addDoc(collection(db, 'rooms', room.code, 'feed'), {
      uid: player.uid,
      playerName: player.name,
      avatar: player.avatar,
      word: word.slice(0, 64),
      letter: matchedLetter,
      theme: txResult.activeTheme.slice(0, 120),
      roundNumber: txResult.roundNumber,
      valid: true,
      reason: reason.slice(0, 200),
      undone: false,
      visibleTo: txResult.playerOrder,
      createdAt: serverTimestamp(),
    });
    feedId = feedRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `rooms/${room.code}/feed`);
  }

  if (txResult.shouldEndRound) {
    window.setTimeout(() => {
      finalizeRoundEndAfterDelay(room.code, txResult.roundNumber);
    }, ROUND_END_DELAY_MS);
  }

  return {
    accepted: true,
    feedId,
    shouldEndRound: txResult.shouldEndRound,
  };
}

export async function recordRejectedWord(params: {
  room: RoomData;
  player: PlayerData;
  word: string;
  reason: string;
  penaltyApplied: boolean;
}): Promise<{ feedId: string; penaltyCard: string | null }> {
  const db = getDb();
  const { room, player, word, reason, penaltyApplied } = params;
  let penaltyCard: string | null = null;
  let newCards = [...player.cards];

  if (penaltyApplied) {
    penaltyCard = drawSingleLetterCard();
    newCards = [...newCards, penaltyCard].slice(0, 25);
    try {
      await updateDoc(doc(db, 'rooms', room.code, 'players', player.uid), {
        cards: newCards,
        cardCount: newCards.length,
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'rooms', room.code), {
        [`playersMeta.${player.uid}.cardCount`]: newCards.length,
        latestAnnouncement: createAnnouncement(
          pickInvalidWordLine(word, room.currentTheme)
        ),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}/players/${player.uid}`);
    }
  } else {
    try {
      await updateDoc(doc(db, 'rooms', room.code), {
        latestAnnouncement: createAnnouncement(
          pickInvalidWordLine(word, room.currentTheme)
        ),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
    }
  }

  let feedId = '';
  try {
    const feedRef = await addDoc(collection(db, 'rooms', room.code, 'feed'), {
      uid: player.uid,
      playerName: player.name,
      avatar: player.avatar,
      word: word.slice(0, 64),
      letter: penaltyCard ? `+${penaltyCard}` : '-',
      theme: room.currentTheme.slice(0, 120),
      roundNumber: room.roundNumber,
      valid: false,
      reason: reason.slice(0, 200),
      undone: false,
      visibleTo: room.playerOrder,
      createdAt: serverTimestamp(),
    });
    feedId = feedRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `rooms/${room.code}/feed`);
  }

  return { feedId, penaltyCard };
}

export async function undoWordEntry(params: {
  room: RoomData;
  player: PlayerData;
  entry: FeedEntry;
  normalizedWord: string;
}): Promise<void> {
  const db = getDb();
  const { room, player, entry, normalizedWord } = params;
  if (entry.undone) return;

  try {
    await runTransaction(db, async (tx) => {
      const roomRef = doc(db, 'rooms', room.code);
      const playerRef = doc(db, 'rooms', room.code, 'players', player.uid);
      const feedRef = doc(db, 'rooms', room.code, 'feed', entry.id);

      const [roomSnap, playerSnap, feedSnap] = await Promise.all([
        tx.get(roomRef),
        tx.get(playerRef),
        tx.get(feedRef),
      ]);

      if (!roomSnap.exists() || !playerSnap.exists()) return;
      if (feedSnap.exists() && (feedSnap.data() as FeedEntry).undone) return;

      const latestRoom = roomSnap.data() as RoomData;
      const latestPlayer = playerSnap.data() as PlayerData;

      let nextCards = [...latestPlayer.cards];
      let nextScore = latestPlayer.score;

      if (entry.valid && entry.letter) {
        nextCards = [...nextCards, entry.letter].slice(0, 25);
        nextScore = Math.max(0, latestPlayer.score - 1);
      } else if (!entry.valid && entry.letter.startsWith('+')) {
        const addedCard = entry.letter.slice(1);
        const idx = nextCards.lastIndexOf(addedCard);
        if (idx !== -1) {
          nextCards.splice(idx, 1);
        }
      }

      const nextUsedWords = entry.valid
        ? latestRoom.usedWords.filter((w) => w !== normalizedWord)
        : latestRoom.usedWords;

      const nextWinnersOrder = latestRoom.winnersOrder.filter(
        (u) => u !== player.uid
      );

      tx.update(playerRef, {
        cards: nextCards,
        cardCount: nextCards.length,
        score: nextScore,
        finishedRound: 0,
        updatedAt: serverTimestamp(),
      });

      tx.update(roomRef, {
        usedWords: nextUsedWords,
        winnersOrder: nextWinnersOrder,
        [`playersMeta.${player.uid}.cardCount`]: nextCards.length,
        [`playersMeta.${player.uid}.score`]: nextScore,
        [`playersMeta.${player.uid}.finishedRound`]: 0,
        lastActionNotice: `${latestPlayer.name} hat "${entry.word}" zurückgenommen`,
        updatedAt: serverTimestamp(),
      });

      if (feedSnap.exists()) {
        tx.update(feedRef, { undone: true });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}/feed/${entry.id}`);
  }
}

export async function consumeActionCard(
  code: string,
  player: PlayerData,
  actionType: ActionCardType
): Promise<ActionCardType[]> {
  const db = getDb();
  const idx = player.actionCards.indexOf(actionType);
  if (idx === -1) return player.actionCards;
  const nextActions = [...player.actionCards];
  nextActions.splice(idx, 1);
  try {
    await updateDoc(doc(db, 'rooms', code, 'players', player.uid), {
      actionCards: nextActions,
      updatedAt: serverTimestamp(),
    });
    if (actionType === 'SHIELD') {
      await updateDoc(doc(db, 'rooms', code), {
        lastActionNotice: `🛡️ ${player.name} nutzt ein Schutzschild!`,
        latestAnnouncement: createAnnouncement(pickShieldBlockLine(player.name)),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${code}/players/${player.uid}`);
  }
  return nextActions;
}

export async function playChaosThemeSwap(room: RoomData, player: PlayerData): Promise<void> {
  const db = getDb();
  await consumeActionCard(room.code, player, 'THEME_SWAP');
  const nextIndex = (room.currentThemeIndex + 1) % Math.max(1, room.deckThemes.length);
  const nextTheme = room.deckThemes[nextIndex] || 'Überraschungs-Thema';
  try {
    await updateDoc(doc(db, 'rooms', room.code), {
      currentThemeIndex: nextIndex,
      currentTheme: nextTheme,
      usedWords: [],
      turnEndsAt: Date.now() + room.roundDurationSec * 1000,
      lastActionNotice: `🔄 ${player.name} nutzt Themen-Wechsel!`,
      latestAnnouncement: createAnnouncement(
        pickThemeSwapLine(player.name, nextTheme)
      ),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
  }
}

export async function playChaosTimeTurbo(room: RoomData, player: PlayerData): Promise<void> {
  const db = getDb();
  await consumeActionCard(room.code, player, 'TIME_TURBO');
  try {
    await updateDoc(doc(db, 'rooms', room.code), {
      turnEndsAt: Math.min(room.turnEndsAt, Date.now() + 5500),
      lastActionNotice: `⚡ ${player.name} zündet den Zeit-Turbo (5s)!`,
      latestAnnouncement: createAnnouncement(pickTimeTurboLine(player.name)),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
  }
}

export async function sendChaosGift(params: {
  room: RoomData;
  sender: PlayerData;
  targetUid: string;
  targetName: string;
  cardIndex: number;
}): Promise<void> {
  const db = getDb();
  const { room, sender, targetUid, targetName, cardIndex } = params;
  const letter = sender.cards[cardIndex];
  if (!letter) return;

  const nextCards = sender.cards.filter((_, idx) => idx !== cardIndex);
  const nextActions = [...sender.actionCards];
  const giftIdx = nextActions.indexOf('GIFT');
  if (giftIdx !== -1) nextActions.splice(giftIdx, 1);

  const hasFinished = nextCards.length === 0;
  const newWinnersOrder =
    hasFinished && !room.winnersOrder.includes(sender.uid)
      ? [...room.winnersOrder, sender.uid]
      : room.winnersOrder;
  const remainingPlayers = room.playerOrder.filter((u) => !newWinnersOrder.includes(u));
  const shouldEndRound = remainingPlayers.length <= 1;

  const targetIsBot = Boolean(room.playersMeta[targetUid]?.isBot);

  try {
    await updateDoc(doc(db, 'rooms', room.code, 'players', sender.uid), {
      cards: nextCards,
      cardCount: nextCards.length,
      actionCards: nextActions,
      finishedRound: hasFinished ? room.roundNumber : sender.finishedRound,
      updatedAt: serverTimestamp(),
    });

    if (targetIsBot) {
      // Host/bot resolves gift immediately (bot blocks with SHIELD if available)
      const botSnap = await getDoc(doc(db, 'rooms', room.code, 'players', targetUid));
      if (botSnap.exists()) {
        const bot = botSnap.data() as PlayerData;
        const shieldIdx = bot.actionCards.indexOf('SHIELD');
        if (shieldIdx !== -1) {
          const nextBotActions = [...bot.actionCards];
          nextBotActions.splice(shieldIdx, 1);
          await updateDoc(doc(db, 'rooms', room.code, 'players', targetUid), {
            actionCards: nextBotActions,
            updatedAt: serverTimestamp(),
          });
          await updateDoc(doc(db, 'rooms', room.code), {
            winnersOrder: newWinnersOrder,
            turnEndsAt: shouldEndRound ? 0 : room.turnEndsAt,
            activeTurnUid: shouldEndRound ? '' : room.activeTurnUid,
            [`playersMeta.${sender.uid}.cardCount`]: nextCards.length,
            [`playersMeta.${sender.uid}.finishedRound`]: hasFinished ? room.roundNumber : sender.finishedRound,
            lastActionNotice: `🛡️ ${targetName} wehrt Geschenk von ${sender.name} mit Schutzschild ab!`,
            latestAnnouncement: createAnnouncement(
              pickShieldBlockLine(targetName)
            ),
            updatedAt: serverTimestamp(),
          });
          if (shouldEndRound) {
            window.setTimeout(() => {
              finalizeRoundEndAfterDelay(room.code, room.roundNumber);
            }, ROUND_END_DELAY_MS);
          }
          return;
        }
        const nextBotCards = [...bot.cards, letter].slice(0, 25);
        await updateDoc(doc(db, 'rooms', room.code, 'players', targetUid), {
          cards: nextBotCards,
          cardCount: nextBotCards.length,
          updatedAt: serverTimestamp(),
        });
        await updateDoc(doc(db, 'rooms', room.code), {
          winnersOrder: newWinnersOrder,
          turnEndsAt: shouldEndRound ? 0 : room.turnEndsAt,
          activeTurnUid: shouldEndRound ? '' : room.activeTurnUid,
          [`playersMeta.${sender.uid}.cardCount`]: nextCards.length,
          [`playersMeta.${sender.uid}.finishedRound`]: hasFinished ? room.roundNumber : sender.finishedRound,
          [`playersMeta.${targetUid}.cardCount`]: nextBotCards.length,
          lastActionNotice: `🎁 ${sender.name} schenkt ${targetName} eine Karte!`,
          latestAnnouncement: createAnnouncement(
            pickGiftCardLine(sender.name, targetName)
          ),
          updatedAt: serverTimestamp(),
        });
        if (shouldEndRound) {
          window.setTimeout(() => {
            finalizeRoundEndAfterDelay(room.code, room.roundNumber);
          }, ROUND_END_DELAY_MS);
        }
        return;
      }
    }

    await updateDoc(doc(db, 'rooms', room.code), {
      winnersOrder: newWinnersOrder,
      turnEndsAt: shouldEndRound ? 0 : room.turnEndsAt,
      activeTurnUid: shouldEndRound ? '' : room.activeTurnUid,
      [`playersMeta.${sender.uid}.cardCount`]: nextCards.length,
      [`playersMeta.${sender.uid}.finishedRound`]: hasFinished ? room.roundNumber : sender.finishedRound,
      lastActionNotice: `🎁 ${sender.name} schenkt ${targetName} eine Karte!`,
      latestAnnouncement: createAnnouncement(
        pickGiftCardLine(sender.name, targetName)
      ),
      updatedAt: serverTimestamp(),
    });

    if (shouldEndRound) {
      window.setTimeout(() => {
        finalizeRoundEndAfterDelay(room.code, room.roundNumber);
      }, ROUND_END_DELAY_MS);
    }

    await addDoc(collection(db, 'rooms', room.code, 'events'), {
      type: 'GIFT',
      fromUid: sender.uid,
      fromName: sender.name,
      toUid: targetUid,
      letter,
      status: 'PENDING',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `rooms/${room.code}/events`);
  }
}

export async function resolveChaosGiftEvent(params: {
  room: RoomData;
  player: PlayerData;
  eventId: string;
  letter: string;
  useShield: boolean;
}): Promise<void> {
  const db = getDb();
  const { room, player, eventId, letter, useShield } = params;

  try {
    await updateDoc(doc(db, 'rooms', room.code, 'events', eventId), {
      status: useShield ? 'BLOCKED' : 'ACCEPTED',
      updatedAt: serverTimestamp(),
    });

    if (useShield) {
      const nextActions = [...player.actionCards];
      const shieldIdx = nextActions.indexOf('SHIELD');
      if (shieldIdx !== -1) nextActions.splice(shieldIdx, 1);
      await updateDoc(doc(db, 'rooms', room.code, 'players', player.uid), {
        actionCards: nextActions,
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'rooms', room.code), {
        lastActionNotice: `🛡️ ${player.name} blockt das Karten-Geschenk ab!`,
        latestAnnouncement: createAnnouncement(pickShieldBlockLine(player.name)),
        updatedAt: serverTimestamp(),
      });
    } else {
      const nextCards = [...player.cards, letter].slice(0, 25);
      await updateDoc(doc(db, 'rooms', room.code, 'players', player.uid), {
        cards: nextCards,
        cardCount: nextCards.length,
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'rooms', room.code), {
        [`playersMeta.${player.uid}.cardCount`]: nextCards.length,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}/events/${eventId}`);
  }
}

export async function claimMyRoundPoints(room: RoomData, player: PlayerData): Promise<number> {
  if (player.lastScoredRound >= room.roundNumber) return player.score;
  const db = getDb();

  const rankIndex = room.winnersOrder.indexOf(player.uid);
  const earned = calculateRoundPoints(rankIndex, room.playerOrder.length);
  const newScore = player.score + earned;

  try {
    await updateDoc(doc(db, 'rooms', room.code, 'players', player.uid), {
      score: newScore,
      lastScoredRound: room.roundNumber,
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'rooms', room.code), {
      [`playersMeta.${player.uid}.score`]: newScore,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}/players/${player.uid}`);
  }

  return newScore;
}

export async function hostClaimBotRoundPoints(room: RoomData): Promise<void> {
  const db = getDb();
  const botUids = room.playerOrder.filter((uid) => room.playersMeta[uid]?.isBot);
  for (const botUid of botUids) {
    try {
      const snap = await getDoc(doc(db, 'rooms', room.code, 'players', botUid));
      if (!snap.exists()) continue;
      const bot = snap.data() as PlayerData;
      if (bot.lastScoredRound >= room.roundNumber) continue;

      const rankIndex = room.winnersOrder.indexOf(botUid);
      const earned = calculateRoundPoints(rankIndex, room.playerOrder.length);
      const newScore = bot.score + earned;

      await updateDoc(doc(db, 'rooms', room.code, 'players', botUid), {
        score: newScore,
        lastScoredRound: room.roundNumber,
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'rooms', room.code), {
        [`playersMeta.${botUid}.score`]: newScore,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}/players/${botUid}`);
    }
  }
}

export async function hostCheckGameOverOrNextRound(
  room: RoomData,
  action: 'FINISH_CHECK' | 'NEXT_ROUND'
): Promise<void> {
  const db = getDb();
  if (action === 'FINISH_CHECK') {
    const sorted = Object.values(room.playersMeta).sort((a, b) => b.score - a.score);
    const someoneWon = sorted.some((p) => p.score >= room.targetScore);
    if (someoneWon) {
      const winnerName = sorted[0]?.name ?? 'WortBlitz-Champion';
      try {
        await updateDoc(doc(db, 'rooms', room.code), {
          status: 'GAME_OVER',
          lastActionNotice: 'Wir haben eine Siegerin oder einen Sieger!',
          latestAnnouncement: createAnnouncement(pickVictoryLine(winnerName)),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
      }
    }
    return;
  }

  const nextIndex = (room.currentThemeIndex + 1) % Math.max(1, room.deckThemes.length);
  const nextTheme = room.deckThemes[nextIndex] || 'Familien-Runde';
  const nextRound = room.roundNumber + 1;

  try {
    await updateDoc(doc(db, 'rooms', room.code), {
      currentThemeIndex: nextIndex,
      currentTheme: nextTheme,
      roundNumber: nextRound,
      status: 'COUNTDOWN',
      turnEndsAt: Date.now() + 3600,
      activeTurnUid: room.turnMode === 'TURN_BASED' ? (room.playerOrder[0] || '') : '',
      usedWords: [],
      winnersOrder: [],
      lastActionNotice: `Runde ${nextRound} startet!`,
      latestAnnouncement: createAnnouncement(
        pickRoundStartLine(nextRound, nextTheme)
      ),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
  }
}

export async function hostFinishRoundManually(room: RoomData): Promise<void> {
  const db = getDb();
  try {
    await updateDoc(doc(db, 'rooms', room.code), {
      status: 'ROUND_END',
      activeTurnUid: '',
      turnEndsAt: 0,
      lastActionNotice: 'Runde beendet — Punkte werden gezählt!',
      latestAnnouncement: createAnnouncement(pickRoundEndLine(room.roundNumber)),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
  }
}

export async function hostResetRoomToLobby(room: RoomData): Promise<void> {
  const db = getDb();
  const resetMeta: Record<string, PlayerMeta> = {};
  for (const uid of room.playerOrder) {
    const existing = room.playersMeta[uid];
    if (existing) {
      resetMeta[uid] = {
        ...existing,
        cardCount: 0,
        score: 0,
        finishedRound: 0,
      };
    }
  }
  try {
    await updateDoc(doc(db, 'rooms', room.code), {
      status: 'LOBBY',
      roundNumber: 0,
      currentThemeIndex: 0,
      currentTheme: '',
      turnEndsAt: 0,
      activeTurnUid: '',
      usedWords: [],
      winnersOrder: [],
      playersMeta: resetMeta,
      lastActionNotice: 'Neues Spiel vorbereitet!',
      latestAnnouncement: null,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
  }
}
