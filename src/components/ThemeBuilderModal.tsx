import React, { useState } from 'react';
import { Sparkles, Plus, Trash2, Check, X, BookOpen, Loader2 } from 'lucide-react';
import type { CustomDeck } from '../types/game';

interface ThemeBuilderModalProps {
  open: boolean;
  onClose: () => void;
  customDecks: CustomDeck[];
  onSaveCustomDecks: (decks: CustomDeck[]) => void;
  onApplyDeck: (name: string, themes: string[]) => void;
}

export const ThemeBuilderModal: React.FC<ThemeBuilderModalProps> = ({
  open,
  onClose,
  customDecks,
  onSaveCustomDecks,
  onApplyDeck,
}) => {
  const [tab, setTab] = useState<'AI' | 'CUSTOM'>('AI');

  // AI Generator state
  const [keyword, setKeyword] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [generatedThemes, setGeneratedThemes] = useState<string[]>([]);
  const [aiDeckTitle, setAiDeckTitle] = useState('');

  // Custom Deck Editor state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deckName, setDeckName] = useState('');
  const [deckLines, setDeckLines] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  if (!open) return null;

  const handleGenerateAiThemes = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = keyword.trim();
    if (clean.length < 2) {
      setAiError('Bitte gib ein Stichwort mit mindestens 2 Zeichen ein.');
      return;
    }
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch('/api/generate-themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: clean }),
      });
      const data = (await res.json()) as { themes?: string[]; error?: string };
      if (!res.ok || !Array.isArray(data.themes)) {
        throw new Error(data.error || 'Themen konnten nicht generiert werden.');
      }
      setGeneratedThemes(data.themes);
      setAiDeckTitle(`KI-Deck: ${clean}`);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Fehler bei der Anfrage.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleUseAiDeck = (alsoSave: boolean) => {
    if (generatedThemes.length === 0) return;
    const title = aiDeckTitle.trim() || `KI-Deck: ${keyword.trim()}`;
    if (alsoSave) {
      const newDeck: CustomDeck = {
        id: `deck_${Date.now()}`,
        name: title,
        themes: generatedThemes,
        updatedAt: Date.now(),
      };
      onSaveCustomDecks([newDeck, ...customDecks]);
    }
    onApplyDeck(title, generatedThemes);
    onClose();
  };

  const startNewDeck = () => {
    setEditingId('new');
    setDeckName('');
    setDeckLines('');
    setCustomError(null);
  };

  const startEditDeck = (deck: CustomDeck) => {
    setEditingId(deck.id);
    setDeckName(deck.name);
    setDeckLines(deck.themes.join('\n'));
    setCustomError(null);
  };

  const handleSaveDeck = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = deckName.trim();
    const parsedThemes = deckLines
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length >= 2);

    if (cleanName.length < 2) {
      setCustomError('Bitte vergib einen Deck-Namen (mind. 2 Zeichen).');
      return;
    }
    if (parsedThemes.length < 3) {
      setCustomError('Bitte trage mindestens 3 Themen ein (eins pro Zeile).');
      return;
    }

    if (editingId === 'new') {
      const created: CustomDeck = {
        id: `deck_${Date.now()}`,
        name: cleanName,
        themes: parsedThemes.slice(0, 60),
        updatedAt: Date.now(),
      };
      onSaveCustomDecks([created, ...customDecks]);
    } else {
      const updated = customDecks.map((d) =>
        d.id === editingId
          ? { ...d, name: cleanName, themes: parsedThemes.slice(0, 60), updatedAt: Date.now() }
          : d
      );
      onSaveCustomDecks(updated);
    }
    setEditingId(null);
    setCustomError(null);
  };

  const handleDeleteDeck = (id: string) => {
    onSaveCustomDecks(customDecks.filter((d) => d.id !== id));
    if (editingId === id) setEditingId(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Themen-Baukasten"
    >
      <div className="w-full sm:max-w-2xl max-h-[90vh] bg-[#171A24] border border-white/10 rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="text-xl font-display font-bold text-white">
            Themen-Baukasten
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-300 hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Segmented Tabs */}
        <div className="px-5 pt-4">
          <div className="grid grid-cols-2 gap-1 p-1 bg-[#0F1117] rounded-xl border border-white/10">
            <button
              type="button"
              onClick={() => setTab('AI')}
              className={`min-h-[44px] px-3 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap ${
                tab === 'AI'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Sparkles className="w-4 h-4 shrink-0" />
              KI-Themengenerator
            </button>
            <button
              type="button"
              onClick={() => setTab('CUSTOM')}
              className={`min-h-[44px] px-3 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap ${
                tab === 'CUSTOM'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <BookOpen className="w-4 h-4 shrink-0" />
              Eigene Decks ({customDecks.length})
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {tab === 'AI' ? (
            <>
              <form onSubmit={handleGenerateAiThemes} className="space-y-3">
                <label className="block text-sm font-medium text-slate-200">
                  Beliebiges Stichwort für 30 maßgeschneiderte Themen
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="z.B. Weihnachten, 80er-Jahre, Camping"
                    maxLength={60}
                    className="flex-1 min-h-[48px] px-4 rounded-xl bg-[#0F1117] border border-white/15 text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="submit"
                    disabled={aiLoading}
                    className="min-h-[48px] px-5 rounded-xl bg-amber-400 text-slate-950 font-semibold hover:bg-amber-300 disabled:opacity-60 flex items-center justify-center gap-2 whitespace-nowrap transition-colors"
                  >
                    {aiLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Erstelle 30 Themen...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        30 Themen generieren
                      </>
                    )}
                  </button>
                </div>
                {aiError && (
                  <p className="text-sm text-rose-400">{aiError}</p>
                )}
              </form>

              {generatedThemes.length > 0 && (
                <div className="space-y-4 pt-2 border-t border-white/10">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-emerald-400">
                      {generatedThemes.length} Themen bereit
                    </span>
                    <input
                      type="text"
                      value={aiDeckTitle}
                      onChange={(e) => setAiDeckTitle(e.target.value)}
                      placeholder="Deck-Titel"
                      maxLength={60}
                      className="max-w-[220px] px-3 py-1.5 text-sm rounded-lg bg-[#0F1117] border border-white/15 text-white"
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 pr-1">
                    {generatedThemes.map((theme, idx) => (
                      <div
                        key={idx}
                        className="px-3 py-2 rounded-xl bg-[#0F1117] border border-white/10 text-sm text-slate-200 flex items-center gap-2"
                      >
                        <span className="text-xs font-mono text-amber-400/80 tabular-nums">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span className="truncate">{theme}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <button
                      type="button"
                      onClick={() => handleUseAiDeck(true)}
                      className="flex-1 min-h-[48px] px-4 rounded-xl bg-emerald-500 text-slate-950 font-semibold hover:bg-emerald-400 transition-colors flex items-center justify-center gap-2"
                    >
                      <Check className="w-4 h-4" />
                      Speichern & als Deck wählen
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUseAiDeck(false)}
                      className="min-h-[48px] px-4 rounded-xl bg-white/10 text-white font-medium hover:bg-white/15 transition-colors"
                    >
                      Nur für diese Runde nutzen
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {editingId ? (
                <form onSubmit={handleSaveDeck} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-200 mb-1.5">
                      Name des Themen-Decks
                    </label>
                    <input
                      type="text"
                      value={deckName}
                      onChange={(e) => setDeckName(e.target.value)}
                      placeholder="z.B. Familienurlaub Österreich"
                      maxLength={60}
                      className="w-full min-h-[44px] px-4 rounded-xl bg-[#0F1117] border border-white/15 text-white focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-200 mb-1.5">
                      Themen (ein Thema pro Zeile, mindestens 3)
                    </label>
                    <textarea
                      value={deckLines}
                      onChange={(e) => setDeckLines(e.target.value)}
                      rows={8}
                      placeholder={'Dinge auf der Alm\nTypisches Hütten-Essen\nWas im Wanderrucksack steckt'}
                      className="w-full p-4 rounded-xl bg-[#0F1117] border border-white/15 text-white text-sm leading-relaxed focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  {customError && (
                    <p className="text-sm text-rose-400">{customError}</p>
                  )}
                  <div className="flex gap-2.5">
                    <button
                      type="submit"
                      className="flex-1 min-h-[46px] px-4 rounded-xl bg-amber-400 text-slate-950 font-semibold hover:bg-amber-300 transition-colors"
                    >
                      Deck speichern
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="min-h-[46px] px-4 rounded-xl bg-white/10 text-slate-200 hover:bg-white/15 transition-colors"
                    >
                      Abbrechen
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={startNewDeck}
                    className="w-full min-h-[48px] px-4 rounded-xl border border-dashed border-amber-400/50 text-amber-300 hover:bg-amber-400/10 font-semibold flex items-center justify-center gap-2 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Neues eigenes Deck erstellen
                  </button>

                  {customDecks.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-6">
                      Noch keine eigenen Decks gespeichert. Erstelle eins manuell oder nutze den KI-Themengenerator!
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {customDecks.map((deck) => (
                        <div
                          key={deck.id}
                          className="p-4 rounded-2xl bg-[#0F1117] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div>
                            <h3 className="font-semibold text-white">{deck.name}</h3>
                            <p className="text-xs text-slate-400">
                              {deck.themes.length} Themen · lokal gespeichert
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                onApplyDeck(deck.name, deck.themes);
                                onClose();
                              }}
                              className="min-h-[44px] px-4 rounded-xl bg-emerald-500 text-slate-950 text-sm font-semibold hover:bg-emerald-400 transition-colors"
                            >
                              Auswählen
                            </button>
                            <button
                              type="button"
                              onClick={() => startEditDeck(deck)}
                              className="min-h-[44px] px-3 rounded-xl bg-white/10 text-slate-200 text-sm hover:bg-white/15 transition-colors"
                            >
                              Bearbeiten
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteDeck(deck.id)}
                              aria-label={`${deck.name} löschen`}
                              className="min-h-[44px] min-w-[44px] rounded-xl bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 flex items-center justify-center transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
