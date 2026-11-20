import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Copy,
  Check,
  Sparkles,
  Users,
  Play,
  LogOut,
  Lock,
  QrCode,
  ShieldAlert,
  Sliders,
  ArrowLeft,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  ALL_BUILTIN_CATEGORIES,
  AVATARS,
  getAvatar,
} from '../data/themesAndCards';
import type {
  CustomDeck,
  LocalPlayerProfile,
  PlayerData,
  RoomData,
  RuleVariant,
  SecretThemeDoc,
  TurnMode,
} from '../types/game';
import type { HostSetupConfig } from '../lib/roomService';

interface HomeAndLobbyProps {
  user: User | null;
  authLoading: boolean;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  profile: LocalPlayerProfile;
  onChangeProfile: (next: LocalPlayerProfile) => void;
  initialRoomCode: string;
  customDecks: CustomDeck[];
  onOpenThemeBuilder: () => void;
  selectedDeckName: string;
  selectedDeckThemes: string[];
  onSelectDeck: (name: string, themes: string[]) => void;
  onCreateRoom: (config: HostSetupConfig) => Promise<void>;
  onJoinRoom: (code: string) => Promise<void>;
  // Active lobby props
  room: RoomData | null;
  player: PlayerData | null;
  mySecretThemes: SecretThemeDoc[];
  onUpdateLobbyProfile: (next: LocalPlayerProfile) => Promise<void>;
  onUpdateHostSettings: (patch: Partial<HostSetupConfig>) => Promise<void>;
  onSubmitSecretTheme: (theme: string) => Promise<void>;
  onStartMatch: () => Promise<void>;
  onLeaveRoom: () => void;
  busyMessage: string | null;
  errorMessage: string | null;
}

