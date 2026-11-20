import React, { useEffect, useState } from 'react';
import { ArrowRight, Award, Trophy } from 'lucide-react';
import { calculateRoundPoints, getAvatar } from '../data/themesAndCards';
import type { PlayerData, RoomData } from '../types/game';

interface RoundEndViewProps {
  room: RoomData;
  myUid: string;
  myPlayer: PlayerData;
  onClaimMyPoints: () => Promise<void>;
  onNextRoundOrFinish: () => Promise<void>;
}

export const RoundEndView: React.FC<RoundEndViewProps> = ({
  room,
  myUid,
  myPlayer,
  onClaimMyPoints,
  onNextRoundOrFinish,
}) => {
  const isHost = room.hostUid === myUid;
  const [advancing, setAdvancing] = useState(false);

  useEffect(() => {
    if (myPlayer.lastScoredRound < room.roundNumber) {
      onClaimMyPoints();
    }
  }, [myPlayer.lastScoredRound, room.roundNumber, onClaimMyPoints]);

  const sortedPlayers = [...room.playerOrder]
    .map((uid) => room.playersMeta[uid])
    .filter(Boolean)
    .sort((a, b) => {
      const rankA = room.winnersOrder.indexOf(a.uid);
      const rankB = room.winnersOrder.indexOf(b.uid);
      if (rankA !== -1 && rankB !== -1) return rankA - rankB;
      if (rankA !== -1) return -1;
      if (rankB !== -1) return 1;
      return a.cardCount - b.cardCount;
    });

  const someoneReachedTarget = sortedPlayers.some((p) => p.score >= room.targetScore);

  const handleNext = async () => {
    if (advancing) return;
    setAdvancing(true);
    try {
      await onNextRoundOrFinish();
    } finally {
      setAdvancing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F1117] text-slate-100 flex flex-col justify-between p-4 pb-8">
      <div className="max-w-xl w-full mx-auto space-y-5 pt-4">
        <div className="text-center space-y-1">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-amber-400/15 border border-amber-400/30 text-amber-400 mb-2">
            <Award className="w-6 h-6" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-display font-extrabold text-white">
            Runde {room.roundNumber} beendet
          </h1>
          <p className="text-sm text-slate-400">
            Ziel: {room.targetScore} Gesamtpunkte
          </p>
        </div>

        <div className="rounded-3xl bg-[#1C202E] border border-white/10 p-4 space-y-2.5">
          {sortedPlayers.map((player) => {
            const rankIdx = room.winnersOrder.indexOf(player.uid);
            const pts = calculateRoundPoints(rankIdx, room.playerOrder.length);
            const av = getAvatar(player.avatar);
            const placeLabel = rankIdx !== -1 ? `${rankIdx + 1}. Platz` : 'Übrig';

            return (
              <div
                key={player.uid}
                className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${
                  rankIdx === 0
                    ? 'bg-amber-400/15 border-amber-400/50'
                    : 'bg-[#161923] border-white/5'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-xl shrink-0">
                    {av.emoji}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-white truncate">
                      {player.name} {player.uid === myUid ? '(Du)' : ''}
                    </div>
                    <div className="text-xs text-slate-400">
                      {placeLabel} · {pts > 0 ? `+${pts} Punkte` : '+0 Punkte'}
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono font-bold text-lg text-amber-400 tabular-nums">
                    {player.score}
                  </div>
                  <div className="text-[11px] text-slate-400">Gesamt</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="max-w-xl w-full mx-auto pt-4">
        {isHost ? (
          <button
            type="button"
            disabled={advancing}
            onClick={handleNext}
            className="w-full min-h-[52px] px-6 rounded-2xl bg-amber-400 text-slate-950 font-display font-bold text-base hover:bg-amber-300 flex items-center justify-center gap-2 transition-colors"
          >
            {someoneReachedTarget ? (
              <>
                <Trophy className="w-5 h-5" />
                <span>Siegerpodest anzeigen</span>
              </>
            ) : (
              <>
                <span>Nächste Runde starten</span>
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        ) : (
          <div className="w-full min-h-[52px] px-6 rounded-2xl bg-[#1C202E] border border-white/10 text-slate-300 text-sm font-medium flex items-center justify-center">
            Warte auf den Gastgeber für die nächste Runde…
          </div>
        )}
      </div>
    </div>
  );
};
