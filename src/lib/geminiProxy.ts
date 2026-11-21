export const GEMINI_MODEL = 'gemini-3.8-flash';

interface GeminiProxyResponse {
  ok?: boolean;
  valid?: boolean;
  authenticated?: boolean;
  text?: string;
  error?: string;
  response?: { text?: string };
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

class GeminiProxyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiProxyError';
  }
}

function extractJsonString(raw: string): string {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  return trimmed;
}

export async function authenticateFamilyPin(
  pin: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cleanPin = pin.trim();
  if (!cleanPin) {
    return { ok: false, error: 'Bitte gib das Familien-Passwort ein.' };
  }

  try {
    const res = await fetch('./gemini.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'auth', pin: cleanPin }),
    });

    const rawText = await res.text();
    let data: GeminiProxyResponse = {};
    try {
      data = JSON.parse(rawText) as GeminiProxyResponse;
    } catch {
      return {
        ok: false,
        error: 'Der Zugangsserver ist gerade nicht erreichbar. Bitte versuche es gleich erneut.',
      };
    }

    if (
      res.status === 401 ||
      res.status === 403 ||
      data.ok === false ||
      data.valid === false ||
      data.authenticated === false
    ) {
      return {
        ok: false,
        error: 'Falsches Familien-Passwort.',
      };
    }

    if (!res.ok || data.error) {
      return {
        ok: false,
        error: 'Passwort-Prüfung gerade nicht verfügbar. Bitte erneut versuchen.',
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      error: 'Verbindung zum Familien-Server fehlgeschlagen. Bitte Netzwerk prüfen.',
    };
  }
}

export async function callGeminiProxy(
  pin: string,
  prompt: string,
  jsonMode = true,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 8000;
  const controller = new AbortController();
  const externalSignal = options?.signal;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort);
    }
  }

  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch('./gemini.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        pin,
        prompt,
        jsonMode,
        model: GEMINI_MODEL,
      }),
    });

    const rawBody = await res.text();
    let data: GeminiProxyResponse;
    try {
      data = JSON.parse(rawBody) as GeminiProxyResponse;
    } catch (parseErr) {
      console.warn('Gemini-Proxy lieferte kein gültiges JSON:', parseErr);
      throw new GeminiProxyError(
        'Der KI-Schiedsrichter ist gerade kurz nicht erreichbar.'
      );
    }

    if (!res.ok || data.error) {
      console.warn('Gemini-Proxy meldete einen technischen Fehler:', data.error ?? res.status);
      throw new GeminiProxyError(
        'Der KI-Schiedsrichter ist gerade kurz überlastet.'
      );
    }

    const text =
      data.text ??
      data.response?.text ??
      data.candidates?.[0]?.content?.parts?.[0]?.text ??
      '';

    if (!text.trim()) {
      throw new GeminiProxyError('Der KI-Schiedsrichter hat nicht rechtzeitig geantwortet.');
    }

    return text;
  } catch (err) {
    if (err instanceof GeminiProxyError) {
      throw err;
    }
    console.warn('Gemini-Proxy Verbindungsfehler:', err);
    throw new GeminiProxyError(
      'KI-Schiedsrichter gerade nicht erreichbar – bitte erneut versuchen.'
    );
  } finally {
    window.clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export async function judgeWordViaProxy(params: {
  pin: string;
  word: string;
  theme: string;
  isJunior: boolean;
}): Promise<
  | { ok: true; valid: boolean; reason: string }
  | { ok: false; reason: string }
> {
  const { pin, word, theme, isJunior } = params;

  const juniorHint = isJunior
    ? 'WICHTIG: Der Spieler spielt in der JUNIOR-/Einsteiger-Stufe (Kind/Anfänger). Sei sehr wohlwollend, großzügig und freundlich! Akzeptiere auch einfache, kindgerechte oder kreativ-assoziative Zusammenhänge.'
    : 'Der Spieler spielt in der Standard-Stufe. Sei fair, freundlich und offen für kreative, aber nachvollziehbare Assoziationen.';

  const prompt = [
    `Du bist der gut gelaunte, faire KI-Schiedsrichter im deutschen Familien-Wortspiel "WortBlitz".`,
    `Aktuelles Thema: "${theme}"`,
    `Genannter Begriff: "${word}"`,
    juniorHint,
    `Prüfe:`,
    `1. Ist "${word}" ein echtes deutsches Wort oder ein bekannter Eigenname/Begriff (kein Kauderwelsch)?`,
    `2. Passt der Begriff logisch, thematisch oder kreativ zum Thema "${theme}"?`,
    `Antworte ausschließlich als gültiges JSON-Objekt im Format: {"valid": boolean, "reason": string}`,
    `"reason" muss eine kurze, knackige, humorvolle Begründung auf Deutsch sein (maximal 14 Wörter).`,
  ].join('\n');

  try {
    const text = await callGeminiProxy(pin, prompt, true, { timeoutMs: 8000 });
    const parsed = JSON.parse(extractJsonString(text)) as {
      valid?: boolean;
      reason?: string;
    };

    const valid = Boolean(parsed.valid);
    return {
      ok: true,
      valid,
      reason:
        typeof parsed.reason === 'string' && parsed.reason.trim()
          ? parsed.reason.trim()
          : valid
            ? 'Passt perfekt zum Thema!'
            : 'Das passt leider nicht so richtig zum Thema.',
    };
  } catch (err) {
    console.warn('Technische Ausnahme bei Wortprüfung:', err);
    return {
      ok: false,
      reason:
        'KI-Prüfung gerade nicht erreichbar – bitte nochmal senden oder Karte antippen.',
    };
  }
}

export async function generateThemesViaProxy(
  pin: string,
  keyword: string
): Promise<string[]> {
  const prompt = [
    `Erstelle genau 30 abwechslungsreiche, kreative, familientaugliche Einzelthemen auf Deutsch für das Wortspiel "WortBlitz" passend zum Stichwort: "${keyword}".`,
    `Regeln:`,
    `- Jedes Thema soll kurz und sofort verständlich sein (2 bis 6 Wörter), z. B. "Dinge unter dem Tannenbaum" oder "Typische 80er-Frisuren".`,
    `- Zu jedem Thema müssen einem spontan viele verschiedene deutsche Wörter mit unterschiedlichen Anfangsbuchstaben einfallen.`,
    `- Keine Duplikate, keine Nummerierung.`,
    `Antworte ausschließlich als JSON-Array aus genau 30 Strings, z. B. ["Thema 1", "Thema 2", ...].`,
  ].join('\n');

  try {
    const text = await callGeminiProxy(pin, prompt, true, { timeoutMs: 12000 });
    const parsed = JSON.parse(extractJsonString(text)) as unknown;

    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { themes?: unknown }).themes)
        ? (parsed as { themes: unknown[] }).themes
        : [];

    const themes = list
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length >= 2)
      .slice(0, 30);

    if (themes.length === 0) {
      throw new GeminiProxyError(
        'Die KI konnte zu diesem Stichwort leider keine Themen erstellen. Bitte ein anderes Wort probieren.'
      );
    }

    return themes;
  } catch (err) {
    if (err instanceof GeminiProxyError) {
      throw err;
    }
    console.warn('Technische Ausnahme im KI-Themengenerator:', err);
    throw new GeminiProxyError(
      'Der KI-Themengenerator ist gerade nicht erreichbar. Bitte versuche es gleich nochmal.'
    );
  }
}

