import type { ActionCardType } from '../types/game';

export interface AvatarOption {
  id: string;
  emoji: string;
  label: string;
  bgClass: string;
}

export const AVATARS: AvatarOption[] = [
  { id: 'fox', emoji: '🦊', label: 'Fuchs', bgClass: 'bg-orange-500/20 border-orange-400/40' },
  { id: 'owl', emoji: '🦉', label: 'Eule', bgClass: 'bg-indigo-500/20 border-indigo-400/40' },
  { id: 'lion', emoji: '🦁', label: 'Löwe', bgClass: 'bg-amber-500/20 border-amber-400/40' },
  { id: 'panda', emoji: '🐼', label: 'Panda', bgClass: 'bg-emerald-500/20 border-emerald-400/40' },
  { id: 'frog', emoji: '🐸', label: 'Frosch', bgClass: 'bg-lime-500/20 border-lime-400/40' },
  { id: 'koala', emoji: '🐨', label: 'Koala', bgClass: 'bg-sky-500/20 border-sky-400/40' },
  { id: 'cat', emoji: '🐱', label: 'Katze', bgClass: 'bg-rose-500/20 border-rose-400/40' },
  { id: 'bear', emoji: '🐻', label: 'Bär', bgClass: 'bg-amber-700/25 border-amber-500/40' },
  { id: 'unicorn', emoji: '🦄', label: 'Einhorn', bgClass: 'bg-fuchsia-500/20 border-fuchsia-400/40' },
  { id: 'octopus', emoji: '🐙', label: 'Oktopus', bgClass: 'bg-pink-500/20 border-pink-400/40' },
  { id: 'rocket', emoji: '🚀', label: 'Rakete', bgClass: 'bg-cyan-500/20 border-cyan-400/40' },
  { id: 'star', emoji: '🌟', label: 'Stern', bgClass: 'bg-yellow-500/20 border-yellow-400/40' },
];

export function getAvatar(avatarId: string): AvatarOption {
  return AVATARS.find((a) => a.id === avatarId) ?? AVATARS[0];
}

export interface BuiltinCategory {
  id: string;
  name: string;
  description: string;
  themes: string[];
}

