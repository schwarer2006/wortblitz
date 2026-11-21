import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  FastForward,
  LogOut,
  Megaphone,
  Mic,
  MicOff,
  RefreshCw,
  RotateCcw,
  Send,
  Shield,
  Snowflake,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import {
  ACTION_CARD_META,
  findBestMatchingCard,
  getAvatar,
  getLetterCardColors,
  isRareLetter,
  normalizeWord,
  stripGermanArticle,
} from '../data/themesAndCards';
import { useSpeechRecognition, type MicMode } from '../hooks/useSpeechRecognition';
import { getStoredFamilyPin, judgeWordViaProxy } from '../lib/geminiProxy';
import {
  playActionSound,
  playCardTap,
  playCountdownBeep,
  playErrorBuzz,
  playSuccessChime,
} from '../lib/soundAndSpeech';
import type {
  ActionCardType,
  ChaosEvent,
  FeedEntry,
  PlayerData,
  RoomData,
} from '../types/game';

interface GameViewProps {
  room: RoomData;
  myUid: string;
  familyPin: string;
  myPlayer: PlayerData;
  feedEntries: FeedEntry[];
  pendingGifts: ChaosEvent[];
  muted: boolean;
  isTableAudioDevice: boolean;
  onToggleTableAudio: () => void;
  onToggleMute: () => void;
  onCountdownFinished: () => Promise<void>;
  onThemeTimedOut: () => Promise<void>;
  onTurnTimedOut: () => Promise<void>;
  onAcceptWord: (params: {
    word: string;
    normalizedWord: string;
    matchedLetter: string;
    cardIndex: number;
    reason: string;
  }) => Promise<
    | { accepted: true; feedId: string; shouldEndRound: boolean }
    | { accepted: false; reason: string }
  >;
  onRejectWord: (params: {
    word: string;
    reason: string;
    penaltyApplied: boolean;
    wrongLetter?: boolean;
    expectedLetter?: string;
  }) => Promise<{ feedId: string; penaltyCard: string | null }>;
  onSwapCard: (
    cardIndex: number
  ) => Promise<
    | { ok: true; oldLetter: string; newLetter: string }
    | { ok: false; reason: string }
  >;
  onUndoEntry: (entry: FeedEntry, normalizedWord: string) => Promise<void>;
  onConsumeShieldForPenalty: () => Promise<void>;
  onPlayThemeSwap: () => Promise<void>;
  onPlayTimeTurbo: () => Promise<void>;
  onSendGift: (targetUid: string, targetName: string, cardIndex: number) => Promise<void>;
  onResolveGift: (event: ChaosEvent, useShield: boolean) => Promise<void>;
  onSendBlock: (targetUid: string, targetName: string) => Promise<void>;
  onResolveBlock: (event: ChaosEvent, useShield: boolean) => Promise<void>;
  onFinishRoundManually: () => Promise<void>;
  onLogout: () => void;
}

interface JudgeFeedback {
  type: 'VALID' | 'INVALID' | 'CHECKING' | 'INFO';
  word: string;
  reason: string;
  canShieldPenalty?: boolean;
}

type ChaosTargetMode =
  | {
      type: 'GIFT';
      step: 'PICK_CARD' | 'PICK_TARGET';
      cardIndex: number | null;
    }
  | {
      type: 'BLOCK';
    }
  | null;

