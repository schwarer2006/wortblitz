let audioCtx: AudioContext | null = null;
let cachedVoices: SpeechSynthesisVoice[] = [];
let voicesListenerRegistered = false;
let pendingSpeakTimeoutId: number | null = null;

interface TtsRecognitionBridge {
  onStart: () => void;
  onEnd: () => void;
}

let activeBridge: TtsRecognitionBridge | null = null;

export function registerTtsRecognitionBridge(
  bridge: TtsRecognitionBridge | null
): void {
  activeBridge = bridge;
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function refreshVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  try {
    const list = window.speechSynthesis.getVoices();
    if (list && list.length > 0) {
      cachedVoices = list;
    }
    if (!voicesListenerRegistered) {
      voicesListenerRegistered = true;
      window.speechSynthesis.onvoiceschanged = () => {
        try {
          const updated = window.speechSynthesis.getVoices();
          if (updated && updated.length > 0) {
            cachedVoices = updated;
          }
        } catch {
          // ignore voice reload errors
        }
      };
    }
  } catch {
    // ignore
  }
  return cachedVoices;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  refreshVoices();
}

function selectPreferredGermanVoice(): SpeechSynthesisVoice | null {
  const voices = refreshVoices();
  if (voices.length === 0) return null;

  const germanVoices = voices.filter((v) =>
    v.lang.toLowerCase().startsWith('de')
  );
  const pool = germanVoices.length > 0 ? germanVoices : voices;

  // 1. Google Deutsch
  const googleDe = pool.find((v) =>
    v.name.toLowerCase().includes('google deutsch')
  );
  if (googleDe) return googleDe;

  // 2. Natural or Online German voice
  const naturalOrOnline = germanVoices.find((v) =>
    /(natural|online)/i.test(v.name)
  );
  if (naturalOrOnline) return naturalOrOnline;

  // 3. Anna or Markus
  const annaOrMarkus = germanVoices.find((v) =>
    /(anna|markus)/i.test(v.name)
  );
  if (annaOrMarkus) return annaOrMarkus;

  // 4. Any German voice (or browser fallback if none marked de)
  return germanVoices[0] ?? null;
}

function createConfiguredUtterance(text: string): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'de-DE';
  utterance.pitch = 1.08;
  utterance.rate = 1.06;

  const preferred = selectPreferredGermanVoice();
  if (preferred) {
    utterance.voice = preferred;
  }

  let finished = false;
  const finishOnce = () => {
    if (finished) return;
    finished = true;
    activeBridge?.onEnd();
  };

  utterance.onstart = () => {
    activeBridge?.onStart();
  };
  utterance.onend = finishOnce;
  utterance.onerror = finishOnce;

  return utterance;
}

export function playSuccessChime(muted = false) {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99];
  notes.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now + idx * 0.06);
    gain.gain.setValueAtTime(0.001, now + idx * 0.06);
    gain.gain.exponentialRampToValueAtTime(0.14, now + idx * 0.06 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + idx * 0.06);
    osc.stop(now + idx * 0.06 + 0.24);
  });
}

export function playErrorBuzz(muted = false) {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(190, now);
  osc.frequency.exponentialRampToValueAtTime(125, now + 0.22);
  gain.gain.setValueAtTime(0.1, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.26);
}

export function playCardTap(muted = false) {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(420, now);
  osc.frequency.exponentialRampToValueAtTime(220, now + 0.06);
  gain.gain.setValueAtTime(0.08, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.08);
}

export function playCountdownBeep(isFinal = false, muted = false) {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(isFinal ? 880 : 480, now);
  gain.gain.setValueAtTime(0.1, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + (isFinal ? 0.28 : 0.12));
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + (isFinal ? 0.3 : 0.14));
}

export function playActionSound(muted = false) {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(340, now);
  osc.frequency.exponentialRampToValueAtTime(880, now + 0.18);
  gain.gain.setValueAtTime(0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.24);
}

export function playVictoryFanfare(muted = false) {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const melody = [523.25, 659.25, 783.99, 1046.5];
  melody.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const start = now + idx * 0.11;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.38);
  });
}

export function unlockAndTestAudio(
  welcomeText = "Tisch-Ton ist auf diesem Gerät aktiv! Jetzt geht's rund!"
) {
  getAudioContext();
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  if (pendingSpeakTimeoutId !== null) {
    window.clearTimeout(pendingSpeakTimeoutId);
    pendingSpeakTimeoutId = null;
  }

  console.log('[Moderator]:', welcomeText);
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    const utterance = createConfiguredUtterance(welcomeText);
    window.speechSynthesis.speak(utterance);
  } catch {
    // Speech synthesis unavailable in current context
  }
}

export function speakModerator(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const clean = text.trim();
  if (!clean) return;

  console.log('[Moderator]:', clean);

  try {
    if (pendingSpeakTimeoutId !== null) {
      window.clearTimeout(pendingSpeakTimeoutId);
      pendingSpeakTimeoutId = null;
    }

    window.speechSynthesis.cancel();
    pendingSpeakTimeoutId = window.setTimeout(() => {
      pendingSpeakTimeoutId = null;
      try {
        window.speechSynthesis.resume();
        const utterance = createConfiguredUtterance(clean);
        window.speechSynthesis.speak(utterance);
      } catch {
        // Speech synthesis unavailable in current context
      }
    }, 50);
  } catch {
    // Speech synthesis unavailable in current context
  }
}

export function stopModeratorSpeech() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  if (pendingSpeakTimeoutId !== null) {
    window.clearTimeout(pendingSpeakTimeoutId);
    pendingSpeakTimeoutId = null;
  }
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
  activeBridge?.onEnd();
}
