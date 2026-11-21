import {
  isRareLetter,
  matchesLetterCard,
  normalizeWord,
  shuffleArray,
  stripGermanArticle,
} from './themesAndCards';

interface ThemeWordGroup {
  keywords: string[];
  wordsByLetter: Partial<Record<string, string[]>>;
}

const THEME_WORD_GROUPS: ThemeWordGroup[] = [
  {
    keywords: ['tier', 'wald', 'meer', 'zoo', 'bauernhof', 'vogel', 'vögel', 'insekt', 'haustier', 'natur', 'fisch'],
    wordsByLetter: {
      A: ['Affe', 'Adler', 'Ameise', 'Alpaka'],
      B: ['Bär', 'Biber', 'Biene', 'Bussard'],
      C: ['Chamäleon', 'Clownfisch'],
      D: ['Dachs', 'Delfin', 'Drossel'],
      E: ['Elefant', 'Eule', 'Eichhörnchen', 'Ente', 'Esel'],
      F: ['Fuchs', 'Frosch', 'Flamingo', 'Forelle', 'Falke'],
      G: ['Giraffe', 'Gans', 'Gecko', 'Gorilla'],
      H: ['Hund', 'Hase', 'Hirsch', 'Hamster', 'Huhn'],
      I: ['Igel', 'Iltis'],
      J: ['Jaguar'],
      K: ['Katze', 'Känguru', 'Koala', 'Krokodil', 'Kuh', 'Käfer'],
      L: ['Löwe', 'Luchs', 'Libelle', 'Lama'],
      M: ['Maus', 'Maulwurf', 'Möwe', 'Marder'],
      N: ['Nashorn', 'Nachtigall', 'Nilpferd'],
      O: ['Otter', 'Oktopus', 'Orca'],
      P: ['Panda', 'Pinguin', 'Pferd', 'Papagei', 'Panther'],
      Q: ['Qualle', 'Quokka'],
      R: ['Reh', 'Rabe', 'Robbe', 'Rentier'],
      S: ['Schlange', 'Schaf', 'Schwan', 'Schmetterling', 'Seelöwe', 'Spatz'],
      T: ['Tiger', 'Taube', 'Tintenfisch', 'Tapir'],
      U: ['Uhu', 'Unke'],
      V: ['Vogel', 'Viper'],
      W: ['Wolf', 'Wal', 'Waschbär', 'Wildschwein', 'Wespe'],
      X: ['Xenopus'],
      Y: ['Yak'],
      Z: ['Zebra', 'Ziege', 'Zitteraal'],
    },
  },
  {
    keywords: ['essen', 'küche', 'kühlschrank', 'obst', 'gemüse', 'pizza', 'frühstück', 'eis', 'backen', 'kuchen', 'getränk', 'suppe', 'picknick', 'restaurant', 'grill', 'käse', 'brot', 'nudeln', 'süß', 'snack'],
    wordsByLetter: {
      A: ['Apfel', 'Ananas', 'Aprikose', 'Avocado'],
      B: ['Banane', 'Brot', 'Brezel', 'Butter', 'Brokkoli', 'Birne'],
      C: ['Croissant', 'Chips', 'Curry'],
      D: ['Dattel', 'Donut', 'Döner'],
      E: ['Erdbeere', 'Eis', 'Eierkuchen', 'Erbse', 'Espresso'],
      F: ['Fisch', 'Feige', 'Fenchel', 'Frikadelle'],
      G: ['Gurke', 'Gulasch', 'Grapefruit', 'Gnocchi'],
      H: ['Honig', 'Himbeere', 'Hamburger', 'Haselnuss', 'Haferflocken'],
      I: ['Ingwer', 'Imbiss'],
      J: ['Joghurt', 'Johannisbeere'],
      K: ['Käse', 'Kartoffel', 'Kirsche', 'Kuchen', 'Kakao', 'Karotte'],
      L: ['Limonade', 'Lachs', 'Lasagne', 'Lauch', 'Linsensuppe'],
      M: ['Milch', 'Mandarine', 'Marmelade', 'Melone', 'Muffin', 'Müsli'],
      N: ['Nudel', 'Nuss', 'Nektarine'],
      O: ['Orange', 'Olive', 'Omelett', 'Orangensaft'],
      P: ['Pizza', 'Pfannkuchen', 'Paprika', 'Pudding', 'Pflaume', 'Pommes'],
      Q: ['Quark', 'Quiche', 'Quitte'],
      R: ['Reis', 'Radieschen', 'Rührei', 'Rosine'],
      S: ['Salat', 'Schokolade', 'Spaghetti', 'Suppe', 'Senf', 'Spinat'],
      T: ['Tomate', 'Toast', 'Torte', 'Tee', 'Traube'],
      U: ['Udon'],
      V: ['Vanilleeis', 'Vollkornbrot'],
      W: ['Waffel', 'Wasser', 'Wurst', 'Wassermelone', 'Walnuss'],
      Y: ['Yuzu'],
      Z: ['Zitrone', 'Zucker', 'Zwiebel', 'Zucchini', 'Zimt'],
    },
  },
  {
    keywords: ['reise', 'welt', 'land', 'länder', 'stadt', 'städte', 'urlaub', 'koffer', 'camping', 'strand', 'hotel', 'flughafen', 'zug', 'verkehr', 'bauwerk', 'insel', 'fluss', 'berg', 'sommer', 'winter'],
    wordsByLetter: {
      A: ['Auto', 'Alpen', 'Amsterdam', 'Athen', 'Australien'],
      B: ['Berlin', 'Bahnhof', 'Bus', 'Boot', 'Brasilien', 'Badehose'],
      C: ['Campingplatz', 'Cabrio', 'Chicago'],
      D: ['Deutschland', 'Dänemark', 'Dresden', 'Donau'],
      E: ['England', 'Eiffelturm', 'Elbe', 'Eisenbahn'],
      F: ['Flugzeug', 'Frankreich', 'Fähre', 'Fahrkarte', 'Florenz'],
      G: ['Griechenland', 'Gepäck', 'Gondel'],
      H: ['Hamburg', 'Hotel', 'Hafen', 'Holland', 'Hubschrauber'],
      I: ['Italien', 'Insel', 'Irland', 'Innsbruck'],
      J: ['Japan', 'Jugendherberge'],
      K: ['Koffer', 'Köln', 'Kanada', 'Kroatien', 'Kompass', 'Kamera'],
      L: ['London', 'Landkarte', 'Lissabon', 'Luftmatratze'],
      M: ['München', 'Madrid', 'Meer', 'Mallorca', 'Mexiko'],
      N: ['Norwegen', 'Neapel', 'Nordsee'],
      O: ['Österreich', 'Oslo', 'Ostsee', 'Ozean'],
      P: ['Paris', 'Pass', 'Portugal', 'Prag', 'Polen'],
      Q: ['Quartier'],
      R: ['Rom', 'Rucksack', 'Reisepass', 'Rhein'],
      S: ['Spanien', 'Schweiz', 'Schiff', 'Strand', 'Sonnencreme', 'Schweden'],
      T: ['Ticket', 'Taschenlampe', 'Türkei', 'Taxi', 'Tirol'],
      U: ['U-Bahn', 'Urlaub', 'Ungarn'],
      V: ['Venedig', 'Visum', 'Vespa'],
      W: ['Wien', 'Wohnmobil', 'Wanderkarte', 'Weltkarte'],
      Y: ['Yacht'],
      Z: ['Zug', 'Zelt', 'Zürich', 'Zeppelin'],
    },
  },
  {
    keywords: ['alltag', 'zuhause', 'bad', 'schublade', 'schreibtisch', 'kleider', 'keller', 'werkzeug', 'möbel', 'wohnzimmer', 'garten', 'einkauf', 'putzen', 'nachttisch', 'büro', 'papier', 'rucksack'],
    wordsByLetter: {
      A: ['Armbanduhr', 'Abfalleimer', 'Akkuschrauber', 'Anzug'],
      B: ['Bürste', 'Bett', 'Besen', 'Brille', 'Blumentopf', 'Buch'],
      C: ['Computer', 'Couch'],
      D: ['Decke', 'Drucker', 'Duschgel', 'Dose'],
      E: ['Eimer', 'Einkaufstasche', 'Eieruhr'],
      F: ['Fenster', 'Föhn', 'Fernbedienung', 'Flasche', 'Feuerzeug'],
      G: ['Gießkanne', 'Gardine', 'Geldbeutel', 'Glühbirne'],
      H: ['Handtuch', 'Hammer', 'Heizung', 'Hose', 'Hausschuhe'],
      I: ['Imbusschlüssel', 'Isolierband'],
      J: ['Jacke', 'Jalousie'],
      K: ['Kamm', 'Kissen', 'Kerze', 'Kugelschreiber', 'Kleiderschrank', 'Kabel'],
      L: ['Lampe', 'Lappen', 'Ladekabel', 'Lineal', 'Löffel'],
      M: ['Mülleimer', 'Matratze', 'Monitor', 'Messer'],
      N: ['Nagelschere', 'Notizblock', 'Nachttisch'],
      O: ['Ordner', 'Ohrring'],
      P: ['Pflaster', 'Papier', 'Pullover', 'Pinsel'],
      Q: ['Quittung'],
      R: ['Regal', 'Regenschirm', 'Radio', 'Rucksack'],
      S: ['Schere', 'Seife', 'Stuhl', 'Schlüssel', 'Spiegel', 'Sofa', 'Staubsauger'],
      T: ['Tisch', 'Teppich', 'Taschentuch', 'Telefon', 'Tasse', 'Topf'],
      U: ['Uhr', 'Unterhose'],
      V: ['Vase', 'Vorhang', 'Verlängerungskabel'],
      W: ['Wecker', 'Waschmaschine', 'Wäschekorb', 'Werkzeugkiste'],
      Z: ['Zahnbürste', 'Zahnpasta', 'Zange', 'Zollstock', 'Zeitung'],
    },
  },
  {
    keywords: ['sport', 'freizeit', 'spiel', 'ball', 'wasser', 'winter', 'musik', 'instrument', 'film', 'buch', 'bücher', 'kino', 'märchen', 'tanz', 'zirkus', 'hobby', 'fahrrad', 'schwimmbad'],
    wordsByLetter: {
      A: ['Akkordeon', 'Achterbahn', 'Anpfiff'],
      B: ['Basketball', 'Ball', 'Badminton', 'Bastelschere', 'Blockflöte'],
      C: ['Cello', 'Clown', 'Comic'],
      D: ['Dart', 'Domino', 'Drachen'],
      E: ['Eishockey', 'Eiskunstlauf', 'Elfmeter', 'E-Gitarre'],
      F: ['Fußball', 'Fahrrad', 'Flöte', 'Frisbee', 'Federball'],
      G: ['Gitarre', 'Golf', 'Geige', 'Gymnastik'],
      H: ['Handball', 'Harfe', 'Helm', 'Hörspiel'],
      I: ['Inliner', 'Instrument'],
      J: ['Judo', 'Jonglieren', 'Jazz'],
      K: ['Klavier', 'Klettern', 'Kino', 'Kartenspiel', 'Kanu'],
      L: ['Leichtathletik', 'Lied', 'Luftpumpe'],
      M: ['Mikrofon', 'Märchen', 'Memory', 'Marathon', 'Mundharmonika'],
      N: ['Notenheft', 'Netz'],
      O: ['Orgel', 'Olympia', 'Oper'],
      P: ['Popcorn', 'Puzzeln', 'Posaune', 'Pfeife', 'Pokal'],
      Q: ['Quiz', 'Querflöte'],
      R: ['Rodel', 'Radsport', 'Racket', 'Roman'],
      S: ['Schwimmen', 'Schlagzeug', 'Ski', 'Schach', 'Skateboard', 'Seilspringen'],
      T: ['Tennis', 'Trompete', 'Tischtennis', 'Turnen', 'Theater', 'Trikot'],
      U: ['Ukulele', 'Uno'],
      V: ['Volleyball', 'Violine'],
      W: ['Wandern', 'Würfel', 'Wasserball', 'Wettlauf'],
      X: ['Xylofon'],
      Y: ['Yoga'],
      Z: ['Zirkus', 'Zeichentrick', 'Ziel'],
    },
  },
  {
    keywords: ['panne', 'schief', 'peinlich', 'passiert', 'ärger', 'missgeschick', 'chaos', 'unfall', 'stress'],
    wordsByLetter: {
      A: ['Auto liegengeblieben', 'Alarm verschlafen'],
      B: ['Badehose vergessen', 'Bus verpasst'],
      D: ['Dusche kalt geblieben'],
      E: ['Eis heruntergefallen'],
      F: ['Flug verpasst', 'Fahrkarte verloren'],
      G: ['Geldbeutel vergessen', 'Gepäck verschwunden'],
      H: ['Handy im Pool', 'Haustür zugefallen'],
      K: ['Koffer verloren', 'Kaffee verschüttet'],
      L: ['Ladekabel vergessen', 'Luftmatratze geplatzt'],
      M: ['Magen verdorben', 'Mütze weggeflogen'],
      N: ['Navi ausgefallen'],
      P: ['Pass abgelaufen', 'Platten am Fahrrad'],
      Q: ['Quittung verloren', 'Aquaplaning gehabt'],
      R: ['Reifen geplatzt', 'Regenschirm vergessen'],
      S: ['Sonnenbrand geholt', 'Schlüssel verlegt'],
      T: ['Taxi verpasst', 'Ticket vergessen'],
      U: ['Uhr stehengeblieben'],
      V: ['Verlaufen in der Altstadt'],
      W: ['WLAN ausgefallen', 'Wecker überhört'],
      X: ['Taxi verpasst', 'Extraportion verloren'],
      Y: ['Handy ins Wasser gefallen'],
      Z: ['Zug verpasst', 'Zelt undicht'],
    },
  },
];

