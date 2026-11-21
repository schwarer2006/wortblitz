export const GEMINI_MODEL = 'gemini-3.8-flash';
export const GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash';
export const FAMILY_PIN_STORAGE_KEY = 'wortblitz_family_pin_v1';

export function getStoredFamilyPin(): string {
  try {
    const fromSession = sessionStorage.getItem(FAMILY_PIN_STORAGE_KEY)?.trim();
    if (fromSession) return fromSession;
  } catch {
    // ignore sessionStorage errors
  }
  try {
    const fromLocal = localStorage.getItem(FAMILY_PIN_STORAGE_KEY)?.trim();
    if (fromLocal) {
      try {
        sessionStorage.setItem(FAMILY_PIN_STORAGE_KEY, fromLocal);
      } catch {
        // ignore
      }
      return fromLocal;
    }
  } catch {
    // ignore localStorage errors
  }
  return '';
}

export function persistFamilyPin(pin: string): void {
  const clean = pin.trim();
  if (!clean) return;
  try {
    sessionStorage.setItem(FAMILY_PIN_STORAGE_KEY, clean);
  } catch {
    // ignore
  }
  try {
    localStorage.setItem(FAMILY_PIN_STORAGE_KEY, clean);
  } catch {
    // ignore
  }
}

export function clearStoredFamilyPin(): void {
  try {
    sessionStorage.removeItem(FAMILY_PIN_STORAGE_KEY);
  } catch {
    // ignore
  }
  try {
    localStorage.removeItem(FAMILY_PIN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

interface GeminiProxyPart {
  text?: string;
  thought?: boolean;
}

interface GeminiProxyResponse {
  ok?: boolean;
  valid?: boolean;
  authenticated?: boolean;
  text?: string | Record<string, unknown>;
  error?: string;
  response?: { text?: string | Record<string, unknown> };
  candidates?: Array<{
    content?: {
      parts?: GeminiProxyPart[];
    };
  }>;
}

class GeminiProxyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiProxyError';
  }
}

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  return trimmed;
}

function parseJsonObjectFromText<T>(raw: string): T {
  const unfenced = stripCodeFences(raw);
  try {
    return JSON.parse(unfenced) as T;
  } catch {
    const objMatch = unfenced.match(/\{[\s\S]*\}/) ?? raw.match(/\{[\s\S]*\}/);
    if (objMatch?.[0]) {
      return JSON.parse(objMatch[0]) as T;
    }
    throw new Error('Kein gültiges JSON-Objekt in der KI-Antwort gefunden.');
  }
}

function parseJsonArrayOrWrapperFromText(raw: string): unknown {
  const unfenced = stripCodeFences(raw);
  try {
    return JSON.parse(unfenced) as unknown;
  } catch {
    const arrMatch = unfenced.match(/\[[\s\S]*\]/) ?? raw.match(/\[[\s\S]*\]/);
    if (arrMatch?.[0]) {
      return JSON.parse(arrMatch[0]) as unknown;
    }
    const objMatch = unfenced.match(/\{[\s\S]*\}/) ?? raw.match(/\{[\s\S]*\}/);
    if (objMatch?.[0]) {
      return JSON.parse(objMatch[0]) as unknown;
    }
    throw new Error('Kein gültiges JSON-Array in der KI-Antwort gefunden.');
  }
}

function extractTextFromProxyResponse(data: GeminiProxyResponse): string {
  if (typeof data.text === 'string' && data.text.trim()) {
    return data.text;
  }
  if (data.text && typeof data.text === 'object') {
    return JSON.stringify(data.text);
  }
  if (typeof data.response?.text === 'string' && data.response.text.trim()) {
    return data.response.text;
  }
  if (data.response?.text && typeof data.response.text === 'object') {
    return JSON.stringify(data.response.text);
  }
  const parts = data.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const nonThought = parts
      .filter((p) => !p.thought && typeof p.text === 'string' && p.text.trim())
      .map((p) => p.text!)
      .join('\n');
    if (nonThought.trim()) return nonThought;

    const anyText = parts
      .filter((p) => typeof p.text === 'string' && p.text.trim())
      .map((p) => p.text!)
      .join('\n');
    if (anyText.trim()) return anyText;
  }
  return '';
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

async function requestGeminiWithModel(params: {
  pin: string;
  prompt: string;
  jsonMode: boolean;
  model: string;
  timeoutMs: number;
  externalSignal?: AbortSignal;
}): Promise<
  | { ok: true; text: string }
  | { ok: false; shouldFallback: boolean; error: GeminiProxyError }
