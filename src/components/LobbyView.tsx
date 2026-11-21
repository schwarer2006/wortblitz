import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Bot,
  Check,
  Copy,
  Crown,
  EyeOff,
  FolderCog,
  LogOut,
  Megaphone,
  Monitor,
  Play,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  Users,
  VolumeX,
} from 'lucide-react';
import { AVATARS, getAvatar } from '../data/themesAndCards';
import { BOT_DIFFICULTY_META } from '../lib/roomService';
import type {
  BotDifficulty,
  CustomDeck,
  LocalPlayerProfile,
  PlayerData,
  RoomData,
  RuleVariant,
  TurnMode,
} from '../types/game';
import { DeckBuilderModal } from './DeckBuilderModal';

interface LobbyViewProps {
  room: RoomData;
  myUid: string;
  familyPin: string;
  myPlayer: PlayerData | null;
  profile: LocalPlayerProfile;
  customDecks: CustomDeck[];
  isTableAudioDevice: boolean;
  onToggleTableAudio: () => void;
  onSaveCustomDeck: (deck: CustomDeck) => void;
  onDeleteCustomDeck: (id: string) => void;
  onUpdateHostSettings: (settings: {
    maxPlayers?: number;
    turnMode?: TurnMode;
    ruleVariant?: RuleVariant;
    penaltyEnabled?: boolean;
    roundDurationSec?: 15 | 20 | 30;
    selectedCategory?: string;
    deckThemes?: string[];
  }) => Promise<void>;
  onAddBot: (difficulty: Exclude<BotDifficulty, 'NONE'>) => Promise<void>;
  onRemoveBot: (botUid: string) => Promise<void>;
  onUpdateBotDifficulty: (
    botUid: string,
    difficulty: Exclude<BotDifficulty, 'NONE'>
  ) => Promise<void>;
  onUpdateProfileInLobby: (nextProfile: LocalPlayerProfile) => Promise<void>;
  onSubmitSecretTheme: (themeText: string) => Promise<void>;
  onStartMatch: () => Promise<void>;
  onLeaveRoom: () => void;
  onLogout: () => void;
}

