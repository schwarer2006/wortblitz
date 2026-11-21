import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Bot,
  FastForward,
  Megaphone,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { getAvatar } from '../data/themesAndCards';
import { playCountdownBeep } from '../lib/soundAndSpeech';
import type { FeedEntry, RoomData } from '../types/game';

interface TableDisplayViewProps {
  room: RoomData;
  familyPin: string;
  feedEntries: FeedEntry[];
  muted: boolean;
  isTableAudioDevice: boolean;
  onToggleTableAudio: () => void;
  onToggleMute: () => void;
  onCountdownFinished: () => Promise<void>;
  onThemeTimedOut: () => Promise<void>;
  onTurnTimedOut: () => Promise<void>;
  onFinishRoundManually: () => Promise<void>;
  onLeaveRoom: () => void;
}

export const TableDisplayView: React.FC<TableDisplayViewProps> = ({
  room,
  familyPin,
  feedEntries,
  muted,
  isTableAudioDevice,
  onToggleTableAudio,
  onToggleMute,
  onCountdownFinished,
  onThemeTimedOut,
  onTurnTimedOut,
  onFinishRoundManually,
  onLeaveRoom,
}) => {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [countdownStep, setCountdownStep] = useState(3);
  const timerHandledKeyRef = useRef('');

  const timerCallbacksRef = useRef({
    onCountdownFinished,
    onThemeTimedOut,
    onTurnTimedOut,
    muted,
    turnMode: room.turnMode,
  });
  timerCallbacksRef.current = {
    onCountdownFinished,
    onThemeTimedOut,
    onTurnTimedOut,
    muted,
    turnMode: room.turnMode,
  };

  const joinUrl = `${window.location.origin}${window.location.pathname}?room=${room.code}&pin=${encodeURIComponent(familyPin)}`;

  const activeFeed = useMemo(
    () =>
      feedEntries
        .filter(
          (e) =>
            !e.undone &&
            e.roundNumber === room.roundNumber &&
            e.theme === room.currentTheme
        )
        .slice(0, 12),
    [feedEntries, room.roundNumber, room.currentTheme]
  );

  const isRoundEndingDelay = room.status === 'PLAYING' && room.turnEndsAt === 0;
  const isTimeUpNotice =
    (room.status === 'COUNTDOWN' && room.lastActionNotice.startsWith('Zeit um')) ||
    (room.status === 'PLAYING' && room.turnEndsAt > 0 && secondsLeft === 0);

  useEffect(() => {
    if (room.status !== 'COUNTDOWN' && room.status !== 'PLAYING') {
      setSecondsLeft(0);
      return;
    }

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
        const key = `tcd-${room.roundNumber}-${room.currentThemeIndex}-${room.turnEndsAt}`;
        if (diffMs <= 0 && timerHandledKeyRef.current !== key) {
          timerHandledKeyRef.current = key;
          playCountdownBeep(true, cb.muted);
          cb.onCountdownFinished();
        }
      } else if (room.status === 'PLAYING' && room.turnEndsAt > 0) {
        const key = `tplay-${room.roundNumber}-${room.currentThemeIndex}-${room.turnEndsAt}`;
        if (diffMs <= 0 && timerHandledKeyRef.current !== key) {
          timerHandledKeyRef.current = key;
          if (cb.turnMode === 'SIMULTANEOUS') {
            cb.onThemeTimedOut();
          } else {
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

  const timerProgressPct =
    room.status === 'PLAYING'
      ? Math.min(100, Math.max(0, (secondsLeft / room.roundDurationSec) * 100))
      : 100;

  return (
    <div className="min-h-screen bg-[#0F1117] text-slate-100 flex flex-col p-4 sm:p-6 gap-5">
      {/* Table Header */}
      <header className="max-w-7xl w-full mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-display font-extrabold text-white">
            WortBlitz
          </span>
          <span className="text-slate-500">·</span>
          <span className="text-sm text-amber-400 font-semibold">
            Tisch-Bildschirm · Runde {room.roundNumber} · {room.selectedCategory}
          </span>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap justify-end">
          <button
            type="button"
            onClick={onToggleTableAudio}
            className={`min-h-[44px] px-4 rounded-xl border text-xs font-bold flex items-center gap-2 transition-colors ${
              isTableAudioDevice
                ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/30'
                : 'bg-amber-400 text-slate-950 border-amber-300 hover:bg-amber-300'
            }`}
          >
            {isTableAudioDevice ? (
              <Megaphone className="w-4 h-4 text-emerald-300" />
            ) : (
              <VolumeX className="w-4 h-4 text-slate-950" />
            )}
            <span>
              {isTableAudioDevice
                ? 'Tisch-Ton aktiv'
                : 'Tisch-Ton auf diesem Gerät einschalten'}
            </span>
          </button>

          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Effekte einschalten' : 'Effekte stummschalten'}
            className="min-h-[44px] min-w-[44px] rounded-xl bg-[#1C202E] border border-white/10 flex items-center justify-center text-slate-200 hover:border-white/25"
          >
            {muted ? (
              <VolumeX className="w-5 h-5 text-rose-400" />
            ) : (
              <Volume2 className="w-5 h-5 text-amber-400" />
            )}
          </button>

          {room.status === 'PLAYING' && (
            <button
              type="button"
              onClick={onThemeTimedOut}
              className="min-h-[44px] px-4 rounded-xl bg-[#1C202E] border border-white/10 hover:border-white/25 text-xs font-semibold text-slate-200 flex items-center gap-1.5"
            >
              <FastForward className="w-4 h-4 text-amber-400" />
              <span>Nächstes Thema</span>
            </button>
          )}

          <button
            type="button"
            onClick={onFinishRoundManually}
            className="min-h-[44px] px-4 rounded-xl bg-amber-400/15 border border-amber-400/40 text-xs font-semibold text-amber-300 hover:bg-amber-400/25"
          >
            Runde auswerten
          </button>

          <button
            type="button"
            onClick={onLeaveRoom}
            className="min-h-[44px] px-3.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-300"
          >
            Beenden
          </button>
        </div>
      </header>

      {/* Main Table Stage */}
      <main className="flex-1 max-w-7xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Center Theme & Players */}
        <div className="lg:col-span-9 flex flex-col gap-5">
          {/* Extra-large Theme Display */}
          <section className="rounded-3xl bg-[#1C202E] border border-white/10 p-6 sm:p-10 flex flex-col justify-between gap-6">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium text-slate-400">
                {room.turnMode === 'TURN_BASED'
                  ? `Reihum · Am Zug: ${room.playersMeta[room.activeTurnUid]?.name ?? '–'}`
                  : 'Alle zugleich · Wer zuerst ruft, legt ab'}
              </span>
              <span
                className={`font-mono font-extrabold text-3xl sm:text-4xl tabular-nums ${
                  secondsLeft <= 5 ? 'text-rose-400' : 'text-amber-400'
                }`}
              >
                {room.status === 'COUNTDOWN' ? `${countdownStep}…` : `${secondsLeft}s`}
              </span>
            </div>

            {room.status === 'COUNTDOWN' ? (
              <div className="py-8 text-center space-y-2">
                {isTimeUpNotice && (
                  <div className="text-base font-bold text-rose-300 uppercase tracking-wide">
                    Zeit um – nächstes Thema!
                  </div>
                )}
                <div className="text-7xl font-display font-extrabold text-amber-400 tabular-nums">
                  {countdownStep}
                </div>
                <p className="text-lg text-slate-300">
                  Thema wird gleich vorgelesen…
                </p>
              </div>
            ) : isRoundEndingDelay ? (
              <div className="py-6 text-center space-y-2">
                <div className="text-xl font-bold text-emerald-300">
                  Alle Karten abgelegt – Runde wird ausgewertet…
                </div>
                <h1 className="text-3xl sm:text-5xl font-display font-extrabold text-white leading-tight text-balance">
                  {room.currentTheme}
                </h1>
              </div>
            ) : (
              <div className="space-y-2">
                {isTimeUpNotice && (
                  <div className="text-center text-base font-bold text-rose-300">
                    Zeit um – nächstes Thema!
                  </div>
                )}
                <h1 className="text-4xl sm:text-6xl font-display font-extrabold text-white text-center leading-tight text-balance py-4">
                  {room.currentTheme}
                </h1>
              </div>
            )}

            <div className="h-3.5 w-full rounded-full bg-[#0F1117] overflow-hidden">
              <div
                className={`h-full transition-all duration-200 ${
                  secondsLeft <= 5 ? 'bg-rose-500' : 'bg-amber-400'
                }`}
                style={{ width: `${timerProgressPct}%` }}
              />
            </div>
          </section>

          {/* All Players & Bots Strip */}
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {room.playerOrder.map((uid) => {
              const p = room.playersMeta[uid];
              if (!p) return null;
              const av = getAvatar(p.avatar);
              const isTurn = room.turnMode === 'TURN_BASED' && room.activeTurnUid === uid;
              const done = p.cardCount === 0;
              return (
                <div
                  key={uid}
                  className={`rounded-2xl p-4 border flex items-center gap-3.5 transition-all ${
                    isTurn
                      ? 'bg-amber-400/20 border-amber-400 scale-[1.02]'
                      : done
                        ? 'bg-emerald-500/15 border-emerald-400/40'
                        : 'bg-[#1C202E] border-white/10'
                  }`}
                >
                  <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center text-2xl shrink-0 ${av.bgClass}`}>
                    {av.emoji}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-base text-white truncate flex items-center gap-1.5">
                      <span>{p.name}</span>
                      {p.isBot && <Bot className="w-4 h-4 text-sky-400 shrink-0" />}
                    </div>
                    <div className="text-sm font-mono tabular-nums text-slate-300 mt-0.5">
                      {done ? 'Fertig!' : `${p.cardCount} Karten`} · {p.score} P.
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        </div>

        {/* Right Column: Live Ticker + Persistent QR Code */}
        <aside className="lg:col-span-3 flex flex-col gap-5">
          {/* Persistent Small QR Code */}
          <div className="rounded-3xl bg-[#1C202E] border border-white/10 p-4 flex items-center gap-4">
            <div className="bg-white p-2 rounded-xl shrink-0">
              <QRCodeSVG
                value={joinUrl}
                size={76}
                bgColor="#FFFFFF"
                fgColor="#0F1117"
                level="M"
              />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-slate-400">Raum-Code</div>
              <div className="font-mono font-bold text-2xl text-amber-400 tracking-widest tabular-nums">
                {room.code}
              </div>
              <div className="text-[11px] text-slate-400 truncate mt-0.5">
                {room.lastActionNotice}
              </div>
            </div>
          </div>

          {/* Live Ticker */}
          <div className="flex-1 rounded-3xl bg-[#1C202E] border border-white/10 p-4 flex flex-col gap-3 min-h-[260px]">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span>Live-Ticker</span>
              <span className="font-mono tabular-nums text-slate-400">
                {room.usedWords.length} gesperrt
              </span>
            </div>
            <div className="space-y-2 overflow-y-auto flex-1 pr-1">
              {activeFeed.length === 0 ? (
                <p className="text-xs text-slate-500 pt-2">
                  Noch keine Begriffe in dieser Runde…
                </p>
              ) : (
                activeFeed.map((item) => (
                  <div
                    key={item.id}
                    className={`px-3 py-2 rounded-xl border text-xs flex items-center justify-between gap-2 ${
                      item.valid
                        ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-100'
                        : 'bg-rose-500/10 border-rose-400/30 text-rose-100'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span>{getAvatar(item.avatar).emoji}</span>
                      <span className="font-bold truncate">{item.word}</span>
                    </div>
                    <span className="font-mono text-[11px] opacity-80 shrink-0">
                      {item.playerName} ({item.letter})
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
};
