import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowRight,
  Eye,
  EyeOff,
  FolderCog,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Monitor,
  Plus,
  Users,
  Zap,
} from 'lucide-react';
import { DeckBuilderModal } from './components/DeckBuilderModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GameView } from './components/GameView';
import { LobbyView } from './components/LobbyView';
import { RoundEndView } from './components/RoundEndView';
import { TableDisplayView } from './components/TableDisplayView';
import { VictoryView } from './components/VictoryView';
import { AVATARS, MIXED_FAMILY_CATEGORY } from './data/themesAndCards';
import { useBotRunner } from './hooks/useBotRunner';
import {
  getDb,
  getOrCreatePlayerId,
  handleFirestoreError,
  initFirebaseFromConfig,
  OperationType,
} from './lib/firebase';
import {
  authenticateFamilyPin,
  clearStoredFamilyPin,
  getStoredFamilyPin,
  persistFamilyPin,
} from './lib/geminiProxy';
import {
  addBotToLobby,
  advanceTheme,
  advanceTurnInTurnBasedMode,
  claimMyRoundPoints,
  consumeActionCard,
  createRoom,
  dealAllBotsForRound,
  dealHandForParticipant,
  finalizeRoundEndAfterDelay,
  hostCheckGameOverOrNextRound,
  hostClaimBotRoundPoints,
  hostFinishRoundManually,
  hostResetRoomToLobby,
  joinRoom,
  playChaosThemeSwap,
  playChaosTimeTurbo,
  recordAcceptedWord,
  recordRejectedWord,
  removeBotFromLobby,
  resolveChaosBlockEvent,
  resolveChaosGiftEvent,
  ROUND_END_DELAY_MS,
  sendChaosBlock,
  sendChaosGift,
  startMatch,
  submitSecretLobbyTheme,
  swapSingleLetterCard,
  transitionCountdownToPlaying,
  undoWordEntry,
  updateBotDifficultyInLobby,
  updateHostLobbySettings,
  updatePlayerProfileInLobby,
} from './lib/roomService';
import {
  playSuccessChime,
  speakModerator,
  stopModeratorSpeech,
  unlockAndTestAudio,
} from './lib/soundAndSpeech';
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
const TABLE_AUDIO_STORAGE_KEY = 'wortblitz_table_audio_device_v1';

