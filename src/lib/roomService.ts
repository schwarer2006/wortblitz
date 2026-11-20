import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  calculateRoundPoints,
  dealActionCards,
  dealLetterHand,
  drawSingleLetterCard,
  shuffleArray,
} from '../data/themesAndCards';
import type {
  ActionCardType,
  FeedEntry,
  LocalPlayerProfile,
  PlayerData,
  PlayerMeta,
  RoomData,
  RuleVariant,
  SecretThemeDoc,
  TurnMode,
} from '../types/game';
import { db, handleFirestoreError, OperationType } from './firebase';

export interface HostSetupConfig {
  maxPlayers: number;
  turnMode: TurnMode;
  ruleVariant: RuleVariant;
  penaltyEnabled: boolean;
  roundDurationSec: 15 | 20 | 30;
  selectedCategory: string;
  deckThemes: string[];
}

export async function generateUniqueRoomCode(): Promise<string> {
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
  const code = await generateUniqueRoomCode();
  const cleanName = profile.name.trim().slice(0, 24) || 'Gastgeber';
  const themes = shuffleArray(config.deckThemes.slice(0, 60));

  const hostMeta: PlayerMeta = {
    uid: hostUid,
    name: cleanName,
    avatar: profile.avatar,
    isJunior: profile.isJunior,
    cardCount: 0,
    score: 0,
    finishedRound: 0,
    secretThemeCount: 0,
  };

  const roomPayload: RoomData = {
    code,
    hostUid,
    status: 'LOBBY',
    maxPlayers: Math.min(8, Math.max(2, config.maxPlayers)),
    turnMode: config.turnMode,
    ruleVariant: config.ruleVariant,
    penaltyEnabled: config.penaltyEnabled,
    roundDurationSec: config.roundDurationSec,
    targetScore: 10,
    selectedCategory: config.selectedCategory.slice(0, 80),
    deckThemes: themes,
    currentThemeIndex: 0,
    currentTheme: '',
    roundNumber: 0,
    turnEndsAt: 0,
    activeTurnUid: '',
    playerOrder: [hostUid],
    playersMeta: { [hostUid]: hostMeta },
    usedWords: [],
    winnersOrder: [],
    lastActionNotice: `${cleanName} hat den Raum eröffnet`,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const playerPayload: PlayerData = {
    uid: hostUid,
    name: cleanName,
    avatar: profile.avatar,
    isJunior: profile.isJunior,
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
    await setDoc(doc(db, 'rooms', code), roomPayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `rooms/${code}`);
  }

  try {
    await setDoc(doc(db, 'rooms', code, 'players', hostUid), playerPayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `rooms/${code}/players/${hostUid}`);
  }

  return code;
}

export async function joinRoom(
  rawCode: string,
  uid: string,
  profile: LocalPlayerProfile
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
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

export async function updatePlayerProfileInLobby(
  code: string,
  uid: string,
  profile: LocalPlayerProfile
): Promise<void> {
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

export async function startMatch(room: RoomData, hostUid: string): Promise<void> {
  let secretThemes: string[] = [];
  try {
    const q = query(
      collection(db, 'rooms', room.code, 'secretThemes'),
      where('hostUid', '==', hostUid)
    );
    const snap = await getDocs(q);
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
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
  }
}

export async function dealMyHandForRound(
  code: string,
  uid: string,
  roundNumber: number,
  isJunior: boolean,
  ruleVariant: RuleVariant
): Promise<void> {
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

export async function transitionCountdownToPlaying(room: RoomData): Promise<void> {
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

export async function advanceTheme(room: RoomData, notice = 'Neues Thema!'): Promise<void> {
  const nextIndex = (room.currentThemeIndex + 1) % Math.max(1, room.deckThemes.length);
  const nextTheme = room.deckThemes[nextIndex] || 'Bunte Alltagswörter';
  try {
    await updateDoc(doc(db, 'rooms', room.code), {
      currentThemeIndex: nextIndex,
      currentTheme: nextTheme,
      usedWords: [],
      status: 'COUNTDOWN',
      turnEndsAt: Date.now() + 3400,
      activeTurnUid:
        room.turnMode === 'TURN_BASED'
          ? getNextActiveTurnUid(room)
          : '',
      lastActionNotice: notice,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
  }
}

export async function advanceTurnInTurnBasedMode(room: RoomData, notice: string): Promise<void> {
  const nextUid = getNextActiveTurnUid(room);
  try {
    await updateDoc(doc(db, 'rooms', room.code), {
      activeTurnUid: nextUid,
      turnEndsAt: Date.now() + room.roundDurationSec * 1000,
      lastActionNotice: notice,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
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
}): Promise<string> {
  const { room, player, word, normalizedWord, matchedLetter, cardIndex, reason } = params;
  const newCards = player.cards.filter((_, idx) => idx !== cardIndex);
  const hasFinished = newCards.length === 0;
  const newWinnersOrder =
    hasFinished && !room.winnersOrder.includes(player.uid)
      ? [...room.winnersOrder, player.uid]
      : room.winnersOrder;

  const remainingPlayers = room.playerOrder.filter((uid) => !newWinnersOrder.includes(uid));
  const shouldEndRound =
    room.playerOrder.length <= 1 ? hasFinished : remainingPlayers.length <= 1;

  const nextTurnUid =
    room.turnMode === 'TURN_BASED'
      ? getNextActiveTurnUid(room, hasFinished ? player.uid : undefined)
      : '';

  const notice = hasFinished
    ? `${player.name} hat alle Karten abgelegt!`
    : `${player.name}: "${word}" (${matchedLetter === 'JOKER' ? '★ Joker' : matchedLetter})`;

  try {
    await updateDoc(doc(db, 'rooms', room.code, 'players', player.uid), {
      cards: newCards,
      cardCount: newCards.length,
      finishedRound: hasFinished ? room.roundNumber : player.finishedRound,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}/players/${player.uid}`);
  }

  try {
    await updateDoc(doc(db, 'rooms', room.code), {
      usedWords: [...room.usedWords, normalizedWord].slice(0, 100),
      winnersOrder: newWinnersOrder,
      status: shouldEndRound ? 'ROUND_END' : room.status,
      activeTurnUid: shouldEndRound ? '' : nextTurnUid,
      turnEndsAt:
        !shouldEndRound && room.turnMode === 'TURN_BASED'
          ? Date.now() + room.roundDurationSec * 1000
          : room.turnEndsAt,
      [`playersMeta.${player.uid}.cardCount`]: newCards.length,
      [`playersMeta.${player.uid}.finishedRound`]: hasFinished ? room.roundNumber : player.finishedRound,
      lastActionNotice: notice.slice(0, 160),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
  }

  try {
    const feedRef = await addDoc(collection(db, 'rooms', room.code, 'feed'), {
      uid: player.uid,
      playerName: player.name,
      avatar: player.avatar,
      word: word.slice(0, 64),
      letter: matchedLetter,
      theme: room.currentTheme.slice(0, 120),
      roundNumber: room.roundNumber,
      valid: true,
      reason: reason.slice(0, 200),
      undone: false,
      visibleTo: room.playerOrder,
      createdAt: serverTimestamp(),
    });
    return feedRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `rooms/${room.code}/feed`);
  }
}

export async function recordRejectedWord(params: {
  room: RoomData;
  player: PlayerData;
  word: string;
  reason: string;
  penaltyApplied: boolean;
}): Promise<{ feedId: string; penaltyCard: string | null }> {
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
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}/players/${player.uid}`);
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
  const { room, player, entry, normalizedWord } = params;
  if (entry.undone) return;

  let nextCards = [...player.cards];
  if (entry.valid && entry.letter) {
    nextCards = [...nextCards, entry.letter].slice(0, 25);
  } else if (!entry.valid && entry.letter.startsWith('+')) {
    const addedCard = entry.letter.slice(1);
    const idx = nextCards.lastIndexOf(addedCard);
    if (idx !== -1) {
      nextCards.splice(idx, 1);
    }
  }

  const nextUsedWords = entry.valid
    ? room.usedWords.filter((w) => w !== normalizedWord)
    : room.usedWords;

  const nextWinnersOrder = room.winnersOrder.filter((u) => u !== player.uid);

  try {
    await updateDoc(doc(db, 'rooms', room.code, 'players', player.uid), {
      cards: nextCards,
      cardCount: nextCards.length,
      finishedRound: 0,
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'rooms', room.code), {
      usedWords: nextUsedWords,
      winnersOrder: nextWinnersOrder,
      [`playersMeta.${player.uid}.cardCount`]: nextCards.length,
      [`playersMeta.${player.uid}.finishedRound`]: 0,
      lastActionNotice: `${player.name} hat "${entry.word}" zurückgenommen`,
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'rooms', room.code, 'feed', entry.id), {
      undone: true,
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
  const idx = player.actionCards.indexOf(actionType);
  if (idx === -1) return player.actionCards;
  const nextActions = [...player.actionCards];
  nextActions.splice(idx, 1);
  try {
    await updateDoc(doc(db, 'rooms', code, 'players', player.uid), {
      actionCards: nextActions,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${code}/players/${player.uid}`);
  }
  return nextActions;
}

export async function playChaosThemeSwap(room: RoomData, player: PlayerData): Promise<void> {
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
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
  }
}

export async function playChaosTimeTurbo(room: RoomData, player: PlayerData): Promise<void> {
  await consumeActionCard(room.code, player, 'TIME_TURBO');
  try {
    await updateDoc(doc(db, 'rooms', room.code), {
      turnEndsAt: Math.min(room.turnEndsAt, Date.now() + 5500),
      lastActionNotice: `⚡ ${player.name} zündet den Zeit-Turbo (5s)!`,
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
  const shouldEndRound =
    room.playerOrder.length <= 1 ? hasFinished : remainingPlayers.length <= 1;

  try {
    await updateDoc(doc(db, 'rooms', room.code, 'players', sender.uid), {
      cards: nextCards,
      cardCount: nextCards.length,
      actionCards: nextActions,
      finishedRound: hasFinished ? room.roundNumber : sender.finishedRound,
      updatedAt: serverTimestamp(),
    });

    await updateDoc(doc(db, 'rooms', room.code), {
      winnersOrder: newWinnersOrder,
      status: shouldEndRound ? 'ROUND_END' : room.status,
      [`playersMeta.${sender.uid}.cardCount`]: nextCards.length,
      [`playersMeta.${sender.uid}.finishedRound`]: hasFinished ? room.roundNumber : sender.finishedRound,
      lastActionNotice: `🎁 ${sender.name} schenkt ${targetName} eine Karte!`,
      updatedAt: serverTimestamp(),
    });

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

export async function hostCheckGameOverOrNextRound(room: RoomData, action: 'FINISH_CHECK' | 'NEXT_ROUND'): Promise<void> {
  if (action === 'FINISH_CHECK') {
    const someoneWon = Object.values(room.playersMeta).some((p) => p.score >= room.targetScore);
    if (someoneWon) {
      try {
        await updateDoc(doc(db, 'rooms', room.code), {
          status: 'GAME_OVER',
          lastActionNotice: 'Wir haben eine Siegerin oder einen Sieger!',
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
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
  }
}

export async function hostFinishRoundManually(room: RoomData): Promise<void> {
  try {
    await updateDoc(doc(db, 'rooms', room.code), {
      status: 'ROUND_END',
      activeTurnUid: '',
      lastActionNotice: 'Runde beendet — Punkte werden gezählt!',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
  }
}

export async function hostResetRoomToLobby(room: RoomData): Promise<void> {
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
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${room.code}`);
  }
}
