import { useEffect, useRef } from 'react';
import { findLocalBotWord } from '../data/localBotWords';
import {
  findBestMatchingCard,
  isRareLetter,
  normalizeWord,
  shuffleArray,
  stripGermanArticle,
} from '../data/themesAndCards';
import { generateBotWordsViaProxy, getStoredFamilyPin } from '../lib/geminiProxy';
import {
  BOT_DIFFICULTY_META,
  getBotPlayerData,
  playChaosThemeSwap,
  playChaosTimeTurbo,
  recordAcceptedWord,
  sendChaosBlock,
  sendChaosGift,
} from '../lib/roomService';
import type { ActionCardType, RoomData } from '../types/game';

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
    const effectivePin = familyPin.trim() || getStoredFamilyPin();
    if (!isHost || !room || room.status !== 'PLAYING' || !effectivePin) {
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
      const staggerMs = isFirstTurn ? Math.min(800, botIndex * 350) : 0;
      const delayMs = Math.min(maxMs, baseDelay + staggerMs);

      // Prefetch AI word suggestion in parallel with the wait timer (3s timeout)
      const controller = new AbortController();
      abortControllers.push(controller);

      const aiSuggestionsPromise = (async () => {
        try {
          const snapshotBot = await getBotPlayerData(latestCheckRoom.code, botUid);
          if (!snapshotBot || snapshotBot.cards.length === 0 || cancelled) return [];
          return await generateBotWordsViaProxy({
            pin: effectivePin,
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

        // Respect Ice Block freeze on bot
        const now = Date.now();
        if (latestBot.blockedUntil && latestBot.blockedUntil > now) {
          controller.abort();
          const waitFreezeMs = Math.min(6200, latestBot.blockedUntil - now + 200);
          const unfreezeId = window.setTimeout(() => {
            scheduleBotMove(botUid, botIndex, false);
          }, waitFreezeMs);
          registerTimer(unfreezeId);
          return;
        }

        // In CHAOS mode, ~25% chance to play a meaningful active action card before/alongside turn
        if (
          liveRoom.ruleVariant === 'CHAOS' &&
          latestBot.actionCards.length > 0 &&
          Math.random() < 0.25
        ) {
          const activeOpponents = liveRoom.playerOrder
            .filter((uid) => uid !== botUid && !liveRoom.winnersOrder.includes(uid))
            .map((uid) => liveRoom.playersMeta[uid])
            .filter(Boolean)
            .sort((a, b) => a.cardCount - b.cardCount);

          const playableActions = shuffleArray(
            latestBot.actionCards.filter((a): a is Exclude<ActionCardType, 'SHIELD'> => {
              if (a === 'SHIELD') return false;
              if (a === 'BLOCK_PLAYER') return activeOpponents.length > 0;
              if (a === 'GIFT') return activeOpponents.length > 0 && latestBot.cards.length >= 2;
              if (a === 'TIME_TURBO') return liveRoom.turnEndsAt - Date.now() > 7500;
              return a === 'THEME_SWAP';
            })
          );

          const chosenAction = playableActions[0];
          if (chosenAction === 'BLOCK_PLAYER' && activeOpponents[0]) {
            controller.abort();
            await sendChaosBlock({
              room: liveRoom,
              sender: latestBot,
              targetUid: activeOpponents[0].uid,
              targetName: activeOpponents[0].name,
            });
            if (!cancelled && liveRoom.turnMode === 'SIMULTANEOUS') {
              scheduleBotMove(botUid, botIndex, false);
            }
            return;
          }
          if (chosenAction === 'GIFT' && activeOpponents[0]) {
            controller.abort();
            // Prefer giving away a rare or regular non-Joker card
            let giftCardIdx = latestBot.cards.findIndex((c) => isRareLetter(c));
            if (giftCardIdx === -1) {
              giftCardIdx = latestBot.cards.findIndex((c) => c !== 'JOKER');
            }
            if (giftCardIdx === -1) giftCardIdx = 0;
            await sendChaosGift({
              room: liveRoom,
              sender: latestBot,
              targetUid: activeOpponents[0].uid,
              targetName: activeOpponents[0].name,
              cardIndex: giftCardIdx,
            });
            if (!cancelled && liveRoom.turnMode === 'SIMULTANEOUS') {
              scheduleBotMove(botUid, botIndex, false);
            }
            return;
          }
          if (chosenAction === 'TIME_TURBO') {
            controller.abort();
            await playChaosTimeTurbo(liveRoom, latestBot);
            if (!cancelled && liveRoom.turnMode === 'SIMULTANEOUS') {
              scheduleBotMove(botUid, botIndex, false);
            }
            return;
          }
          if (chosenAction === 'THEME_SWAP') {
            controller.abort();
            await playChaosThemeSwap(liveRoom, latestBot);
            return;
          }
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

        // 1. Try AI suggestion first (supports Q/X/Y anywhere in word, Joker only as last resort)
        for (const candidate of aiSuggestions) {
          const norm =
            normalizeWord(stripGermanArticle(candidate.word)) ||
            normalizeWord(candidate.word);
          if (!norm || norm.length < 2 || usedSet.has(norm)) continue;

          const match = findBestMatchingCard(candidate.word, latestBot.cards, null);
          if (match.matched) {
            chosenWord = candidate.word;
            chosenNormalized = norm;
            chosenLetter = match.matchedLetter;
            chosenCardIndex = match.cardIndex;
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

          // Schedule next autonomous move if cards remain and round is still running
          if (
            !result.shouldEndRound &&
            latestBot.cards.length - 1 > 0 &&
            freshRoom.turnMode === 'SIMULTANEOUS'
          ) {
            scheduleBotMove(botUid, botIndex, false);
          }
        } else if (freshRoom.turnMode === 'SIMULTANEOUS') {
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