export const GameView: React.FC<GameViewProps> = ({
  room,
  myUid,
  familyPin,
  myPlayer,
  feedEntries,
  pendingGifts,
  muted,
  isTableAudioDevice,
  onToggleTableAudio,
  onToggleMute,
  onCountdownFinished,
  onThemeTimedOut,
  onTurnTimedOut,
  onAcceptWord,
  onRejectWord,
  onSwapCard,
  onUndoEntry,
  onConsumeShieldForPenalty,
  onPlayThemeSwap,
  onPlayTimeTurbo,
  onSendGift,
  onResolveGift,
  onSendBlock,
  onResolveBlock,
  onFinishRoundManually,
  onLogout,
}) => {
  const isHost = room.hostUid === myUid;
  const hasFinishedHand = myPlayer.cards.length === 0;
  const isMyTurn =
    room.turnMode === 'SIMULTANEOUS' || room.activeTurnUid === myUid;

  // In Tablet Table Mode, smartphones automatically mute TTS & sounds (tablet plays audio exclusively)
  const effectiveMuted = room.tableDisplayActive ? true : muted;

  // Push-to-Talk is default for noisy rounds
  const [micMode, setMicMode] = useState<MicMode>('PUSH_TO_TALK');
  const [manualInput, setManualInput] = useState('');
  const [selectedCardIndex, setSelectedCardIndex] = useState<number | null>(null);
  const [swappingCard, setSwappingCard] = useState(false);
  const [feedback, setFeedback] = useState<JudgeFeedback | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [countdownStep, setCountdownStep] = useState<number>(3);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [chaosTargetMode, setChaosTargetMode] = useState<ChaosTargetMode>(null);
  const [pendingPenaltyState, setPendingPenaltyState] = useState<{
    word: string;
    reason: string;
  } | null>(null);

  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const autoHandledBlocksRef = useRef<Set<string>>(new Set());
  const timerHandledKeyRef = useRef<string>('');
  const isCheckingRef = useRef(false);

  // Refs for single clean round timer so callbacks/mute changes never restart setInterval
  const timerCallbacksRef = useRef({
    onCountdownFinished,
    onThemeTimedOut,
    onTurnTimedOut,
    effectiveMuted,
    isHost,
    myUid,
    turnMode: room.turnMode,
    activeTurnUid: room.activeTurnUid,
  });
  timerCallbacksRef.current = {
    onCountdownFinished,
    onThemeTimedOut,
    onTurnTimedOut,
    effectiveMuted,
    isHost,
    myUid,
    turnMode: room.turnMode,
    activeTurnUid: room.activeTurnUid,
  };

  const myLatestUndoableEntry = useMemo(() => {
    return feedEntries.find(
      (entry) =>
        entry.uid === myUid && !entry.undone && entry.roundNumber === room.roundNumber
    );
  }, [feedEntries, myUid, room.roundNumber]);

  const activeFeed = useMemo(() => {
    return feedEntries
      .filter(
        (entry) =>
          !entry.undone &&
          entry.roundNumber === room.roundNumber &&
          entry.theme === room.currentTheme
      )
      .slice(0, 10);
  }, [feedEntries, room.roundNumber, room.currentTheme]);

  const isRoundEndingDelay = room.status === 'PLAYING' && room.turnEndsAt === 0;
  const isTimeUpNotice =
    (room.status === 'COUNTDOWN' && room.lastActionNotice.startsWith('Zeit um')) ||
    (room.status === 'PLAYING' && room.turnEndsAt > 0 && secondsLeft === 0);

  useEffect(() => {
    if (room.status !== 'COUNTDOWN' && room.status !== 'PLAYING') {
      setSecondsLeft(0);
      return;
    }

    // Round is in its 1.2s finishing delay after last card: stop timer cleanly
    if (room.status === 'PLAYING' && room.turnEndsAt === 0) {
      setSecondsLeft(0);
      return;
    }

    const updateTimer = () => {
      const cb = timerCallbacksRef.current;
      const diffMs = Math.max(0, room.turnEndsAt - Date.now());
      const secs = Math.ceil(diffMs / 1000);
      setSecondsLeft(secs);

      if (room.status === 'COUNTDOWN') {
        const step = secs <= 1 ? 1 : secs;
        setCountdownStep(Math.min(3, Math.max(1, step)));
        const key = `cd-${room.roundNumber}-${room.currentThemeIndex}-${room.turnEndsAt}`;
        if (diffMs <= 0 && cb.isHost && timerHandledKeyRef.current !== key) {
          timerHandledKeyRef.current = key;
          playCountdownBeep(true, cb.effectiveMuted);
          cb.onCountdownFinished();
        }
      } else if (room.status === 'PLAYING' && room.turnEndsAt > 0) {
        const key = `play-${room.roundNumber}-${room.currentThemeIndex}-${room.turnEndsAt}`;
        if (diffMs <= 0 && timerHandledKeyRef.current !== key) {
          timerHandledKeyRef.current = key;
          if (cb.turnMode === 'SIMULTANEOUS' && cb.isHost) {
            cb.onThemeTimedOut();
          } else if (
            cb.turnMode === 'TURN_BASED' &&
            (cb.isHost || cb.activeTurnUid === cb.myUid)
          ) {
            cb.onTurnTimedOut();
          }
        }
      }
    };

    updateTimer();
    const intervalId = window.setInterval(updateTimer, 200);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [room.status, room.turnEndsAt, room.roundNumber, room.currentThemeIndex]);

  // Live Ice Block countdown tick
  const blockedUntilMs = myPlayer.blockedUntil ?? 0;
  const isFrozen = blockedUntilMs > nowMs;
  const iceSecondsLeft = isFrozen
    ? Math.max(1, Math.ceil((blockedUntilMs - nowMs) / 1000))
    : 0;

  useEffect(() => {
    setNowMs(Date.now());
    if (blockedUntilMs <= Date.now()) return;
    const id = window.setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      if (current >= blockedUntilMs) {
        window.clearInterval(id);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [blockedUntilMs]);

  // Keep selectedCardIndex valid when hand changes or round changes
  useEffect(() => {
    if (
      selectedCardIndex !== null &&
      selectedCardIndex >= myPlayer.cards.length
    ) {
      setSelectedCardIndex(null);
    }
  }, [myPlayer.cards.length, selectedCardIndex]);

  useEffect(() => {
    setSelectedCardIndex(null);
  }, [room.roundNumber]);

  const pendingGiftEvents = useMemo(
    () => pendingGifts.filter((e) => e.type === 'GIFT'),
    [pendingGifts]
  );
  const pendingBlockEvents = useMemo(
    () => pendingGifts.filter((e) => e.type === 'BLOCK'),
    [pendingGifts]
  );

  // If incoming BLOCK arrives and player has NO Shield, freeze immediately without waiting for click
  useEffect(() => {
    const incomingBlock = pendingBlockEvents[0];
    if (!incomingBlock) return;
    if (myPlayer.actionCards.includes('SHIELD')) return;
    if (autoHandledBlocksRef.current.has(incomingBlock.id)) return;
    autoHandledBlocksRef.current.add(incomingBlock.id);
    playErrorBuzz(effectiveMuted);
    onResolveBlock(incomingBlock, false);
  }, [pendingBlockEvents, myPlayer.actionCards, effectiveMuted, onResolveBlock]);

  const selectedLetter =
    selectedCardIndex !== null ? (myPlayer.cards[selectedCardIndex] ?? null) : null;
  const canUseEmergencySwap =
    room.status === 'PLAYING' &&
    room.turnEndsAt > 0 &&
    !isFrozen &&
    selectedCardIndex !== null &&
    (myPlayer.swappedRound ?? 0) < room.roundNumber;

  const inputPlaceholder = useMemo(() => {
    if (isFrozen) {
      return `❄️ Eingefroren (${iceSecondsLeft}s)…`;
    }
    if (selectedLetter) {
      if (selectedLetter === 'JOKER') {
        return `Beliebiges Wort oder Satz (A–Z) zu ${room.currentTheme}...`;
      }
      if (isRareLetter(selectedLetter)) {
        return `Wort oder Satz mit ${selectedLetter} im Wort...`;
      }
      return `Wort oder Satz mit ${selectedLetter} zu ${room.currentTheme}...`;
    }
    return 'Wort oder Satz sprechen / eintippen…';
  }, [isFrozen, iceSecondsLeft, selectedLetter, room.currentTheme]);

  const handleSubmitSpokenWord = useCallback(
    async (rawSpoken: string) => {
      if (
        room.status !== 'PLAYING' ||
        room.turnEndsAt === 0 ||
        hasFinishedHand ||
        !isMyTurn ||
        isFrozen ||
        isCheckingRef.current
      ) {
        return;
      }

      const cleaned = rawSpoken.trim();
      if (!cleaned) return;
      const normalized =
        normalizeWord(stripGermanArticle(cleaned)) || normalizeWord(cleaned);
      if (!normalized || normalized.length < 2) return;

      // Stage 1: Letter / Card Check (wrong letter => immediate -1 Strafpunkt!)
      const match = findBestMatchingCard(
        cleaned,
        myPlayer.cards,
        selectedCardIndex
      );
      if (!match.matched) {
        playErrorBuzz(effectiveMuted);
        const wrongMsg =
          match.reason === 'WRONG_SELECTED_LETTER'
            ? `"${cleaned}" passt nicht zu Karte ${match.expectedLetter} (-1 Strafpunkt)`
            : `"${cleaned}" passt zu keiner Karte auf deiner Hand (-1 Strafpunkt)`;

        setFeedback({
          type: 'INVALID',
          word: cleaned,
          reason: wrongMsg,
        });

        await onRejectWord({
          word: cleaned,
          reason: wrongMsg,
          penaltyApplied: false,
          wrongLetter: true,
          expectedLetter: match.expectedLetter,
        });
        return;
      }

      // Stage 2: Duplicate Check (no penalty point on simultaneous collision)
      if (room.usedWords.includes(normalized)) {
        playErrorBuzz(effectiveMuted);
        setFeedback({
          type: 'INFO',
          word: cleaned,
          reason: `"${cleaned}" wurde bei diesem Thema schon genannt!`,
        });
        return;
      }

      // Stage 3: Strict Gemini Referee via ./gemini.php
      isCheckingRef.current = true;
      setFeedback({
        type: 'CHECKING',
        word: cleaned,
        reason: 'KI-Schiedsrichter prüft…',
      });

      try {
        const effectivePin = familyPin.trim() || getStoredFamilyPin();
        const result = await judgeWordViaProxy({
          pin: effectivePin,
          word: cleaned,
          theme: room.currentTheme,
          isJunior: myPlayer.isJunior,
          matchedLetter: match.matchedLetter,
          isRareLetterMode: isRareLetter(match.matchedLetter),
        });

        if (!result.ok) {
          console.error('KI-Wortprüfung abgebrochen/fehlgeschlagen:', result.reason);
          setFeedback({
            type: 'INFO',
            word: cleaned,
            reason: result.reason,
          });
          return;
        }

        if (result.valid) {
          const acceptRes = await onAcceptWord({
            word: cleaned,
            normalizedWord: normalized,
            matchedLetter: match.matchedLetter,
            cardIndex: match.cardIndex,
            reason: result.reason,
          });

          if (acceptRes.accepted) {
            playSuccessChime(effectiveMuted);
            setSelectedCardIndex(null);
            setFeedback({
              type: 'VALID',
              word: cleaned,
              reason: `${result.reason} (+1 Punkt)`,
            });
          } else {
            setFeedback({
              type: 'INFO',
              word: cleaned,
              reason: acceptRes.reason,
            });
          }
        } else {
          playErrorBuzz(effectiveMuted);
          if (room.penaltyEnabled && myPlayer.actionCards.includes('SHIELD')) {
            setPendingPenaltyState({ word: cleaned, reason: result.reason });
            setFeedback({
              type: 'INVALID',
              word: cleaned,
              reason: `${result.reason} (-1 Strafpunkt)`,
              canShieldPenalty: true,
            });
          } else {
            const rejected = await onRejectWord({
              word: cleaned,
              reason: result.reason,
              penaltyApplied: room.penaltyEnabled,
            });
            setFeedback({
              type: 'INVALID',
              word: cleaned,
              reason: rejected.penaltyCard
                ? `${result.reason} (-1 Strafpunkt & +1 Strafkarte ${rejected.penaltyCard} gezogen!)`
                : `${result.reason} (-1 Strafpunkt)`,
            });
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('Unerwarteter Fehler bei Wortprüfung:', errMsg, err);
        setFeedback({
          type: 'INFO',
          word: cleaned,
          reason: errMsg.trim()
            ? `Technischer Fehler (${errMsg.trim()}) – bitte erneut versuchen.`
            : 'Prüfung gerade nicht möglich – bitte erneut versuchen.',
        });
      } finally {
        isCheckingRef.current = false;
      }
    },
    [
      room.status,
      room.turnEndsAt,
      room.usedWords,
      room.currentTheme,
      room.penaltyEnabled,
      familyPin,
      hasFinishedHand,
      isMyTurn,
      isFrozen,
      myPlayer.cards,
      myPlayer.isJunior,
      myPlayer.actionCards,
      selectedCardIndex,
      effectiveMuted,
      onAcceptWord,
      onRejectWord,
    ]
  );

  const micEnabled =
    room.status === 'PLAYING' &&
    room.turnEndsAt > 0 &&
    !hasFinishedHand &&
    isMyTurn &&
    !isFrozen &&
    !pendingPenaltyState;

  const {
    isSupported: speechSupported,
    isListening,
    interimText,
    micError,
    startListening,
    stopListening,
  } = useSpeechRecognition({
    enabled: micEnabled,
    mode: micMode,
    onFinalTranscript: handleSubmitSpokenWord,
  });

  const handleManualTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = manualInput.trim();
    if (!val || isFrozen) return;
    setManualInput('');
    await handleSubmitSpokenWord(val);
  };

  const handleTapLetterCard = (cardIndex: number) => {
    if (
      room.status !== 'PLAYING' ||
      room.turnEndsAt === 0 ||
      hasFinishedHand ||
      isFrozen ||
      isCheckingRef.current
    ) {
      return;
    }

    if (chaosTargetMode?.type === 'GIFT' && chaosTargetMode.step === 'PICK_CARD') {
      playCardTap(effectiveMuted);
      setChaosTargetMode({ type: 'GIFT', step: 'PICK_TARGET', cardIndex });
      return;
    }

    if (!isMyTurn) return;

    playCardTap(effectiveMuted);
    setSelectedCardIndex((prev) => {
      const next = prev === cardIndex ? null : cardIndex;
      if (next !== null) {
        window.setTimeout(() => {
          manualInputRef.current?.focus();
        }, 20);
      }
      return next;
    });
  };

  const handleEmergencySwapClick = async () => {
    if (
      selectedCardIndex === null ||
      swappingCard ||
      !canUseEmergencySwap
    ) {
      return;
    }
    setSwappingCard(true);
    try {
      const res = await onSwapCard(selectedCardIndex);
      if (res.ok) {
        playActionSound(effectiveMuted);
        setSelectedCardIndex(null);
        setFeedback({
          type: 'INFO',
          word: 'Notfall-Tausch',
          reason: `Karte ${res.oldLetter} gegen ${res.newLetter} getauscht!`,
        });
      } else {
        setFeedback({
          type: 'INFO',
          word: 'Notfall-Tausch',
          reason: res.reason,
        });
      }
    } finally {
      setSwappingCard(false);
    }
  };

  const handleActionCardClick = async (action: ActionCardType) => {
    if (room.status !== 'PLAYING' || isFrozen) return;
    if (action === 'THEME_SWAP') {
      playActionSound(effectiveMuted);
      await onPlayThemeSwap();
    } else if (action === 'TIME_TURBO') {
      playActionSound(effectiveMuted);
      await onPlayTimeTurbo();
    } else if (action === 'GIFT') {
      if (myPlayer.cards.length === 0) return;
      setChaosTargetMode({ type: 'GIFT', step: 'PICK_CARD', cardIndex: null });
    } else if (action === 'BLOCK_PLAYER') {
      if (otherActivePlayers.length === 0) return;
      setChaosTargetMode({ type: 'BLOCK' });
    }
  };

  const otherActivePlayers = room.playerOrder
    .filter((uid) => uid !== myUid)
    .map((uid) => room.playersMeta[uid])
    .filter(Boolean);

  const timerProgressPct =
    room.status === 'PLAYING'
      ? Math.min(100, Math.max(0, (secondsLeft / room.roundDurationSec) * 100))
      : 100;

  return (
    <div className="min-h-screen bg-[#0F1117] text-slate-100 flex flex-col">
      {/* Top Compact Bar + Opponents */}
      <header className="bg-[#161923] border-b border-white/10 px-3 py-2.5 shrink-0">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 flex-1">
            {room.playerOrder.map((uid) => {
              const p = room.playersMeta[uid];
              if (!p) return null;
              const av = getAvatar(p.avatar);
              const isTurn =
                room.turnMode === 'TURN_BASED' && room.activeTurnUid === uid;
              const done = p.cardCount === 0;
              return (
                <div
                  key={uid}
                  className={`px-2.5 py-1.5 rounded-xl border flex items-center gap-2 shrink-0 transition-all ${
                    isTurn
                      ? 'bg-amber-400/20 border-amber-400'
                      : done
                        ? 'bg-emerald-500/15 border-emerald-400/40'
                        : 'bg-[#0F1117] border-white/10'
                  }`}
                >
                  <span className="text-base">{av.emoji}</span>
                  <div className="leading-tight">
                    <div className="text-[11px] font-semibold text-white max-w-[76px] truncate flex items-center gap-1">
                      <span>{uid === myUid ? 'Du' : p.name}</span>
                      {p.isBot && <Bot className="w-3 h-3 text-sky-400 shrink-0" />}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-400">
                      {done ? `Fertig · ${p.score} P.` : `${p.cardCount} K. · ${p.score} P.`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onToggleTableAudio}
              title="Tisch-Ton auf diesem Gerät ein-/ausschalten"
              aria-label={
                isTableAudioDevice
                  ? 'Tisch-Ton auf diesem Gerät ausschalten'
                  : 'Tisch-Ton auf diesem Gerät einschalten'
              }
              className={`min-h-[40px] px-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                isTableAudioDevice
                  ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/30'
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
              }`}
            >
              <Megaphone
                className={`w-3.5 h-3.5 ${
                  isTableAudioDevice ? 'text-emerald-300' : 'text-slate-400'
                }`}
              />
              <span className="hidden sm:inline">
                {isTableAudioDevice ? 'Tisch-Ton AN' : 'Tisch-Ton'}
              </span>
            </button>
            {!room.tableDisplayActive && (
              <button
                type="button"
                onClick={onToggleMute}
                aria-label={muted ? 'Effekte einschalten' : 'Effekte stummschalten'}
                className="min-h-[40px] min-w-[40px] rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-200 transition-colors"
              >
                {muted ? (
                  <VolumeX className="w-4 h-4 text-rose-400" />
                ) : (
                  <Volume2 className="w-4 h-4 text-amber-400" />
                )}
              </button>
            )}
            {isHost && (
              <button
                type="button"
                onClick={onFinishRoundManually}
                className="min-h-[40px] px-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-300 whitespace-nowrap"
              >
                Auswerten
              </button>
            )}
            <button
              type="button"
              onClick={onLogout}
              aria-label="Abmelden"
              className="min-h-[40px] min-w-[40px] rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-300 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Arena */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-3 py-3 flex flex-col justify-between gap-3">
        {/* Theme + Timer Card (Compact when Table Mode is active to give cards maximum room) */}
        <section
          className={`rounded-3xl bg-[#1C202E] border border-white/10 space-y-2.5 ${
            room.tableDisplayActive ? 'p-3.5' : 'p-4 sm:p-5'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-slate-400 truncate">
              Runde {room.roundNumber} · {room.selectedCategory}
              {room.tableDisplayActive ? ' · Tisch-Ton aktiv' : ''}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {isHost && room.status === 'PLAYING' && (
                <button
                  type="button"
                  onClick={onThemeTimedOut}
                  className="min-h-[32px] px-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-slate-300 flex items-center gap-1"
                >
                  <FastForward className="w-3.5 h-3.5" />
                  <span>Nächstes Thema</span>
                </button>
              )}
              <span
                className={`font-mono font-bold text-lg tabular-nums ${
                  secondsLeft <= 5 ? 'text-rose-400' : 'text-amber-400'
                }`}
              >
                {room.status === 'COUNTDOWN' ? `${countdownStep}…` : `${secondsLeft}s`}
              </span>
            </div>
          </div>

          {room.status === 'COUNTDOWN' ? (
            <div className="py-3 text-center space-y-1">
              {isTimeUpNotice && (
                <div className="text-xs font-bold text-rose-300 uppercase tracking-wide">
                  Zeit um – nächstes Thema!
                </div>
              )}
              <div className="text-4xl font-display font-extrabold text-amber-400 tabular-nums">
                {countdownStep}
              </div>
              <p className="text-xs text-slate-300">
                Gleich geht&apos;s los — Thema wird angesagt…
              </p>
            </div>
          ) : isRoundEndingDelay ? (
            <div className="py-2 text-center space-y-1">
              <div className="text-sm font-bold text-emerald-300">
                Alle Karten abgelegt – Runde wird ausgewertet…
              </div>
              <h1 className="font-display font-extrabold text-white text-xl sm:text-2xl leading-tight">
                {room.currentTheme}
              </h1>
            </div>
          ) : (
            <div className="space-y-1">
              {isTimeUpNotice && (
                <div className="text-center text-xs font-bold text-rose-300">
                  Zeit um – nächstes Thema!
                </div>
              )}
              <h1
                className={`font-display font-extrabold text-white text-center leading-tight text-balance ${
                  room.tableDisplayActive
                    ? 'text-xl sm:text-2xl'
                    : 'text-2xl sm:text-3xl py-1'
                }`}
              >
                {room.currentTheme}
              </h1>
            </div>
          )}

          <div className="h-2 w-full rounded-full bg-[#0F1117] overflow-hidden">
            <div
              className={`h-full transition-all duration-200 ${
                secondsLeft <= 5 ? 'bg-rose-500' : 'bg-amber-400'
              }`}
              style={{ width: `${timerProgressPct}%` }}
            />
          </div>

          {room.turnMode === 'TURN_BASED' && room.status === 'PLAYING' && (
            <div
              className={`px-3 py-2 rounded-xl text-center text-xs font-semibold ${
                isMyTurn
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                  : 'bg-[#0F1117] text-slate-300 border border-white/10'
              }`}
            >
              {isMyTurn
                ? 'Du bist am Zug! Nenne jetzt einen Begriff.'
                : `${room.playersMeta[room.activeTurnUid]?.name ?? 'Mitspieler'} ist am Zug…`}
            </div>
          )}

          <div className="space-y-1 pt-0.5">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Live-Ticker ({room.usedWords.length} gesperrt)</span>
              <span className="truncate max-w-[200px]">{room.lastActionNotice}</span>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
              {activeFeed.length === 0 ? (
                <span className="text-xs text-slate-500">
                  Noch kein Begriff genannt — leg los!
                </span>
              ) : (
                activeFeed.map((item) => (
                  <div
                    key={item.id}
                    className={`px-2.5 py-1 rounded-xl border text-xs shrink-0 flex items-center gap-1.5 ${
                      item.valid
                        ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-200'
                        : 'bg-rose-500/10 border-rose-400/30 text-rose-200'
                    }`}
                  >
                    <span>{getAvatar(item.avatar).emoji}</span>
                    <span className="font-semibold">{item.word}</span>
                    <span className="text-[10px] opacity-75">({item.letter})</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Incoming Ice Block (only visible when player holds SHIELD) */}
        {pendingBlockEvents.length > 0 && myPlayer.actionCards.includes('SHIELD') && (
          <div className="rounded-2xl bg-cyan-500/15 border border-cyan-400/50 p-3.5 flex items-center justify-between gap-3 animate-card-pop">
            <div className="min-w-0">
              <div className="text-sm font-bold text-white flex items-center gap-1.5">
                <Snowflake className="w-4 h-4 text-cyan-300 shrink-0" />
                <span>Eisblock von {pendingBlockEvents[0].fromName}!</span>
              </div>
              <div className="text-xs text-cyan-100">
                Friert dich 6 Sekunden ein – mit Schutzschild abwehren?
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  playActionSound(effectiveMuted);
                  onResolveBlock(pendingBlockEvents[0], true);
                }}
                className="min-h-[40px] px-3 rounded-xl bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Abwehren</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  playErrorBuzz(effectiveMuted);
                  onResolveBlock(pendingBlockEvents[0], false);
                }}
                className="min-h-[40px] px-3 rounded-xl bg-white/15 text-white text-xs font-semibold"
              >
                Annehmen
              </button>
            </div>
          </div>
        )}

        {/* Incoming Gift */}
        {pendingGiftEvents.length > 0 && (
          <div className="rounded-2xl bg-rose-500/15 border border-rose-400/40 p-3.5 flex items-center justify-between gap-3 animate-card-pop">
            <div className="min-w-0">
              <div className="text-sm font-bold text-white">
                🎁 Karten-Geschenk von {pendingGiftEvents[0].fromName}!
              </div>
              <div className="text-xs text-rose-200">
                Karte &bdquo;{pendingGiftEvents[0].letter}&ldquo; wartet auf dich.
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {myPlayer.actionCards.includes('SHIELD') && (
                <button
                  type="button"
                  onClick={() => {
                    playActionSound(effectiveMuted);
                    onResolveGift(pendingGiftEvents[0], true);
                  }}
                  className="min-h-[40px] px-3 rounded-xl bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1"
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>Abwehren</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onResolveGift(pendingGiftEvents[0], false)}
                className="min-h-[40px] px-3 rounded-xl bg-white/15 text-white text-xs font-semibold"
              >
                Annehmen
              </button>
            </div>
          </div>
        )}

        {/* Penalty Shield Reaction */}
        {pendingPenaltyState && (
          <div className="rounded-2xl bg-amber-500/15 border border-amber-400/50 p-3.5 flex items-center justify-between gap-3 animate-card-pop">
            <div className="min-w-0">
              <div className="text-sm font-bold text-white">
                🛡️ Strafkarte (+1) abwehren?
              </div>
              <div className="text-xs text-amber-200 truncate">
                {pendingPenaltyState.reason}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  const p = pendingPenaltyState;
                  playActionSound(effectiveMuted);
                  await onConsumeShieldForPenalty();
                  await onRejectWord({
                    word: p.word,
                    reason: `${p.reason} (Strafkarte mit Schutzschild abgewehrt)`,
                    penaltyApplied: false,
                  });
                  setPendingPenaltyState(null);
                  setFeedback({
                    type: 'INVALID',
                    word: p.word,
                    reason: `${p.reason} (-1 Strafpunkt, Strafkarte mit Schutzschild abgewehrt!)`,
                  });
                }}
                className="min-h-[40px] px-3 rounded-xl bg-emerald-400 text-slate-950 text-xs font-bold"
              >
                Schild nutzen
              </button>
              <button
                type="button"
                onClick={async () => {
                  const p = pendingPenaltyState;
                  setPendingPenaltyState(null);
                  const rejected = await onRejectWord({
                    word: p.word,
                    reason: p.reason,
                    penaltyApplied: true,
                  });
                  setFeedback({
                    type: 'INVALID',
                    word: p.word,
                    reason: rejected.penaltyCard
                      ? `${p.reason} (-1 Strafpunkt & +1 Strafkarte ${rejected.penaltyCard} gezogen!)`
                      : `${p.reason} (-1 Strafpunkt)`,
                  });
                }}
                className="min-h-[40px] px-3 rounded-xl bg-white/10 text-white text-xs font-semibold"
              >
                Karte ziehen
              </button>
            </div>
          </div>
        )}

        {/* Judge Feedback */}
        {feedback && !pendingPenaltyState && (
          <div
            className={`rounded-2xl px-4 py-2.5 border flex items-center justify-between gap-3 animate-card-pop ${
              feedback.type === 'VALID'
                ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-100'
                : feedback.type === 'INVALID'
                  ? 'bg-rose-500/15 border-rose-400/40 text-rose-100'
                  : feedback.type === 'INFO'
                    ? 'bg-amber-500/15 border-amber-400/40 text-amber-100'
                    : 'bg-sky-500/15 border-sky-400/40 text-sky-100'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {feedback.type === 'VALID' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              ) : feedback.type === 'INVALID' ? (
                <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
              ) : feedback.type === 'INFO' ? (
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
              ) : (
                <Mic className="w-5 h-5 text-sky-400 animate-pulse shrink-0" />
              )}
              <div className="min-w-0">
                <span className="font-bold text-sm mr-1.5">{feedback.word}:</span>
                <span className="text-xs opacity-90">{feedback.reason}</span>
              </div>
            </div>
          </div>
        )}

        {/* Chaos Gift or Ice Block Target Picker */}
        {chaosTargetMode && (
          <div
            className={`rounded-2xl bg-[#1C202E] border p-4 space-y-3 ${
              chaosTargetMode.type === 'BLOCK'
                ? 'border-cyan-400/50'
                : 'border-rose-400/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-white">
                {chaosTargetMode.type === 'BLOCK'
                  ? '❄️ Wen möchtest du für 6 Sekunden einfrieren?'
                  : chaosTargetMode.step === 'PICK_CARD'
                    ? '🎁 Schritt 1: Tippe unten eine deiner Buchstabenkarten an'
                    : '🎁 Schritt 2: Wem möchtest du die Karte schenken?'}
              </span>
              <button
                type="button"
                onClick={() => setChaosTargetMode(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Abbrechen
              </button>
            </div>
            {(chaosTargetMode.type === 'BLOCK' ||
              (chaosTargetMode.type === 'GIFT' &&
                chaosTargetMode.step === 'PICK_TARGET' &&
                chaosTargetMode.cardIndex !== null)) && (
              <div className="flex flex-wrap gap-2">
                {otherActivePlayers.map((target) => (
                  <button
                    key={target.uid}
                    type="button"
                    onClick={async () => {
                      const mode = chaosTargetMode;
                      setChaosTargetMode(null);
                      playActionSound(effectiveMuted);
                      if (mode.type === 'BLOCK') {
                        await onSendBlock(target.uid, target.name);
                      } else if (mode.cardIndex !== null) {
                        await onSendGift(target.uid, target.name, mode.cardIndex);
                      }
                    }}
                    className={`min-h-[44px] px-4 rounded-xl text-white font-semibold text-xs flex items-center gap-2 ${
                      chaosTargetMode.type === 'BLOCK'
                        ? 'bg-cyan-600 hover:bg-cyan-500'
                        : 'bg-rose-500 hover:bg-rose-400'
                    }`}
                  >
                    <span>{getAvatar(target.avatar).emoji}</span>
                    <span>{target.name}</span>
                    {target.isBot && <Bot className="w-3.5 h-3.5" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Bottom Player Hand & Speech Controls */}
        <section className="space-y-3 mt-auto">
          {hasFinishedHand ? (
            <div className="rounded-3xl bg-emerald-500/15 border border-emerald-400/40 p-6 text-center space-y-1">
              <div className="text-xl font-display font-bold text-emerald-300">
                Alle Karten abgelegt!
              </div>
              <p className="text-xs text-slate-300">
                Die Runde läuft noch kurz für die übrigen Mitspieler…
              </p>
            </div>
          ) : (
            <>
              {isFrozen && (
                <div className="rounded-2xl bg-cyan-500/20 border border-cyan-300/60 px-4 py-3 flex items-center justify-between gap-3 animate-card-pop">
                  <div className="flex items-center gap-2.5">
                    <Snowflake className="w-5 h-5 text-cyan-200 animate-spin shrink-0" />
                    <div>
                      <div className="text-sm font-bold text-cyan-100">
                        ❄️ Eingefroren!
                      </div>
                      <div className="text-xs text-cyan-200">
                        Ein Eisblock blockiert deine Karten und Eingaben noch {iceSecondsLeft} Sek.
                      </div>
                    </div>
                  </div>
                  <span className="font-mono font-extrabold text-xl text-cyan-100 tabular-nums shrink-0">
                    {iceSecondsLeft}s
                  </span>
                </div>
              )}

              {room.ruleVariant === 'CHAOS' && myPlayer.actionCards.length > 0 && (
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                  {myPlayer.actionCards.map((action, idx) => {
                    const meta = ACTION_CARD_META[action];
                    const isPassiveShield = action === 'SHIELD';
                    return (
                      <button
                        key={`${action}-${idx}`}
                        type="button"
                        disabled={isPassiveShield || room.status !== 'PLAYING' || isFrozen}
                        onClick={() => handleActionCardClick(action)}
                        className={`min-h-[44px] px-3.5 py-2 rounded-2xl border text-left flex items-center gap-2 shrink-0 transition-transform active:scale-95 ${meta.colorClass} ${
                          isPassiveShield ? 'opacity-85 cursor-default' : ''
                        } disabled:opacity-50`}
                      >
                        <span className="text-lg">{meta.emoji}</span>
                        <div>
                          <div className="text-xs font-bold leading-none">{meta.title}</div>
                          <div className="text-[10px] opacity-80 mt-0.5">{meta.shortDesc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div
                className={`space-y-2 rounded-2xl transition-all ${
                  isFrozen ? 'opacity-55 ring-2 ring-cyan-400/50 p-2 bg-cyan-950/20' : ''
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 px-1">
                  <span>
                    Deine Kartenhand ({myPlayer.cards.length}) ·{' '}
                    {selectedLetter
                      ? `Karte ${selectedLetter === 'JOKER' ? '★ Joker' : selectedLetter} gewählt (erneut tippen zum Abwählen)`
                      : 'Zum Auswählen antippen oder direkt sprechen'}
                  </span>
                  {canUseEmergencySwap && (
                    <button
                      type="button"
                      disabled={swappingCard}
                      onClick={handleEmergencySwapClick}
                      className="min-h-[32px] px-3 rounded-xl bg-amber-400/15 border border-amber-400/50 text-amber-300 hover:bg-amber-400/25 font-semibold text-xs flex items-center gap-1.5 transition-colors"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${swappingCard ? 'animate-spin' : ''}`} />
                      <span>Karte tauschen (1×)</span>
                    </button>
                  )}
                </div>
                <div
                  className={`grid gap-2 ${
                    room.tableDisplayActive
                      ? 'grid-cols-4 sm:grid-cols-8 gap-2.5'
                      : 'grid-cols-4 sm:grid-cols-8'
                  }`}
                >
                  {myPlayer.cards.map((letter, idx) => {
                    const palette = getLetterCardColors(letter);
                    const isSelected = selectedCardIndex === idx;
                    const rare = isRareLetter(letter);
                    return (
                      <button
                        key={`${letter}-${idx}`}
                        type="button"
                        disabled={
                          room.status !== 'PLAYING' ||
                          isFrozen ||
                          (!isMyTurn &&
                            !(
                              chaosTargetMode?.type === 'GIFT' &&
                              chaosTargetMode.step === 'PICK_CARD'
                            ))
                        }
                        onClick={() => handleTapLetterCard(idx)}
                        className={`aspect-[3/4] rounded-2xl border-2 shadow-md flex flex-col items-center justify-center relative select-none transition-all active:scale-95 disabled:opacity-50 ${palette.bg} ${palette.border} ${palette.text} ${
                          isSelected
                            ? 'ring-4 ring-white shadow-xl -translate-y-1.5 scale-[1.04] z-10'
                            : 'hover:-translate-y-0.5'
                        }`}
                      >
                        {rare && (
                          <span
                            className={`absolute top-1.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold tracking-tight leading-none ${palette.badge}`}
                          >
                            Im Wort
                          </span>
                        )}
                        {isSelected && (
                          <span className="absolute bottom-1.5 px-1.5 py-0.5 rounded-md bg-slate-950/80 text-white text-[9px] font-bold leading-none">
                            Aktiv
                          </span>
                        )}
                        {letter === 'JOKER' ? (
                          <>
                            <span className="text-3xl sm:text-4xl font-display font-extrabold leading-none">
                              ★
                            </span>
                            <span className="text-[10px] font-bold mt-1 tracking-wide">
                              A–Z
                            </span>
                          </>
                        ) : (
                          <span
                            className={`font-display font-extrabold leading-none ${
                              room.tableDisplayActive
                                ? 'text-4xl sm:text-5xl'
                                : 'text-3xl sm:text-4xl'
                            }`}
                          >
                            {letter}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* Mic Controls, Undo & Text Fallback */}
          <div className="rounded-3xl bg-[#1C202E] border border-white/10 p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1 p-1 rounded-xl bg-[#0F1117] border border-white/10">
                <button
                  type="button"
                  onClick={() => setMicMode('PUSH_TO_TALK')}
                  className={`min-h-[36px] px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    micMode === 'PUSH_TO_TALK'
                      ? 'bg-amber-400 text-slate-950'
                      : 'text-slate-300'
                  }`}
                >
                  Push-to-Talk
                </button>
                <button
                  type="button"
                  onClick={() => setMicMode('CONTINUOUS')}
                  className={`min-h-[36px] px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    micMode === 'CONTINUOUS'
                      ? 'bg-amber-400 text-slate-950'
                      : 'text-slate-300'
                  }`}
                >
                  Dauer-Zuhören
                </button>
              </div>

              <button
                type="button"
                disabled={!myLatestUndoableEntry}
                onClick={() => {
                  if (!myLatestUndoableEntry) return;
                  const norm =
                    normalizeWord(stripGermanArticle(myLatestUndoableEntry.word)) ||
                    normalizeWord(myLatestUndoableEntry.word);
                  onUndoEntry(myLatestUndoableEntry, norm);
                }}
                className="min-h-[40px] px-3 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-35 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                <span>Falsch verstanden / Rückgängig</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {speechSupported ? (
                micMode === 'PUSH_TO_TALK' ? (
                  <button
                    type="button"
                    disabled={!micEnabled}
                    onPointerDown={() => startListening()}
                    onPointerUp={() => stopListening()}
                    onPointerLeave={() => {
                      if (isListening) stopListening();
                    }}
                    className={`min-h-[48px] px-4 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 shrink-0 select-none transition-all ${
                      isListening
                        ? 'bg-rose-500 text-white scale-[0.98]'
                        : 'bg-amber-400 text-slate-950 hover:bg-amber-300'
                    } disabled:opacity-40`}
                  >
                    <Mic className="w-5 h-5" />
                    <span>{isListening ? 'Sprich jetzt…' : 'Halten & Sprechen'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!micEnabled}
                    onClick={() => (isListening ? stopListening() : startListening())}
                    className={`min-h-[48px] px-4 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 shrink-0 transition-colors ${
                      isListening
                        ? 'bg-emerald-500/20 border border-emerald-400/50 text-emerald-300'
                        : 'bg-white/10 text-slate-300'
                    } disabled:opacity-40`}
                  >
                    {isListening ? (
                      <>
                        <Mic className="w-4 h-4 animate-pulse" />
                        <span className="hidden sm:inline">Hört zu…</span>
                      </>
                    ) : (
                      <>
                        <MicOff className="w-4 h-4" />
                        <span className="hidden sm:inline">Mikro pausiert</span>
                      </>
                    )}
                  </button>
                )
              ) : (
                <div className="px-3 py-2 rounded-xl bg-white/5 text-[11px] text-slate-400 shrink-0">
                  Tippen zum Eingeben
                </div>
              )}

              <form onSubmit={handleManualTextSubmit} className="flex-1 flex gap-1.5 min-w-0">
                <input
                  ref={manualInputRef}
                  type="text"
                  value={manualInput}
                  disabled={!micEnabled}
                  maxLength={100}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder={interimText || inputPlaceholder}
                  className="flex-1 min-w-0 min-h-[48px] px-3.5 rounded-2xl bg-[#0F1117] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400 disabled:opacity-40"
                />
                <button
                  type="submit"
                  disabled={!micEnabled || manualInput.trim().length < 2}
                  aria-label="Wort prüfen"
                  className="min-h-[48px] min-w-[48px] rounded-2xl bg-amber-400 text-slate-950 font-bold hover:bg-amber-300 disabled:opacity-40 flex items-center justify-center shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>

            {micError && <p className="text-xs text-rose-400">{micError}</p>}
          </div>
        </section>
      </main>
    </div>
  );
};
