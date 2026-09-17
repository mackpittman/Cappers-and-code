export type Team = { abbr: string; name: string; short: string };
export type LivePlayer = {
  best: number;
  bestBook?: string;
  consensus: number;
  books?: Record<string, number>;
  /** Per-book deep links (bet slip when the book supports it, else market or event page). */
  links?: Record<string, string> | null;
  implied: number;
  open?: number | null;
  move?: number | null;
  fetchedAt?: string;
};
export type Pick = {
  name: string;
  team: string;
  pos: string;
  price: number | null;
  priceNote?: string;
  implied: number | null;
  est: number;
  why: string;
  live?: LivePlayer | null;
  /** 2+ touchdowns (player_tds_over at 1.5), better of the books, when posted. */
  live2?: LivePlayer | null;
  edge?: number | null;
  gameId?: string;
  kickoff?: string;
};
export type PropLean = {
  player: string;
  market: string;
  side: 'over' | 'under';
  line: number;
  why: string;
};
export type MarketLean = {
  projected: { away: number; home: number };
  side: string;
  sideConf: number;
  total: string;
  totalConf: number;
  why: string;
  propLeans: PropLean[];
};
export type PropLine = {
  market: string;
  label: string;
  name: string;
  line: number | null;
  over: number | null;
  under: number | null;
  bestOver: number | null;
  bestUnder: number | null;
  lineLow: number | null;
  lineHigh: number | null;
  fetchedAt: string;
  lean: { side: 'over' | 'under'; line: number; why: string; delta: number | null } | null;
};
export type BestBet = { game: string; gameLabel?: string; bet: string; conf: number; why: string };
export type Stack = { legs: string[]; why: string; type: 'sgp' | 'cross' | 'contrarian' };
/** A priced ticket the desk curates for a standalone game (Thursday, Sunday and Monday night). */
export type TicketLeg = { label: string; price: number | null; book?: string | null };
export type Ticket = {
  kind: 'anytime' | 'twoPlus' | 'sgp' | 'cross' | 'contrarian' | 'side' | 'total' | 'longshot';
  label?: string;
  legs: TicketLeg[];
  /** Parlay price at the book the legs were priced on; null when the book prices the SGP itself. */
  price: number | null;
  /** For 2+ TD singles: the price to play at or better. */
  minPrice?: number | null;
  prob: number | null;
  why: string;
  book?: string | null;
};
export type InjuryEntry = {
  name: string;
  pos?: string;
  status: string;
  type?: string;
  detail?: string;
  date?: string;
};
export type Lines = {
  spread: string;
  total: number;
  ml: { away: number; home: number };
  winProb: { away: number; home: number };
  implied: { away: number; home: number };
};
export type LiveLines = {
  source?: string;
  fetchedAt: string;
  ml: {
    home: number | null;
    away: number | null;
    bestHome: number | null;
    bestAway: number | null;
    openHome?: number | null;
    openAway?: number | null;
  };
  spread: { homePoint: number | null; homePrice: number | null; awayPrice: number | null };
  total: { point: number | null; over: number | null; under: number | null };
  winProb: { away: number; home: number } | null;
};
export type Game = {
  id: string;
  espnId: string;
  kickoff: string;
  venue: string;
  away: Team;
  home: Team;
  lines: Lines;
  sections: {
    offseason: string;
    matchup: string;
    injuries: string;
    oddsNotes: string;
    atdNotes: string;
  };
  atdBoard: {
    name: string;
    team: string;
    price: number;
    implied: number;
    live?: { best: number; bestBook?: string; consensus: number } | null;
  }[];
  top3: Pick[];
  value: Pick[];
  stacks: Stack[];
  tickets?: Ticket[];
  market?: MarketLean;
  propLines?: PropLine[];
  pulls?: Record<string, string>;
  status?: { state: string; detail: string; score: { away: number; home: number } } | null;
  live?: LiveLines | null;
  liveBoard?: {
    name: string;
    best: number;
    bestBook?: string;
    consensus: number;
    implied: number;
  }[];
  injuryReport?: { away: InjuryEntry[]; home: InjuryEntry[]; fetchedAt: string | null };
};
export type ParlayLeg = {
  type: 'atd' | 'td2' | 'side' | 'total' | 'text';
  label: string;
  player?: string;
  team?: string;
  game?: string;
  gameLabel?: string;
  kickoff?: string;
  prob: number | null;
  price: number | null;
  book: string;
  implied?: number;
  edge?: number;
  conf?: number;
  moved?: string | null;
  why?: string;
};
export type Parlay = {
  rank: number;
  legs: ParlayLeg[];
  price: number | null;
  decimal: number | null;
  prob: number | null;
  ev: number | null;
  fairPrice?: number;
  minPrice?: number;
  why: string;
};
export type ParlayCategory = {
  key: 'anytime' | 'twoPlus' | 'sides' | 'totals' | 'sameGame' | 'model';
  title: string;
  note: string;
  parlays: Parlay[];
};
export type Parlays = {
  builtAt: string;
  books: string[];
  oddsFetchedAt: string | null;
  note: string;
  categories: ParlayCategory[];
};
export type FeedAttachment = {
  name: string;
  url: string;
  type: string | null;
  width: number | null;
  height: number | null;
  size: number | null;
};
export type FeedEmbed = {
  title: string | null;
  description: string | null;
  url: string | null;
  image: string | null;
};
export type FeedPost = {
  id: string;
  channel_id: string;
  channel_name: string;
  capper: string | null;
  author_id: string;
  author_name: string;
  author_avatar: string | null;
  content: string;
  attachments: FeedAttachment[];
  embeds: FeedEmbed[];
  posted_at: string;
  edited_at: string | null;
};
export type Tally = { wins: number; losses: number; pushes: number; pending: number };
export type ResultItem = {
  game: string;
  gameLabel: string;
  final: string | null;
  type: 'side' | 'total' | 'atd' | 'prop';
  label: string;
  bucket: string;
  result: 'win' | 'loss' | 'push' | 'pending' | 'ungraded';
  conf?: number;
  est?: number;
  actual?: number | null;
};
export type Board = {
  season: number;
  week: number;
  generatedAt: string;
  researchAsOf: string;
  oddsFetchedAt?: string | null;
  oddsCredits?: {
    remaining: number | null;
    used: number | null;
    spent7d?: number;
    spent30d?: number;
    reserve?: number | null;
  } | null;
  creditPlan?: {
    monthly: number;
    phases: Record<string, string[]>;
    reserve: number;
    note: string;
  } | null;
  linesSource?: string | null;
  injuriesFetchedAt?: string | null;
  notes: string;
  completed: { id: string; away: string; home: string; final: string; tds: string[] }[];
  games: Game[];
  slateTop: Pick[];
  slateValue: Pick[];
  bestBets?: BestBet[];
  results?: {
    gradedAt: string;
    finals: number;
    games: number;
    summary: Record<string, Tally>;
    items: ResultItem[];
  } | null;
  record?: {
    updatedAt: string;
    season_totals: Record<string, Tally>;
    weeks: { week: number; finals: number; games: number; summary: Record<string, Tally> }[];
  } | null;
  crossStacks: Stack[];
  parlays?: Parlays | null;
  upsetLeans: { team: string; price: number; winProb: number; why: string }[];
};
