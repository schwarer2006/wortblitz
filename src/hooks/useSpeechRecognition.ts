import { useCallback, useEffect, useRef, useState } from 'react';
import { registerTtsRecognitionBridge } from '../lib/soundAndSpeech';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export type MicMode = 'CONTINUOUS' | 'PUSH_TO_TALK';

interface UseSpeechRecognitionOptions {
  enabled: boolean;
  mode: MicMode;
  onFinalTranscript: (text: string) => void;
}

export function useSpeechRecognition({
  enabled,
  mode,
  onFinalTranscript,
}: UseSpeechRecognitionOptions) {
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [micError, setMicError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldKeepAliveRef = useRef(false);
  const pausedByTtsRef = useRef(false);
  const resumeTimerRef = useRef<number | null>(null);

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const modeRef = useRef(mode);
  modeRef.current = mode;

  const onFinalRef = useRef(onFinalTranscript);
  onFinalRef.current = onFinalTranscript;

  useEffect(() => {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
    setIsSupported(Boolean(Ctor));
  }, []);

  const stopListening = useCallback(() => {
    shouldKeepAliveRef.current = false;
    pausedByTtsRef.current = false;
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
    setInterimText('');
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore stop errors
      }
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!Ctor) {
      setMicError('Spracherkennung wird in diesem Browser leider nicht unterstützt.');
      return;
    }

    setMicError(null);
    shouldKeepAliveRef.current = modeRef.current === 'CONTINUOUS';

    if (pausedByTtsRef.current) {
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
    }

    const recognition = new Ctor();
    recognition.lang = 'de-DE';
    recognition.continuous = modeRef.current === 'CONTINUOUS';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setMicError(null);
    };

    recognition.onresult = (event) => {
      if (pausedByTtsRef.current) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const transcript = res[0]?.transcript?.trim() ?? '';
        if (!transcript) continue;
        if (res.isFinal) {
          setInterimText('');
          onFinalRef.current(transcript);
        } else {
          interim = transcript;
        }
      }
      if (interim) {
        setInterimText(interim);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        shouldKeepAliveRef.current = false;
        setMicError(
          'Mikrofon-Zugriff wurde verweigert. Bitte Berechtigung im Browser freigeben.'
        );
        setIsListening(false);
      } else if (event.error === 'no-speech' || event.error === 'aborted') {
        // Normal silence / manual or TTS pause stop
      } else {
        setMicError(`Mikrofon-Hinweis: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimText('');
      if (
        !pausedByTtsRef.current &&
        shouldKeepAliveRef.current &&
        enabledRef.current &&
        modeRef.current === 'CONTINUOUS'
      ) {
        window.setTimeout(() => {
          if (
            !pausedByTtsRef.current &&
            shouldKeepAliveRef.current &&
            enabledRef.current &&
            modeRef.current === 'CONTINUOUS'
          ) {
            try {
              recognition.start();
            } catch {
              // ignore restart collision
            }
          }
        }, 250);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // already started
    }
  }, []);

  // Register TTS pause/resume bridge so continuous listening pauses during moderator speech
  useEffect(() => {
    registerTtsRecognitionBridge({
      onStart: () => {
        if (modeRef.current !== 'CONTINUOUS' || !shouldKeepAliveRef.current) return;
        pausedByTtsRef.current = true;
        if (resumeTimerRef.current !== null) {
          window.clearTimeout(resumeTimerRef.current);
          resumeTimerRef.current = null;
        }
        if (recognitionRef.current) {
          try {
            recognitionRef.current.stop();
          } catch {
            // ignore
          }
        }
      },
      onEnd: () => {
        if (!pausedByTtsRef.current) return;
        pausedByTtsRef.current = false;
        if (
          enabledRef.current &&
          modeRef.current === 'CONTINUOUS' &&
          shouldKeepAliveRef.current
        ) {
          resumeTimerRef.current = window.setTimeout(() => {
            resumeTimerRef.current = null;
            if (
              !pausedByTtsRef.current &&
              enabledRef.current &&
              modeRef.current === 'CONTINUOUS' &&
              shouldKeepAliveRef.current
            ) {
              startListening();
            }
          }, 150);
        }
      },
    });

    return () => {
      registerTtsRecognitionBridge(null);
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    };
  }, [startListening]);

  useEffect(() => {
    if (!enabled) {
      stopListening();
      return;
    }
    if (mode === 'CONTINUOUS' && isSupported) {
      startListening();
    } else if (mode === 'PUSH_TO_TALK') {
      stopListening();
    }
    return () => {
      shouldKeepAliveRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }
    };
  }, [enabled, mode, isSupported, startListening, stopListening]);

  return {
    isSupported,
    isListening,
    interimText,
    micError,
    startListening,
    stopListening,
  };
}