export const BUILTIN_CATEGORIES: BuiltinCategory[] = [
  {
    id: 'alltag',
    name: 'Alltag & Zuhause',
    description: 'Vertraute Dinge aus Wohnung, Familie & Tagesablauf',
    themes: [
      'Dinge im Badezimmer',
      'Was man in einer Schublade findet',
      'Gegenstände auf dem Schreibtisch',
      'Was morgens als Erstes passiert',
      'Dinge im Kleiderschrank',
      'Werkzeuge im Keller',
      'Was auf den Esstisch gehört',
      'Geräte mit Stecker',
      'Dinge, die man leicht verliert',
      'Was im Flur steht',
      'Haushaltsaufgaben',
      'Dinge aus Glas',
      'Was man im Rucksack hat',
      'Gegenstände im Wohnzimmer',
      'Dinge, die leuchten',
      'Was im Briefkasten landet',
      'Etwas zum Putzen',
      'Möbelstücke',
      'Was im Garten wächst oder steht',
      'Dinge mit Reißverschluss',
      'Was man beim Einkaufen braucht',
      'Sachen aus Papier',
      'Dinge auf dem Nachttisch',
      'Was Geräusche macht',
      'Etwas Weiches',
    ],
  },
  {
    id: 'essen',
    name: 'Essen & Küche',
    description: 'Leckere Zutaten, Gerichte & Küchenhelfer',
    themes: [
      'Dinge im Kühlschrank',
      'Obst & Beeren',
      'Gemüsesorten',
      'Beliebter Pizzabelag',
      'Süßigkeiten & Snacks',
      'Was auf den Frühstückstisch kommt',
      'Eissorten',
      'Kräuter & Gewürze',
      'Küchengeräte & Helfer',
      'Typisch italienisches Essen',
      'Getränke ohne Alkohol',
      'Was man grillen kann',
      'Backzutaten',
      'Suppen & Eintöpfe',
      'Käsesorten & Milchprodukte',
      'Was man im Restaurant bestellt',
      'Beilagen zum Hauptgericht',
      'Etwas Saures',
      'Etwas Knuspriges',
      'Kuchen & Gebäck',
      'Nudelsorten & Pasta',
      'Brot & Brötchen',
      'Was auf dem Jahrmarkt duftet',
      'Typisches Picknick-Essen',
      'Dinge in der Vorratskammer',
    ],
  },
  {
    id: 'tiere',
    name: 'Tiere & Natur',
    description: 'Tierwelt, Pflanzen, Wetter & Landschaften',
    themes: [
      'Tiere im Wald',
      'Tiere im Meer',
      'Haustiere',
      'Vögel',
      'Tiere in Afrika',
      'Insekten & Krabbeltiere',
      'Bäume & Sträucher',
      'Blumenarten',
      'Wetterphänomene',
      'Tiere auf dem Bauernhof',
      'Dinge am Strand',
      'Tiere mit Fell',
      'Tiere, die schwimmen können',
      'Nachtaktive Tiere',
      'Jahreszeiten & Naturereignisse',
      'Landschaften & Gewässer',
      'Pilze & Waldfrüchte',
      'Tiere in den Bergen',
      'Dinge im Park',
      'Sehr kleine Tiere',
      'Sehr große Tiere',
      'Reptilien & Amphibien',
      'Naturschätze & Steine',
      'Tiere im Zoo',
      'Alles rund ums Wasser',
    ],
  },
  {
    id: 'reisen',
    name: 'Reisen & Welt',
    description: 'Länder, Städte, Urlaub & Fortbewegung',
    themes: [
      'Länder in Europa',
      'Hauptstädte der Welt',
      'Dinge im Reisekoffer',
      'Fortbewegungsmittel',
      'Deutsche Städte',
      'Bekannte Sehenswürdigkeiten',
      'Was am Flughafen passiert',
      'Camping-Ausrüstung',
      'Urlaubsinseln',
      'Flüsse & Gebirge',
      'Souvenirs & Mitbringsel',
      'Dinge im Hotelzimmer',
      'Verkehrsschilder & Straße',
      'Was man im Zug sieht',
      'Sprachen der Welt',
      'Berühmte Bauwerke',
      'Skiurlaub & Winterreise',
      'Dinge für den Strandurlaub',
      'Abenteuer & Ausflüge',
      'Weltmeere & Küsten',
      'Währungen & Geld',
      'Wander-Ausrüstung',
      'Länder außerhalb Europas',
      'Orte zum Übernachten',
      'Reiseziele im Sommer',
    ],
  },
  {
    id: 'kultur',
    name: 'Filme, Bücher & Musik',
    description: 'Geschichten, Instrumente, Helden & Bühne',
    themes: [
      'Musikinstrumente',
      'Märchen & Fabelwesen',
      'Filmgenres',
      'Berühmte Zeichentrickfiguren',
      'Musikrichtungen',
      'Superhelden & Bösewichte',
      'Was man im Kino sieht oder isst',
      'Bücher & Literaturgenres',
      'Berühmte Sänger oder Bands',
      'Dinge auf einer Theaterbühne',
      'Klassische Kinderbücher',
      'TV-Serien & Shows',
      'Tanzstile',
      'Feste & Feiertage',
      'Fantasy & Magie',
      'Berühmte Schauspieler',
      'Lieder, die jeder mitsingen kann',
      'Museen & Kunstformen',
      'Comics & Graphic Novels',
      'Quiz- & Brettspiele',
      'Fotografie & Kamera',
      'Mittelalter & Ritterzeit',
      'Weltraum & Science-Fiction',
      'Krimi & Detektiv',
      'Zirkus & Show',
    ],
  },
  {
    id: 'sport',
    name: 'Sport & Freizeit',
    description: 'Bewegung, Hobbys, Spiele & Vereinsleben',
    themes: [
      'Ballsportarten',
      'Sportarten im Wasser',
      'Wintersport',
      'Was man auf dem Spielplatz macht',
      'Olympische Disziplinen',
      'Kreative Hobbys & Basteln',
      'Dinge im Schwimmbad',
      'Sportausrüstung',
      'Fahrradtour & Zubehör',
      'Gesellschaftsspiele',
      'Leichtathletik & Turnen',
      'Was man im Park spielen kann',
      'Teamsportarten',
      'Dinge in der Sporttasche',
      'Karten- & Würfelspiele',
      'Gartenarbeit & Naturhobby',
      'Videospiele & Konsolen',
      'Outdoor-Aktivitäten',
      'Wettkampf & Pokale',
      'Yoga, Tanz & Fitness',
      'Berufe rund um den Sport',
      'Freizeitparks & Attraktionen',
      'Sammelobjekte',
      'Klettern & Wandern',
      'Musik & Chor als Hobby',
    ],
  },
];

