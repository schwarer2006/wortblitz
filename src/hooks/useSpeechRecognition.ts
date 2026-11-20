import { useCallback, useEffect, useRef, useState } from 'react';

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
    shouldKeepAliveRef.current = mode === 'CONTINUOUS';

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
    }

    const recognition = new Ctor();
    recognition.lang = 'de-DE';
    recognition.continuous = mode === 'CONTINUOUS';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setMicError(null);
    };

    recognition.onresult = (event) => {
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
        setMicError('Mikrofon-Zugriff wurde verweigert. Bitte Berechtigung im Browser freigeben.');
        setIsListening(false);
      } else if (event.error === 'no-speech' || event.error === 'aborted') {
        // Normal silence / manual stop
      } else {
        setMicError(`Mikrofon-Hinweis: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimText('');
      if (shouldKeepAliveRef.current && enabled && mode === 'CONTINUOUS') {
        setTimeout(() => {
          if (shouldKeepAliveRef.current) {
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
  }, [enabled, mode]);

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
