import { useEffect, useRef } from 'react';
import { findLocalBotWord } from '../data/localBotWords';
import {
  extractStartingLetter,
  normalizeWord,
  stripGermanArticle,
} from '../data/themesAndCards';
import { generateBotWordsViaProxy } from '../lib/geminiProxy';
import {
  BOT_DIFFICULTY_META,
  getBotPlayerData,
  recordAcceptedWord,
} from '../lib/roomService';
import type { RoomData } from '../types/game';

interface UseBotRunnerOptions {
  room: RoomData | null;
  isHost: boolean;
  familyPin: string;
  onBotPlayedWord?: () => void;
}

export function useBotRunner({
  room,
  isHost,
  familyPin,
  onBotPlayedWord,
}: UseBotRunnerOptions) {
  const roomRef = useRef<RoomData | null>(room);
  roomRef.current = room;

  const onBotPlayedRef = useRef(onBotPlayedWord);
  onBotPlayedRef.current = onBotPlayedWord;

  useEffect(() => {
    if (!isHost || !room || room.status !== 'PLAYING' || !familyPin) {
      return;
    }

    // Wait if round is in its 1.2s finishing delay (turnEndsAt === 0)
    if (room.turnEndsAt === 0) {
      return;
    }

    const activeRoundNumber = room.roundNumber;
    const activeThemeIndex = room.currentThemeIndex;
    const activeTheme = room.currentTheme;
    const activeTurnMode = room.turnMode;
    const activeTurnUid = room.activeTurnUid;

    const botsToRun = room.playerOrder.filter((uid) => {
      const meta = room.playersMeta[uid];
      if (!meta || !meta.isBot || meta.cardCount <= 0) return false;
      if (activeTurnMode === 'TURN_BASED') {
        return activeTurnUid === uid;
      }
      return true;
    });

    if (botsToRun.length === 0) return;

    let cancelled = false;
    const timerIds: number[] = [];
    const abortControllers: AbortController[] = [];

    const registerTimer = (id: number) => {
      timerIds.push(id);
    };

    const scheduleBotMove = (botUid: string, botIndex: number, isFirstTurn: boolean) => {
      if (cancelled) return;
      const latestCheckRoom = roomRef.current;
      if (
        !latestCheckRoom ||
        latestCheckRoom.status !== 'PLAYING' ||
        latestCheckRoom.turnEndsAt === 0 ||
        latestCheckRoom.roundNumber !== activeRoundNumber ||
        latestCheckRoom.currentThemeIndex !== activeThemeIndex
      ) {
        return;
      }

      const meta = latestCheckRoom.playersMeta[botUid];
      if (!meta || !meta.isBot || meta.cardCount <= 0) return;
      if (activeTurnMode === 'TURN_BASED' && latestCheckRoom.activeTurnUid !== botUid) {
        return;
      }

      const diff = meta.botDifficulty === 'NONE' ? 'NORMAL' : meta.botDifficulty;
      const { minMs, maxMs } = BOT_DIFFICULTY_META[diff];
      const baseDelay = Math.floor(minMs + Math.random() * (maxMs - minMs));
      // Slight stagger when multiple bots run simultaneously so moves feel natural
      const staggerMs = isFirstTurn ? Math.min(800, botIndex * 350) : 0;
      const delayMs = Math.min(maxMs, baseDelay + staggerMs);

      // Prefetch AI word suggestion in parallel with the 4–8s wait timer (3s timeout)
      const controller = new AbortController();
      abortControllers.push(controller);

      const aiSuggestionsPromise = (async () => {
        try {
          const snapshotBot = await getBotPlayerData(latestCheckRoom.code, botUid);
          if (!snapshotBot || snapshotBot.cards.length === 0 || cancelled) return [];
          return await generateBotWordsViaProxy({
            pin: familyPin,
            theme: activeTheme,
            cards: snapshotBot.cards,
            usedWords: roomRef.current?.usedWords ?? latestCheckRoom.usedWords,
            botName: snapshotBot.name,
            timeoutMs: 3000,
            signal: controller.signal,
          });
        } catch {
          return [];
        }
      })();

      const timerId = window.setTimeout(async () => {
        if (cancelled) return;
        const liveRoom = roomRef.current;
        if (
          !liveRoom ||
          liveRoom.status !== 'PLAYING' ||
          liveRoom.turnEndsAt === 0 ||
          liveRoom.roundNumber !== activeRoundNumber ||
          liveRoom.currentThemeIndex !== activeThemeIndex
        ) {
          return;
        }
        if (liveRoom.turnMode === 'TURN_BASED' && liveRoom.activeTurnUid !== botUid) {
          return;
        }

        const latestBot = await getBotPlayerData(liveRoom.code, botUid);
        if (cancelled || !latestBot || latestBot.cards.length === 0) return;

        // Retry shortly if bot hand is still being dealt
        if (latestBot.roundDealt < liveRoom.roundNumber) {
          const retryId = window.setTimeout(() => {
            scheduleBotMove(botUid, botIndex, false);
          }, 600);
          registerTimer(retryId);
          return;
        }

        // Wait briefly at most 400ms for in-flight Gemini result, otherwise use local fallback immediately
        const aiSuggestions = await Promise.race([
          aiSuggestionsPromise,
          new Promise<Array<{ word: string; letter: string }>>((resolve) =>
            window.setTimeout(() => resolve([]), 400)
          ),
        ]);
        controller.abort();

        if (cancelled) return;
        const freshRoom = roomRef.current;
        if (
          !freshRoom ||
          freshRoom.status !== 'PLAYING' ||
          freshRoom.turnEndsAt === 0 ||
          freshRoom.roundNumber !== activeRoundNumber ||
          freshRoom.currentThemeIndex !== activeThemeIndex
        ) {
          return;
        }

        const usedSet = new Set(freshRoom.usedWords.map((w) => normalizeWord(w)));

        let chosenWord = '';
        let chosenNormalized = '';
        let chosenLetter = '';
        let chosenCardIndex = -1;
        let usedAi = false;

        // 1. Try AI suggestion first (must match an unblocked hand letter and not be in usedWords)
        for (const candidate of aiSuggestions) {
          const norm =
            normalizeWord(stripGermanArticle(candidate.word)) ||
            normalizeWord(candidate.word);
          if (!norm || norm.length < 2 || usedSet.has(norm)) continue;

          const startLetter = extractStartingLetter(
            stripGermanArticle(candidate.word)
          );
          let cardIdx = latestBot.cards.findIndex((c) => c === startLetter);
          let matchedLetter = startLetter;

          if (cardIdx === -1 && candidate.letter) {
            cardIdx = latestBot.cards.findIndex((c) => c === candidate.letter);
            matchedLetter = candidate.letter;
          }
          if (cardIdx === -1) {
            cardIdx = latestBot.cards.findIndex((c) => c === 'JOKER');
            matchedLetter = 'JOKER';
          }

          if (cardIdx !== -1 && matchedLetter) {
            chosenWord = candidate.word;
            chosenNormalized = norm;
            chosenLetter = matchedLetter;
            chosenCardIndex = cardIdx;
            usedAi = true;
            break;
          }
        }

        // 2. Local German fallback if AI timed out, errored, or returned no usable word
        if (chosenCardIndex === -1) {
          const fallback = findLocalBotWord({
            theme: freshRoom.currentTheme,
            cards: latestBot.cards,
            usedWords: freshRoom.usedWords,
          });
          if (fallback) {
            const cardIdx = latestBot.cards.findIndex((c) => c === fallback.letter);
            if (cardIdx !== -1) {
              chosenWord = fallback.word;
              chosenNormalized =
                normalizeWord(stripGermanArticle(fallback.word)) ||
                normalizeWord(fallback.word);
              chosenLetter = fallback.letter;
              chosenCardIndex = cardIdx;
            }
          }
        }

        if (chosenCardIndex === -1 || !chosenWord || !chosenNormalized) {
          if (freshRoom.turnMode === 'SIMULTANEOUS') {
            scheduleBotMove(botUid, botIndex, false);
          }
          return;
        }

        const result = await recordAcceptedWord({
          room: freshRoom,
          player: latestBot,
          word: chosenWord,
          normalizedWord: chosenNormalized,
          matchedLetter: chosenLetter,
          cardIndex: chosenCardIndex,
          reason: usedAi
            ? 'KI-Mitspieler hat blitzschnell geantwortet!'
            : 'KI-Mitspieler hat blitzschnell kombiniert!',
        });

        if (cancelled) return;

        if (result.accepted) {
          onBotPlayedRef.current?.();

          // Schedule next autonomous move in 4–8s if cards remain and round is still running
          if (
            !result.shouldEndRound &&
            latestBot.cards.length - 1 > 0 &&
            freshRoom.turnMode === 'SIMULTANEOUS'
          ) {
            scheduleBotMove(botUid, botIndex, false);
          }
        } else if (freshRoom.turnMode === 'SIMULTANEOUS') {
          // Word was sniped right before commit -> try again in 4–8s
          scheduleBotMove(botUid, botIndex, false);
        }
      }, delayMs);

      registerTimer(timerId);
    };

    botsToRun.forEach((botUid, idx) => {
      scheduleBotMove(botUid, idx, true);
    });

    return () => {
      cancelled = true;
      timerIds.forEach((id) => window.clearTimeout(id));
      abortControllers.forEach((c) => c.abort());
    };
  }, [
    isHost,
    familyPin,
    room?.code,
    room?.status,
    room?.roundNumber,
    room?.currentThemeIndex,
    room?.turnMode,
    room?.activeTurnUid,
    room?.turnEndsAt === 0,
  ]);
}
