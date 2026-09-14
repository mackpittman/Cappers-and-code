// The book bridge. Our slip is the source of truth; this turns it into whatever a given
// sportsbook can actually accept — a deep link into their slip, parser-ready text, or an
// ordered tap list for books with no integration at all.
import type { SlipItem, SlipLeg } from './slip';

// Kept local rather than imported from ./price so this module has no runtime imports at all and
// can be unit tested with node --experimental-strip-types, no bundler in the loop.
const fmtPrice = (n: number | null | undefined) => (n == null ? '—' : n > 0 ? `+${n}` : `${n}`);

export type BookKey =
  | 'fanduel'
  | 'draftkings'
  | 'betmgm'
  | 'caesars'
  | 'betrivers'
  | 'bovada'
  | 'betonlineag'
  | 'underdog'
  | 'courtside'
  | 'other';

export type Book = {
  key: BookKey;
  name: string;
  short: string;
  /** True when the odds feed can hand us a URL that lands a selection in this book's slip. */
  linkable: boolean;
  home: string;
  /** What this app can and cannot do for this book, in one honest sentence. */
  note: string;
};

export const BOOKS: Book[] = [
  {
    key: 'fanduel',
    name: 'FanDuel',
    short: 'FD',
    linkable: true,
    home: 'https://sportsbook.fanduel.com',
    note: 'Single selections can open straight in their slip when the feed gives us a link. Parlays still have to be built in their app.',
  },
  {
    key: 'draftkings',
    name: 'DraftKings',
    short: 'DK',
    linkable: true,
    home: 'https://sportsbook.draftkings.com',
    note: 'Single selections can open straight in their slip when the feed gives us a link. Parlays still have to be built in their app.',
  },
  {
    key: 'betmgm',
    name: 'BetMGM',
    short: 'MGM',
    linkable: true,
    home: 'https://sports.betmgm.com',
    note: 'Deep links arrive only when the odds feed publishes them for this book.',
  },
  {
    key: 'caesars',
    name: 'Caesars',
    short: 'CZR',
    linkable: true,
    home: 'https://sportsbook.caesars.com',
    note: 'Deep links arrive only when the odds feed publishes them for this book.',
  },
  {
    key: 'betrivers',
    name: 'BetRivers',
    short: 'BR',
    linkable: true,
    home: 'https://betrivers.com',
    note: 'Deep links arrive only when the odds feed publishes them for this book.',
  },
  {
    key: 'bovada',
    name: 'Bovada',
    short: 'BV',
    linkable: false,
    home: 'https://www.bovada.lv',
    note: 'No link target. Use the tap list or paste the text into their search.',
  },
  {
    key: 'betonlineag',
    name: 'BetOnline',
    short: 'BOL',
    linkable: false,
    home: 'https://www.betonline.ag',
    note: 'No link target. Use the tap list or paste the text into their search.',
  },
  {
    key: 'underdog',
    name: 'Underdog',
    short: 'UD',
    linkable: false,
    home: 'https://underdogfantasy.com',
    note: 'Pick-em style. Copy the legs and match them in their board, or run the text through a converter.',
  },
  {
    key: 'courtside',
    name: 'Courtside',
    short: 'CS',
    linkable: false,
    home: 'https://www.courtside.app',
    note: 'Social sportsbook with no public API, affiliate program, or slip link. Build-along is the fastest route here.',
  },
  {
    key: 'other',
    name: 'Another book',
    short: '—',
    linkable: false,
    home: '',
    note: 'Copy the legs as text, or open the shared slip on the phone you are betting from.',
  },
];

export const bookByKey = (k: string | null | undefined): Book =>
  BOOKS.find((b) => b.key === k) ?? BOOKS[BOOKS.length - 1];

