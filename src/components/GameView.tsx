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
  RotateCcw,
  Send,
  Shield,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import {
  ACTION_CARD_META,
  extractStartingLetter,
  getAvatar,
  getLetterCardColors,
  normalizeWord,
  stripGermanArticle,
} from '../data/themesAndCards';
import { useSpeechRecognition, type MicMode } from '../hooks/useSpeechRecognition';
import { judgeWordViaProxy } from '../lib/geminiProxy';
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
  }) => Promise<{ feedId: string; penaltyCard: string | null }>;
  onUndoEntry: (entry: FeedEntry, normalizedWord: string) => Promise<void>;
  onConsumeShieldForPenalty: () => Promise<void>;
  onPlayThemeSwap: () => Promise<void>;
  onPlayTimeTurbo: () => Promise<void>;
  onSendGift: (targetUid: string, targetName: string, cardIndex: number) => Promise<void>;
  onResolveGift: (event: ChaosEvent, useShield: boolean) => Promise<void>;
  onFinishRoundManually: () => Promise<void>;
  onLogout: () => void;
}

interface JudgeFeedback {
  type: 'VALID' | 'INVALID' | 'CHECKING' | 'INFO';
  word: string;
  reason: string;
  canShieldPenalty?: boolean;
}

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
  onUndoEntry,
  onConsumeShieldForPenalty,
  onPlayThemeSwap,
  onPlayTimeTurbo,
  onSendGift,
  onResolveGift,
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
  const [feedback, setFeedback] = useState<JudgeFeedback | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [countdownStep, setCountdownStep] = useState<number>(3);
  const [giftMode, setGiftMode] = useState<{
    step: 'PICK_CARD' | 'PICK_TARGET';
    cardIndex: number | null;
  } | null>(null);
  const [pendingPenaltyState, setPendingPenaltyState] = useState<{
    word: string;
    reason: string;
  } | null>(null);

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

  const findMatchingCard = useCallback(
    (word: string): { cardIndex: number; matchedLetter: string } | null => {
      const stripped = stripGermanArticle(normalizeWord(word));
      const candidates = [
        extractStartingLetter(stripped),
        extractStartingLetter(word),
      ].filter(Boolean);

      for (const letter of candidates) {
        const exactIdx = myPlayer.cards.findIndex((c) => c === letter);
        if (exactIdx !== -1) {
          return { cardIndex: exactIdx, matchedLetter: letter };
        }
      }

      const jokerIdx = myPlayer.cards.findIndex((c) => c === 'JOKER');
      if (jokerIdx !== -1) {
        return { cardIndex: jokerIdx, matchedLetter: 'JOKER' };
      }

      return null;
    },
    [myPlayer.cards]
  );

  const handleSubmitSpokenWord = useCallback(
    async (rawSpoken: string) => {
      if (
        room.status !== 'PLAYING' ||
        room.turnEndsAt === 0 ||
        hasFinishedHand ||
        !isMyTurn ||
        isCheckingRef.current
      ) {
        return;
      }

      const cleaned = rawSpoken.trim();
      if (!cleaned) return;
      const normalized =
        normalizeWord(stripGermanArticle(cleaned)) || normalizeWord(cleaned);
      if (!normalized || normalized.length < 2) return;

      // Stage 1: Letter Check
      const match = findMatchingCard(cleaned);
      if (!match) {
        const needed = extractStartingLetter(stripGermanArticle(cleaned)) || '?';
        playErrorBuzz(effectiveMuted);
        setFeedback({
          type: 'INVALID',
          word: cleaned,
          reason: `Keine Karte mit "${needed}" (und kein Joker) auf der Hand.`,
        });
        return;
      }

      // Stage 2: Duplicate Check
      if (room.usedWords.includes(normalized)) {
        playErrorBuzz(effectiveMuted);
        setFeedback({
          type: 'INVALID',
          word: cleaned,
          reason: `"${cleaned}" wurde bei diesem Thema schon genannt!`,
        });
        return;
      }

      // Stage 3: Gemini Referee via ./gemini.php (No points or card changes before validation succeeds!)
      isCheckingRef.current = true;
      setFeedback({
        type: 'CHECKING',
        word: cleaned,
        reason: 'KI-Schiedsrichter prüft…',
      });

      try {
        const result = await judgeWordViaProxy({
          pin: familyPin,
          word: cleaned,
          theme: room.currentTheme,
          isJunior: myPlayer.isJunior,
        });

        if (!result.ok) {
          // Technical API failure: catch cleanly without showing raw API error in red banner or penalizing
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
              reason: result.reason,
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
                ? `${result.reason} (+1 Strafkarte ${rejected.penaltyCard})`
                : result.reason,
            });
          }
        }
      } catch {
        // Fallback safety guard: never display raw error messages in the red hint banner
        setFeedback({
          type: 'INFO',
          word: cleaned,
          reason: 'Prüfung gerade nicht möglich – bitte erneut versuchen.',
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
      myPlayer.isJunior,
      myPlayer.actionCards,
      findMatchingCard,
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
    if (!val) return;
    setManualInput('');
    await handleSubmitSpokenWord(val);
  };

  const handleTapLetterCard = async (cardIndex: number, letter: string) => {
    if (
      room.status !== 'PLAYING' ||
      room.turnEndsAt === 0 ||
      hasFinishedHand ||
      isCheckingRef.current
    ) {
      return;
    }

    if (giftMode?.step === 'PICK_CARD') {
      setGiftMode({ step: 'PICK_TARGET', cardIndex });
      return;
    }

    if (!isMyTurn) return;

    const tag = Date.now().toString().slice(-4);
    const label = letter === 'JOKER' ? `Joker ${tag}` : `Karte ${letter} ${tag}`;
    const normalized = normalizeWord(stripGermanArticle(label));

    const acceptRes = await onAcceptWord({
      word: label,
      normalizedWord: normalized,
      matchedLetter: letter,
      cardIndex,
      reason: 'Per Fingertipp abgelegt',
    });

    if (acceptRes.accepted) {
      playCardTap(effectiveMuted);
      setFeedback({
        type: 'VALID',
        word: letter === 'JOKER' ? '★ Joker' : `Karte ${letter}`,
        reason: 'Per Fingertipp abgelegt! (+1 Punkt)',
      });
    } else {
      setFeedback({
        type: 'INFO',
        word: letter === 'JOKER' ? '★ Joker' : `Karte ${letter}`,
        reason: acceptRes.reason,
      });
    }
  };

  const handleActionCardClick = async (action: ActionCardType) => {
    if (room.status !== 'PLAYING') return;
    if (action === 'THEME_SWAP') {
      playActionSound(effectiveMuted);
      await onPlayThemeSwap();
    } else if (action === 'TIME_TURBO') {
      playActionSound(effectiveMuted);
      await onPlayTimeTurbo();
    } else if (action === 'GIFT') {
      if (myPlayer.cards.length === 0) return;
      setGiftMode({ step: 'PICK_CARD', cardIndex: null });
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

        {/* Incoming Gift */}
        {pendingGifts.length > 0 && (
          <div className="rounded-2xl bg-rose-500/15 border border-rose-400/40 p-3.5 flex items-center justify-between gap-3 animate-card-pop">
            <div className="min-w-0">
              <div className="text-sm font-bold text-white">
                🎁 Karten-Geschenk von {pendingGifts[0].fromName}!
              </div>
              <div className="text-xs text-rose-200">
                Karte &bdquo;{pendingGifts[0].letter}&ldquo; wartet auf dich.
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {myPlayer.actionCards.includes('SHIELD') && (
                <button
                  type="button"
                  onClick={() => {
                    playActionSound(effectiveMuted);
                    onResolveGift(pendingGifts[0], true);
                  }}
                  className="min-h-[40px] px-3 rounded-xl bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1"
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>Abwehren</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onResolveGift(pendingGifts[0], false)}
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
                  playActionSound(effectiveMuted);
                  await onConsumeShieldForPenalty();
                  setPendingPenaltyState(null);
                  setFeedback({
                    type: 'VALID',
                    word: pendingPenaltyState.word,
                    reason: 'Strafkarte mit Schutzschild abgewehrt!',
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
                  await onRejectWord({
                    word: p.word,
                    reason: p.reason,
                    penaltyApplied: true,
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

        {/* Chaos Gift Picker */}
        {giftMode && (
          <div className="rounded-2xl bg-[#1C202E] border border-rose-400/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-white">
                {giftMode.step === 'PICK_CARD'
                  ? '🎁 Schritt 1: Tippe unten eine deiner Buchstabenkarten an'
                  : '🎁 Schritt 2: Wem möchtest du die Karte schenken?'}
              </span>
              <button
                type="button"
                onClick={() => setGiftMode(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Abbrechen
              </button>
            </div>
            {giftMode.step === 'PICK_TARGET' && giftMode.cardIndex !== null && (
              <div className="flex flex-wrap gap-2">
                {otherActivePlayers.map((target) => (
                  <button
                    key={target.uid}
                    type="button"
                    onClick={async () => {
                      const idx = giftMode.cardIndex!;
                      setGiftMode(null);
                      playActionSound(effectiveMuted);
                      await onSendGift(target.uid, target.name, idx);
                    }}
                    className="min-h-[44px] px-4 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-semibold text-xs flex items-center gap-2"
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
              {room.ruleVariant === 'CHAOS' && myPlayer.actionCards.length > 0 && (
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                  {myPlayer.actionCards.map((action, idx) => {
                    const meta = ACTION_CARD_META[action];
                    const isPassiveShield = action === 'SHIELD';
                    return (
                      <button
                        key={`${action}-${idx}`}
                        type="button"
                        disabled={isPassiveShield || room.status !== 'PLAYING'}
                        onClick={() => handleActionCardClick(action)}
                        className={`min-h-[44px] px-3.5 py-2 rounded-2xl border text-left flex items-center gap-2 shrink-0 transition-transform active:scale-95 ${meta.colorClass} ${
                          isPassiveShield ? 'opacity-85 cursor-default' : ''
                        }`}
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

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                  <span>
                    Deine Kartenhand ({myPlayer.cards.length}) · Zum Ablegen antippen oder sprechen
                  </span>
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
                    return (
                      <button
                        key={`${letter}-${idx}`}
                        type="button"
                        disabled={
                          room.status !== 'PLAYING' ||
                          (!isMyTurn && giftMode?.step !== 'PICK_CARD')
                        }
                        onClick={() => handleTapLetterCard(idx, letter)}
                        className={`aspect-[3/4] rounded-2xl border-2 shadow-md flex flex-col items-center justify-center relative select-none transition-transform active:scale-95 disabled:opacity-50 ${palette.bg} ${palette.border} ${palette.text}`}
                      >
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
                  const norm = normalizeWord(
                    stripGermanArticle(myLatestUndoableEntry.word)
                  );
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
                  Tippen oder Karte antippen
                </div>
              )}

              <form onSubmit={handleManualTextSubmit} className="flex-1 flex gap-1.5 min-w-0">
                <input
                  type="text"
                  value={manualInput}
                  disabled={!micEnabled}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder={interimText || 'Wort sprechen oder eintippen…'}
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
