import React, { useState } from 'react';
import { Check, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { ALL_BUILTIN_CATEGORIES } from '../data/themesAndCards';
import { generateThemesViaProxy } from '../lib/geminiProxy';
import type { CustomDeck } from '../types/game';

interface DeckBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  familyPin: string;
  selectedCategory: string;
  customDecks: CustomDeck[];
  onSaveCustomDeck: (deck: CustomDeck) => void;
  onDeleteCustomDeck: (id: string) => void;
  onSelectDeck: (name: string, themes: string[]) => void;
}

export const DeckBuilderModal: React.FC<DeckBuilderModalProps> = ({
  isOpen,
  onClose,
  familyPin,
  selectedCategory,
  customDecks,
  onSaveCustomDeck,
  onDeleteCustomDeck,
  onSelectDeck,
}) => {
  const [tab, setTab] = useState<'BUILTIN' | 'AI' | 'CUSTOM'>('BUILTIN');

  const [aiKeyword, setAiKeyword] = useState('');
  const [aiThemes, setAiThemes] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [deckName, setDeckName] = useState('');
  const [deckRawText, setDeckRawText] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGenerateAiThemes = async (e: React.FormEvent) => {
    e.preventDefault();
    const keyword = aiKeyword.trim();
    if (keyword.length < 2) {
      setAiError('Bitte gib ein Stichwort ein (z. B. Weihnachten, 80er-Jahre, Camping).');
      return;
    }
    setAiLoading(true);
    setAiError(null);
    try {
      const themes = await generateThemesViaProxy(familyPin, keyword);
      setAiThemes(themes);
    } catch {
      setAiError(
        'Der KI-Themengenerator ist gerade nicht erreichbar. Bitte versuche es gleich nochmal.'
      );
    } finally {
      setAiLoading(false);
    }
  };

  const handleUseAiDeck = (saveToLocal: boolean) => {
    if (aiThemes.length === 0) return;
    const title = `KI: ${aiKeyword.trim()}`;
    if (saveToLocal) {
      onSaveCustomDeck({
        id: `ai-${Date.now()}`,
        name: title,
        themes: aiThemes,
        updatedAt: Date.now(),
      });
    }
    onSelectDeck(title, aiThemes);
    onClose();
  };

  const handleSaveManualDeck = (e: React.FormEvent) => {
    e.preventDefault();
    const name = deckName.trim();
    const themes = deckRawText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length >= 2);

    if (name.length < 2) {
      setCustomError('Bitte gib deinem Themen-Deck einen Namen.');
      return;
    }
    if (themes.length < 3) {
      setCustomError('Bitte trage mindestens 3 Einzelthemen ein (ein Thema pro Zeile).');
      return;
    }
    setCustomError(null);

    const newDeck: CustomDeck = {
      id: editingId ?? `custom-${Date.now()}`,
      name,
      themes,
      updatedAt: Date.now(),
    };
    onSaveCustomDeck(newDeck);
    onSelectDeck(newDeck.name, newDeck.themes);
    setEditingId(null);
    setDeckName('');
    setDeckRawText('');
    onClose();
  };

  const startEditCustomDeck = (deck: CustomDeck) => {
    setEditingId(deck.id);
    setDeckName(deck.name);
    setDeckRawText(deck.themes.join('\n'));
    setCustomError(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl max-h-[90vh] bg-[#161923] border border-white/10 rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <h2 className="text-xl font-display font-bold text-white">
              Themen-Baukasten
            </h2>
            <p className="text-xs text-slate-400">
              Wähle eine Kategorie, erstelle eigene Decks oder nutze den KI-Generator
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="min-h-[44px] min-w-[44px] rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pt-4">
          <div className="grid grid-cols-3 gap-1 p-1 bg-[#0F1117] rounded-xl border border-white/10">
            <button
              type="button"
              onClick={() => setTab('BUILTIN')}
              className={`min-h-[40px] px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors ${
                tab === 'BUILTIN'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Familien-Decks
            </button>
            <button
              type="button"
              onClick={() => setTab('AI')}
              className={`min-h-[40px] px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors ${
                tab === 'AI'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              KI-Generator (30)
            </button>
            <button
              type="button"
              onClick={() => setTab('CUSTOM')}
              className={`min-h-[40px] px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors ${
                tab === 'CUSTOM'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Eigene Decks ({customDecks.length})
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {tab === 'BUILTIN' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ALL_BUILTIN_CATEGORIES.map((cat) => {
                const isActive = selectedCategory === cat.name;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      onSelectDeck(cat.name, cat.themes);
                      onClose();
                    }}
                    className={`text-left p-4 rounded-2xl border transition-all min-h-[88px] flex flex-col justify-between ${
                      isActive
                        ? 'bg-amber-400/15 border-amber-400 text-white'
                        : 'bg-[#1C202E] border-white/10 hover:border-white/25 text-slate-100'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-display font-bold text-base">
                        {cat.name}
                      </span>
                      {isActive && (
                        <Check className="w-5 h-5 text-amber-400 shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {cat.description} · {cat.themes.length} Themen
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {tab === 'AI' && (
            <div className="space-y-4">
              <form onSubmit={handleGenerateAiThemes} className="space-y-3">
                <label className="block text-sm font-medium text-slate-200">
                  Wunsch-Stichwort für 30 maßgeschneiderte Themen
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={aiKeyword}
                    onChange={(e) => setAiKeyword(e.target.value)}
                    placeholder="z. B. Weihnachten, 80er-Jahre, Camping..."
                    maxLength={60}
                    className="flex-1 min-h-[46px] px-4 rounded-xl bg-[#0F1117] border border-white/15 text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="submit"
                    disabled={aiLoading}
                    className="min-h-[46px] px-5 rounded-xl bg-amber-400 text-slate-950 font-semibold hover:bg-amber-300 disabled:opacity-50 flex items-center gap-2 shrink-0 transition-colors"
                  >
                    {aiLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    <span>{aiLoading ? 'Generiert…' : 'Erstellen'}</span>
                  </button>
                </div>
                {aiError && <p className="text-xs text-rose-400">{aiError}</p>}
              </form>

              {aiThemes.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-emerald-400">
                      {aiThemes.length} Themen generiert
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleUseAiDeck(false)}
                        className="min-h-[40px] px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-colors"
                      >
                        Nur für Runde nutzen
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUseAiDeck(true)}
                        className="min-h-[40px] px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-xs font-semibold text-slate-950 transition-colors"
                      >
                        Speichern &amp; Aktivieren
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                    {aiThemes.map((t, i) => (
                      <div
                        key={`${t}-${i}`}
                        className="px-3 py-2 rounded-xl bg-[#0F1117] border border-white/10 text-xs text-slate-200 flex items-center gap-2"
                      >
                        <span className="text-slate-500 font-mono tabular-nums w-5 shrink-0">
                          {i + 1}.
                        </span>
                        <span className="truncate">{t}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'CUSTOM' && (
            <div className="space-y-5">
              {customDecks.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-400">
                    Gespeicherte Decks (Lokal im Browser)
                  </h3>
                  <div className="space-y-2">
                    {customDecks.map((deck) => (
                      <div
                        key={deck.id}
                        className={`p-3 rounded-2xl border flex items-center justify-between gap-3 ${
                          selectedCategory === deck.name
                            ? 'bg-amber-400/15 border-amber-400'
                            : 'bg-[#1C202E] border-white/10'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectDeck(deck.name, deck.themes);
                            onClose();
                          }}
                          className="text-left flex-1 min-w-0"
                        >
                          <div className="font-semibold text-sm text-white truncate">
                            {deck.name}
                          </div>
                          <div className="text-xs text-slate-400">
                            {deck.themes.length} Themen
                          </div>
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEditCustomDeck(deck)}
                            className="min-h-[40px] px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200"
                          >
                            Bearbeiten
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteCustomDeck(deck.id)}
                            aria-label="Deck löschen"
                            className="min-h-[40px] min-w-[40px] rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 flex items-center justify-center"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <form onSubmit={handleSaveManualDeck} className="space-y-3 pt-2 border-t border-white/10">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">
                    {editingId ? 'Deck bearbeiten' : 'Neues eigenes Deck erstellen'}
                  </h3>
                  {editingId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setDeckName('');
                        setDeckRawText('');
                      }}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      Abbrechen
                    </button>
                  )}
                </div>

                <input
                  type="text"
                  value={deckName}
                  onChange={(e) => setDeckName(e.target.value)}
                  placeholder="Deck-Name (z. B. Familien-Insider)"
                  maxLength={60}
                  className="w-full min-h-[44px] px-4 rounded-xl bg-[#0F1117] border border-white/15 text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                />

                <textarea
                  value={deckRawText}
                  onChange={(e) => setDeckRawText(e.target.value)}
                  rows={5}
                  placeholder={'Ein Thema pro Zeile:\nDinge bei Oma im Garten\nWas Papa immer vergisst\nLieblingsgerichte im Urlaub'}
                  className="w-full p-4 rounded-xl bg-[#0F1117] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                />

                {customError && <p className="text-xs text-rose-400">{customError}</p>}

                <button
                  type="submit"
                  className="w-full min-h-[46px] px-5 py-3 rounded-xl bg-amber-400 text-slate-950 font-semibold hover:bg-amber-300 flex items-center justify-center gap-2 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Speichern &amp; Deck auswählen</span>
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