/** Books in the feed use full keys; our slip rows carry short codes like FD. Map both ways. */
const SHORT: Record<string, BookKey> = {
  fd: 'fanduel',
  dk: 'draftkings',
  mgm: 'betmgm',
  czr: 'caesars',
  br: 'betrivers',
  bv: 'bovada',
  bol: 'betonlineag',
  ud: 'underdog',
  cs: 'courtside',
};
export const normBook = (s: string | null | undefined): BookKey | null => {
  if (!s) return null;
  const k = s.trim().toLowerCase();
  if (BOOKS.some((b) => b.key === k)) return k as BookKey;
  return SHORT[k] ?? null;
};

/** The deep link for this row at this book, or null when we have nothing that lands in their slip. */
export function deepLink(i: SlipItem, book: BookKey): string | null {
  if (!i.link) return null;
  // A row's link belongs to the book its price came from. Sending it anywhere else is a lie.
  const owner = normBook(i.book);
  if (owner && owner !== book) return null;
  return i.link;
}

/** One flat line per selection: what a betslip parser or a book's search box wants. */
export function legLines(i: SlipItem): string[] {
  if (i.legs?.length) return i.legs.map(legLine);
  return [legLine({ label: i.label, price: i.price ?? null, book: i.book ?? null })];
}
const legLine = (l: SlipLeg) => `${l.label}${l.price != null ? ` ${fmtPrice(l.price)}` : ''}`;

/**
 * Parser-ready text. `legs` flattens everything to one selection per line, which is what
 * screenshot-to-betslip converters read. `tickets` keeps each parlay together as a block.
 */
export function importText(list: SlipItem[], mode: 'legs' | 'tickets' = 'legs'): string {
  if (mode === 'legs') return list.flatMap(legLines).join('\n');
  return list
    .map((i) => {
      const lines = legLines(i);
      return lines.length > 1 ? `${lines.length}-leg parlay\n${lines.join('\n')}` : lines[0];
    })
    .join('\n\n');
}

export type TapStep = {
  id: string;
  /** What to type into the book's search box. */
  search: string;
  /** The selection to tap once the search lands. */
  selection: string;
  price: string;
  book: string | null;
  units: number;
  link: string | null;
};
export type TapSection = { game: string; steps: TapStep[] };

/** Strip the market off a label so what is left is searchable: a player or a team. */
export function searchTerm(label: string): string {
  return label
    .replace(
      /\s+(anytime\s+td|anytime\s+touchdown|\d\+\s*td[s]?|to\s+score.*|over|under|o\d|u\d)\b.*$/i,
      '',
    )
    .replace(/\s+[-+]?\d+(\.\d+)?\s*$/, '')
    .trim();
}

/**
 * Build-along order: grouped by game so you stay on one screen in their app, and within a
 * game the legs you are most likely to find together come first.
 */
export function tapOrder(list: SlipItem[], book: BookKey): TapSection[] {
  const rank: Record<string, number> = { side: 0, total: 1, ml: 2, atd: 3, td2: 4, prop: 5 };
  const byGame = new Map<string, TapStep[]>();
  for (const i of list) {
    const game = i.game_label ?? 'Cross-game and parlays';
    const steps = byGame.get(game) ?? [];
    const legs = i.legs?.length
      ? i.legs
      : [{ label: i.label, price: i.price ?? null, book: i.book }];
    legs.forEach((l, n) => {
      steps.push({
        id: `${i.id}:${n}`,
        search: searchTerm(l.label),
        selection: l.label,
        price: fmtPrice(l.price),
        book: l.book ?? i.book ?? null,
        units: Number(i.units) || 0,
        link: n === 0 ? deepLink(i, book) : null,
      });
    });
    byGame.set(game, steps);
  }
  const order = (s: TapStep) => {
    const item = list.find((i) => s.id.startsWith(`${i.id}:`));
    return rank[item?.kind ?? 'prop'] ?? 9;
  };
  return [...byGame.entries()].map(([game, steps]) => ({
    game,
    steps: [...steps].sort((a, b) => order(a) - order(b)),
  }));
}