const GENERAL_GERMAN_WORDS: Record<string, string[]> = {
  A: ['Apfel', 'Auto', 'Adler', 'Armband', 'Ampel', 'Anker', 'Abend', 'Ameise'],
  B: ['Ball', 'Baum', 'Buch', 'Brille', 'Blume', 'Brot', 'Bus', 'Bär'],
  C: ['Computer', 'Clown', 'Camping', 'Couch', 'Croissant', 'Cello'],
  D: ['Dach', 'Delfin', 'Drachen', 'Decke', 'Drucker', 'Dose', 'Donner'],
  E: ['Elefant', 'Ente', 'Eimer', 'Eule', 'Eis', 'Erdbeere', 'Engel', 'Erde'],
  F: ['Fisch', 'Fenster', 'Fahrrad', 'Fuchs', 'Flasche', 'Flugzeug', 'Feder'],
  G: ['Garten', 'Gitarre', 'Gurke', 'Glas', 'Giraffe', 'Glocke', 'Gabel'],
  H: ['Haus', 'Hund', 'Hut', 'Handy', 'Hammer', 'Himmel', 'Honig', 'Hase'],
  I: ['Insel', 'Igel', 'Ingwer', 'Imbiss', 'Instrument', 'Indianer'],
  J: ['Jacke', 'Joghurt', 'Jaguar', 'Jahr', 'Jäger', 'Junge', 'Juwel'],
  K: ['Katze', 'Kaffee', 'Kamera', 'Kerze', 'Koffer', 'Kuchen', 'Kissen', 'Kamm'],
  L: ['Lampe', 'Löwe', 'Löffel', 'Luftballon', 'Leiter', 'Lied', 'Laterne'],
  M: ['Maus', 'Mond', 'Milch', 'Messer', 'Mantel', 'Musik', 'Meer', 'Mütze'],
  N: ['Nacht', 'Nase', 'Nudel', 'Nest', 'Nebel', 'Nagel', 'Natur', 'Nuss'],
  O: ['Orange', 'Ozean', 'Ohr', 'Ofen', 'Ordner', 'Olive', 'Oma', 'Ostern'],
  P: ['Pizza', 'Pferd', 'Papier', 'Pinsel', 'Paket', 'Park', 'Palme', 'Puppe'],
  Q: ['Quark', 'Qualle', 'Quelle', 'Quiz', 'Quitte', 'Quadrat'],
  R: ['Regen', 'Rad', 'Radio', 'Rucksack', 'Ring', 'Rose', 'Robbe', 'Reis'],
  S: ['Sonne', 'Schuh', 'Stuhl', 'Schlüssel', 'Schiff', 'Stern', 'Salat', 'Sofa'],
  T: ['Tisch', 'Tasse', 'Tiger', 'Tasche', 'Telefon', 'Traum', 'Tür', 'Tomate'],
  U: ['Uhr', 'Urlaub', 'Ufer', 'Uhu', 'Umschlag', 'Untertasse', 'Unwetter'],
  V: ['Vogel', 'Vase', 'Vulkan', 'Violine', 'Vorhang', 'Vater', 'Velo'],
  W: ['Wasser', 'Wald', 'Wolke', 'Wagen', 'Wecker', 'Wiese', 'Wind', 'Welle'],
  X: ['Taxi', 'Xylofon', 'Mixer', 'Boxen', 'Hexerei'],
  Y: ['Handy', 'Yacht', 'Yoga', 'Hobby', 'Baby'],
  Z: ['Zug', 'Zebra', 'Zitrone', 'Zelt', 'Zeit', 'Zange', 'Zucker', 'Zaun'],
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function isWordAvailable(
  word: string,
  expectedCardLetter: string,
  usedSet: Set<string>
): boolean {
  const norm = normalizeWord(stripGermanArticle(word)) || normalizeWord(word);
  if (!norm || norm.length < 2) return false;
  if (usedSet.has(norm)) return false;
  return matchesLetterCard(word, expectedCardLetter);
}

export function findLocalBotWord(params: {
  theme: string;
  cards: string[];
  usedWords: string[];
}): { word: string; letter: string } | null {
  const { theme, cards, usedWords } = params;
  if (cards.length === 0) return null;

  const usedSet = new Set(usedWords.map((w) => normalizeWord(w)));
  const themeLower = theme.toLowerCase();

  // Match thematic groups whose keywords appear in current theme
  const matchingGroups = THEME_WORD_GROUPS.filter((group) =>
    group.keywords.some((kw) => themeLower.includes(kw))
  );

  // Priority: regular cards first, then rare Q/X/Y cards, then JOKER last
  const regularLetters = shuffleArray(
    Array.from(new Set(cards.filter((c) => c !== 'JOKER' && !isRareLetter(c))))
  );
  const rareLetters = shuffleArray(
    Array.from(new Set(cards.filter((c) => isRareLetter(c))))
  );
  const orderedNonJokerLetters = [...regularLetters, ...rareLetters];
  const hasJoker = cards.includes('JOKER');

  // 1. Try thematic group words for regular & rare cards
  for (const letter of orderedNonJokerLetters) {
    for (const group of matchingGroups) {
      const candidates = shuffleArray(group.wordsByLetter[letter] ?? []);
      const hit = candidates.find((w) => isWordAvailable(w, letter, usedSet));
      if (hit) {
        return { word: hit, letter };
      }
    }
  }

  // 2. Try general German dictionary for regular & rare cards
  for (const letter of orderedNonJokerLetters) {
    const candidates = shuffleArray(GENERAL_GERMAN_WORDS[letter] ?? []);
    const hit = candidates.find((w) => isWordAvailable(w, letter, usedSet));
    if (hit) {
      return { word: hit, letter };
    }
    // For rare Q/X/Y cards, also scan across all general words if needed
    if (isRareLetter(letter)) {
      const allGeneral = shuffleArray(Object.values(GENERAL_GERMAN_WORDS).flat());
      const rareHit = allGeneral.find((w) => isWordAvailable(w, letter, usedSet));
      if (rareHit) {
        return { word: rareHit, letter };
      }
    }
  }

  // 3. Try JOKER with thematic words first, then general dictionary
  if (hasJoker) {
    for (const group of matchingGroups) {
      const allGroupWords = shuffleArray(
        Object.values(group.wordsByLetter).flatMap((list) => list ?? [])
      );
      const hit = allGroupWords.find((w) => isWordAvailable(w, 'JOKER', usedSet));
      if (hit) {
        return { word: hit, letter: 'JOKER' };
      }
    }

    for (const letter of shuffleArray(ALPHABET)) {
      const candidates = shuffleArray(GENERAL_GERMAN_WORDS[letter] ?? []);
      const hit = candidates.find((w) => isWordAvailable(w, 'JOKER', usedSet));
      if (hit) {
        return { word: hit, letter: 'JOKER' };
      }
    }
  }

  // 4. Ultimate fallback
  const fallbackLetter = orderedNonJokerLetters[0] ?? 'A';
  const fallbackPool = GENERAL_GERMAN_WORDS[fallbackLetter] ?? GENERAL_GERMAN_WORDS.A;
  return {
    word: fallbackPool[0],
    letter: orderedNonJokerLetters.length > 0 ? fallbackLetter : 'JOKER',
  };
}
