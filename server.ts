import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '1mb' }));

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY ist auf dem Server nicht konfiguriert.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/judge-word', async (req, res) => {
  try {
    const word = typeof req.body?.word === 'string' ? req.body.word.trim() : '';
    const theme = typeof req.body?.theme === 'string' ? req.body.theme.trim() : '';
    const isJunior = Boolean(req.body?.isJunior);

    if (!word || !theme) {
      res.status(400).json({ error: 'Begriff und Thema sind erforderlich.' });
      return;
    }

    const ai = getGeminiClient();

    const juniorHint = isJunior
      ? 'WICHTIG: Der Spieler spielt in der JUNIOR-/Einsteiger-Stufe (Kind/Anfänger). Sei sehr wohlwollend, großzügig und freundlich! Akzeptiere auch einfache, kindgerechte oder kreativ-assoziative Zusammenhänge.'
      : 'Der Spieler spielt in der Standard-Stufe. Sei fair, freundlich und offen für kreative, aber nachvollziehbare Assoziationen.';

    const prompt = [
      `Du bist der gut gelaunte, faire KI-Schiedsrichter im deutschen Familien-Wortspiel "WortBlitz".`,
      `Aktuelles Thema: "${theme}"`,
      `Genannter Begriff: "${word}"`,
      juniorHint,
      `Prüfe:`,
      `1. Ist "${word}" ein echtes deutsches Wort oder ein bekannter Eigenname/Begriff (kein Unsinn/Kauderwelsch)?`,
      `2. Passt der Begriff logisch, thematisch oder kreativ zum Thema "${theme}"?`,
      `Antworte ausschließlich als JSON mit:`,
      `- "valid": true oder false`,
      `- "reason": Eine kurze, knackige, humorvolle Begründung auf Deutsch (maximal 14 Wörter). Bei gültigen Wörtern z.B. ein kurzes Lob/Kommentar; bei ungültigen Wörtern eine augenzwinkernde Erklärung.`,
    ].join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            valid: {
              type: Type.BOOLEAN,
              description: 'Ob der Begriff zum Thema passt und akzeptiert wird.',
            },
            reason: {
              type: Type.STRING,
              description: 'Kurze, freundliche oder humorvolle Begründung auf Deutsch.',
            },
          },
          required: ['valid', 'reason'],
        },
      },
    });

    const rawText = (response.text ?? '').trim();
    const parsed = JSON.parse(rawText) as { valid?: boolean; reason?: string };

    res.json({
      valid: Boolean(parsed.valid),
      reason: typeof parsed.reason === 'string' && parsed.reason.trim()
        ? parsed.reason.trim()
        : parsed.valid
          ? 'Passt perfekt zum Thema!'
          : 'Das passt leider nicht so richtig zum Thema.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler bei der KI-Prüfung.';
    console.error('Fehler in /api/judge-word:', error);
    res.status(500).json({ error: message });
  }
});

app.post('/api/generate-themes', async (req, res) => {
  try {
    const keyword = typeof req.body?.keyword === 'string' ? req.body.keyword.trim() : '';
    if (!keyword || keyword.length < 2) {
      res.status(400).json({ error: 'Bitte gib ein Stichwort mit mindestens 2 Zeichen ein.' });
      return;
    }

    const ai = getGeminiClient();

    const prompt = [
      `Erstelle genau 30 abwechslungsreiche, kreative, familientaugliche Einzelthemen auf Deutsch für das Wortspiel "WortBlitz" passend zum Oberbegriff/Stichwort: "${keyword}".`,
      `Regeln für die Themen:`,
      `- Jedes Thema soll kurz und sofort verständlich sein (2 bis 6 Wörter), z.B. "Dinge unter dem Tannenbaum" oder "Typische 80er-Frisuren".`,
      `- Zu jedem Thema müssen einem spontan viele verschiedene deutsche Wörter mit unterschiedlichen Anfangsbuchstaben einfallen.`,
      `- Keine Duplikate, keine Nummerierung, keine Anführungszeichen.`,
    ].join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            themes: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Liste mit genau 30 kreativen Einzelthemen auf Deutsch.',
            },
          },
          required: ['themes'],
        },
      },
    });

    const rawText = (response.text ?? '').trim();
    const parsed = JSON.parse(rawText) as { themes?: string[] };
    const themes = Array.isArray(parsed.themes)
      ? parsed.themes
          .map((t) => (typeof t === 'string' ? t.trim() : ''))
          .filter((t) => t.length >= 2)
          .slice(0, 30)
      : [];

    if (themes.length === 0) {
      res.status(502).json({ error: 'Die KI konnte keine Themen generieren. Bitte erneut versuchen.' });
      return;
    }

    res.json({ themes });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fehler bei der Themengenerierung.';
    console.error('Fehler in /api/generate-themes:', error);
    res.status(500).json({ error: message });
  }
});

async function startServer() {
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('/{*splat}', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`WortBlitz Server läuft auf http://0.0.0.0:${port}`);
  });
}

startServer();
