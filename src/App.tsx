import React, { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import {
  ArrowRight,
  FolderCog,
  Loader2,
  LogIn,
  LogOut,
  Plus,
  Users,
  Zap,
} from 'lucide-react';
import { DeckBuilderModal } from './components/DeckBuilderModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GameView } from './components/GameView';
import { LobbyView } from './components/LobbyView';
import { RoundEndView } from './components/RoundEndView';
import { VictoryView } from './components/VictoryView';
import {
  AVATARS,
  MIXED_FAMILY_CATEGORY,
} from './data/themesAndCards';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  signInWithGoogle,
  signOutUser,
  testFirestoreConnection,
} from './lib/firebase';
import {
  advanceTheme,
  advanceTurnInTurnBasedMode,
  claimMyRoundPoints,
  consumeActionCard,
  createRoom,
  dealMyHandForRound,
  hostCheckGameOverOrNextRound,
  hostFinishRoundManually,
  hostResetRoomToLobby,
  joinRoom,
  playChaosThemeSwap,
  playChaosTimeTurbo,
  recordAcceptedWord,
  recordRejectedWord,
  resolveChaosGiftEvent,
  sendChaosGift,
  startMatch,
  submitSecretLobbyTheme,
  transitionCountdownToPlaying,
  undoWordEntry,
  updateHostLobbySettings,
  updatePlayerProfileInLobby,
} from './lib/roomService';
import type {
  ChaosEvent,
  CustomDeck,
  FeedEntry,
  LocalPlayerProfile,
  PlayerData,
  RoomData,
  RuleVariant,
  TurnMode,
} from './types/game';

const PROFILE_STORAGE_KEY = 'wortblitz_profile_v1';
const CUSTOM_DECKS_STORAGE_KEY = 'wortblitz_custom_decks_v1';
const ACTIVE_ROOM_STORAGE_KEY = 'wortblitz_active_room_v1';

function loadStoredProfile(user: User | null): LocalPlayerProfile {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalPlayerProfile>;
      if (parsed.name && parsed.avatar) {
        return {
          name: parsed.name.slice(0, 24),
          avatar: parsed.avatar,
          isJunior: Boolean(parsed.isJunior),
        };
      }
    }
  } catch {
    // ignore storage parse failure
  }
  const firstName = user?.displayName?.split(' ')[0]?.slice(0, 24) || 'Spieler';
  return { name: firstName, avatar: 'fox', isJunior: false };
}

