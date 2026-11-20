import React, { useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { Trophy, RotateCcw, ArrowRight, Crown } from 'lucide-react';
import { calculateRoundPoints, getAvatar } from '../data/themesAndCards';
import { playVictoryFanfare } from '../lib/soundAndSpeech';
import type { RoomData } from '../types/game';

interface RoundAndVictoryViewProps {
  room: RoomData;
  myUid: string;
  muted: boolean;
  onNextRound: () => Promise<void>;
  onResetToLobby: () => Promise<void>;
  onShowGameOver: () => Promise<void>;
}

export const RoundAndVictoryView: React.FC<RoundAndVictoryViewProps> = ({
  room,
  myUid,
  muted,
  onNextRound,
  onResetToLobby,
  onShowGameOver,
}) => {
  const isHost = room.hostUid === myUid;
  const confettiFiredRef = useRef(false);

  const playersList = room.playerOrder
    .map((uid) => room.playersMeta[uid])
    .filter(Boolean);

  const sortedByScore = [...playersList].sort((a, b) => b.score - a.score);
  const someoneReachedTarget = sortedByScore.some((p) => p.score >= room.targetScore);

  useEffect(() => {
    if (room.status === 'GAME_OVER' && !confettiFiredRef.current) {
      confettiFiredRef.current = true;
      playVictoryFanfare(muted);
      try {
        confetti({
          particleCount: 90,
          spread: 75,
          origin: { y: 0.55 },
          colors: ['#F59E0B', '#10B981', '#0EA5E9', '#F43F5E'],
        });
        setTimeout(() => {
          confetti({
            particleCount: 55,
            angle: 60,
            spread: 55,
            origin: { x: 0.1, y: 0.65 },
          });
          confetti({
            particleCount: 55,
            angle: 120,
            spread: 55,
            origin: { x: 0.9, y: 0.65 },
          });
        }, 350);
      } catch {
        // ignore confetti error
      }
    }
    if (room.status !== 'GAME_OVER') {
      confettiFiredRef.current = false;
    }
  }, [room.status, muted]);

  if (room.status === 'GAME_OVER') {
    const first = sortedByScore[0];
    const second = sortedByScore[1];
    const third = sortedByScore[2];

    return (
      <div className="min-h-screen bg-[#0F1117] text-white flex flex-col items-center justify-center p-5">
        <div className="w-full max-w-2xl rounded-3xl bg-[#171A24] border border-white/10 p-6 sm:p-8 space-y-8 text-center">
          <div className="space-y-2">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-400/20 border border-amber-400/40 text-amber-300 mx-auto">
              <Crown className="w-7 h-7" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-display font-extrabold text-white">
              Siegerpodest
            </h1>
            <p className="text-sm text-slate-300">
              {first?.name} gewinnt das Match mit {first?.score} Punkten!
            </p>
          </div>

          {/* Podium */}
          <div className="grid grid-cols-3 items-end gap-3 pt-4 max-w-md mx-auto">
            {/* 2nd Place */}
            <div className="flex flex-col items-center">
              {second && (
                <>
                  <div className="text-3xl mb-1">{getAvatar(second.avatar).emoji}</div>
                  <p className="text-sm font-semibold truncate max-w-full">{second.name}</p>
                  <p className="text-xs text-slate-400 tabular-nums mb-2">{second.score} Pkt</p>
                  <div className="w-full h-24 rounded-t-2xl bg-slate-700/60 border border-white/10 flex items-center justify-center font-display text-2xl font-bold text-slate-200">
                    2.
                  </div>
                </>
              )}
            </div>

            {/* 1st Place */}
            <div className="flex flex-col items-center">
              {first && (
                <>
                  <div className="text-4xl mb-1">{getAvatar(first.avatar).emoji}</div>
                  <p className="text-base font-bold text-amber-300 truncate max-w-full">{first.name}</p>
                  <p className="text-xs text-amber-200/80 tabular-nums mb-2">{first.score} Pkt</p>
                  <div className="w-full h-32 rounded-t-2xl bg-amber-400 text-slate-950 flex items-center justify-center font-display text-3xl font-extrabold">
                    1.
                  </div>
                </>
              )}
            </div>

            {/* 3rd Place */}
            <div className="flex flex-col items-center">
              {third && (
                <>
                  <div className="text-3xl mb-1">{getAvatar(third.avatar).emoji}</div>
                  <p className="text-sm font-semibold truncate max-w-full">{third.name}</p>
                  <p className="text-xs text-slate-400 tabular-nums mb-2">{third.score} Pkt</p>
                  <div className="w-full h-16 rounded-t-2xl bg-orange-900/50 border border-orange-400/20 flex items-center justify-center font-display text-xl font-bold text-orange-200">
                    3.
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Full Table */}
          <div className="space-y-2 text-left">
            {sortedByScore.map((p, idx) => (
              <div
                key={p.uid}
                className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#0F1117] border border-white/10"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 text-sm font-mono text-slate-400 tabular-nums">
                    {idx + 1}.
                  </span>
                  <span className="text-xl">{getAvatar(p.avatar).emoji}</span>
                  <span className="font-semibold text-white">{p.name}</span>
                </div>
                <span className="font-mono font-bold text-amber-300 tabular-nums">
                  {p.score} Punkte
                </span>
              </div>
            ))}
          </div>

          {isHost ? (
            <button
              type="button"
              onClick={onResetToLobby}
              className="w-full min-h-[52px] px-6 py-3 rounded-2xl bg-amber-400 text-slate-950 font-bold hover:bg-amber-300 transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-5 h-5" />
              Neue Partie in dieser Lobby
            </button>
          ) : (
            <p className="text-sm text-slate-400">
              Warte auf den Spielleiter für eine neue Runde...
            </p>
          )}
        </div>
      </div>
    );
  }

  // ROUND_END
  return (
    <div className="min-h-screen bg-[#0F1117] text-white flex flex-col items-center justify-center p-5">
      <div className="w-full max-w-xl rounded-3xl bg-[#171A24] border border-white/10 p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-1.5">
          <p className="text-sm font-medium text-amber-400">
            Runde {room.roundNumber} beendet
          </p>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-white">
            Rundenwertung
          </h1>
          <p className="text-xs text-slate-400">
            1. Platz = +3 Pkt · 2. Platz = +2 Pkt · Weitere = +1 Pkt · Letzter = 0 Pkt (Ziel: {room.targetScore} Pkt)
          </p>
        </div>

        <div className="space-y-2.5">
          {sortedByScore.map((p) => {
            const rankIdx = room.winnersOrder.indexOf(p.uid);
            const earned = calculateRoundPoints(rankIdx, room.playerOrder.length);
            const avatar = getAvatar(p.avatar);
            const progressPct = Math.min(100, Math.round((p.score / room.targetScore) * 100));

            return (
              <div
                key={p.uid}
                className={`p-4 rounded-2xl border ${
                  p.uid === myUid
                    ? 'bg-amber-400/10 border-amber-400/40'
                    : 'bg-[#0F1117] border-white/10'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-2xl shrink-0">
                      {avatar.emoji}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">
                        {p.name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {rankIdx >= 0 ? `${rankIdx + 1}. Platz` : `Noch ${p.cardCount} Karten`}
                        {' · '}
                        <span className="text-emerald-400 font-semibold">+{earned} Pkt</span>
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xl font-mono font-bold text-amber-300 tabular-nums">
                      {p.score}
                    </span>
                    <span className="text-xs text-slate-400"> / {room.targetScore}</span>
                  </div>
                </div>
                <div className="mt-2.5 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-400 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {isHost ? (
          someoneReachedTarget ? (
            <button
              type="button"
              onClick={onShowGameOver}
              className="w-full min-h-[52px] px-6 py-3 rounded-2xl bg-amber-400 text-slate-950 font-bold hover:bg-amber-300 transition-colors flex items-center justify-center gap-2"
            >
              <Trophy className="w-5 h-5" />
              Zum Siegerpodest
            </button>
          ) : (
            <button
              type="button"
              onClick={onNextRound}
              className="w-full min-h-[52px] px-6 py-3 rounded-2xl bg-amber-400 text-slate-950 font-bold hover:bg-amber-300 transition-colors flex items-center justify-center gap-2"
            >
              Nächste Runde starten
              <ArrowRight className="w-5 h-5" />
            </button>
          )
        ) : (
          <p className="text-center text-sm text-slate-400 py-2">
            Der Spielleiter startet gleich die nächste Runde...
          </p>
        )}
      </div>
    </div>
  );
};
