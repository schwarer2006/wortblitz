import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  RotateCcw,
  SkipForward,
  Volume2,
  VolumeX,
  CheckCircle2,
  XCircle,
  Send,
  Shield,
  Flag,
  Loader2,
  X,
} from 'lucide-react';
import {
  ACTION_CARD_META,
  extractStartingLetter,
  getAvatar,
  getLetterCardColors,
  normalizeWord,
  stripGermanArticle,
} from '../data/themesAndCards';
import {
  playActionSound,
  playCardTap,
  playCountdownBeep,
  playErrorBuzz,
  playSuccessChime,
  speakModerator,
  stopModeratorSpeech,
} from '../lib/soundAndSpeech';
import type {
  ActionCardType,
  ChaosEvent,
  FeedEntry,
  PlayerData,
  RoomData,
} from '../types/game';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface GameArenaProps {
  room: RoomData;
  player: PlayerData;
  feed: FeedEntry[];
  pendingGiftEvents: ChaosEvent[];
  muted: boolean;
  onToggleMute: () => void;
  onTransitionToPlaying: () => Promise<void>;
  onAdvanceTheme: (notice?: string) => Promise<void>;
  onAdvanceTurn: (notice: string) => Promise<void>;
  onFinishRound: () => Promise<void>;
  onRecordAccepted: (params: {
    word: string;
    normalizedWord: string;
    matchedLetter: string;
    cardIndex: number;
    reason: string;
  }) => Promise<string>;
  onRecordRejected: (params: {
    word: string;
    reason: string;
    penaltyApplied: boolean;
  }) => Promise<{ feedId: string; penaltyCard: string | null }>;
  onConsumeShieldForPenalty: () => Promise<void>;
  onUndoEntry: (entry: FeedEntry, normalizedWord: string) => Promise<void>;
  onPlayThemeSwap: () => Promise<void>;
  onPlayTimeTurbo: () => Promise<void>;
  onSendGift: (targetUid: string, targetName: string, cardIndex: number) => Promise<void>;
  onResolveGift: (event: ChaosEvent, useShield: boolean) => Promise<void>;
}