export const MIXED_FAMILY_CATEGORY: BuiltinCategory = {
  id: 'mix',
  name: 'Bunter Familien-Mix',
  description: 'Die abwechslungsreichste Mischung aus allen 6 Kategorien',
  themes: BUILTIN_CATEGORIES.flatMap((c) => c.themes.slice(0, 6)),
};

export const ALL_BUILTIN_CATEGORIES: BuiltinCategory[] = [
  MIXED_FAMILY_CATEGORY,
  ...BUILTIN_CATEGORIES,
];

// Balanced German letter frequency weights + rare A-Z Joker
const LETTER_POOL: Array<{ letter: string; weight: number }> = [
  { letter: 'E', weight: 12 },
  { letter: 'N', weight: 10 },
  { letter: 'S', weight: 10 },
  { letter: 'R', weight: 9 },
  { letter: 'A', weight: 9 },
  { letter: 'T', weight: 9 },
  { letter: 'M', weight: 8 },
  { letter: 'K', weight: 8 },
  { letter: 'L', weight: 8 },
  { letter: 'B', weight: 8 },
  { letter: 'G', weight: 7 },
  { letter: 'H', weight: 7 },
  { letter: 'W', weight: 7 },
  { letter: 'F', weight: 7 },
  { letter: 'P', weight: 6 },
  { letter: 'Z', weight: 6 },
  { letter: 'D', weight: 6 },
  { letter: 'I', weight: 5 },
  { letter: 'O', weight: 5 },
  { letter: 'U', weight: 5 },
  { letter: 'V', weight: 3 },
  { letter: 'C', weight: 3 },
  { letter: 'J', weight: 2 },
  { letter: 'Q', weight: 1 },
  { letter: 'X', weight: 1 },
  { letter: 'Y', weight: 1 },
  { letter: 'JOKER', weight: 5 },
];

const EXPANDED_LETTER_DECK: string[] = LETTER_POOL.flatMap(({ letter, weight }) =>
  Array.from({ length: weight }, () => letter)
);

export function drawSingleLetterCard(): string {
  const index = Math.floor(Math.random() * EXPANDED_LETTER_DECK.length);
  return EXPANDED_LETTER_DECK[index];
}

export function dealLetterHand(count: number): string[] {
  const hand: string[] = [];
  let jokerCount = 0;
  for (let i = 0; i < count; i++) {
    let card = drawSingleLetterCard();
    if (card === 'JOKER') {
      if (jokerCount >= 1) {
        // Limit to max 1 Joker in starting hand to keep rounds fair
        while (card === 'JOKER') {
          card = drawSingleLetterCard();
        }
      } else {
        jokerCount++;
      }
    }
    hand.push(card);
  }
  return hand;
}

const ACTION_POOL: ActionCardType[] = ['THEME_SWAP', 'GIFT', 'TIME_TURBO', 'SHIELD'];

export function dealActionCards(count: number): ActionCardType[] {
  const result: ActionCardType[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * ACTION_POOL.length);
    result.push(ACTION_POOL[idx]);
  }
  return result;
}