> {
  const { pin, prompt, jsonMode, model, timeoutMs, externalSignal } = params;
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort);
    }
  }

  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch('./gemini.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        pin,
        prompt,
        jsonMode,
        model,
      }),
    });

    if (res.status === 401 || res.status === 403) {
      console.error(`Gemini-Proxy (${model}) Authentifizierungsfehler: HTTP ${res.status}`);
      return {
        ok: false,
        shouldFallback: false,
        error: new GeminiProxyError(
          'Sitzung abgelaufen (PIN fehlt) – bitte Seite neu laden und PIN eingeben.'
        ),
      };
    }

    const rawBody = await res.text();
    let data: GeminiProxyResponse | null = null;
    try {
      data = JSON.parse(rawBody) as GeminiProxyResponse;
    } catch (parseErr) {
      console.error(
        `Gemini-Proxy (${model}) lieferte kein gültiges JSON (HTTP ${res.status}):`,
        parseErr,
        rawBody.slice(0, 200)
      );
      const isModelStatus = res.status === 404 || res.status === 400;
      return {
        ok: false,
        shouldFallback: isModelStatus,
        error: new GeminiProxyError(
          `KI-Fehler (HTTP ${res.status}: ${res.ok ? 'Ungültige Server-Antwort' : 'Proxy-Fehler'}) – bitte nochmal senden.`
        ),
      };
    }

    if (!res.ok || data.error) {
      const apiMsg = data.error || 'Proxy-Fehler';
      const isModelOrClientError =
        res.status === 404 ||
        res.status === 400 ||
        (res.ok && /\b(400|404|not found|unsupported|model)\b/i.test(apiMsg));
      console.error(
        `Gemini-Proxy (${model}) Fehler (HTTP ${res.status}):`,
        apiMsg
      );
      return {
        ok: false,
        shouldFallback: isModelOrClientError,
        error: new GeminiProxyError(
          `KI-Fehler (HTTP ${res.status}: ${apiMsg}) – bitte nochmal senden.`
        ),
      };
    }

    const text = extractTextFromProxyResponse(data);

    if (!text.trim()) {
      console.error(`Gemini-Proxy (${model}) lieferte leere Antwort (HTTP ${res.status}):`, data);
      return {
        ok: false,
        shouldFallback: false,
        error: new GeminiProxyError(
          `KI-Fehler (HTTP ${res.status}: Leere KI-Antwort) – bitte nochmal senden.`
        ),
      };
    }

    return { ok: true, text };
  } catch (err) {
    const isAbort =
      (err instanceof DOMException && err.name === 'AbortError') ||
      (typeof err === 'object' &&
        err !== null &&
        (err as { name?: string }).name === 'AbortError');

    if (isAbort) {
      if (externalSignal?.aborted && !timedOut) {
        return {
          ok: false,
          shouldFallback: false,
          error: new GeminiProxyError('KI-Anfrage abgebrochen.'),
        };
      }
      console.error(`Gemini-Proxy (${model}) Timeout nach ${timeoutMs}ms`);
      return {
        ok: false,
        shouldFallback: false,
        error: new GeminiProxyError(
          'KI-Zeitüberschreitung (>10s) – bitte nochmal senden.'
        ),
      };
    }

    const detail = err instanceof Error ? err.message : String(err);
    console.error(`Gemini-Proxy (${model}) Verbindungsfehler:`, detail, err);
    return {
      ok: false,
      shouldFallback: false,
      error: new GeminiProxyError(
        `KI-Fehler (Netzwerk: ${detail || 'Verbindungsfehler'}) – bitte nochmal senden.`
      ),
    };
  } finally {
    window.clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export async function callGeminiProxy(
  pin: string,
  prompt: string,
  jsonMode = true,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<string> {
  const effectivePin = pin.trim() || getStoredFamilyPin();
  if (!effectivePin) {
    console.error('Gemini-Proxy Aufruf ohne gültige Familien-PIN blockiert.');
    throw new GeminiProxyError(
      'Sitzung abgelaufen (PIN fehlt) – bitte Seite neu laden und PIN eingeben.'
    );
  }

  const timeoutMs = options?.timeoutMs ?? 10000;
  const externalSignal = options?.signal;

  const primaryAttempt = await requestGeminiWithModel({
    pin: effectivePin,
    prompt,
    jsonMode,
    model: GEMINI_MODEL,
    timeoutMs,
    externalSignal,
  });

  if (primaryAttempt.ok) {
    return primaryAttempt.text;
  }

  if (primaryAttempt.shouldFallback && !externalSignal?.aborted) {
    console.error(
      `Modell ${GEMINI_MODEL} fehlgeschlagen (${primaryAttempt.error.message}) – Fallback auf ${GEMINI_FALLBACK_MODEL}.`
    );
    const fallbackAttempt = await requestGeminiWithModel({
      pin: effectivePin,
      prompt,
      jsonMode,
      model: GEMINI_FALLBACK_MODEL,
      timeoutMs,
      externalSignal,
    });

    if (fallbackAttempt.ok) {
      return fallbackAttempt.text;
    }
    throw fallbackAttempt.error;
  }

  throw primaryAttempt.error;
}

export async function judgeWordViaProxy(params: {
  pin: string;
  word: string;
  theme: string;
  isJunior: boolean;
  matchedLetter?: string;
  isRareLetterMode?: boolean;
}): Promise<
  | { ok: true; valid: boolean; reason: string }
  | { ok: false; reason: string }
> {
  const { pin, word, theme, isJunior, matchedLetter, isRareLetterMode } = params;
  const effectivePin = pin.trim() || getStoredFamilyPin();

  const juniorHint = isJunior
    ? 'JUNIOR-MODUS: Sei bei einfachen, kindgerechten Begriffen wohlwollend. Lehne erfundene Fantasiewörter, Schummel-Anfänge und reinen Quatsch aber ebenfalls freundlich ab.'
    : 'STANDARD-MODUS: Sei fair und offen für kreative Assoziationen, aber konsequent bei Unsinn und Schummel-Tricks.';

  const rareHint =
    isRareLetterMode && matchedLetter
      ? `SONDERREGEL SELTENER BUCHSTABE (${matchedLetter}): Der Buchstabe "${matchedLetter}" darf bei diesem Zug beliebig irgendwo in einem Wort der Eingabe vorkommen (z. B. "Taxi verpasst" für X, "Handy im Pool" für Y, "Aquaplaning" für Q) – er muss NICHT am Wortanfang stehen.`
      : '';

  const prompt = [
    `Du bist der schlagfertige, strenge aber gut gelaunte KI-Schiedsrichter im deutschen Familien-Wortspiel "WortBlitz".`,
    `Aktuelles Thema: "${theme}"`,
    `Eingabe des Spielers (Wort oder Satz): "${word}"`,
    juniorHint,
    rareHint,
    `Prüfe alle folgenden Kriterien streng:`,
    `1. ECHTE SPRACHE & SINN: Die Eingabe muss aus echten, existierenden deutschen Wörtern (oder bekannten Eigennamen) bestehen und eine sinnvolle, verständliche Aussage zum Thema ergeben. Erfundene Fantasiewörter oder absurde Wort-Neuschöpfungen (z. B. "Schwanzhund", "Bananenkatze") sowie zusammenhangloser Wortsalat sind STRIKT UNGÜLTIG (valid: false).`,
    `2. KEIN SCHUMMEL-ANFANG: Es ist streng verboten, einen Begriff durch ein künstlich vorangestelltes Füll-, Adjektiv- oder Verstärkungswort auf einen Anfangsbuchstaben zu trimmen (z. B. "Super Koffer verloren" für S, "Total schlimmer Sonnenbrand" für T, "Mega großes Problem" für M). Das erste Wort muss natürlich und sinnvoll die Aussage tragen.`,
    `3. SITUATIONS-THEMEN: Bei Themen wie "Urlaubspannen", "Peinliche Momente", "Was morgens passiert" usw. reicht ein einzelnes neutrales Substantiv (z. B. nur "Koffer" oder "Hotel") NICHT aus — eine echte Situation/Handlung/Panne muss erkennbar sein (z. B. "Koffer verloren", "Kein WLAN im Hotel"). Bei reinen Sammelthemen wie "Dinge im Kühlschrank" reicht natürlich ein passendes Wort ("Käse").`,
    `Antworte ausschließlich als gültiges JSON-Objekt im Format: {"valid": boolean, "reason": string}`,
    `"reason" muss ein kurzer, schlagfertiger Moderator-Spruch auf Deutsch sein (maximal 10 bis 12 Wörter), der Quatsch-Begriffe augenzwinkernd kommentiert (z. B. "'Schwanzhund'? Nettes Fabelwesen – zählt aber leider nicht!").`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const text = await callGeminiProxy(effectivePin, prompt, true, {
      timeoutMs: 10000,
    });
    const parsed = parseJsonObjectFromText<{
      valid?: boolean;
      reason?: string;
    }>(text);

    const valid = Boolean(parsed.valid);
    return {
      ok: true,
      valid,
      reason:
        typeof parsed.reason === 'string' && parsed.reason.trim()
          ? parsed.reason.trim()
          : valid
            ? 'Passt perfekt zum Thema!'
            : 'Das zählt leider nicht zum Thema.',
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Fehler bei KI-Wortprüfung:', errMsg, err);
    if (err instanceof GeminiProxyError) {
      return {
        ok: false,
        reason: err.message,
      };
    }
    if (
      (err instanceof DOMException && err.name === 'AbortError') ||
      (typeof err === 'object' &&
        err !== null &&
        (err as { name?: string }).name === 'AbortError')
    ) {
      return {
        ok: false,
        reason: 'KI-Zeitüberschreitung (>10s) – bitte nochmal senden.',
      };
    }
    return {
      ok: false,
      reason: errMsg.trim()
        ? `KI-Fehler (${errMsg.trim()}) – bitte nochmal senden.`
        : 'KI-Antwort unlesbar – bitte nochmal senden.',
    };
  }
}

export async function generateThemesViaProxy(
  pin: string,
  keyword: string
): Promise<string[]> {
  const effectivePin = pin.trim() || getStoredFamilyPin();
  const prompt = [
    `Erstelle genau 30 abwechslungsreiche, kreative, familientaugliche Einzelthemen auf Deutsch für das Wortspiel "WortBlitz" passend zum Stichwort: "${keyword}".`,
    `Regeln:`,
    `- Jedes Thema soll kurz und sofort verständlich sein (2 bis 6 Wörter), z. B. "Dinge unter dem Tannenbaum" oder "Typische 80er-Frisuren".`,
    `- Zu jedem Thema müssen einem spontan viele verschiedene deutsche Wörter mit unterschiedlichen Anfangsbuchstaben einfallen.`,
    `- Keine Duplikate, keine Nummerierung.`,
    `Antworte ausschließlich als JSON-Array aus genau 30 Strings, z. B. ["Thema 1", "Thema 2", ...].`,
  ].join('\n');

  try {
    const text = await callGeminiProxy(effectivePin, prompt, true, {
      timeoutMs: 12000,
    });
    const parsed = parseJsonArrayOrWrapperFromText(text);

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
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Fehler im KI-Themengenerator:', errMsg, err);
    throw new GeminiProxyError(
      errMsg.trim()
        ? `KI-Themengenerator Fehler (${errMsg.trim()}) – bitte erneut versuchen.`
        : 'KI-Themengenerator lieferte eine ungültige Antwort. Bitte erneut versuchen.'
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
  const effectivePin = pin.trim() || getStoredFamilyPin();
  if (!effectivePin) return [];

  const uniqueLetters = Array.from(new Set(cards));
  const prompt = [
    `Du spielst als KI-Mitspieler im deutschen Wortspiel "WortBlitz".`,
    `Aktuelles Thema: "${theme}"`,
    `Verfügbare Handkarten: ${uniqueLetters.join(', ')} ("JOKER" = jeder Anfangsbuchstabe A–Z; bei Q, X oder Y darf der Buchstabe irgendwo im Wort vorkommen, z. B. "Taxi verpasst" für X, "Handy verloren" für Y, "Aquaplaning" für Q).`,
    usedWords.length > 0
      ? `Bereits gesperrte Antworten (NICHT verwenden): ${usedWords.join(', ')}`
      : `Noch keine Begriffe gesperrt.`,
    `Nenne 1 oder 2 echte, treffende deutsche Begriffe oder kurze Phrasen (bei Situations-Themen wie Pannen z. B. "Koffer verloren" statt nur "Koffer"), ohne künstliche Füllwörter am Anfang.`,
    `Antworte ausschließlich als JSON-Array von Objekten im Format: [{"word": "Beispiel", "letter": "B"}]. Wenn Q/X/Y irgendwo vorkommt, setze "letter": "X" usw.; bei "JOKER" setze "letter": "JOKER".`,
  ].join('\n');

  try {
    const text = await callGeminiProxy(effectivePin, prompt, true, {
      timeoutMs,
      signal,
    });
    const parsed = parseJsonArrayOrWrapperFromText(text);
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
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (!signal?.aborted) {
      console.error('Fehler bei KI-Bot-Wortvorschlag:', errMsg, err);
    }
    return [];
  }
}
