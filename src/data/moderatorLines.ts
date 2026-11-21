import type { RoomAnnouncement } from '../types/game';

function pickRandom(options: string[]): string {
  return options[Math.floor(Math.random() * options.length)];
}

export function createAnnouncement(text: string): RoomAnnouncement {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `ann_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  return {
    id,
    text: text.trim().slice(0, 240),
    createdAt: Date.now(),
  };
}

export function pickRoundStartLine(roundNumber: number, theme: string): string {
  return pickRandom([
    `Runde ${roundNumber}! Das Thema lautet: ${theme}!`,
    `Auf die Karten, fertig, los! Thema: ${theme}!`,
    `Runde ${roundNumber} startet – gesucht wird: ${theme}!`,
  ]);
}

export function pickTimeUpThemeLine(nextTheme: string): string {
  return pickRandom([
    `Zeit um – neues Thema! Jetzt zählt: ${nextTheme}!`,
    `Themenwechsel! Ab sofort gesucht: ${nextTheme}!`,
    `Weiter geht's! Neues Thema: ${nextTheme}!`,
  ]);
}

export function pickRoundEndLine(roundNumber: number): string {
  return pickRandom([
    `Runde ${roundNumber} ist durch! Jetzt zählen die Punkte!`,
    `Schlussgong für Runde ${roundNumber}! Schauen wir aufs Punktekonto!`,
  ]);
}

export function pickVictoryLine(winnerName: string): string {
  return pickRandom([
    `Sieg für ${winnerName}! Was für ein WortBlitz-Finale!`,
    `Platz eins geht an ${winnerName}! Herzlichen Glückwunsch!`,
  ]);
}

export function pickValidWordHighlightLine(playerName: string): string {
  return pickRandom([
    `Sauber! Blitzschnell abgelegt!`,
    `Starkes Wort – weiter so!`,
    `Treffer für ${playerName}! Richtig stark!`,
    `Jawoll, ${playerName} – der hat gesessen!`,
  ]);
}

export function pickInvalidWordLine(word: string, theme: string): string {
  return pickRandom([
    `${word} bei ${theme}? Netter Versuch – zählt aber leider nicht!`,
    `Oje, ${word} passt hier leider nicht – weitermachen!`,
    `Knapp daneben mit ${word}! Gleich nochmal!`,
  ]);
}

export function pickBotMoveLine(botName: string): string {
  return pickRandom([
    `Oha, ${botName} gibt Gas! Jetzt nachlegen!`,
    `Blitzschnell von ${botName}! Wer hält dagegen?`,
    `Achtung – ${botName} legt vor!`,
  ]);
}

export function pickLowCardsLine(playerName: string, remaining: number): string {
  if (remaining === 1) {
    return pickRandom([
      `Endspurt! Nur noch eine Karte bei ${playerName} bis zum Sieg!`,
      `Achtung – ${playerName} hat nur noch eine letzte Karte!`,
    ]);
  }
  return pickRandom([
    `Endspurt! Nur noch zwei Karten bei ${playerName}!`,
    `Jetzt wird's heiß – ${playerName} braucht nur noch zwei!`,
  ]);
}

export function pickHandFinishedLine(playerName: string): string {
  return pickRandom([
    `Wahnsinn! ${playerName} legt die allerletzte Karte ab!`,
    `Geschafft! ${playerName} hat die Hand komplett leer!`,
  ]);
}

export function pickGiftCardLine(senderName: string, targetName: string): string {
  return pickRandom([
    `Autsch, ein Karten-Geschenk von ${senderName} für ${targetName}!`,
    `Überraschung! ${senderName} schiebt ${targetName} eine Karte rüber!`,
  ]);
}

export function pickShieldBlockLine(blockerName: string): string {
  return pickRandom([
    `Abgeblockt! Das Schutzschild von ${blockerName} hält!`,
    `Zack, abgewehrt! ${blockerName} zieht das Schutzschild!`,
  ]);
}

export function pickThemeSwapLine(playerName: string, nextTheme: string): string {
  return pickRandom([
    `Themen-Wechsel! ${playerName} dreht auf: ${nextTheme}!`,
    `Alles neu! ${playerName} wählt: ${nextTheme}!`,
  ]);
}

export function pickTimeTurboLine(playerName: string): string {
  return pickRandom([
    `Zeit-Turbo von ${playerName}! Nur noch fünf Sekunden!`,
    `Tempo! ${playerName} zündet den Zeit-Turbo!`,
  ]);
}