export async function generateBotWordsViaProxy(params: {
  pin: string;
  theme: string;
  cards: string[];
  usedWords: string[];
  botName: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<Array<{ word: string; letter: string }>> {
  const { pin, theme, cards, usedWords, timeoutMs = 3500, signal } = params;
  if (cards.length === 0) return [];

  const uniqueLetters = Array.from(new Set(cards));
  const prompt = [
    `Du spielst als KI-Mitspieler im deutschen Wortspiel "WortBlitz".`,
    `Aktuelles Thema: "${theme}"`,
    `Verfügbare Anfangsbuchstaben auf deiner Hand: ${uniqueLetters.join(', ')} (wobei "JOKER" für jeden beliebigen Buchstaben A-Z steht).`,
    usedWords.length > 0
      ? `Bereits gesperrte Wörter (NICHT verwenden): ${usedWords.join(', ')}`
      : `Noch keine Wörter gesperrt.`,
    `Nenne 1 oder 2 einfache, passende, eindeutige deutsche Substantive oder Begriffe zum Thema "${theme}", die jeweils mit einem der verfügbaren Hand-Buchstaben beginnen.`,
    `Antworte ausschließlich als JSON-Array von Objekten im Format: [{"word": "Beispiel", "letter": "B"}]. Wenn "JOKER" genutzt wird, setze "letter": "JOKER".`,
  ].join('\n');

  try {
    const text = await callGeminiProxy(pin, prompt, true, { timeoutMs, signal });
    const parsed = JSON.parse(extractJsonString(text)) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { words?: unknown }).words)
        ? (parsed as { words: unknown[] }).words
        : [];

    return list
      .filter(
        (item): item is { word: string; letter: string } =>
          Boolean(item) &&
          typeof (item as { word?: unknown }).word === 'string' &&
          typeof (item as { letter?: unknown }).letter === 'string'
      )
      .map((item) => ({
        word: item.word.trim(),
        letter: item.letter.trim().toUpperCase(),
      }))
      .filter((item) => item.word.length >= 2)
      .slice(0, 2);
  } catch {
    return [];
  }
}