export const ACTION_CARD_META: Record<
  ActionCardType,
  { emoji: string; title: string; shortDesc: string; colorClass: string }
> = {
  THEME_SWAP: {
    emoji: '🔄',
    title: 'Themen-Wechsel',
    shortDesc: 'Tauscht sofort das aktuelle Thema',
    colorClass: 'bg-sky-500/20 border-sky-400/50 text-sky-200',
  },
  GIFT: {
    emoji: '🎁',
    title: 'Karten-Geschenk',
    shortDesc: 'Schiebt einem Mitspieler 1 eigene Karte zu',
    colorClass: 'bg-rose-500/20 border-rose-400/50 text-rose-200',
  },
  TIME_TURBO: {
    emoji: '⚡',
    title: 'Zeit-Turbo',
    shortDesc: 'Verkürzt den Countdown auf 5 Sekunden',
    colorClass: 'bg-amber-500/20 border-amber-400/50 text-amber-200',
  },
  SHIELD: {
    emoji: '🛡️',
    title: 'Schutzschild',
    shortDesc: 'Wehrt Karten-Geschenk oder Strafkarte ab',
    colorClass: 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200',
  },
};

export function getLetterCardColors(letter: string): {
  bg: string;
  border: string;
  text: string;
  badge: string;
} {
  if (letter === 'JOKER') {
    return {
      bg: 'bg-gradient-to-br from-amber-300 via-yellow-400 to-orange-400',
      border: 'border-amber-200',
      text: 'text-slate-950',
      badge: 'bg-slate-950/15 text-slate-950',
    };
  }
  const code = letter.charCodeAt(0) % 6;
  switch (code) {
    case 0:
      return {
        bg: 'bg-[#F43F5E]', // Coral Rose
        border: 'border-[#FDA4AF]/50',
        text: 'text-white',
        badge: 'bg-black/20 text-white/90',
      };
    case 1:
      return {
        bg: 'bg-[#F59E0B]', // Warm Amber
        border: 'border-[#FDE68A]/50',
        text: 'text-slate-950',
        badge: 'bg-slate-950/15 text-slate-950',
      };
    case 2:
      return {
        bg: 'bg-[#10B981]', // Emerald
        border: 'border-[#A7F3D0]/50',
        text: 'text-slate-950',
        badge: 'bg-slate-950/15 text-slate-950',
      };
    case 3:
      return {
        bg: 'bg-[#0EA5E9]', // Sky Blue
        border: 'border-[#BAE6FD]/50',
        text: 'text-slate-950',
        badge: 'bg-slate-950/15 text-slate-950',
      };
    case 4:
      return {
        bg: 'bg-[#F97316]', // Tangerine
        border: 'border-[#FED7AA]/50',
        text: 'text-slate-950',
        badge: 'bg-slate-950/15 text-slate-950',
      };
    default:
      return {
        bg: 'bg-[#6366F1]', // Indigo
        border: 'border-[#C7D2FE]/50',
        text: 'text-white',
        badge: 'bg-black/20 text-white/90',
      };
  }
}

export function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function normalizeWord(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:"'„“‚‘()[\]{}]/g, '')
    .replace(/\s+/g, ' ');
}

export function stripGermanArticle(word: string): string {
  return word.replace(/^(der|die|das|ein|eine|einen|einem|einer)\s+/i, '').trim();
}

export function extractStartingLetter(word: string): string {
  const cleaned = normalizeWord(word);
  if (!cleaned) return '';
  const first = cleaned[0].toUpperCase();
  if (first === 'Ä') return 'A';
  if (first === 'Ö') return 'O';
  if (first === 'Ü') return 'U';
  if (first === 'ß') return 'S';
  return /^[A-Z]$/.test(first) ? first : '';
}

export function calculateRoundPoints(rankIndex: number, totalPlayers: number): number {
  if (rankIndex < 0) return 0; // Still had cards left (last place)
  if (rankIndex === totalPlayers - 1 && totalPlayers > 1) return 0; // Last place
  if (rankIndex === 0) return 3;
  if (rankIndex === 1) return 2;
  return 1;
}