export const LobbyView: React.FC<LobbyViewProps> = ({
  room,
  myUid,
  familyPin,
  myPlayer,
  profile,
  customDecks,
  isTableAudioDevice,
  onToggleTableAudio,
  onSaveCustomDeck,
  onDeleteCustomDeck,
  onUpdateHostSettings,
  onAddBot,
  onRemoveBot,
  onUpdateBotDifficulty,
  onUpdateProfileInLobby,
  onSubmitSecretTheme,
  onStartMatch,
  onLeaveRoom,
  onLogout,
}) => {
  const isHost = room.hostUid === myUid;
  const isTableDisplay = isHost && room.tableDisplayActive;

  const [copied, setCopied] = useState(false);
  const [deckModalOpen, setDeckModalOpen] = useState(false);
  const [secretInput, setSecretInput] = useState('');
  const [secretSubmitting, setSecretSubmitting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [botDifficultyPick, setBotDifficultyPick] =
    useState<Exclude<BotDifficulty, 'NONE'>>('NORMAL');
  const [addingBot, setAddingBot] = useState(false);

  const [draftName, setDraftName] = useState(profile.name);
  const [draftAvatar, setDraftAvatar] = useState(profile.avatar);
  const [draftJunior, setDraftJunior] = useState(profile.isJunior);

  const joinUrl = `${window.location.origin}${window.location.pathname}?room=${room.code}&pin=${encodeURIComponent(familyPin)}`;
  const secretCount =
    myPlayer?.secretThemeCount ?? room.playersMeta[myUid]?.secretThemeCount ?? 0;

  const humanCount = room.playerOrder.filter(
    (uid) => !room.playersMeta[uid]?.isBot
  ).length;
  const canStart = humanCount >= 1 && room.playerOrder.length >= 2;

  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleSecretSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (secretInput.trim().length < 2 || secretCount >= 2 || secretSubmitting) return;
    setSecretSubmitting(true);
    try {
      await onSubmitSecretTheme(secretInput.trim());
      setSecretInput('');
    } finally {
      setSecretSubmitting(false);
    }
  };

  const handleSaveMyProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdateProfileInLobby({
      name: draftName.trim() || 'Mitspieler',
      avatar: draftAvatar,
      isJunior: draftJunior,
    });
    setEditProfileOpen(false);
  };

  const handleAddBotClick = async () => {
    if (addingBot || room.playerOrder.length >= room.maxPlayers) return;
    setAddingBot(true);
    try {
      await onAddBot(botDifficultyPick);
    } finally {
      setAddingBot(false);
    }
  };

  const handleStart = async () => {
    if (!canStart || starting) return;
    setStarting(true);
    try {
      await onStartMatch();
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F1117] text-slate-100 pb-28">
      <header className="sticky top-0 z-30 bg-[#0F1117]/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg font-display font-extrabold tracking-tight text-white whitespace-nowrap">
              WortBlitz
            </span>
            <span className="text-slate-500">·</span>
            <span className="text-xs font-mono tabular-nums text-amber-400 font-semibold whitespace-nowrap">
              Raum {room.code}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleTableAudio}
              title="Tisch-Ton auf diesem Gerät ein-/ausschalten"
              className={`min-h-[40px] px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                isTableAudioDevice
                  ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/30'
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
              }`}
            >
              {isTableAudioDevice ? (
                <Megaphone className="w-3.5 h-3.5 text-emerald-300" />
              ) : (
                <VolumeX className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span>{isTableAudioDevice ? 'Tisch-Ton AN' : 'Tisch-Ton'}</span>
            </button>
            <button
              type="button"
              onClick={onLeaveRoom}
              className="min-h-[40px] px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-300 whitespace-nowrap transition-colors"
            >
              Verlassen
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="min-h-[40px] px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-300 flex items-center gap-1.5 whitespace-nowrap transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Abmelden</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: QR Invite, Players & Bots, Secret Themes */}
        <section className="lg:col-span-5 space-y-4">
          <div
            className={`rounded-2xl border px-4 py-3 flex items-center justify-between gap-3 ${
              isTableAudioDevice
                ? 'bg-emerald-500/15 border-emerald-400/40'
                : 'bg-[#1C202E] border-white/10'
            }`}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              {isTableAudioDevice ? (
                <Megaphone className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
              ) : (
                <VolumeX className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
              )}
              <div className="text-xs">
                <div className="font-bold text-white">
                  Tisch-Ton auf diesem Gerät
                </div>
                <div className="text-slate-300">
                  {isTableAudioDevice
                    ? 'Aktiv: Sprachmoderation läuft laut über dieses Gerät.'
                    : 'Aus: Ideal für Smartphones. Auf dem Tisch-Laptop/Tablet einschalten.'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onToggleTableAudio}
              className={`min-h-[38px] px-3.5 rounded-xl text-xs font-bold shrink-0 transition-colors ${
                isTableAudioDevice
                  ? 'bg-emerald-400 text-slate-950 hover:bg-emerald-300'
                  : 'bg-amber-400 text-slate-950 hover:bg-amber-300'
              }`}
            >
              {isTableAudioDevice ? 'Ausschalten' : 'Einschalten'}
            </button>
          </div>

          {room.tableDisplayActive && (
            <div className="rounded-2xl bg-sky-500/15 border border-sky-400/40 px-4 py-3 flex items-center gap-3">
              <Monitor className="w-5 h-5 text-sky-300 shrink-0" />
              <div className="text-xs text-sky-100">
                <span className="font-bold">Tablet / Tisch-Modus aktiv:</span>{' '}
                {isTableDisplay
                  ? 'Dieses Gerät zeigt Thema, Timer & Live-Ticker — ohne eigene Karten.'
                  : 'Große Themenanzeige läuft zentral auf dem Tisch-Gerät.'}
              </div>
            </div>
          )}

          {/* Room Code & QR Invite */}
          <div className="rounded-3xl bg-[#1C202E] border border-white/10 p-5 flex items-center gap-5">
            <div className="bg-white p-2.5 rounded-2xl shrink-0">
              <QRCodeSVG
                value={joinUrl}
                size={108}
                bgColor="#FFFFFF"
                fgColor="#0F1117"
                level="M"
              />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="text-xs text-slate-400">
                QR-Code scannen (loggt automatisch ein)
              </div>
              <div className="text-4xl font-mono font-bold tracking-[0.18em] text-amber-400 tabular-nums">
                {room.code}
              </div>
              <button
                type="button"
                onClick={handleCopyInvite}
                className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white inline-flex items-center gap-2 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Link kopiert</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Einladungs-Link</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Players & KI-Bots List */}
          <div className="rounded-3xl bg-[#1C202E] border border-white/10 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-display font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-amber-400" />
                <span>
                  Mitspieler ({room.playerOrder.length}/{room.maxPlayers})
                </span>
              </h2>
              {!isTableDisplay && (
                <button
                  type="button"
                  onClick={() => setEditProfileOpen((prev) => !prev)}
                  className="min-h-[36px] px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-amber-300 transition-colors"
                >
                  {editProfileOpen ? 'Fertig' : 'Mein Profil'}
                </button>
              )}
            </div>

            {editProfileOpen && !isTableDisplay && (
              <form
                onSubmit={handleSaveMyProfile}
                className="p-4 rounded-2xl bg-[#0F1117] border border-white/10 space-y-3"
              >
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  maxLength={24}
                  placeholder="Dein Name"
                  className="w-full min-h-[42px] px-3 rounded-xl bg-[#161923] border border-white/15 text-sm text-white focus:outline-none focus:border-amber-400"
                />
                <div className="grid grid-cols-6 gap-1.5">
                  {AVATARS.map((av) => (
                    <button
                      key={av.id}
                      type="button"
                      onClick={() => setDraftAvatar(av.id)}
                      className={`min-h-[42px] rounded-xl border text-lg flex items-center justify-center transition-all ${
                        draftAvatar === av.id
                          ? 'bg-amber-400/20 border-amber-400 scale-105'
                          : 'bg-[#161923] border-white/10'
                      }`}
                    >
                      {av.emoji}
                    </button>
                  ))}
                </div>
                <label className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[#161923] border border-white/10 cursor-pointer">
                  <div>
                    <div className="text-xs font-semibold text-white">
                      Junior / Einsteiger
                    </div>
                    <div className="text-[11px] text-slate-400">
                      7 statt 8 Karten &amp; wohlwollendere KI-Prüfung
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={draftJunior}
                    onChange={(e) => setDraftJunior(e.target.checked)}
                    className="w-5 h-5 accent-amber-400"
                  />
                </label>
                <button
                  type="submit"
                  className="w-full min-h-[42px] rounded-xl bg-amber-400 text-slate-950 text-xs font-bold hover:bg-amber-300"
                >
                  Profil aktualisieren
                </button>
              </form>
            )}

            <div className="space-y-2">
              {room.playerOrder.length === 0 ? (
                <div className="p-4 rounded-2xl bg-[#161923] border border-white/5 text-xs text-slate-400 text-center">
                  Noch keine Spieler beigetreten — scannt den QR-Code oder fügt einen KI-Bot hinzu.
                </div>
              ) : (
                room.playerOrder.map((uid) => {
                  const p = room.playersMeta[uid];
                  if (!p) return null;
                  const av = getAvatar(p.avatar);
                  return (
                    <div
                      key={uid}
                      className="px-3.5 py-2.5 rounded-2xl bg-[#161923] border border-white/5 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-10 h-10 rounded-xl border flex items-center justify-center text-xl shrink-0 ${av.bgClass}`}
                        >
                          {av.emoji}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-sm text-white truncate">
                              {p.name}
                            </span>
                            {uid === room.hostUid && (
                              <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            )}
                            {p.isBot && (
                              <Bot className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                            )}
                            {uid === myUid && (
                              <span className="text-xs text-amber-400 font-medium">
                                (Du)
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400">
                            {p.isBot
                              ? `KI-Bot · ${BOT_DIFFICULTY_META[p.botDifficulty === 'NONE' ? 'NORMAL' : p.botDifficulty].label}`
                              : p.isJunior
                                ? 'Junior · 7 Karten'
                                : 'Standard · 8 Karten'}
                            {p.secretThemeCount > 0 && ` · ${p.secretThemeCount} Geheim-Thema`}
                          </div>
                        </div>
                      </div>

                      {isHost && p.isBot && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <select
                            aria-label={`Schwierigkeit für ${p.name}`}
                            value={p.botDifficulty === 'NONE' ? 'NORMAL' : p.botDifficulty}
                            onChange={(e) =>
                              onUpdateBotDifficulty(
                                uid,
                                e.target.value as Exclude<BotDifficulty, 'NONE'>
                              )
                            }
                            className="min-h-[34px] px-2 rounded-lg bg-[#0F1117] border border-white/15 text-xs text-slate-200"
                          >
                            <option value="SLOW">Gemütlich</option>
                            <option value="NORMAL">Normal</option>
                            <option value="FAST">Blitzschnell</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => onRemoveBot(uid)}
                            aria-label={`${p.name} entfernen`}
                            className="min-h-[34px] min-w-[34px] rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 flex items-center justify-center"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Host: Add KI-Bot */}
            {isHost && room.playerOrder.length < room.maxPlayers && (
              <div className="pt-2 border-t border-white/10 space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    value={botDifficultyPick}
                    onChange={(e) =>
                      setBotDifficultyPick(
                        e.target.value as Exclude<BotDifficulty, 'NONE'>
                      )
                    }
                    className="min-h-[42px] px-3 rounded-xl bg-[#0F1117] border border-white/15 text-xs font-medium text-white"
                  >
                    <option value="SLOW">Gemütlich (7–13s)</option>
                    <option value="NORMAL">Normal (4–8s)</option>
                    <option value="FAST">Blitzschnell (2–4s)</option>
                  </select>
                  <button
                    type="button"
                    disabled={addingBot}
                    onClick={handleAddBotClick}
                    className="flex-1 min-h-[42px] px-3.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-sky-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    <span>+ KI-Bot hinzufügen</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Secret Lobby Themes (only for players with hands) */}
          {!isTableDisplay && (
            <div className="rounded-3xl bg-[#1C202E] border border-white/10 p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-display font-bold text-white flex items-center gap-2">
                  <EyeOff className="w-4 h-4 text-sky-400" />
                  <span>Geheime Themen-Idee</span>
                </h2>
                <span className="text-xs font-mono tabular-nums text-slate-400">
                  {secretCount}/2 eingereicht
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Schmuggle heimlich bis zu 2 eigene Themen in den Stapel – niemand sieht vorher, was du eingereicht hast!
              </p>
              {secretCount < 2 ? (
                <form onSubmit={handleSecretSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={secretInput}
                    onChange={(e) => setSecretInput(e.target.value)}
                    placeholder="z. B. Peinliche Urlaubspannen..."
                    maxLength={80}
                    className="flex-1 min-h-[44px] px-3.5 rounded-xl bg-[#0F1117] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                  />
                  <button
                    type="submit"
                    disabled={secretSubmitting || secretInput.trim().length < 2}
                    aria-label="Geheimes Thema einreichen"
                    className="min-h-[44px] min-w-[44px] px-4 rounded-xl bg-sky-400 text-slate-950 font-semibold hover:bg-sky-300 disabled:opacity-40 flex items-center justify-center transition-colors"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              ) : (
                <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-400/25 text-xs text-sky-200">
                  Deine 2 geheimen Themen sind sicher im Kartenstapel versteckt!
                </div>
              )}
            </div>
          )}
        </section>

        {/* Right Column: Host Game Configuration */}
        <section className="lg:col-span-7 space-y-4">
          <div className="rounded-3xl bg-[#1C202E] border border-white/10 p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-display font-bold text-white">
                Spielregeln &amp; Themen-Deck
              </h2>
              {!isHost && (
                <span className="text-xs text-slate-400">
                  Nur Host wählt aus
                </span>
              )}
            </div>

            <div className="p-4 rounded-2xl bg-[#161923] border border-white/10 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs text-slate-400">Aktives Themen-Deck</div>
                <div className="text-base font-display font-bold text-amber-400 truncate mt-0.5">
                  {room.selectedCategory}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {room.deckThemes.length} Einzelthemen geladen
                </div>
              </div>
              {isHost && (
                <button
                  type="button"
                  onClick={() => setDeckModalOpen(true)}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-amber-400/15 border border-amber-400/40 text-amber-300 hover:bg-amber-400/25 text-xs font-semibold flex items-center gap-2 shrink-0 transition-colors"
                >
                  <FolderCog className="w-4 h-4" />
                  <span>Themen ändern / KI</span>
                </button>
              )}
            </div>

            {/* Ablauf-Modus */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 block">
                Ablauf-Modus
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={!isHost}
                  onClick={() => onUpdateHostSettings({ turnMode: 'SIMULTANEOUS' })}
                  className={`p-3.5 rounded-2xl border text-left transition-all ${
                    room.turnMode === 'SIMULTANEOUS'
                      ? 'bg-amber-400/15 border-amber-400 text-white'
                      : 'bg-[#161923] border-white/10 text-slate-300'
                  } disabled:cursor-default`}
                >
                  <div className="font-semibold text-sm">Alle zugleich</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Wer zuerst ein passendes Wort ruft, legt ab und sperrt es.
                  </div>
                </button>
                <button
                  type="button"
                  disabled={!isHost}
                  onClick={() => onUpdateHostSettings({ turnMode: 'TURN_BASED' })}
                  className={`p-3.5 rounded-2xl border text-left transition-all ${
                    room.turnMode === 'TURN_BASED'
                      ? 'bg-amber-400/15 border-amber-400 text-white'
                      : 'bg-[#161923] border-white/10 text-slate-300'
                  } disabled:cursor-default`}
                >
                  <div className="font-semibold text-sm">Reihum</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Nacheinander im Uhrzeigersinn mit eigenem Zug-Timer.
                  </div>
                </button>
              </div>
            </div>

            {/* Regel-Variante */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 block">
                Regel-Variante
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={!isHost}
                  onClick={() => onUpdateHostSettings({ ruleVariant: 'CLASSIC' })}
                  className={`p-3.5 rounded-2xl border text-left transition-all ${
                    room.ruleVariant === 'CLASSIC'
                      ? 'bg-emerald-400/15 border-emerald-400 text-white'
                      : 'bg-[#161923] border-white/10 text-slate-300'
                  } disabled:cursor-default`}
                >
                  <div className="font-semibold text-sm">Klassisch</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Pures Wort- und Buchstabenkartenspiel ohne Sonderkarten.
                  </div>
                </button>
                <button
                  type="button"
                  disabled={!isHost}
                  onClick={() => onUpdateHostSettings({ ruleVariant: 'CHAOS' })}
                  className={`p-3.5 rounded-2xl border text-left transition-all ${
                    room.ruleVariant === 'CHAOS'
                      ? 'bg-rose-400/15 border-rose-400 text-white'
                      : 'bg-[#161923] border-white/10 text-slate-300'
                  } disabled:cursor-default`}
                >
                  <div className="font-semibold text-sm flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-rose-400" />
                    <span>Familien-Chaos</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    +2 Aktionskarten: Themen-Wechsel, Geschenk, Turbo &amp; Schild.
                  </div>
                </button>
              </div>
            </div>

            {/* Timer & Max Players */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 block">
                  Themen-Timer
                </label>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[#0F1117] border border-white/10">
                  {([15, 20, 30] as const).map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      disabled={!isHost}
                      onClick={() => onUpdateHostSettings({ roundDurationSec: sec })}
                      className={`min-h-[40px] rounded-lg text-xs font-mono font-bold tabular-nums transition-colors ${
                        room.roundDurationSec === sec
                          ? 'bg-amber-400 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      } disabled:cursor-default`}
                    >
                      {sec} Sek.
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 block">
                  Maximale Spieleranzahl
                </label>
                <div className="grid grid-cols-7 gap-1 p-1 rounded-xl bg-[#0F1117] border border-white/10">
                  {[2, 3, 4, 5, 6, 7, 8].map((num) => (
                    <button
                      key={num}
                      type="button"
                      disabled={!isHost || num < room.playerOrder.length}
                      onClick={() => onUpdateHostSettings({ maxPlayers: num })}
                      className={`min-h-[40px] rounded-lg text-xs font-mono font-bold tabular-nums transition-colors ${
                        room.maxPlayers === num
                          ? 'bg-amber-400 text-slate-950'
                          : 'text-slate-300 hover:text-white disabled:opacity-30'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <label
              className={`p-3.5 rounded-2xl bg-[#161923] border border-white/10 flex items-center justify-between gap-3 ${
                isHost ? 'cursor-pointer' : 'opacity-90'
              }`}
            >
              <div className="flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-white">
                    Automatische Strafkarte (+1) bei ungültigem Wort
                  </div>
                  <div className="text-xs text-slate-400">
                    Lehnt der KI-Schiedsrichter ein Wort ab, zieht der Spieler sofort 1 Karte nach.
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                disabled={!isHost}
                checked={room.penaltyEnabled}
                onChange={(e) => onUpdateHostSettings({ penaltyEnabled: e.target.checked })}
                className="w-5 h-5 accent-amber-400 shrink-0"
              />
            </label>
          </div>
        </section>
      </main>

      {/* Bottom Sticky Start CTA */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[#0F1117] via-[#0F1117] to-transparent z-30">
        <div className="max-w-5xl mx-auto">
          {isHost ? (
            <button
              type="button"
              disabled={!canStart || starting}
              onClick={handleStart}
              className="w-full min-h-[52px] px-6 rounded-2xl bg-amber-400 text-slate-950 font-display font-bold text-base hover:bg-amber-300 disabled:opacity-45 flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.99]"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>
                {humanCount < 1
                  ? 'Mindestens 1 Spieler am Smartphone nötig…'
                  : room.playerOrder.length < 2
                    ? 'Warte auf 2. Spieler oder füge KI-Bot hinzu…'
                    : starting
                      ? 'Spiel startet…'
                      : `Runde starten (${room.playerOrder.length} Mitspieler)`}
              </span>
            </button>
          ) : (
            <div className="w-full min-h-[52px] px-6 rounded-2xl bg-[#1C202E] border border-white/10 text-slate-300 font-medium text-sm flex items-center justify-center">
              Warte auf den Gastgeber, um die Runde zu starten…
            </div>
          )}
        </div>
      </div>

      <DeckBuilderModal
        isOpen={deckModalOpen}
        onClose={() => setDeckModalOpen(false)}
        familyPin={familyPin}
        selectedCategory={room.selectedCategory}
        customDecks={customDecks}
        onSaveCustomDeck={onSaveCustomDeck}
        onDeleteCustomDeck={onDeleteCustomDeck}
        onSelectDeck={(name, themes) =>
          onUpdateHostSettings({ selectedCategory: name, deckThemes: themes })
        }
      />
    </div>
  );
};