function loadStoredDecks(): CustomDeck[] {
  try {
    const raw = localStorage.getItem(CUSTOM_DECKS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CustomDeck[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function WortBlitzApp() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [profile, setProfile] = useState<LocalPlayerProfile>(() => loadStoredProfile(null));
  const [customDecks, setCustomDecks] = useState<CustomDeck[]>(() => loadStoredDecks());

  // Home screen setup state
  const [homeMode, setHomeMode] = useState<'JOIN' | 'CREATE'>('CREATE');
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  const [setupMaxPlayers, setSetupMaxPlayers] = useState(4);
  const [setupTurnMode, setSetupTurnMode] = useState<TurnMode>('SIMULTANEOUS');
  const [setupRuleVariant, setSetupRuleVariant] = useState<RuleVariant>('CHAOS');
  const [setupPenaltyEnabled, setSetupPenaltyEnabled] = useState(true);
  const [setupDuration, setSetupDuration] = useState<15 | 20 | 30>(20);
  const [setupCategory, setSetupCategory] = useState(MIXED_FAMILY_CATEGORY.name);
  const [setupThemes, setSetupThemes] = useState<string[]>(MIXED_FAMILY_CATEGORY.themes);
  const [deckModalOpen, setDeckModalOpen] = useState(false);

  // Active room real-time state
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get('room');
    if (urlRoom && /^[0-9]{4}$/.test(urlRoom)) return null; // Auto-join after profile/auth check
    return sessionStorage.getItem(ACTIVE_ROOM_STORAGE_KEY);
  });
  const [pendingQrRoom, setPendingQrRoom] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get('room');
    return urlRoom && /^[0-9]{4}$/.test(urlRoom) ? urlRoom : null;
  });

  const [room, setRoom] = useState<RoomData | null>(null);
  const [myPlayer, setMyPlayer] = useState<PlayerData | null>(null);
  const [feedEntries, setFeedEntries] = useState<FeedEntry[]>([]);
  const [pendingGifts, setPendingGifts] = useState<ChaosEvent[]>([]);
  const [muted, setMuted] = useState(false);
  const [heroImgError, setHeroImgError] = useState(false);

  // If QR code URL param exists, pre-fill join tab
  useEffect(() => {
    if (pendingQrRoom) {
      setHomeMode('JOIN');
      setJoinCode(pendingQrRoom);
    }
  }, [pendingQrRoom]);

  // Persist profile and custom decks
  useEffect(() => {
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    } catch {
      // ignore
    }
  }, [profile]);

  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_DECKS_STORAGE_KEY, JSON.stringify(customDecks));
    } catch {
      // ignore
    }
  }, [customDecks]);

  // Firebase Auth listener + initial connection check
  useEffect(() => {
    testFirestoreConnection();
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        setProfile((prev) => {
          if (prev.name === 'Spieler' && u.displayName) {
            return { ...prev, name: u.displayName.split(' ')[0].slice(0, 24) };
          }
          return prev;
        });
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Firestore real-time subscriptions when inside a room
  useEffect(() => {
    if (!authReady || !user || !activeRoomCode) {
      setRoom(null);
      setMyPlayer(null);
      setFeedEntries([]);
      setPendingGifts([]);
      return;
    }

    const roomPath = `rooms/${activeRoomCode}`;
    const unsubRoom = onSnapshot(
      doc(db, 'rooms', activeRoomCode),
      (snap) => {
        if (!snap.exists()) {
          setRoom(null);
          setActiveRoomCode(null);
          sessionStorage.removeItem(ACTIVE_ROOM_STORAGE_KEY);
          return;
        }
        setRoom(snap.data() as RoomData);
      },
      (err) => handleFirestoreError(err, OperationType.GET, roomPath)
    );

    const playerPath = `rooms/${activeRoomCode}/players/${user.uid}`;
    const unsubPlayer = onSnapshot(
      doc(db, 'rooms', activeRoomCode, 'players', user.uid),
      (snap) => {
        setMyPlayer(snap.exists() ? (snap.data() as PlayerData) : null);
      },
      (err) => handleFirestoreError(err, OperationType.GET, playerPath)
    );

    const feedPath = `rooms/${activeRoomCode}/feed`;
    const feedQuery = query(
      collection(db, 'rooms', activeRoomCode, 'feed'),
      where('visibleTo', 'array-contains', user.uid)
    );
    const unsubFeed = onSnapshot(
      feedQuery,
      (snap) => {
        const entries = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<FeedEntry, 'id'>) }))
          .sort((a, b) => {
            const secA = (a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
            const secB = (b.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
            return secB - secA;
          })
          .slice(0, 20);
        setFeedEntries(entries);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, feedPath)
    );

    const eventsPath = `rooms/${activeRoomCode}/events`;
    const eventsQuery = query(
      collection(db, 'rooms', activeRoomCode, 'events'),
      where('toUid', '==', user.uid)
    );
    const unsubEvents = onSnapshot(
      eventsQuery,
      (snap) => {
        setPendingGifts(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<ChaosEvent, 'id'>) }))
            .filter((e) => e.status === 'PENDING')
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, eventsPath)
    );

    return () => {
      unsubRoom();
      unsubPlayer();
      unsubFeed();
      unsubEvents();
    };
  }, [authReady, user, activeRoomCode]);

  // Automatically deal this player's private hand when a new round starts
  useEffect(() => {
    if (!room || !myPlayer || !user) return;
    if (
      (room.status === 'COUNTDOWN' || room.status === 'PLAYING') &&
      room.roundNumber > 0 &&
      myPlayer.roundDealt < room.roundNumber
    ) {
      dealMyHandForRound(
        room.code,
        user.uid,
        room.roundNumber,
        myPlayer.isJunior,
        room.ruleVariant
      );
    }
  }, [room, myPlayer, user]);

  // Host monitors scores during ROUND_END to detect 10-point victory
  useEffect(() => {
    if (!room || !user) return;
    if (room.status === 'ROUND_END' && room.hostUid === user.uid) {
      hostCheckGameOverOrNextRound(room, 'FINISH_CHECK');
    }
  }, [room, user]);

  const handleSaveCustomDeck = useCallback((deck: CustomDeck) => {
    setCustomDecks((prev) => {
      const idx = prev.findIndex((d) => d.id === deck.id);
      if (idx !== -1) {
        const next = [...prev];
        next[idx] = deck;
        return next;
      }
      return [deck, ...prev];
    });
  }, []);

  const handleDeleteCustomDeck = useCallback((id: string) => {
    setCustomDecks((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.'
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || busyAction) return;
    setBusyAction(true);
    setJoinError(null);
    try {
      const code = await createRoom(user.uid, profile, {
        maxPlayers: setupMaxPlayers,
        turnMode: setupTurnMode,
        ruleVariant: setupRuleVariant,
        penaltyEnabled: setupPenaltyEnabled,
        roundDurationSec: setupDuration,
        selectedCategory: setupCategory,
        deckThemes: setupThemes,
      });
      sessionStorage.setItem(ACTIVE_ROOM_STORAGE_KEY, code);
      setActiveRoomCode(code);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Raum konnte nicht erstellt werden.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || busyAction) return;
    setBusyAction(true);
    setJoinError(null);
    try {
      const result = await joinRoom(joinCode, user.uid, profile);
      if (!result.ok) {
        setJoinError(result.error);
      } else {
        sessionStorage.setItem(ACTIVE_ROOM_STORAGE_KEY, result.code);
        setActiveRoomCode(result.code);
        setPendingQrRoom(null);
        window.history.replaceState({}, '', '/');
      }
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Beitritt fehlgeschlagen.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleLeaveRoom = () => {
    sessionStorage.removeItem(ACTIVE_ROOM_STORAGE_KEY);
    setActiveRoomCode(null);
    setRoom(null);
    setMyPlayer(null);
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#0F1117] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
      </div>
    );
  }

  // Active Room Routing
  if (user && activeRoomCode && room) {
    if (room.status === 'LOBBY') {
      return (
        <LobbyView
          room={room}
          myUid={user.uid}
          myPlayer={myPlayer}
          profile={profile}
          customDecks={customDecks}
          onSaveCustomDeck={handleSaveCustomDeck}
          onDeleteCustomDeck={handleDeleteCustomDeck}
          onUpdateHostSettings={(s) => updateHostLobbySettings(room.code, s)}
          onUpdateProfileInLobby={async (next) => {
            setProfile(next);
            await updatePlayerProfileInLobby(room.code, user.uid, next);
          }}
          onSubmitSecretTheme={(themeText) =>
            submitSecretLobbyTheme(
              room.code,
              room.hostUid,
              user.uid,
              themeText,
              myPlayer?.secretThemeCount ?? 0
            )
          }
          onStartMatch={() => startMatch(room, user.uid)}
          onLeaveRoom={handleLeaveRoom}
        />
      );
    }

    if ((room.status === 'COUNTDOWN' || room.status === 'PLAYING') && myPlayer) {
      return (
        <GameView
          room={room}
          myUid={user.uid}
          myPlayer={myPlayer}
          feedEntries={feedEntries}
          pendingGifts={pendingGifts}
          muted={muted}
          onToggleMute={() => setMuted((m) => !m)}
          onCountdownFinished={() => transitionCountdownToPlaying(room)}
          onThemeTimedOut={() => advanceTheme(room, 'Zeit um — nächstes Thema!')}
          onTurnTimedOut={() =>
            advanceTurnInTurnBasedMode(room, 'Zugzeit abgelaufen — nächster Spieler!')
          }
          onAcceptWord={(params) =>
            recordAcceptedWord({ room, player: myPlayer, ...params })
          }
          onRejectWord={(params) =>
            recordRejectedWord({ room, player: myPlayer, ...params })
          }
          onUndoEntry={(entry, normalizedWord) =>
            undoWordEntry({ room, player: myPlayer, entry, normalizedWord })
          }
          onConsumeShieldForPenalty={async () => {
            await consumeActionCard(room.code, myPlayer, 'SHIELD');
          }}
          onPlayThemeSwap={() => playChaosThemeSwap(room, myPlayer)}
          onPlayTimeTurbo={() => playChaosTimeTurbo(room, myPlayer)}
          onSendGift={(targetUid, targetName, cardIndex) =>
            sendChaosGift({ room, sender: myPlayer, targetUid, targetName, cardIndex })
          }
          onResolveGift={(event, useShield) =>
            resolveChaosGiftEvent({
              room,
              player: myPlayer,
              eventId: event.id,
              letter: event.letter,
              useShield,
            })
          }
          onFinishRoundManually={() => hostFinishRoundManually(room)}
        />
      );
    }

    if (room.status === 'ROUND_END' && myPlayer) {
      return (
        <RoundEndView
          room={room}
          myUid={user.uid}
          myPlayer={myPlayer}
          onClaimMyPoints={async () => {
            await claimMyRoundPoints(room, myPlayer);
          }}
          onNextRoundOrFinish={() => hostCheckGameOverOrNextRound(room, 'NEXT_ROUND')}
        />
      );
    }

    if (room.status === 'GAME_OVER') {
      return (
        <VictoryView
          room={room}
          myUid={user.uid}
          muted={muted}
          onResetToLobby={() => hostResetRoomToLobby(room)}
          onLeaveRoom={handleLeaveRoom}
        />
      );
    }

    return (
      <div className="min-h-screen bg-[#0F1117] flex items-center justify-center text-slate-300">
        <Loader2 className="w-7 h-7 text-amber-400 animate-spin mr-2" />
        <span>Karten werden gemischt…</span>
      </div>
    );
  }

  // Home / Sign-In & Room Setup Screen
  return (
    <div className="min-h-screen bg-[#0F1117] text-slate-100">
      {/* Top Bar */}
      <header className="border-b border-white/10 bg-[#0F1117]/90 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <Zap className="w-6 h-6 text-amber-400 fill-amber-400" />
            <span className="text-xl font-display font-extrabold tracking-tight text-white">
              WortBlitz
            </span>
          </div>

          {user ? (
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs text-slate-300 hidden sm:inline truncate max-w-[180px]">
                {user.displayName || user.email}
              </span>
              <button
                type="button"
                onClick={() => signOutUser()}
                className="min-h-[40px] px-3.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Abmelden</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={authLoading}
              onClick={handleGoogleLogin}
              className="min-h-[40px] px-4 rounded-xl bg-amber-400 text-slate-950 text-xs font-bold hover:bg-amber-300 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              <LogIn className="w-4 h-4" />
              <span>Anmelden</span>
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left Hero Column */}
        <section className="lg:col-span-6 flex flex-col justify-between gap-6">
          <div className="space-y-4">
            <h1 className="text-4xl sm:text-5xl font-display font-extrabold text-white tracking-tight leading-[1.08] text-balance">
              Das rasante Wortkarten-Duell für den Familientisch
            </h1>
            <p className="text-base text-slate-300 max-w-xl leading-relaxed">
              Jeder sieht seine eigenen Buchstaben auf dem Smartphone, ruft passende Begriffe ins Mikrofon und der KI-Schiedsrichter prüft blitzschnell in Echtzeit.
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              <span>2–8 Spieler per QR-Code</span>
              <span aria-hidden="true">·</span>
              <span>Junior-Fairness</span>
              <span aria-hidden="true">·</span>
              <span>Familien-Chaos-Karten</span>
            </div>
          </div>

          <div className="rounded-3xl overflow-hidden border border-white/10 bg-[#1C202E] aspect-[4/3] sm:aspect-[16/10] relative">
            {!heroImgError ? (
              <img
                src="/src/assets/images/wortblitz_cards_hero_1795193543971.jpg"
                alt="WortBlitz Buchstabenkarten auf dunklem Spieltisch"
                referrerPolicy="no-referrer"
                onError={() => setHeroImgError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#1C202E] to-[#0F1117] p-6">
                <div className="flex gap-3">
                  {['W', 'O', 'R', 'T'].map((l, i) => (
                    <div
                      key={l}
                      className={`w-16 h-24 rounded-2xl flex items-center justify-center font-display font-extrabold text-3xl shadow-lg ${
                        i === 0
                          ? 'bg-sky-500 text-slate-950'
                          : i === 1
                            ? 'bg-emerald-500 text-slate-950'
                            : i === 2
                              ? 'bg-amber-400 text-slate-950'
                              : 'bg-rose-500 text-white'
                      }`}
                    >
                      {l}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right Interactive Entry Card */}
        <section className="lg:col-span-6">
          <div className="h-full rounded-3xl bg-[#1C202E] border border-white/10 p-5 sm:p-7 flex flex-col justify-between gap-6">
            {!user ? (
              <div className="my-auto space-y-5 text-center py-6">
                <h2 className="text-2xl font-display font-bold text-white">
                  {pendingQrRoom
                    ? `Raum ${pendingQrRoom} beitreten`
                    : 'Mit deinem Konto loslegen'}
                </h2>
                <p className="text-sm text-slate-300 max-w-sm mx-auto">
                  Melde dich kurz mit Google an, damit deine Kartenhand und Punkte in Echtzeit mit allen Smartphones synchronisiert werden.
                </p>
                {authError && (
                  <p className="text-xs text-rose-400">{authError}</p>
                )}
                <button
                  type="button"
                  disabled={authLoading}
                  onClick={handleGoogleLogin}
                  className="w-full min-h-[52px] px-6 rounded-2xl bg-amber-400 text-slate-950 font-display font-bold text-base hover:bg-amber-300 flex items-center justify-center gap-2 transition-colors"
                >
                  {authLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <LogIn className="w-5 h-5" />
                  )}
                  <span>Mit Google anmelden &amp; spielen</span>
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Mode Toggle: Create vs Join */}
                <div className="grid grid-cols-2 gap-1 p-1 bg-[#0F1117] rounded-2xl border border-white/10">
                  <button
                    type="button"
                    onClick={() => setHomeMode('CREATE')}
                    className={`min-h-[44px] rounded-xl text-sm font-semibold transition-colors ${
                      homeMode === 'CREATE'
                        ? 'bg-amber-400 text-slate-950'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    Neuen Raum erstellen
                  </button>
                  <button
                    type="button"
                    onClick={() => setHomeMode('JOIN')}
                    className={`min-h-[44px] rounded-xl text-sm font-semibold transition-colors ${
                      homeMode === 'JOIN'
                        ? 'bg-amber-400 text-slate-950'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    Raum beitreten
                  </button>
                </div>

                {/* Player Profile Setup */}
                <div className="space-y-3 p-4 rounded-2xl bg-[#161923] border border-white/10">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">
                      Dein Spieler-Profil
                    </span>
                    <label className="flex items-center gap-2 text-xs text-amber-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={profile.isJunior}
                        onChange={(e) =>
                          setProfile((p) => ({ ...p, isJunior: e.target.checked }))
                        }
                        className="w-4 h-4 accent-amber-400"
                      />
                      <span>Junior / Einsteiger (7 Karten)</span>
                    </label>
                  </div>

                  <input
                    type="text"
                    value={profile.name}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, name: e.target.value }))
                    }
                    maxLength={24}
                    placeholder="Dein Spitzname"
                    className="w-full min-h-[44px] px-4 rounded-xl bg-[#0F1117] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                  />

                  <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5">
                    {AVATARS.map((av) => (
                      <button
                        key={av.id}
                        type="button"
                        onClick={() => setProfile((p) => ({ ...p, avatar: av.id }))}
                        title={av.label}
                        className={`min-h-[40px] rounded-xl border text-lg flex items-center justify-center transition-transform ${
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

                {homeMode === 'CREATE' ? (
                  <form onSubmit={handleCreateRoom} className="space-y-4">
                    {/* Theme Deck Picker */}
                    <div className="p-4 rounded-2xl bg-[#161923] border border-white/10 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-slate-400">Themen-Deck</div>
                        <div className="text-sm font-bold text-amber-400 truncate">
                          {setupCategory} ({setupThemes.length} Themen)
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDeckModalOpen(true)}
                        className="min-h-[42px] px-3.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white flex items-center gap-1.5 shrink-0"
                      >
                        <FolderCog className="w-4 h-4 text-amber-400" />
                        <span>Baukasten / KI</span>
                      </button>
                    </div>

                    {/* Quick Settings Grid */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs text-slate-400 block">
                          Ablauf-Modus
                        </label>
                        <select
                          value={setupTurnMode}
                          onChange={(e) => setSetupTurnMode(e.target.value as TurnMode)}
                          className="w-full min-h-[44px] px-3 rounded-xl bg-[#0F1117] border border-white/15 text-sm text-white focus:outline-none focus:border-amber-400"
                        >
                          <option value="SIMULTANEOUS">Alle zugleich</option>
                          <option value="TURN_BASED">Reihum (Uhrzeigersinn)</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs text-slate-400 block">
                          Regel-Variante
                        </label>
                        <select
                          value={setupRuleVariant}
                          onChange={(e) => setSetupRuleVariant(e.target.value as RuleVariant)}
                          className="w-full min-h-[44px] px-3 rounded-xl bg-[#0F1117] border border-white/15 text-sm text-white focus:outline-none focus:border-amber-400"
                        >
                          <option value="CHAOS">Familien-Chaos (+2 Aktionen)</option>
                          <option value="CLASSIC">Klassisch</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs text-slate-400 block">
                          Spieleranzahl
                        </label>
                        <select
                          value={setupMaxPlayers}
                          onChange={(e) => setSetupMaxPlayers(Number(e.target.value))}
                          className="w-full min-h-[44px] px-3 rounded-xl bg-[#0F1117] border border-white/15 text-sm text-white focus:outline-none focus:border-amber-400"
                        >
                          {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                            <option key={n} value={n}>
                              Bis zu {n} Spieler
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs text-slate-400 block">
                          Timer pro Thema
                        </label>
                        <select
                          value={setupDuration}
                          onChange={(e) =>
                            setSetupDuration(Number(e.target.value) as 15 | 20 | 30)
                          }
                          className="w-full min-h-[44px] px-3 rounded-xl bg-[#0F1117] border border-white/15 text-sm text-white focus:outline-none focus:border-amber-400"
                        >
                          <option value={15}>15 Sekunden</option>
                          <option value={20}>20 Sekunden</option>
                          <option value={30}>30 Sekunden</option>
                        </select>
                      </div>
                    </div>

                    <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#161923] border border-white/10 cursor-pointer">
                      <span className="text-xs font-medium text-slate-200">
                        Automatische Strafkarte (+1) bei ungültigem Wort
                      </span>
                      <input
                        type="checkbox"
                        checked={setupPenaltyEnabled}
                        onChange={(e) => setSetupPenaltyEnabled(e.target.checked)}
                        className="w-4 h-4 accent-amber-400"
                      />
                    </label>

                    {joinError && <p className="text-xs text-rose-400">{joinError}</p>}

                    <button
                      type="submit"
                      disabled={busyAction || !profile.name.trim()}
                      className="w-full min-h-[52px] px-6 rounded-2xl bg-amber-400 text-slate-950 font-display font-bold text-base hover:bg-amber-300 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                    >
                      {busyAction ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Plus className="w-5 h-5" />
                      )}
                      <span>Lobby mit QR-Code erstellen</span>
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleJoinRoom} className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-slate-300 block">
                        4-stelliger Raum-Code
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]{4}"
                        maxLength={4}
                        value={joinCode}
                        onChange={(e) =>
                          setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 4))
                        }
                        placeholder="1234"
                        className="w-full min-h-[56px] px-4 rounded-2xl bg-[#0F1117] border border-white/15 text-center font-mono text-3xl font-bold tracking-[0.25em] text-amber-400 placeholder:text-slate-600 focus:outline-none focus:border-amber-400"
                      />
                    </div>

                    {joinError && <p className="text-xs text-rose-400">{joinError}</p>}

                    <button
                      type="submit"
                      disabled={busyAction || joinCode.length !== 4 || !profile.name.trim()}
                      className="w-full min-h-[52px] px-6 rounded-2xl bg-amber-400 text-slate-950 font-display font-bold text-base hover:bg-amber-300 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                    >
                      {busyAction ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Users className="w-5 h-5" />
                      )}
                      <span>Raum beitreten</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </section>
      </main>

      <DeckBuilderModal
        isOpen={deckModalOpen}
        onClose={() => setDeckModalOpen(false)}
        selectedCategory={setupCategory}
        customDecks={customDecks}
        onSaveCustomDeck={handleSaveCustomDeck}
        onDeleteCustomDeck={handleDeleteCustomDeck}
        onSelectDeck={(name, themes) => {
          setSetupCategory(name);
          setSetupThemes(themes);
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <WortBlitzApp />
    </ErrorBoundary>
  );
}
