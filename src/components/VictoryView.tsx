import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { RotateCcw, Trophy } from 'lucide-react';
import { getAvatar } from '../data/themesAndCards';
import { playVictoryFanfare } from '../lib/soundAndSpeech';
import type { RoomData } from '../types/game';

interface VictoryViewProps {
  room: RoomData;
  myUid: string;
  muted: boolean;
  onResetToLobby: () => Promise<void>;
  onLeaveRoom: () => void;
}

export const VictoryView: React.FC<VictoryViewProps> = ({
  room,
  myUid,
  muted,
  onResetToLobby,
  onLeaveRoom,
}) => {
  const isHost = room.hostUid === myUid;

  const ranked = [...room.playerOrder]
    .map((uid) => room.playersMeta[uid])
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  useEffect(() => {
    playVictoryFanfare(muted);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) {
      confetti({
        particleCount: 95,
        spread: 75,
        origin: { y: 0.6 },
        colors: ['#F59E0B', '#10B981', '#F43F5E', '#0EA5E9'],
      });
    }
  }, [muted]);

  const podiumOrder = [ranked[1], ranked[0], ranked[2]].filter(Boolean);

  return (
    <div className="min-h-screen bg-[#0F1117] text-slate-100 flex flex-col justify-between p-4 pb-8">
      <div className="max-w-xl w-full mx-auto space-y-6 pt-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-400/20 border border-amber-400/40 text-amber-400">
            <Trophy className="w-7 h-7" />
          </div>
          <h1 className="text-3xl font-display font-extrabold text-white">
            {ranked[0]?.name} gewinnt WortBlitz!
          </h1>
          <p className="text-sm text-slate-400">
            Endstand nach {room.roundNumber} Runden
          </p>
        </div>

        {/* Visual Podium */}
        <div className="grid grid-cols-3 gap-2.5 items-end pt-4">
          {podiumOrder.map((p) => {
            const actualRank = ranked.findIndex((r) => r.uid === p.uid) + 1;
            const heightClass =
              actualRank === 1
                ? 'h-40 bg-amber-400/20 border-amber-400/60'
                : actualRank === 2
                  ? 'h-32 bg-slate-400/15 border-slate-400/40'
                  : 'h-24 bg-orange-500/15 border-orange-400/40';
            const av = getAvatar(p.avatar);
            return (
              <div
                key={p.uid}
                className={`rounded-t-3xl rounded-b-xl border p-3 flex flex-col items-center justify-between text-center ${heightClass}`}
              >
                <div className="space-y-1">
                  <div className="text-2xl">{av.emoji}</div>
                  <div className="text-xs font-bold text-white truncate max-w-[90px]">
                    {p.name}
                  </div>
                </div>
                <div>
                  <div className="font-mono font-extrabold text-lg text-amber-400 tabular-nums">
                    {p.score} P.
                  </div>
                  <div className="text-[11px] text-slate-300 font-semibold">
                    {actualRank}. Platz
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Full Standings */}
        <div className="rounded-3xl bg-[#1C202E] border border-white/10 p-4 space-y-2">
          {ranked.map((p, idx) => (
            <div
              key={p.uid}
              className="px-3.5 py-2.5 rounded-2xl bg-[#161923] flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono font-bold text-slate-400 w-5 tabular-nums">
                  {idx + 1}.
                </span>
                <span className="text-lg">{getAvatar(p.avatar).emoji}</span>
                <span className="font-semibold text-sm text-white">{p.name}</span>
              </div>
              <span className="font-mono font-bold text-amber-400 tabular-nums">
                {p.score} Punkte
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-xl w-full mx-auto pt-4 flex gap-3">
        <button
          type="button"
          onClick={onLeaveRoom}
          className="min-h-[52px] px-5 rounded-2xl bg-white/10 hover:bg-white/15 text-sm font-semibold text-white"
        >
          Startseite
        </button>
        {isHost && (
          <button
            type="button"
            onClick={onResetToLobby}
            className="flex-1 min-h-[52px] px-6 rounded-2xl bg-amber-400 text-slate-950 font-display font-bold text-base hover:bg-amber-300 flex items-center justify-center gap-2"
          >
            <RotateCcw className="w-5 h-5" />
            <span>Nochmal spielen</span>
          </button>
        )}
      </div>
    </div>
  );
};