export const GameArena: React.FC<GameArenaProps> = ({
  room,
  player,
  feed,
  pendingGiftEvents,
  muted,
  onToggleMute,
  onTransitionToPlaying,
  onAdvanceTheme,
  onAdvanceTurn,
  onFinishRound,
  onRecordAccepted,
  onRecordRejected,
  onConsumeShieldForPenalty,
  onUndoEntry,
  onPlayThemeSwap,
  onPlayTimeTurbo,
  onSendGift,
  onResolveGift,
}) => {
  const isHost = room.hostUid === player.uid;
  const isMyTurn =
    room.turnMode === 'SIMULTANEOUS' || room.activeTurnUid === player.uid;
  const hasFinished = player.cards.length === 0 || room.winnersOrder.includes(player.uid);

  // Timer tick
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);

  const remainingMs = Math.max(0, room.turnEndsAt - nowMs);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const totalSec = room.status === 'COUNTDOWN' ? 3 : room.roundDurationSec;
  const progressPct = Math.min(100, Math.max(0, (remainingMs / (totalSec * 1000)) * 100));

  // Countdown + Moderator Speech & Host Auto-Advance
  const lastSpokenThemeKeyRef = useRef<string>('');
  const lastBeepSecRef = useRef<number>(-1);
  const autoAdvanceLockRef = useRef<string>('');

  useEffect(() => {
    if (room.status === 'COUNTDOWN') {
      const key = `${room.roundNumber}:${room.currentThemeIndex}:${room.currentTheme}`;
      if (lastSpokenThemeKeyRef.current !== key) {
        lastSpokenThemeKeyRef.current = key;
        speakModerator(`3, 2, 1, Los! Das Thema ist: ${room.currentTheme}`, muted);
      }
      if (remainingSec > 0 && remainingSec <= 3 && lastBeepSecRef.current !== remainingSec) {
        lastBeepSecRef.current = remainingSec;
        playCountdownBeep(false, muted);
      }
      if (remainingMs <= 0 && isHost) {
        const lockKey = `countdown:${key}`;
        if (autoAdvanceLockRef.current !== lockKey) {
          autoAdvanceLockRef.current = lockKey;
          playCountdownBeep(true, muted);
          onTransitionToPlaying();
        }
      }
    } else if (room.status === 'PLAYING') {
      if (remainingMs <= 0 && isHost && room.turnEndsAt > 0) {
        const lockKey = `playing:${room.roundNumber}:${room.currentThemeIndex}:${room.turnEndsAt}`;
        if (autoAdvanceLockRef.current !== lockKey) {
          autoAdvanceLockRef.current = lockKey;
          if (room.turnMode === 'SIMULTANEOUS') {
            onAdvanceTheme('Zeit um! Nächstes Thema...');
          } else {
            onAdvanceTurn('Zugzeit abgelaufen — nächster Spieler!');
          }
        }
      }
    }
  }, [
    room.status,
    room.roundNumber,
    room.currentThemeIndex,
    room.currentTheme,
    room.turnEndsAt,
    room.turnMode,
    remainingMs,
    remainingSec,
    isHost,
    muted,
    onTransitionToPlaying,
    onAdvanceTheme,
    onAdvanceTurn,
  ]);

  useEffect(() => {
    return () => stopModeratorSpeech();
  }, []);

  // Mic & Word Checking State
  const [micMode, setMicMode] = useState<'CONTINUOUS' | 'PTT'>('PTT');
  const [isListening, setIsListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [judgingWord, setJudgingWord] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    title: string;
    detail: string;
  } | null>(null);

  // Pending Penalty Shield Reaction
  const [pendingPenalty, setPendingPenalty] = useState<{
    word: string;
    reason: string;
    expiresAt: number;
  } | null>(null);

  // Manual Card Tap Sheet
  const [manualCardIdx, setManualCardIdx] = useState<number | null>(null);
  const [manualWordInput, setManualWordInput] = useState('');

  // Chaos Gift Modal
  const [giftStepOpen, setGiftStepOpen] = useState(false);
  const [giftCardIdx, setGiftCardIdx] = useState<number | null>(null);

  const SpeechRecognitionCtor = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
  }, []);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const pttActiveRef = useRef(false);
  const lastEvaluatedRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  const showFeedback = useCallback(
    (type: 'success' | 'error' | 'info', title: string, detail: string) => {
      setFeedback({ type, title, detail });
    },
    []
  );

  // Core 3-Stage Verification Logic
  const evaluateWord = useCallback(
    async (rawSpoken: string, preferredCardIdx?: number) => {
      if (room.status !== 'PLAYING' || hasFinished) return;
      if (!isMyTurn) {
        showFeedback('info', 'Noch nicht dran', 'Warte, bis du im Reihum-Modus am Zug bist.');
        return;
      }

      const cleanedRaw = rawSpoken.trim().replace(/[.,!?;:]+$/g, '');
      if (!cleanedRaw) return;

      // Deduplicate rapid double-triggers from speech engine
      const now = Date.now();
      if (
        lastEvaluatedRef.current.text === cleanedRaw.toLowerCase() &&
        now - lastEvaluatedRef.current.at < 2200
      ) {
        return;
      }
      lastEvaluatedRef.current = { text: cleanedRaw.toLowerCase(), at: now };

      const withoutArticle = stripGermanArticle(cleanedRaw);
      const candidates = [withoutArticle, cleanedRaw].filter(Boolean);

      let chosenWord = candidates[0];
      let matchedIdx = -1;
      let matchedLetter = '';

      if (typeof preferredCardIdx === 'number' && player.cards[preferredCardIdx]) {
        const cardLetter = player.cards[preferredCardIdx];
        const first = extractStartingLetter(chosenWord);
        if (cardLetter === 'JOKER' || first === cardLetter) {
          matchedIdx = preferredCardIdx;
          matchedLetter = cardLetter;
        } else {
          playErrorBuzz(muted);
          showFeedback(
            'error',
            `Falscher Anfangsbuchstabe`,
            `"${chosenWord}" beginnt mit ${first || '?'}, nicht mit ${cardLetter}.`
          );
          return;
        }
      } else {
        // Stage 1: Letter check across player's hand (prefer exact letter over JOKER)
        for (const cand of candidates) {
          const letter = extractStartingLetter(cand);
          if (!letter) continue;
          const exactIdx = player.cards.indexOf(letter);
          if (exactIdx !== -1) {
            chosenWord = cand;
            matchedIdx = exactIdx;
            matchedLetter = letter;
            break;
          }
        }
        if (matchedIdx === -1) {
          const jokerIdx = player.cards.indexOf('JOKER');
          if (jokerIdx !== -1) {
            matchedIdx = jokerIdx;
            matchedLetter = 'JOKER';
          }
        }
      }

      if (matchedIdx === -1) {
        const first = extractStartingLetter(chosenWord) || '?';
        playErrorBuzz(muted);
        showFeedback(
          'error',
          `Keine "${first}"-Karte`,
          `Du hast weder "${first}" noch einen Joker auf der Hand ("${chosenWord}").`
        );
        return;
      }

      // Stage 2: Duplicate check
      const normalized = normalizeWord(chosenWord);
      if (room.usedWords.includes(normalized)) {
        playErrorBuzz(muted);
        showFeedback(
          'error',
          'Bereits genannt!',
          `"${chosenWord}" wurde bei diesem Thema schon gespielt.`
        );
        return;
      }

      // Stage 3: Gemini 2.5 Flash Referee
      setJudgingWord(chosenWord);
      try {
        const res = await fetch('/api/judge-word', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            word: chosenWord,
            theme: room.currentTheme,
            isJunior: player.isJunior,
          }),
        });
        const data = (await res.json()) as {
          valid?: boolean;
          reason?: string;
          error?: string;
        };

        if (!res.ok) {
          throw new Error(data.error || 'KI-Prüfung fehlgeschlagen.');
        }

        const isValid = Boolean(data.valid);
        const reason = data.reason || (isValid ? 'Passt!' : 'Passt leider nicht.');

        if (isValid) {
          await onRecordAccepted({
            word: chosenWord,
            normalizedWord: normalized,
            matchedLetter,
            cardIndex: matchedIdx,
            reason,
          });
          playSuccessChime(muted);
          showFeedback(
            'success',
            `✓ "${chosenWord}" akzeptiert!`,
            `${matchedLetter === 'JOKER' ? '★ Joker' : `Karte [${matchedLetter}]`} abgelegt · ${reason}`
          );
          setManualCardIdx(null);
          setManualWordInput('');
        } else {
          playErrorBuzz(muted);
          if (room.penaltyEnabled && player.actionCards.includes('SHIELD')) {
            setPendingPenalty({
              word: chosenWord,
              reason,
              expiresAt: Date.now() + 5500,
            });
          } else {
            const result = await onRecordRejected({
              word: chosenWord,
              reason,
              penaltyApplied: room.penaltyEnabled,
            });
            showFeedback(
              'error',
              `"${chosenWord}" abgelehnt`,
              result.penaltyCard
                ? `${reason} (+1 Strafkarte [${result.penaltyCard}])`
                : reason
            );
          }
        }
      } catch (err) {
        showFeedback(
          'error',
          'KI nicht erreichbar',
          err instanceof Error ? err.message : 'Bitte tippe die Karte manuell ab.'
        );
      } finally {
        setJudgingWord(null);
      }
    },
    [
      room.status,
      room.usedWords,
      room.currentTheme,
      room.penaltyEnabled,
      hasFinished,
      isMyTurn,
      player.cards,
      player.isJunior,
      player.actionCards,
      muted,
      showFeedback,
      onRecordAccepted,
      onRecordRejected,
    ]
  );

  // Auto-resolve pending penalty shield if 5.5s timer expires
  useEffect(() => {
    if (!pendingPenalty) return;
    if (nowMs >= pendingPenalty.expiresAt) {
      const snap = pendingPenalty;
      setPendingPenalty(null);
      onRecordRejected({
        word: snap.word,
        reason: snap.reason,
        penaltyApplied: true,
      }).then((res) => {
        showFeedback(
          'error',
          `"${snap.word}" abgelehnt`,
          res.penaltyCard
            ? `${snap.reason} (+1 Strafkarte [${res.penaltyCard}])`
            : snap.reason
        );
      });
    }
  }, [pendingPenalty, nowMs, onRecordRejected, showFeedback]);

  // Auto-accept pending gift if player doesn't have SHIELD or doesn't react within 6s
  const giftHandledRef = useRef<Set<string>>(new Set());
  const activeGiftEvent = pendingGiftEvents[0] ?? null;

  useEffect(() => {
    if (!activeGiftEvent) return;
    if (giftHandledRef.current.has(activeGiftEvent.id)) return;

    if (!player.actionCards.includes('SHIELD')) {
      giftHandledRef.current.add(activeGiftEvent.id);
      onResolveGift(activeGiftEvent, false);
      playActionSound(muted);
      showFeedback(
        'info',
        `🎁 Karte [${activeGiftEvent.letter}] erhalten`,
        `${activeGiftEvent.fromName} hat dir eine Karte zugeschoben!`
      );
      return;
    }

    const timer = window.setTimeout(() => {
      if (!giftHandledRef.current.has(activeGiftEvent.id)) {
        giftHandledRef.current.add(activeGiftEvent.id);
        onResolveGift(activeGiftEvent, false);
      }
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [activeGiftEvent, player.actionCards, onResolveGift, muted, showFeedback]);

  // Web Speech API lifecycle
  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startRecognition = useCallback(
    (continuous: boolean) => {
      if (!SpeechRecognitionCtor || room.status !== 'PLAYING' || hasFinished) return;
      stopRecognition();

      try {
        const rec = new SpeechRecognitionCtor();
        rec.lang = 'de-DE';
        rec.continuous = continuous;
        rec.interimResults = true;

        rec.onresult = (event) => {
          let finalChunk = '';
          let interimChunk = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const res = event.results[i];
            const text = res[0]?.transcript || '';
            if (res.isFinal) {
              finalChunk += `${text} `;
            } else {
              interimChunk += `${text} `;
            }
          }
          if (interimChunk.trim()) {
            setLiveTranscript(interimChunk.trim());
          }
          if (finalChunk.trim()) {
            setLiveTranscript(finalChunk.trim());
            evaluateWord(finalChunk.trim());
          }
        };

        rec.onerror = (ev) => {
          if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
            showFeedback(
              'error',
              'Mikrofon blockiert',
              'Bitte erlaube den Mikrofonzugriff oder tippe deine Karten direkt an.'
            );
            setIsListening(false);
          }
        };

        rec.onend = () => {
          if (continuous && micMode === 'CONTINUOUS' && room.status === 'PLAYING' && !hasFinished) {
            window.setTimeout(() => {
              if (micMode === 'CONTINUOUS' && room.status === 'PLAYING') {
                startRecognition(true);
              }
            }, 180);
          } else if (!continuous && pttActiveRef.current) {
            pttActiveRef.current = false;
            setIsListening(false);
          } else {
            setIsListening(false);
          }
        };

        recognitionRef.current = rec;
        rec.start();
        setIsListening(true);
      } catch {
        setIsListening(false);
      }
    },
    [SpeechRecognitionCtor, room.status, hasFinished, micMode, stopRecognition, evaluateWord, showFeedback]
  );

  useEffect(() => {
    if (micMode === 'CONTINUOUS' && room.status === 'PLAYING' && !hasFinished && isMyTurn) {
      startRecognition(true);
    } else if (micMode !== 'CONTINUOUS' || room.status !== 'PLAYING' || hasFinished) {
      stopRecognition();
    }
    return () => stopRecognition();
  }, [micMode, room.status, hasFinished, isMyTurn, startRecognition, stopRecognition]);

  const handlePttDown = () => {
    if (!SpeechRecognitionCtor || room.status !== 'PLAYING' || hasFinished) return;
    pttActiveRef.current = true;
    setLiveTranscript('');
    startRecognition(false);
  };

  const handlePttUp = () => {
    if (!pttActiveRef.current) return;
    pttActiveRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        setIsListening(false);
      }
    }
    setIsListening(false);
  };

  // Last undoable feed entry for current player
  const currentRoundFeed = useMemo(
    () =>
      feed
        .filter((f) => f.roundNumber === room.roundNumber)
        .sort((a, b) => {
          const sa = (a.createdAt as { seconds?: number })?.seconds ?? 0;
          const sb = (b.createdAt as { seconds?: number })?.seconds ?? 0;
          return sb - sa;
        }),
    [feed, room.roundNumber]
  );

  const lastMyFeedEntry = useMemo(
    () => currentRoundFeed.find((f) => f.uid === player.uid && !f.undone) ?? null,
    [currentRoundFeed, player.uid]
  );

  const handleUndoLast = async () => {
    if (!lastMyFeedEntry) return;
    const norm = normalizeWord(lastMyFeedEntry.word);
    await onUndoEntry(lastMyFeedEntry, norm);
    playCardTap(muted);
    showFeedback(
      'info',
      'Rückgängig gemacht',
      `"${lastMyFeedEntry.word}" wurde korrigiert.`
    );
  };

  const handleManualTableDiscard = async () => {
    if (manualCardIdx === null || !player.cards[manualCardIdx]) return;
    const letter = player.cards[manualCardIdx];
    const label = manualWordInput.trim() || `Begriff mit ${letter === 'JOKER' ? 'Joker' : letter}`;
    await onRecordAccepted({
      word: label,
      normalizedWord: normalizeWord(label),
      matchedLetter: letter,
      cardIndex: manualCardIdx,
      reason: 'Manuell am Tisch abgelegt',
    });
    playSuccessChime(muted);
    setManualCardIdx(null);
    setManualWordInput('');
  };

  const handleManualCheckSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCardIdx === null || !manualWordInput.trim()) return;
    await evaluateWord(manualWordInput.trim(), manualCardIdx);
  };

  const handleActionCardClick = async (action: ActionCardType) => {
    if (room.status !== 'PLAYING') return;
    if (action === 'THEME_SWAP') {
      playActionSound(muted);
      await onPlayThemeSwap();
      showFeedback('info', '🔄 Themen-Wechsel!', 'Ein brandneues Thema ist auf dem Tisch.');
    } else if (action === 'TIME_TURBO') {
      playActionSound(muted);
      await onPlayTimeTurbo();
      showFeedback('info', '⚡ Zeit-Turbo!', 'Countdown auf 5 Sekunden verkürzt!');
    } else if (action === 'GIFT') {
      if (player.cards.length === 0) return;
      setGiftCardIdx(0);
      setGiftStepOpen(true);
    } else if (action === 'SHIELD') {
      showFeedback(
        'info',
        '🛡️ Schutzschild bereit',
        'Aktiviert sich automatisch als Reaktion, wenn dir ein Geschenk oder eine Strafkarte droht.'
      );
    }
  };

  const opponents = room.playerOrder
    .map((uid) => room.playersMeta[uid])
    .filter((p) => p && p.uid !== player.uid);

  return (
    <div className="min-h-screen bg-[#0F1117] text-slate-100 flex flex-col">
      {/* Compact Sticky Top Bar (well under 15% mobile height) */}
      <header className="sticky top-0 z-30 h-14 bg-[#0F1117]/95 backdrop-blur-md border-b border-white/10 px-3 sm:px-6 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="font-display font-extrabold text-lg text-white whitespace-nowrap shrink-0">
            WortBlitz
          </span>
          <span className="text-xs font-mono text-amber-400 tabular-nums whitespace-nowrap">
            {room.code}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isHost && (
            <>
              <button
                type="button"
                onClick={() => onAdvanceTheme('Thema übersprungen')}
                title="Nächstes Thema"
                className="min-h-[44px] px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-200 flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <SkipForward className="w-4 h-4 text-amber-400" />
                <span className="hidden sm:inline">Nächstes Thema</span>
              </button>
              <button
                type="button"
                onClick={onFinishRound}
                title="Runde beenden"
                className="min-h-[44px] px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-200 flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <Flag className="w-4 h-4 text-rose-400" />
                <span className="hidden sm:inline">Wertung</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Ton einschalten' : 'Ton stummschalten'}
            className="min-h-[44px] min-w-[44px] rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-200 transition-colors"
          >
            {muted ? <VolumeX className="w-5 h-5 text-slate-400" /> : <Volume2 className="w-5 h-5 text-amber-400" />}
          </button>
        </div>
      </header>

      {/* Main Responsive Layout */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-6 py-3 sm:py-5 flex flex-col lg:grid lg:grid-cols-12 gap-4">
        {/* TOP / LEFT ZONE: Players Strip, Current Theme, Timer & Live Ticker */}
        <div className="lg:col-span-5 space-y-3 sm:space-y-4">
          {/* Player Roster Strip */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {room.playerOrder
              .map((uid) => room.playersMeta[uid])
              .filter(Boolean)
              .map((p) => {
                const av = getAvatar(p.avatar);
                const isTurn =
                  room.turnMode === 'TURN_BASED' && room.activeTurnUid === p.uid;
                const isDone = room.winnersOrder.includes(p.uid);
                return (
                  <div
                    key={p.uid}
                    className={`shrink-0 px-3 py-2 rounded-2xl border flex items-center gap-2.5 transition-colors ${
                      isTurn
                        ? 'bg-amber-400/15 border-amber-400'
                        : p.uid === player.uid
                          ? 'bg-[#1C202E] border-white/20'
                          : 'bg-[#171A24] border-white/10'
                    }`}
                  >
                    <span className="text-xl">{av.emoji}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate max-w-[84px]">
                        {p.name}
                      </p>
                      <p className="text-[11px] font-mono text-slate-400 tabular-nums">
                        {isDone ? 'Fertig!' : `${p.cardCount} Krt`} · {p.score} Pkt
                      </p>
                      {isTurn && (
                        <p className="text-[10px] font-bold text-amber-300">Am Zug</p>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Active Theme & Countdown Card */}
          <section className="rounded-3xl bg-[#171A24] border border-white/10 p-4 sm:p-6 space-y-3 relative overflow-hidden">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>
                Runde {room.roundNumber} · {room.turnMode === 'SIMULTANEOUS' ? 'Alle zugleich' : 'Reihum'}
              </span>
              <span
                className={`font-mono text-base font-bold tabular-nums ${
                  remainingSec <= 5 && room.status === 'PLAYING'
                    ? 'text-rose-400'
                    : 'text-amber-400'
                }`}
              >
                {remainingSec}s
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-display font-extrabold text-white leading-tight text-balance">
              {room.currentTheme}
            </h1>

            <div className="h-2 w-full rounded-full bg-[#0F1117] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-200 ${
                  remainingSec <= 5 && room.status === 'PLAYING'
                    ? 'bg-rose-500'
                    : 'bg-amber-400'
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>

            {room.lastActionNotice && (
              <p className="text-xs text-slate-400 truncate">
                {room.lastActionNotice}
              </p>
            )}

            {/* 3-2-1 Countdown Overlay */}
            {room.status === 'COUNTDOWN' && (
              <div className="absolute inset-0 bg-[#0F1117]/90 backdrop-blur-sm flex flex-col items-center justify-center p-4 text-center z-10">
                <p className="text-xs font-semibold text-amber-400 mb-1">
                  Thema wird vorgelesen...
                </p>
                <div className="font-display text-6xl font-extrabold text-white tabular-nums">
                  {remainingSec > 0 ? remainingSec : 'LOS!'}
                </div>
                <p className="text-sm font-semibold text-slate-200 mt-2 line-clamp-2">
                  {room.currentTheme}
                </p>
              </div>
            )}
          </section>

          {/* Live Ticker + Locked Words */}
          <section className="rounded-2xl bg-[#171A24] border border-white/10 p-3.5 sm:p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300">Live-Ticker</span>
              <span className="text-slate-400 tabular-nums">
                {room.usedWords.length} gesperrte Wörter
              </span>
            </div>

            {currentRoundFeed.length === 0 ? (
              <p className="text-xs text-slate-500 py-1">
                Noch kein Wort genannt — leg los!
              </p>
            ) : (
              <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                {currentRoundFeed.slice(0, 8).map((entry) => (
                  <div
                    key={entry.id}
                    className={`flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 rounded-xl bg-[#0F1117] ${
                      entry.undone ? 'opacity-45 line-through' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span>{getAvatar(entry.avatar).emoji}</span>
                      <span className="font-semibold text-slate-200 truncate">
                        {entry.playerName}:
                      </span>
                      <span className="text-white font-medium truncate">
                        {entry.word}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 font-mono font-bold ${
                        entry.valid ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {entry.valid ? `✓ ${entry.letter === 'JOKER' ? '★' : entry.letter}` : `✕ ${entry.letter}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* BOTTOM / RIGHT ZONE (Thumb Zone): Feedback, Own Cards, Action Cards & Mic Controls */}
        <div className="lg:col-span-7 flex flex-col justify-between space-y-4">
          {/* AI Referee Feedback Banner */}
          {judgingWord ? (
            <div className="rounded-2xl bg-amber-400/15 border border-amber-400/40 px-4 py-3 flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-amber-400 animate-spin shrink-0" />
              <p className="text-sm font-semibold text-amber-200">
                KI-Schiedsrichter prüft „{judgingWord}“...
              </p>
            </div>
          ) : feedback ? (
            <div
              className={`rounded-2xl border px-4 py-3 flex items-start gap-3 animate-card-pop ${
                feedback.type === 'success'
                  ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-100'
                  : feedback.type === 'error'
                    ? 'bg-rose-500/15 border-rose-400/40 text-rose-100'
                    : 'bg-sky-500/15 border-sky-400/40 text-sky-100'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">{feedback.title}</p>
                <p className="text-xs opacity-90">{feedback.detail}</p>
              </div>
            </div>
          ) : null}

          {/* Own Letter Cards Hand */}
          <section className="rounded-3xl bg-[#171A24] border border-white/10 p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-display font-bold text-slate-200">
                Deine Kartenhand ({player.cards.length})
              </h2>
              <span className="text-xs text-slate-400">
                Antippen zum Ablegen
              </span>
            </div>

            {hasFinished ? (
              <div className="py-8 text-center space-y-1">
                <p className="font-display text-2xl font-extrabold text-emerald-400">
                  Alle Karten abgelegt!
                </p>
                <p className="text-xs text-slate-400">
                  Die Runde läuft weiter, bis nur noch ein Spieler Karten hat.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-4 gap-2.5">
                {player.cards.map((letter, idx) => {
                  const style = getLetterCardColors(letter);
                  return (
                    <button
                      key={`${letter}-${idx}`}
                      type="button"
                      disabled={room.status !== 'PLAYING' || Boolean(judgingWord)}
                      onClick={() => {
                        playCardTap(muted);
                        setManualCardIdx(idx);
                        setManualWordInput('');
                      }}
                      className={`min-h-[82px] sm:min-h-[96px] rounded-2xl border-2 ${style.bg} ${style.border} ${style.text} flex flex-col items-center justify-center p-2 shadow-md active:scale-95 transition-transform disabled:opacity-50 animate-card-pop`}
                    >
                      <span className="font-display text-3xl sm:text-4xl font-extrabold leading-none">
                        {letter === 'JOKER' ? '★' : letter}
                      </span>
                      <span
                        className={`mt-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${style.badge}`}
                      >
                        {letter === 'JOKER' ? 'A–Z Joker' : 'Karte'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Chaos Action Cards */}
            {room.ruleVariant === 'CHAOS' && player.actionCards.length > 0 && (
              <div className="pt-3 border-t border-white/10 space-y-2">
                <span className="block text-xs font-medium text-slate-400">
                  Aktionskarten (Familien-Chaos)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {player.actionCards.map((action, idx) => {
                    const meta = ACTION_CARD_META[action];
                    return (
                      <button
                        key={`${action}-${idx}`}
                        type="button"
                        disabled={room.status !== 'PLAYING'}
                        onClick={() => handleActionCardClick(action)}
                        className={`min-h-[52px] px-3.5 py-2 rounded-2xl border text-left flex items-center gap-3 active:scale-[0.98] transition-transform disabled:opacity-50 ${meta.colorClass}`}
                      >
                        <span className="text-2xl shrink-0">{meta.emoji}</span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold truncate">{meta.title}</p>
                          <p className="text-[11px] opacity-80 truncate">{meta.shortDesc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Mic Controls & Undo Bar (Bottom Ergonomic Thumb Zone) */}
          <section className="rounded-3xl bg-[#171A24] border border-white/10 p-4 space-y-3">
            {/* Mic Mode Switcher + Live Transcript */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex p-1 rounded-xl bg-[#0F1117] border border-white/10">
                <button
                  type="button"
                  onClick={() => setMicMode('PTT')}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors ${
                    micMode === 'PTT'
                      ? 'bg-amber-400 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Sprechtaste halten
                </button>
                <button
                  type="button"
                  onClick={() => setMicMode('CONTINUOUS')}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors ${
                    micMode === 'CONTINUOUS'
                      ? 'bg-amber-400 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Dauer-Zuhören
                </button>
              </div>

              {lastMyFeedEntry && (
                <button
                  type="button"
                  onClick={handleUndoLast}
                  className="min-h-[44px] px-3.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-amber-300 flex items-center gap-1.5 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Falsch verstanden / Rückgängig
                </button>
              )}
            </div>

            {liveTranscript && (
              <p className="text-xs text-slate-300 bg-[#0F1117] px-3 py-2 rounded-xl truncate">
                Erkannt: <span className="font-semibold text-white">„{liveTranscript}“</span>
              </p>
            )}

            {!SpeechRecognitionCtor ? (
              <div className="p-3 rounded-xl bg-[#0F1117] border border-white/10 text-xs text-slate-400 flex items-center gap-2">
                <MicOff className="w-4 h-4 shrink-0 text-slate-500" />
                <span>
                  Spracherkennung wird in diesem Browser nicht unterstützt. Tippe einfach eine Buchstabenkarte an!
                </span>
              </div>
            ) : micMode === 'PTT' ? (
              <button
                type="button"
                disabled={room.status !== 'PLAYING' || hasFinished || !isMyTurn}
                onPointerDown={handlePttDown}
                onPointerUp={handlePttUp}
                onPointerCancel={handlePttUp}
                onPointerLeave={handlePttUp}
                className={`w-full min-h-[60px] rounded-2xl font-bold text-base flex items-center justify-center gap-2.5 touch-none select-none transition-transform active:scale-[0.98] disabled:opacity-50 ${
                  isListening
                    ? 'bg-rose-500 text-white'
                    : 'bg-amber-400 text-slate-950 hover:bg-amber-300'
                }`}
              >
                <Mic className="w-5 h-5" />
                {!isMyTurn
                  ? 'Warte auf deinen Zug...'
                  : isListening
                    ? 'Höre zu — zum Prüfen loslassen'
                    : 'Sprechtaste gedrückt halten & Wort rufen'}
              </button>
            ) : (
              <div
                className={`w-full min-h-[56px] px-4 rounded-2xl border flex items-center justify-center gap-2.5 text-sm font-semibold ${
                  isListening
                    ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-200'
                    : 'bg-[#0F1117] border-white/10 text-slate-400'
                }`}
              >
                <Mic className="w-5 h-5" />
                {!isMyTurn
                  ? 'Warte auf deinen Zug (Dauer-Zuhören pausiert)'
                  : isListening
                    ? 'Dauer-Zuhören aktiv (de-DE) — sprich jederzeit ein Wort!'
                    : 'Mikrofon wartet auf Rundenstart...'}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Manual Card Tap Sheet */}
      {manualCardIdx !== null && player.cards[manualCardIdx] && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full sm:max-w-md bg-[#171A24] border border-white/10 rounded-t-3xl sm:rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-display font-bold text-white">
                Karte [{player.cards[manualCardIdx] === 'JOKER' ? '★ A–Z Joker' : player.cards[manualCardIdx]}] spielen
              </h3>
              <button
                type="button"
                onClick={() => setManualCardIdx(null)}
                className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-300 hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleManualCheckSubmit} className="space-y-3">
              <input
                type="text"
                autoFocus
                value={manualWordInput}
                onChange={(e) => setManualWordInput(e.target.value)}
                placeholder={
                  player.cards[manualCardIdx] === 'JOKER'
                    ? 'Beliebiges Wort zum Thema eingeben...'
                    : `Wort mit "${player.cards[manualCardIdx]}" eingeben...`
                }
                maxLength={60}
                className="w-full min-h-[48px] px-4 rounded-xl bg-[#0F1117] border border-white/15 text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
              />
              <button
                type="submit"
                disabled={!manualWordInput.trim() || Boolean(judgingWord)}
                className="w-full min-h-[48px] px-4 rounded-xl bg-amber-400 text-slate-950 font-bold hover:bg-amber-300 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                Per KI prüfen & ablegen
              </button>
            </form>

            <div className="pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={handleManualTableDiscard}
                className="w-full min-h-[48px] px-4 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-semibold text-slate-200 transition-colors"
              >
                Direkt ablegen (Tisch-Einigung ohne KI)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chaos Gift Selector Modal */}
      {giftStepOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full sm:max-w-md bg-[#171A24] border border-white/10 rounded-t-3xl sm:rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-display font-bold text-white">
                🎁 Karten-Geschenk
              </h3>
              <button
                type="button"
                onClick={() => setGiftStepOpen(false)}
                className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-300 hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-400">
                1. Eigene Karte zum Verschenken wählen
              </p>
              <div className="flex flex-wrap gap-2">
                {player.cards.map((c, idx) => (
                  <button
                    key={`${c}-${idx}`}
                    type="button"
                    onClick={() => setGiftCardIdx(idx)}
                    className={`min-w-[48px] min-h-[48px] px-3 rounded-xl font-display font-bold text-lg border ${
                      giftCardIdx === idx
                        ? 'bg-amber-400 text-slate-950 border-amber-300'
                        : 'bg-[#0F1117] text-white border-white/15'
                    }`}
                  >
                    {c === 'JOKER' ? '★' : c}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-400">
                2. Mitspieler antippen
              </p>
              {opponents.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Keine Mitspieler im Raum verfügbar.
                </p>
              ) : (
                <div className="space-y-2">
                  {opponents.map((opp) => (
                    <button
                      key={opp.uid}
                      type="button"
                      disabled={giftCardIdx === null}
                      onClick={async () => {
                        if (giftCardIdx === null) return;
                        setGiftStepOpen(false);
                        playActionSound(muted);
                        await onSendGift(opp.uid, opp.name, giftCardIdx);
                        showFeedback(
                          'info',
                          `🎁 Geschenk unterwegs`,
                          `Du hast ${opp.name} eine Karte geschickt!`
                        );
                      }}
                      className="w-full min-h-[48px] px-4 rounded-xl bg-[#0F1117] hover:bg-white/10 border border-white/10 flex items-center justify-between text-left"
                    >
                      <span className="flex items-center gap-2.5 font-semibold text-white">
                        <span className="text-xl">{getAvatar(opp.avatar).emoji}</span>
                        {opp.name}
                      </span>
                      <span className="text-xs text-slate-400 tabular-nums">
                        {opp.cardCount} Karten
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Shield Reaction Modal for Incoming Penalty Card */}
      {pendingPenalty && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-3xl bg-[#171A24] border border-emerald-400/40 p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center mx-auto">
              <Shield className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-display font-bold text-white">
              Strafkarte (+1) droht!
            </h3>
            <p className="text-sm text-slate-300">
              „{pendingPenalty.word}“ wurde abgelehnt ({pendingPenalty.reason}).
            </p>
            <div className="space-y-2.5 pt-2">
              <button
                type="button"
                onClick={async () => {
                  setPendingPenalty(null);
                  playActionSound(muted);
                  await onConsumeShieldForPenalty();
                  showFeedback(
                    'success',
                    '🛡️ Schutzschild eingesetzt!',
                    'Strafkarte erfolgreich abgewehrt.'
                  );
                }}
                className="w-full min-h-[50px] rounded-xl bg-emerald-400 text-slate-950 font-bold hover:bg-emerald-300"
              >
                🛡️ Schutzschild einsetzen (Abwehren)
              </button>
              <button
                type="button"
                onClick={async () => {
                  const snap = pendingPenalty;
                  setPendingPenalty(null);
                  const res = await onRecordRejected({
                    word: snap.word,
                    reason: snap.reason,
                    penaltyApplied: true,
                  });
                  showFeedback(
                    'error',
                    `"${snap.word}" abgelehnt`,
                    res.penaltyCard
                      ? `${snap.reason} (+1 Strafkarte [${res.penaltyCard}])`
                      : snap.reason
                  );
                }}
                className="w-full min-h-[44px] rounded-xl bg-white/10 text-slate-300 text-sm"
              >
                Strafkarte annehmen (+1)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shield Reaction Modal for Incoming Chaos Gift */}
      {activeGiftEvent && player.actionCards.includes('SHIELD') && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-3xl bg-[#171A24] border border-emerald-400/40 p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-300 flex items-center justify-center mx-auto text-2xl">
              🎁
            </div>
            <h3 className="text-xl font-display font-bold text-white">
              Karten-Geschenk von {activeGiftEvent.fromName}!
            </h3>
            <p className="text-sm text-slate-300">
              Du erhältst die Karte <strong className="text-white">[{activeGiftEvent.letter}]</strong>. Mit deinem Schutzschild abwehren?
            </p>
            <div className="space-y-2.5 pt-2">
              <button
                type="button"
                onClick={async () => {
                  giftHandledRef.current.add(activeGiftEvent.id);
                  playActionSound(muted);
                  await onResolveGift(activeGiftEvent, true);
                  showFeedback(
                    'success',
                    '🛡️ Geschenk abgewehrt!',
                    `Du hast das Karten-Geschenk von ${activeGiftEvent.fromName} geblockt.`
                  );
                }}
                className="w-full min-h-[50px] rounded-xl bg-emerald-400 text-slate-950 font-bold hover:bg-emerald-300"
              >
                🛡️ Schutzschild einsetzen!
              </button>
              <button
                type="button"
                onClick={async () => {
                  giftHandledRef.current.add(activeGiftEvent.id);
                  await onResolveGift(activeGiftEvent, false);
                }}
                className="w-full min-h-[44px] rounded-xl bg-white/10 text-slate-300 text-sm"
              >
                Karte annehmen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
