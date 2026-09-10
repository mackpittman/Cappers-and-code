export type Team = { abbr: string; name: string; short: string };
export type LivePlayer = {
  best: number;
  bestBook?: string;
  consensus: number;
  books?: Record<string, number>;
  implied: number;
  open?: number | null;
  move?: number | null;
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
  edge?: number | null;
  gameId?: string;
  kickoff?: string;
};
export type Stack = { legs: string[]; why: string; type: 'sgp' | 'cross' | 'contrarian' };
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
  fetchedAt: string;
  ml: {
    home: number | null;
    away: number | null;
    bestHome: number | null;
    bestAway: number | null;
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
export type Board = {
  season: number;
  week: number;
  generatedAt: string;
  researchAsOf: string;
  oddsFetchedAt?: string | null;
  oddsCredits?: { remaining: number | null; used: number | null } | null;
  injuriesFetchedAt?: string | null;
  notes: string;
  completed: { id: string; away: string; home: string; final: string; tds: string[] }[];
  games: Game[];
  slateTop: Pick[];
  slateValue: Pick[];
  crossStacks: Stack[];
  upsetLeans: { team: string; price: number; winProb: number; why: string }[];
};