export const HomeAndLobby: React.FC<HomeAndLobbyProps> = ({
  user,
  authLoading,
  onSignIn,
  onSignOut,
  profile,
  onChangeProfile,
  initialRoomCode,
  customDecks,
  onOpenThemeBuilder,
  selectedDeckName,
  selectedDeckThemes,
  onSelectDeck,
  onCreateRoom,
  onJoinRoom,
  room,
  player,
  mySecretThemes,
  onUpdateLobbyProfile,
  onUpdateHostSettings,
  onSubmitSecretTheme,
  onStartMatch,
  onLeaveRoom,
  busyMessage,
  errorMessage,
}) => {
  const [modeTab, setModeTab] = useState<'JOIN' | 'HOST'>(
    initialRoomCode ? 'JOIN' : 'HOST'
  );
  const [joinCode, setJoinCode] = useState(initialRoomCode);
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  // Host setup form state
  const [maxPlayers, setMaxPlayers] = useState<number>(4);
  const [turnMode, setTurnMode] = useState<TurnMode>('SIMULTANEOUS');
  const [ruleVariant, setRuleVariant] = useState<RuleVariant>('CHAOS');
  const [penaltyEnabled, setPenaltyEnabled] = useState<boolean>(false);
  const [roundDurationSec, setRoundDurationSec] = useState<15 | 20 | 30>(20);

  // Lobby state
  const [copiedLink, setCopiedLink] = useState(false);
  const [secretInput, setSecretInput] = useState('');

  // Render Waiting Lobby when inside a room
  if (room && player) {
    const isHost = room.hostUid === user?.uid;
    const shareUrl = `${window.location.origin}/?room=${room.code}`;
    const playersList = room.playerOrder
      .map((uid) => room.playersMeta[uid])
      .filter(Boolean);

    const handleCopyLink = async () => {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      } catch {
        // Fallback ignored if clipboard blocked
      }
    };

    const handleSecretSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = secretInput.trim();
      if (trimmed.length < 2) return;
      await onSubmitSecretTheme(trimmed);
      setSecretInput('');
    };

    return (
      <div className="min-h-screen bg-[#0F1117] text-slate-100 pb-12">
        {/* Top Bar (3-zone contract) */}
        <header className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4 border-b border-white/10">
          <span className="font-display text-xl font-extrabold tracking-tight text-white whitespace-nowrap shrink-0">
            WortBlitz
          </span>
          <span className="text-xs sm:text-sm text-slate-400 truncate">
            Warte-Lobby · Raum {room.code}
          </span>
          <button
            type="button"
            onClick={onLeaveRoom}
            className="min-h-[44px] px-3.5 rounded-xl bg-white/5 hover:bg-white/10 text-sm font-medium text-slate-200 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Verlassen
          </button>
        </header>

        <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Room Code, QR Code & Players */}
          <div className="lg:col-span-7 space-y-6">
            {/* Room Code + QR Card */}
            <section className="rounded-3xl bg-[#171A24] border border-white/10 p-5 sm:p-6 flex flex-col sm:flex-row items-center gap-6">
              <div className="bg-white p-3.5 rounded-2xl shrink-0">
                <QRCodeSVG value={shareUrl} size={136} level="M" />
              </div>
              <div className="flex-1 text-center sm:text-left space-y-3 min-w-0">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-400">
                    Mit Smartphone-Kamera scannen oder Code eingeben
                  </p>
                  <div className="font-mono text-4xl sm:text-5xl font-bold tracking-widest text-amber-400 tabular-nums">
                    {room.code}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-medium text-white inline-flex items-center gap-2 transition-colors whitespace-nowrap"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" />
                      Einladungslink kopiert
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Einladungslink kopieren
                    </>
                  )}
                </button>
              </div>
            </section>

            {/* Players Roster */}
            <section className="rounded-3xl bg-[#171A24] border border-white/10 p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-display font-bold text-white flex items-center gap-2">
                  <Users className="w-5 h-5 text-amber-400" />
                  Mitspieler am Tisch
                </h2>
                <span className="font-mono text-sm font-semibold text-slate-300 tabular-nums">
                  {playersList.length} / {room.maxPlayers}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {playersList.map((p) => {
                  const av = getAvatar(p.avatar);
                  const isMe = p.uid === user?.uid;
                  const isRoomHost = p.uid === room.hostUid;
                  return (
                    <div
                      key={p.uid}
                      className={`p-3.5 rounded-2xl border flex items-center gap-3 ${
                        isMe
                          ? 'bg-amber-400/10 border-amber-400/40'
                          : 'bg-[#0F1117] border-white/10'
                      }`}
                    >
                      <div
                        className={`w-11 h-11 rounded-xl border flex items-center justify-center text-2xl shrink-0 ${av.bgClass}`}
                      >
                        {av.emoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-white truncate">
                          {p.name} {isMe ? '(Du)' : ''}
                        </p>
                        <p className="text-xs text-slate-400 truncate">
                          {isRoomHost ? 'Spielleiter' : 'Mitspieler'}
                          {' · '}
                          {p.isJunior ? 'Junior (7 Karten)' : 'Standard (8 Karten)'}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Quick own profile adjustment in lobby */}
              <div className="pt-4 border-t border-white/10 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-medium text-slate-300">
                    Deine Stufe & Avatar anpassen
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateLobbyProfile({
                        ...profile,
                        isJunior: !player.isJunior,
                      })
                    }
                    className={`min-h-[44px] px-3.5 rounded-xl text-xs font-semibold border transition-colors ${
                      player.isJunior
                        ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                        : 'bg-[#0F1117] border-white/15 text-slate-300 hover:border-white/30'
                    }`}
                  >
                    {player.isJunior
                      ? 'Junior-Stufe aktiv (7 Karten · milde KI)'
                      : 'Auf Junior-Stufe wechseln'}
                  </button>
                </div>
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {AVATARS.map((av) => (
                    <button
                      key={av.id}
                      type="button"
                      onClick={() =>
                        onUpdateLobbyProfile({
                          ...profile,
                          avatar: av.id,
                        })
                      }
                      aria-label={`Avatar ${av.label}`}
                      className={`min-w-[44px] min-h-[44px] rounded-xl text-xl flex items-center justify-center border transition-transform ${
                        player.avatar === av.id
                          ? 'bg-amber-400/20 border-amber-400 scale-105'
                          : 'bg-[#0F1117] border-white/10 hover:border-white/25'
                      }`}
                    >
                      {av.emoji}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </div>

          {/* Right Column: Secret Lobby Themes & Game Settings / Start */}
          <div className="lg:col-span-5 space-y-6">
            {/* Geheime Lobby-Themen */}
            <section className="rounded-3xl bg-[#171A24] border border-white/10 p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-display font-bold text-white flex items-center gap-2">
                  <Lock className="w-5 h-5 text-amber-400" />
                  Geheime Themen-Ideen
                </h2>
                <span className="text-xs font-mono text-slate-400 tabular-nums">
                  {player.secretThemeCount} / 2
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Reiche heimlich bis zu 2 eigene Themen ein. Sie bleiben geheim und werden beim Spielstart in den Stapel gemischt!
              </p>

              {player.secretThemeCount < 2 ? (
                <form onSubmit={handleSecretSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={secretInput}
                    onChange={(e) => setSecretInput(e.target.value)}
                    placeholder="z.B. Peinliche Momente im Urlaub"
                    maxLength={80}
                    className="flex-1 min-h-[44px] px-3.5 rounded-xl bg-[#0F1117] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="submit"
                    disabled={secretInput.trim().length < 2}
                    className="min-h-[44px] px-4 rounded-xl bg-amber-400 text-slate-950 text-sm font-semibold hover:bg-amber-300 disabled:opacity-50 whitespace-nowrap transition-colors"
                  >
                    Einreichen
                  </button>
                </form>
              ) : (
                <p className="text-xs font-medium text-emerald-400">
                  Du hast bereits 2 geheime Themen eingereicht.
                </p>
              )}

              {mySecretThemes.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {mySecretThemes.map((st) => (
                    <div
                      key={st.id}
                      className="px-3 py-2 rounded-xl bg-[#0F1117] border border-white/10 text-xs text-slate-300 flex items-center justify-between"
                    >
                      <span className="truncate">{st.theme}</span>
                      <span className="text-slate-500 ml-2 shrink-0">geheim</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Rules Summary & Host Start */}
            <section className="rounded-3xl bg-[#171A24] border border-white/10 p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-display font-bold text-white flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-amber-400" />
                  Spielregeln
                </h2>
                {isHost && (
                  <button
                    type="button"
                    onClick={onOpenThemeBuilder}
                    className="min-h-[44px] px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-amber-300 flex items-center gap-1.5 transition-colors"
                  >
                    <Sparkles className="w-4 h-4" />
                    Themen ändern
                  </button>
                )}
              </div>

              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between py-2 border-b border-white/10">
                  <span className="text-slate-400">Themen-Deck</span>
                  <span className="font-semibold text-white text-right">
                    {room.selectedCategory} ({room.deckThemes.length})
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-white/10">
                  <span className="text-slate-400">Ablauf</span>
                  {isHost ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => onUpdateHostSettings({ turnMode: 'SIMULTANEOUS' })}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                          room.turnMode === 'SIMULTANEOUS'
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-white/5 text-slate-300'
                        }`}
                      >
                        Alle zugleich
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateHostSettings({ turnMode: 'TURN_BASED' })}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                          room.turnMode === 'TURN_BASED'
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-white/5 text-slate-300'
                        }`}
                      >
                        Reihum
                      </button>
                    </div>
                  ) : (
                    <span className="font-semibold text-white">
                      {room.turnMode === 'SIMULTANEOUS' ? 'Alle zugleich' : 'Reihum'}
                    </span>
                  )}
                </div>
                <div className="flex justify-between py-2 border-b border-white/10">
                  <span className="text-slate-400">Variante</span>
                  {isHost ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => onUpdateHostSettings({ ruleVariant: 'CLASSIC' })}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                          room.ruleVariant === 'CLASSIC'
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-white/5 text-slate-300'
                        }`}
                      >
                        Klassisch
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateHostSettings({ ruleVariant: 'CHAOS' })}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                          room.ruleVariant === 'CHAOS'
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-white/5 text-slate-300'
                        }`}
                      >
                        Familien-Chaos
                      </button>
                    </div>
                  ) : (
                    <span className="font-semibold text-white">
                      {room.ruleVariant === 'CHAOS' ? 'Familien-Chaos' : 'Klassisch'}
                    </span>
                  )}
                </div>
                <div className="flex justify-between py-2 border-b border-white/10">
                  <span className="text-slate-400">Countdown</span>
                  {isHost ? (
                    <div className="flex gap-1">
                      {([15, 20, 30] as const).map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => onUpdateHostSettings({ roundDurationSec: sec })}
                          className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold ${
                            room.roundDurationSec === sec
                              ? 'bg-amber-400 text-slate-950'
                              : 'bg-white/5 text-slate-300'
                          }`}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="font-mono font-semibold text-white tabular-nums">
                      {room.roundDurationSec} Sekunden
                    </span>
                  )}
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-slate-400">Strafkarte (+1)</span>
                  {isHost ? (
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateHostSettings({ penaltyEnabled: !room.penaltyEnabled })
                      }
                      className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                        room.penaltyEnabled
                          ? 'bg-rose-500/25 text-rose-200 border border-rose-400/40'
                          : 'bg-white/5 text-slate-300'
                      }`}
                    >
                      {room.penaltyEnabled ? 'Aktiv' : 'Aus'}
                    </button>
                  ) : (
                    <span className="font-semibold text-white">
                      {room.penaltyEnabled ? 'Aktiv (+1)' : 'Aus'}
                    </span>
                  )}
                </div>
              </div>

              {errorMessage && (
                <p className="text-sm text-rose-400">{errorMessage}</p>
              )}

              {isHost ? (
                <button
                  type="button"
                  onClick={onStartMatch}
                  disabled={Boolean(busyMessage)}
                  className="w-full min-h-[54px] px-6 py-3.5 rounded-2xl bg-amber-400 text-slate-950 text-base font-bold hover:bg-amber-300 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
                >
                  <Play className="w-5 h-5 fill-current" />
                  {busyMessage ||
                    (playersList.length < 2
                      ? 'Runde starten (Solo-Test / 1 Spieler)'
                      : `Spiel mit ${playersList.length} Spielern starten`)}
                </button>
              ) : (
                <div className="p-4 rounded-2xl bg-[#0F1117] border border-white/10 text-center text-sm text-slate-300">
                  Warte darauf, dass der Spielleiter die Runde startet...
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    );
  }

  // Home Screen (Create or Join)
  const handleHostSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onCreateRoom({
      maxPlayers,
      turnMode,
      ruleVariant,
      penaltyEnabled,
      roundDurationSec,
      selectedCategory: selectedDeckName,
      deckThemes: selectedDeckThemes,
    });
  };

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onJoinRoom(joinCode);
  };

  return (
    <div className="min-h-screen bg-[#0F1117] text-slate-100 pb-14">
      {/* Top Bar (3-zone contract) */}
      <header className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6 border-b border-white/10">
        <span className="font-display text-2xl font-extrabold tracking-tight text-white whitespace-nowrap shrink-0">
          WortBlitz
        </span>
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
          <button
            type="button"
            onClick={() => setModeTab('HOST')}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Lobby erstellen
          </button>
          <button
            type="button"
            onClick={() => setModeTab('JOIN')}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Code eingeben
          </button>
          <button
            type="button"
            onClick={onOpenThemeBuilder}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Themen-Baukasten
          </button>
        </nav>
        <div className="shrink-0">
          {authLoading ? (
            <span className="text-xs text-slate-400">Lade...</span>
          ) : user ? (
            <button
              type="button"
              onClick={onSignOut}
              className="min-h-[44px] px-3.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs sm:text-sm font-medium text-slate-200 flex items-center gap-2 whitespace-nowrap transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Abmelden
            </button>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className="min-h-[44px] px-4 rounded-xl bg-amber-400 text-slate-950 text-xs sm:text-sm font-bold hover:bg-amber-300 whitespace-nowrap transition-colors"
            >
              Mit Google anmelden
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Brand Hero + Player Profile */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-3xl bg-[#171A24] border border-white/10 overflow-hidden">
            <div className="aspect-[16/10] w-full bg-[#11141C] relative overflow-hidden">
              {!heroImgFailed ? (
                <img
                  src="/src/assets/images/wortblitz_cards_hero_1795193543971.jpg"
                  alt="Bunte Buchstabenkarten von WortBlitz auf dunklem Spieltisch"
                  referrerPolicy="no-referrer"
                  onError={() => setHeroImgFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-[#171A24] to-amber-950/30">
                  <span className="font-display text-4xl font-extrabold text-amber-400">
                    WortBlitz
                  </span>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#171A24] via-transparent to-transparent" />
            </div>
            <div className="p-5 sm:p-6 space-y-2.5 -mt-6 relative">
              <h1 className="text-2xl sm:text-3xl font-display font-extrabold text-white leading-tight text-balance">
                Rufen, ablegen, abräumen — jeder sieht seine eigenen Karten.
              </h1>
              <p className="text-sm text-slate-300 leading-relaxed">
                Scanne am Tisch den QR-Code mit dem Smartphone. Die KI hört per Mikrofon zu, prüft jeden Begriff sekundenschnell und sorgt für faire Familien-Runden.
              </p>
            </div>
          </div>

          {/* Player Profile Card */}
          <section className="rounded-3xl bg-[#171A24] border border-white/10 p-5 sm:p-6 space-y-4">
            <h2 className="text-lg font-display font-bold text-white">
              Dein Spielerprofil
            </h2>

            <div>
              <label
                htmlFor="player-name"
                className="block text-xs font-medium text-slate-400 mb-1.5"
              >
                Dein Name am Spieltisch
              </label>
              <input
                id="player-name"
                type="text"
                value={profile.name}
                onChange={(e) =>
                  onChangeProfile({ ...profile, name: e.target.value })
                }
                placeholder="z.B. Lena, Papa, Oma..."
                maxLength={24}
                className="w-full min-h-[48px] px-4 rounded-xl bg-[#0F1117] border border-white/15 text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
              />
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-400 mb-2">
                Avatar wählen
              </span>
              <div className="grid grid-cols-6 gap-2">
                {AVATARS.map((av) => (
                  <button
                    key={av.id}
                    type="button"
                    onClick={() =>
                      onChangeProfile({ ...profile, avatar: av.id })
                    }
                    aria-label={av.label}
                    className={`min-h-[44px] rounded-xl text-xl flex items-center justify-center border transition-transform ${
                      profile.avatar === av.id
                        ? 'bg-amber-400/20 border-amber-400 scale-105'
                        : 'bg-[#0F1117] border-white/10 hover:border-white/25'
                    }`}
                  >
                    {av.emoji}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                onChangeProfile({ ...profile, isJunior: !profile.isJunior })
              }
              className={`w-full min-h-[52px] px-4 py-3 rounded-2xl border text-left flex items-center justify-between gap-3 transition-colors ${
                profile.isJunior
                  ? 'bg-emerald-500/15 border-emerald-400/50'
                  : 'bg-[#0F1117] border-white/10 hover:border-white/25'
              }`}
            >
              <div>
                <p className="text-sm font-semibold text-white">
                  Junior / Einsteiger-Stufe
                </p>
                <p className="text-xs text-slate-400">
                  Startet mit 7 statt 8 Karten & wohlwollendere KI-Wortprüfung
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded-lg text-xs font-bold shrink-0 ${
                  profile.isJunior
                    ? 'bg-emerald-400 text-slate-950'
                    : 'bg-white/10 text-slate-300'
                }`}
              >
                {profile.isJunior ? 'Aktiv' : 'Aus'}
              </span>
            </button>
          </section>
        </div>

        {/* Right: Host / Join Panels */}
        <div className="lg:col-span-7 space-y-5">
          {!user && !authLoading && (
            <div className="rounded-3xl bg-amber-400/10 border border-amber-400/35 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h2 className="font-display font-bold text-amber-300 text-lg">
                  Kurz anmelden & losspielen
                </h2>
                <p className="text-xs sm:text-sm text-slate-300">
                  Für die Echtzeit-Synchronisation zwischen allen Smartphones wird dein Google-Konto genutzt.
                </p>
              </div>
              <button
                type="button"
                onClick={onSignIn}
                className="min-h-[48px] px-5 rounded-xl bg-amber-400 text-slate-950 font-bold hover:bg-amber-300 whitespace-nowrap shrink-0 transition-colors"
              >
                Mit Google anmelden
              </button>
            </div>
          )}

          {/* Mode Switcher */}
          <div className="grid grid-cols-2 gap-1 p-1.5 rounded-2xl bg-[#171A24] border border-white/10">
            <button
              type="button"
              onClick={() => setModeTab('HOST')}
              className={`min-h-[48px] rounded-xl text-sm font-bold transition-colors ${
                modeTab === 'HOST'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Neues Spiel hosten
            </button>
            <button
              type="button"
              onClick={() => setModeTab('JOIN')}
              className={`min-h-[48px] rounded-xl text-sm font-bold transition-colors ${
                modeTab === 'JOIN'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Raum beitreten
            </button>
          </div>

          {modeTab === 'JOIN' ? (
            <form
              onSubmit={handleJoinSubmit}
              className="rounded-3xl bg-[#171A24] border border-white/10 p-6 space-y-5"
            >
              <div className="space-y-1.5">
                <h2 className="text-xl font-display font-bold text-white flex items-center gap-2">
                  <QrCode className="w-5 h-5 text-amber-400" />
                  Mit 4-stelligem Raum-Code beitreten
                </h2>
                <p className="text-sm text-slate-400">
                  Oder scanne einfach den QR-Code vom Bildschirm des Spielleiters.
                </p>
              </div>

              <div>
                <label
                  htmlFor="room-code-input"
                  className="block text-xs font-medium text-slate-400 mb-2"
                >
                  4-stelliger Raum-Code
                </label>
                <input
                  id="room-code-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  value={joinCode}
                  onChange={(e) =>
                    setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 4))
                  }
                  placeholder="4829"
                  className="w-full min-h-[64px] px-5 rounded-2xl bg-[#0F1117] border border-white/15 font-mono text-3xl font-bold tracking-[0.4em] text-center text-amber-400 placeholder:text-slate-700 focus:outline-none focus:border-amber-400 tabular-nums"
                />
              </div>

              {errorMessage && (
                <p className="text-sm text-rose-400">{errorMessage}</p>
              )}

              <button
                type="submit"
                disabled={joinCode.length !== 4 || Boolean(busyMessage)}
                className="w-full min-h-[54px] px-6 py-3.5 rounded-2xl bg-amber-400 text-slate-950 font-bold hover:bg-amber-300 disabled:opacity-50 transition-colors"
              >
                {busyMessage || 'Lobby beitreten'}
              </button>
            </form>
          ) : (
            <form
              onSubmit={handleHostSubmit}
              className="rounded-3xl bg-[#171A24] border border-white/10 p-6 space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-display font-bold text-white">
                  Host-Setup
                </h2>
                <span className="text-xs text-slate-400">Ziel: 10 Punkte</span>
              </div>

              {/* Player Count 2-8 */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-400">
                  Spieleranzahl (2 bis 8 Spieler)
                </label>
                <div className="grid grid-cols-7 gap-1.5">
                  {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setMaxPlayers(n)}
                      className={`min-h-[44px] rounded-xl font-mono font-bold text-sm transition-colors ${
                        maxPlayers === n
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-[#0F1117] border border-white/10 text-slate-300 hover:border-white/25'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Turn Mode */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-400">
                  Ablauf-Modus
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setTurnMode('SIMULTANEOUS')}
                    className={`p-3.5 rounded-2xl border text-left transition-colors ${
                      turnMode === 'SIMULTANEOUS'
                        ? 'bg-amber-400/15 border-amber-400 text-white'
                        : 'bg-[#0F1117] border-white/10 text-slate-300 hover:border-white/25'
                    }`}
                  >
                    <p className="font-bold text-sm">Alle zugleich</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Wer zuerst ein Wort ruft, legt ab und sperrt den Begriff
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTurnMode('TURN_BASED')}
                    className={`p-3.5 rounded-2xl border text-left transition-colors ${
                      turnMode === 'TURN_BASED'
                        ? 'bg-amber-400/15 border-amber-400 text-white'
                        : 'bg-[#0F1117] border-white/10 text-slate-300 hover:border-white/25'
                    }`}
                  >
                    <p className="font-bold text-sm">Reihum</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Nacheinander im Uhrzeigersinn mit eigenem Zug-Timer
                    </p>
                  </button>
                </div>
              </div>

              {/* Rule Variant */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-400">
                  Regel-Variante
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setRuleVariant('CLASSIC')}
                    className={`p-3.5 rounded-2xl border text-left transition-colors ${
                      ruleVariant === 'CLASSIC'
                        ? 'bg-amber-400/15 border-amber-400 text-white'
                        : 'bg-[#0F1117] border-white/10 text-slate-300 hover:border-white/25'
                    }`}
                  >
                    <p className="font-bold text-sm">Klassisch</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Reines Wort- und Buchstabenkartenspiel
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRuleVariant('CHAOS')}
                    className={`p-3.5 rounded-2xl border text-left transition-colors ${
                      ruleVariant === 'CHAOS'
                        ? 'bg-amber-400/15 border-amber-400 text-white'
                        : 'bg-[#0F1117] border-white/10 text-slate-300 hover:border-white/25'
                    }`}
                  >
                    <p className="font-bold text-sm">Familien-Chaos</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      +2 Aktionskarten (Themen-Wechsel, Geschenk, Turbo, Schild)
                    </p>
                  </button>
                </div>
              </div>

              {/* Timer + Penalty Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-400">
                    Themen-Countdown
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([15, 20, 30] as const).map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => setRoundDurationSec(sec)}
                        className={`min-h-[44px] rounded-xl font-mono font-bold text-sm transition-colors ${
                          roundDurationSec === sec
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-[#0F1117] border border-white/10 text-slate-300 hover:border-white/25'
                        }`}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-400">
                    Zusatzregel
                  </label>
                  <button
                    type="button"
                    onClick={() => setPenaltyEnabled(!penaltyEnabled)}
                    className={`w-full min-h-[44px] px-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 transition-colors ${
                      penaltyEnabled
                        ? 'bg-rose-500/20 border-rose-400/50 text-rose-200'
                        : 'bg-[#0F1117] border-white/10 text-slate-300'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      Strafkarte (+1) bei Fehler
                    </span>
                    <span>{penaltyEnabled ? 'An' : 'Aus'}</span>
                  </button>
                </div>
              </div>

              {/* Theme Categories + AI Generator Trigger */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-slate-400">
                    Themen-Kategorie ({selectedDeckThemes.length} Themen)
                  </label>
                  <button
                    type="button"
                    onClick={onOpenThemeBuilder}
                    className="text-xs font-semibold text-amber-300 hover:text-amber-200 inline-flex items-center gap-1"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    KI-Generator & eigene Decks
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ALL_BUILTIN_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => onSelectDeck(cat.name, cat.themes)}
                      className={`min-h-[44px] px-3.5 py-2.5 rounded-xl border text-left transition-colors ${
                        selectedDeckName === cat.name
                          ? 'bg-amber-400/15 border-amber-400 text-white'
                          : 'bg-[#0F1117] border-white/10 text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <p className="text-sm font-semibold truncate">{cat.name}</p>
                    </button>
                  ))}
                  {customDecks.map((deck) => (
                    <button
                      key={deck.id}
                      type="button"
                      onClick={() => onSelectDeck(deck.name, deck.themes)}
                      className={`min-h-[44px] px-3.5 py-2.5 rounded-xl border text-left transition-colors ${
                        selectedDeckName === deck.name
                          ? 'bg-emerald-400/15 border-emerald-400 text-white'
                          : 'bg-[#0F1117] border-white/10 text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <p className="text-sm font-semibold truncate">
                        {deck.name} ({deck.themes.length})
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {errorMessage && (
                <p className="text-sm text-rose-400">{errorMessage}</p>
              )}

              <button
                type="submit"
                disabled={Boolean(busyMessage)}
                className="w-full min-h-[54px] px-6 py-3.5 rounded-2xl bg-amber-400 text-slate-950 text-base font-bold hover:bg-amber-300 disabled:opacity-50 transition-colors"
              >
                {busyMessage || 'Lobby & QR-Code erstellen'}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};