function loadStoredProfile(): LocalPlayerProfile {
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
    // ignore
  }
  return { name: '', avatar: 'fox', isJunior: false };
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
  const [myUid] = useState<string>(() => getOrCreatePlayerId());

  // Firebase external config state
  const [firebaseStatus, setFirebaseStatus] = useState<
    | { state: 'LOADING' }
    | { state: 'READY' }
    | { state: 'CONFIG_ERROR'; reason: string; message: string }
  >({ state: 'LOADING' });

  // Family PIN auth state
  const [authChecking, setAuthChecking] = useState(true);
  const [familyPin, setFamilyPin] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSubmitting, setPinSubmitting] = useState(false);

  const [profile, setProfile] = useState<LocalPlayerProfile>(() => loadStoredProfile());
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
  const [setupTableMode, setSetupTableMode] = useState(false);
  const [setupCategory, setSetupCategory] = useState(MIXED_FAMILY_CATEGORY.name);
  const [setupThemes, setSetupThemes] = useState<string[]>(MIXED_FAMILY_CATEGORY.themes);
  const [deckModalOpen, setDeckModalOpen] = useState(false);

  // Active room real-time state
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get('room');
    if (urlRoom && /^[0-9]{4}$/.test(urlRoom)) return null;
    return sessionStorage.getItem(ACTIVE_ROOM_STORAGE_KEY);
  });

  const [room, setRoom] = useState<RoomData | null>(null);
  const [myPlayer, setMyPlayer] = useState<PlayerData | null>(null);
  const [feedEntries, setFeedEntries] = useState<FeedEntry[]>([]);
  const [pendingGifts, setPendingGifts] = useState<ChaosEvent[]>([]);
  const [muted, setMuted] = useState(false);
  const [isTableAudioDevice, setIsTableAudioDevice] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TABLE_AUDIO_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [heroImgError, setHeroImgError] = useState(false);

  const dealtHandRoundRef = useRef<string>('');
  const dealtBotsRoundRef = useRef<string>('');
  const initialAnnouncementSyncedRoomRef = useRef<string | null>(null);
  const lastSpokenAnnouncementIdRef = useRef<string | null>(null);
  const isTableAudioRef = useRef<boolean>(isTableAudioDevice);
  isTableAudioRef.current = isTableAudioDevice;

  // 1. Load external ./firebase-config.json on boot
  useEffect(() => {
    let active = true;
    initFirebaseFromConfig().then((result) => {
      if (!active) return;
      if (result.ok) {
        setFirebaseStatus({ state: 'READY' });
      } else {
        setFirebaseStatus({
          state: 'CONFIG_ERROR',
          reason: result.reason,
          message: result.message,
        });
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // 2. Check URL ?room=...&pin=... and localStorage PIN on boot
  useEffect(() => {
    let active = true;

    const bootstrapAuth = async () => {
      const params = new URLSearchParams(window.location.search);
      const urlRoom = params.get('room');
      const urlPin = params.get('pin');

      if (urlRoom && /^[0-9]{4}$/.test(urlRoom)) {
        setHomeMode('JOIN');
        setJoinCode(urlRoom);
      }

      const candidatePin = urlPin?.trim() || getStoredFamilyPin();

      if (candidatePin) {
        const res = await authenticateFamilyPin(candidatePin);
        if (!active) return;
        if (res.ok) {
          persistFamilyPin(candidatePin);
          setFamilyPin(candidatePin);
          if (urlPin) {
            // Strip pin from URL bar after automatic login
            const cleanUrl = urlRoom ? `?room=${urlRoom}` : window.location.pathname;
            window.history.replaceState({}, '', cleanUrl);
          }
        } else {
          clearStoredFamilyPin();
          setFamilyPin(null);
          if (urlPin) {
            setPinError('Der Link-Zugangscode ist ungültig oder abgelaufen.');
          }
        }
      }

      if (active) setAuthChecking(false);
    };

    bootstrapAuth();
    return () => {
      active = false;
    };
  }, []);

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

  // 3. Firestore real-time subscriptions when inside a room
  useEffect(() => {
    if (firebaseStatus.state !== 'READY' || !familyPin || !activeRoomCode) {
      setRoom(null);
      setMyPlayer(null);
      setFeedEntries([]);
      setPendingGifts([]);
      return;
    }

    const db = getDb();
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

    const playerPath = `rooms/${activeRoomCode}/players/${myUid}`;
    const unsubPlayer = onSnapshot(
      doc(db, 'rooms', activeRoomCode, 'players', myUid),
      (snap) => {
        setMyPlayer(snap.exists() ? (snap.data() as PlayerData) : null);
      },
      (err) => handleFirestoreError(err, OperationType.GET, playerPath)
    );

    const feedPath = `rooms/${activeRoomCode}/feed`;
    const feedQuery = query(collection(db, 'rooms', activeRoomCode, 'feed'));
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
          .slice(0, 100);
        setFeedEntries(entries);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, feedPath)
    );

    const eventsPath = `rooms/${activeRoomCode}/events`;
    const eventsQuery = query(
      collection(db, 'rooms', activeRoomCode, 'events'),
      where('toUid', '==', myUid)
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
  }, [firebaseStatus.state, familyPin, activeRoomCode, myUid]);

  // 3b. Firestore-driven table audio moderation (only speaks when isTableAudioDevice === true)
  useEffect(() => {
    if (!room) {
      initialAnnouncementSyncedRoomRef.current = null;
      lastSpokenAnnouncementIdRef.current = null;
      return;
    }

    const incomingId = room.latestAnnouncement?.id ?? null;

    // On initial room load / page reload, record existing ID without replaying old announcements
    if (initialAnnouncementSyncedRoomRef.current !== room.code) {
      initialAnnouncementSyncedRoomRef.current = room.code;
      lastSpokenAnnouncementIdRef.current = incomingId;
      return;
    }

    if (incomingId && incomingId !== lastSpokenAnnouncementIdRef.current) {
      lastSpokenAnnouncementIdRef.current = incomingId;
      if (isTableAudioRef.current && room.latestAnnouncement?.text) {
        speakModerator(room.latestAnnouncement.text);
      }
    }
  }, [room?.code, room?.latestAnnouncement?.id, room?.latestAnnouncement?.text]);

  // 4. Deal player hand and bot hands when a round starts (guarded against rapid duplicate snapshots)
  useEffect(() => {
    if (!room) {
      dealtHandRoundRef.current = '';
      dealtBotsRoundRef.current = '';
      return;
    }
    if (room.status !== 'COUNTDOWN' && room.status !== 'PLAYING') return;
    if (room.roundNumber <= 0) return;

    const handKey = `${room.code}-${room.roundNumber}-${myUid}`;
    if (
      myPlayer &&
      myPlayer.roundDealt < room.roundNumber &&
      dealtHandRoundRef.current !== handKey
    ) {
      dealtHandRoundRef.current = handKey;
      dealHandForParticipant(
        room.code,
        myUid,
        room.roundNumber,
        myPlayer.isJunior,
        room.ruleVariant
      );
    }

    const botsKey = `${room.code}-${room.roundNumber}-bots`;
    if (room.hostUid === myUid && dealtBotsRoundRef.current !== botsKey) {
      dealtBotsRoundRef.current = botsKey;
      dealAllBotsForRound(room);
    }
  }, [room, myPlayer, myUid]);

  // 5. Host safety net: finalize ROUND_END 1.2s after penultimate/final player discards last card
  useEffect(() => {
    if (!room || room.hostUid !== myUid || room.status !== 'PLAYING') return;
    if (room.playerOrder.length < 2) return;

    const remainingPlayers = room.playerOrder.filter(
      (uid) => !room.winnersOrder.includes(uid)
    );
    if (remainingPlayers.length > 1) return;

    const roundToFinish = room.roundNumber;
    const roomCode = room.code;
    const timerId = window.setTimeout(() => {
      finalizeRoundEndAfterDelay(roomCode, roundToFinish);
    }, ROUND_END_DELAY_MS);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    room?.code,
    room?.hostUid,
    room?.status,
    room?.roundNumber,
    room?.playerOrder,
    room?.winnersOrder,
    myUid,
  ]);

  // 6. Host checks victory target score during ROUND_END
  useEffect(() => {
    if (!room) return;
    if (room.status === 'ROUND_END' && room.hostUid === myUid) {
      hostCheckGameOverOrNextRound(room, 'FINISH_CHECK');
    }
  }, [room, myUid]);

  // 6. Host runs KI-Bots during active round
  const isHost = Boolean(room && room.hostUid === myUid);
  useBotRunner({
    room,
    isHost,
    familyPin: (familyPin ?? '').trim() || getStoredFamilyPin(),
    onBotPlayedWord: () => {
      if (isTableAudioDevice && !muted) {
        playSuccessChime(false);
      }
    },
  });

  const handleToggleTableAudio = useCallback(() => {
    const next = !isTableAudioDevice;
    try {
      localStorage.setItem(TABLE_AUDIO_STORAGE_KEY, String(next));
    } catch {
      // ignore storage failure
    }
    isTableAudioRef.current = next;
    setIsTableAudioDevice(next);
    if (next) {
      lastSpokenAnnouncementIdRef.current = room?.latestAnnouncement?.id ?? null;
      unlockAndTestAudio();
    } else {
      stopModeratorSpeech();
    }
  }, [isTableAudioDevice, room?.latestAnnouncement?.id]);

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

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pinSubmitting) return;
    setPinSubmitting(true);
    setPinError(null);
    const res = await authenticateFamilyPin(pinInput);
    if (res.ok) {
      const cleanPin = pinInput.trim();
      persistFamilyPin(cleanPin);
      setFamilyPin(cleanPin);
      setPinInput('');
    } else {
      setPinError(res.error);
    }
    setPinSubmitting(false);
  };

  const handleLogout = () => {
    stopModeratorSpeech();
    initialAnnouncementSyncedRoomRef.current = null;
    lastSpokenAnnouncementIdRef.current = null;
    clearStoredFamilyPin();
    sessionStorage.removeItem(ACTIVE_ROOM_STORAGE_KEY);
    setFamilyPin(null);
    setActiveRoomCode(null);
    setRoom(null);
    setMyPlayer(null);
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyAction || firebaseStatus.state !== 'READY') return;
    setBusyAction(true);
    setJoinError(null);
    try {
      const code = await createRoom(myUid, profile, {
        maxPlayers: setupMaxPlayers,
        turnMode: setupTurnMode,
        ruleVariant: setupRuleVariant,
        penaltyEnabled: setupPenaltyEnabled,
        roundDurationSec: setupDuration,
        selectedCategory: setupCategory,
        deckThemes: setupThemes,
        tableDisplayActive: setupTableMode,
      });
      sessionStorage.setItem(ACTIVE_ROOM_STORAGE_KEY, code);
      setActiveRoomCode(code);
    } catch (err) {
      setJoinError(
        err instanceof Error ? err.message : 'Raum konnte nicht erstellt werden.'
      );
    } finally {
      setBusyAction(false);
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyAction || firebaseStatus.state !== 'READY') return;
    setBusyAction(true);
    setJoinError(null);
    try {
      const result = await joinRoom(joinCode, myUid, profile);
      if (!result.ok) {
        setJoinError(result.error);
      } else {
        sessionStorage.setItem(ACTIVE_ROOM_STORAGE_KEY, result.code);
        setActiveRoomCode(result.code);
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Beitritt fehlgeschlagen.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleLeaveRoom = () => {
    stopModeratorSpeech();
    initialAnnouncementSyncedRoomRef.current = null;
    lastSpokenAnnouncementIdRef.current = null;
    sessionStorage.removeItem(ACTIVE_ROOM_STORAGE_KEY);
    setActiveRoomCode(null);
    setRoom(null);
    setMyPlayer(null);
  };

  // Loading state
  if (firebaseStatus.state === 'LOADING' || authChecking) {
    return (
      <div className="min-h-screen bg-[#0F1117] flex items-center justify-center text-slate-300">
        <Loader2 className="w-8 h-8 text-amber-400 animate-spin mr-3" />
        <span>WortBlitz wird geladen…</span>
      </div>
    );
  }

  // Firebase Config Placeholder / Missing Screen
  if (firebaseStatus.state === 'CONFIG_ERROR') {
    return (
      <div className="min-h-screen bg-[#0F1117] text-slate-100 flex items-center justify-center p-5">
        <div className="max-w-lg w-full rounded-3xl bg-[#1C202E] border border-amber-400/40 p-6 sm:p-8 space-y-4">
          <div className="flex items-center gap-3 text-amber-400">
            <AlertTriangle className="w-7 h-7 shrink-0" />
            <h1 className="text-xl font-display font-bold text-white">
              Firebase-Konfiguration erforderlich
            </h1>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">
            {firebaseStatus.message}
          </p>
          <div className="p-4 rounded-2xl bg-[#0F1117] border border-white/10 text-xs text-slate-300 space-y-2">
            <p className="font-semibold text-white">So richtest du Firebase ein:</p>
            <ol className="list-decimal list-inside space-y-1 text-slate-400">
              <li>
                Öffne die Datei <code className="text-amber-300">firebase-config.json</code> auf deinem Webserver (bzw. <code className="text-amber-300">public/firebase-config.json</code> vor dem Build).
              </li>
              <li>
                Ersetze alle Platzhalter (<code className="text-amber-300">DEIN_FIREBASE_API_KEY</code>, <code className="text-amber-300">DEIN_PROJEKT_ID</code> usw.) mit den Werten deiner Firebase-Web-App.
              </li>
              <li>Lade diese Seite anschließend neu.</li>
            </ol>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full min-h-[48px] rounded-2xl bg-amber-400 text-slate-950 font-display font-bold hover:bg-amber-300 transition-colors"
          >
            Erneut prüfen
          </button>
        </div>
      </div>
    );
  }

  // Family Password Login Gate
  if (!familyPin) {
    return (
      <div className="min-h-screen bg-[#0F1117] text-slate-100 flex items-center justify-center p-5">
        <div className="max-w-md w-full rounded-3xl bg-[#1C202E] border border-white/10 p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-400/15 border border-amber-400/30 text-amber-400 mb-1">
              <Lock className="w-7 h-7" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-display font-extrabold text-white">
              WortBlitz – Familien-Zugang
            </h1>
            <p className="text-sm text-slate-400">
              Bitte gib euer gemeinsames Familien-Passwort ein, um den Spielbereich und KI-Schiedsrichter freizuschalten.
            </p>
          </div>

          <form onSubmit={handlePinSubmit} className="space-y-4">
            <div className="relative">
              <KeyRound className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showPin ? 'text' : 'password'}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="Familien-Passwort"
                autoFocus
                className="w-full min-h-[52px] pl-12 pr-12 rounded-2xl bg-[#0F1117] border border-white/15 text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
              />
              <button
                type="button"
                onClick={() => setShowPin((s) => !s)}
                aria-label={showPin ? 'Passwort verbergen' : 'Passwort anzeigen'}
                className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-white"
              >
                {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {pinError && <p className="text-xs text-rose-400">{pinError}</p>}

            <button
              type="submit"
              disabled={pinSubmitting || !pinInput.trim()}
              className="w-full min-h-[52px] px-6 rounded-2xl bg-amber-400 text-slate-950 font-display font-bold text-base hover:bg-amber-300 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
            >
              {pinSubmitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <ArrowRight className="w-5 h-5" />
              )}
              <span>Freischalten</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Active Room Routing
  if (activeRoomCode && room) {
    if (room.status === 'LOBBY') {
      return (
        <LobbyView
          room={room}
          myUid={myUid}
          familyPin={familyPin}
          myPlayer={myPlayer}
          profile={profile}
          customDecks={customDecks}
          isTableAudioDevice={isTableAudioDevice}
          onToggleTableAudio={handleToggleTableAudio}
          onSaveCustomDeck={handleSaveCustomDeck}
          onDeleteCustomDeck={handleDeleteCustomDeck}
          onUpdateHostSettings={(s) => updateHostLobbySettings(room.code, s)}
          onAddBot={(difficulty) => addBotToLobby(room, difficulty)}
          onRemoveBot={(botUid) => removeBotFromLobby(room, botUid)}
          onUpdateBotDifficulty={(botUid, diff) =>
            updateBotDifficultyInLobby(room.code, botUid, diff)
          }
          onUpdateProfileInLobby={async (next) => {
            setProfile(next);
            await updatePlayerProfileInLobby(room.code, myUid, next);
          }}
          onSubmitSecretTheme={(themeText) =>
            submitSecretLobbyTheme(
              room.code,
              room.hostUid,
              myUid,
              themeText,
              myPlayer?.secretThemeCount ?? 0
            )
          }
          onStartMatch={() => startMatch(room, myUid)}
          onLeaveRoom={handleLeaveRoom}
          onLogout={handleLogout}
        />
      );
    }

    if (room.status === 'COUNTDOWN' || room.status === 'PLAYING') {
      if (isHost && room.tableDisplayActive) {
        return (
          <TableDisplayView
            room={room}
            familyPin={familyPin}
            feedEntries={feedEntries}
            muted={muted}
            isTableAudioDevice={isTableAudioDevice}
            onToggleTableAudio={handleToggleTableAudio}
            onToggleMute={() => setMuted((m) => !m)}
            onCountdownFinished={() => transitionCountdownToPlaying(room)}
            onThemeTimedOut={() => advanceTheme(room, 'Zeit um – nächstes Thema!')}
            onTurnTimedOut={() =>
              advanceTurnInTurnBasedMode(room, 'Zugzeit abgelaufen – nächster Spieler!')
            }
            onFinishRoundManually={() => hostFinishRoundManually(room)}
            onLeaveRoom={handleLeaveRoom}
          />
        );
      }

      if (myPlayer) {
        return (
          <GameView
            room={room}
            myUid={myUid}
            familyPin={(familyPin ?? '').trim() || getStoredFamilyPin()}
            myPlayer={myPlayer}
            feedEntries={feedEntries}
            pendingGifts={pendingGifts}
            muted={muted}
            isTableAudioDevice={isTableAudioDevice}
            onToggleTableAudio={handleToggleTableAudio}
            onToggleMute={() => setMuted((m) => !m)}
            onCountdownFinished={() => transitionCountdownToPlaying(room)}
            onThemeTimedOut={() => advanceTheme(room, 'Zeit um – nächstes Thema!')}
            onTurnTimedOut={() =>
              advanceTurnInTurnBasedMode(room, 'Zugzeit abgelaufen – nächster Spieler!')
            }
            onAcceptWord={(params) =>
              recordAcceptedWord({ room, player: myPlayer, ...params })
            }
            onRejectWord={(params) =>
              recordRejectedWord({ room, player: myPlayer, ...params })
            }
            onSwapCard={(cardIndex) =>
              swapSingleLetterCard(room, myPlayer, cardIndex)
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
            onSendBlock={(targetUid, targetName) =>
              sendChaosBlock({ room, sender: myPlayer, targetUid, targetName })
            }
            onResolveBlock={(event, useShield) =>
              resolveChaosBlockEvent({
                room,
                player: myPlayer,
                eventId: event.id,
                useShield,
              })
            }
            onFinishRoundManually={() => hostFinishRoundManually(room)}
            onLogout={handleLogout}
          />
        );
      }
    }

    if (room.status === 'ROUND_END' && (myPlayer || (isHost && room.tableDisplayActive))) {
      return (
        <RoundEndView
          room={room}
          myUid={myUid}
          myPlayer={myPlayer}
          onClaimMyPoints={async () => {
            if (myPlayer) await claimMyRoundPoints(room, myPlayer);
          }}
          onHostClaimBotPoints={() => hostClaimBotRoundPoints(room)}
          onNextRoundOrFinish={() => hostCheckGameOverOrNextRound(room, 'NEXT_ROUND')}
        />
      );
    }

    if (room.status === 'GAME_OVER') {
      return (
        <VictoryView
          room={room}
          myUid={myUid}
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

  // Home / Room Creation & Join Screen
  return (
    <div className="min-h-screen bg-[#0F1117] text-slate-100">
      <header className="border-b border-white/10 bg-[#0F1117]/90 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <Zap className="w-6 h-6 text-amber-400 fill-amber-400" />
            <span className="text-xl font-display font-extrabold tracking-tight text-white">
              WortBlitz
            </span>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="min-h-[40px] px-3.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Abmelden</span>
          </button>
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
              <span>2–8 Spieler &amp; KI-Bots</span>
              <span aria-hidden="true">·</span>
              <span>Tablet-Tischmodus</span>
              <span aria-hidden="true">·</span>
              <span>Junior-Fairness</span>
            </div>
          </div>

          <div className="rounded-3xl overflow-hidden border border-white/10 bg-[#1C202E] aspect-[4/3] sm:aspect-[16/10] relative">
            {!heroImgError ? (
              <img
                src="./src/assets/images/wortblitz_cards_hero_1795193543971.jpg"
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
            <div className="space-y-5">
              {/* Mode Toggle */}
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

              {/* Player Profile (hidden when host chooses Table Display Mode) */}
              {!(homeMode === 'CREATE' && setupTableMode) && (
                <div className="space-y-3 p-4 rounded-2xl bg-[#161923] border border-white/10">
                  <div className="flex items-center justify-between gap-2">
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
                    placeholder="Dein Spitzname (z. B. Mama, Tim…)"
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
              )}

              {homeMode === 'CREATE' ? (
                <form onSubmit={handleCreateRoom} className="space-y-3.5">
                  {/* Tablet / Tisch-Modus Switch */}
                  <label className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-sky-500/10 border border-sky-400/30 cursor-pointer">
                    <div className="flex items-start gap-2.5">
                      <Monitor className="w-5 h-5 text-sky-300 shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-bold text-white">
                          Dieses Gerät als Tisch-Bildschirm nutzen (ohne eigene Karten)
                        </div>
                        <div className="text-[11px] text-slate-300">
                          Ideal für ein Tablet in der Tischmitte mit großem Thema &amp; zentraler Sprachausgabe.
                        </div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={setupTableMode}
                      onChange={(e) => setSetupTableMode(e.target.checked)}
                      className="w-5 h-5 accent-sky-400 shrink-0"
                    />
                  </label>

                  {/* Theme Deck Picker */}
                  <div className="p-3.5 rounded-2xl bg-[#161923] border border-white/10 flex items-center justify-between gap-3">
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
                    disabled={
                      busyAction || (!setupTableMode && !profile.name.trim())
                    }
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
                    disabled={
                      busyAction || joinCode.length !== 4 || !profile.name.trim()
                    }
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
          </div>
        </section>
      </main>

      <DeckBuilderModal
        isOpen={deckModalOpen}
        onClose={() => setDeckModalOpen(false)}
        familyPin={familyPin}
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
