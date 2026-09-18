// Auto-settling the bet slip from the graded board.
//
// grade-results already decides every pick's outcome from the final box score and writes it onto
// the board as results.items. The slip was not reading any of it, so a member had to tap WON or
// LOST on every row by hand and the tracker's record only ever reflected what they remembered to
// mark. This maps one to the other.
//
// Two things make the match non-trivial:
//   1. The same bet is written differently in each place. The board says "Amon-Ra St. Brown ATD
//      +115", the slip says "Amon-Ra St. Brown anytime TD". So both sides get normalized first.
//   2. A ticket is a parlay of legs the board only grades individually, so a multi-leg slip row is
//      settled from its legs: one loser sinks it, every leg has to land for it to win.
import type { Board, ResultItem } from './types';
import type { SlipItem, SlipStatus } from './slip';

export type Outcome = 'win' | 'loss' | 'push';

/**
 * Reduce a bet description to something comparable. Prices, books and the several spellings of a
 * touchdown prop all vary between the board and the slip without changing what was bet.
 */
export function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+anytime\s+(touchdown|td)\b/g, ' atd')
    .replace(/\s+to\s+score\b/g, ' atd')
    .replace(/(\d)\+\s*(touchdowns|tds|td)\b/g, '$1+ td')
    // Strip American prices, which differ between where a bet was seen and where it was taken.
    // Three digits minimum on purpose: a two-digit rule would swallow the number in a spread like
    // "BUF -10", and no American price is smaller than 100.
    .replace(/\s*[+-]\d{3,4}(?!\.)\b/g, ' ')
    .replace(/[(),]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type ResultIndex = {
  byGame: Map<string, Outcome>;
  byLabel: Map<string, Outcome | null>; // null where the same label graded inconsistently
};

/** Build lookup tables once per board rather than scanning the item list per slip row. */
export function indexResults(items: ResultItem[] | undefined | null): ResultIndex {
  const byGame = new Map<string, Outcome>();
  const seen = new Map<string, Set<Outcome>>();
  for (const r of items ?? []) {
    if (r.result !== 'win' && r.result !== 'loss' && r.result !== 'push') continue;
    const norm = normalizeLabel(r.label);
    byGame.set(`${r.game}|${norm}`, r.result);
    const set = seen.get(norm) ?? new Set<Outcome>();
    set.add(r.result);
    seen.set(norm, set);
  }
  const byLabel = new Map<string, Outcome | null>();
  // A bare label is only safe to trust when every game that graded it agrees, which is what stops
  // "Over 54.5" in one game settling a different game's identical total.
  for (const [norm, set] of seen) byLabel.set(norm, set.size === 1 ? [...set][0] : null);
  return { byGame, byLabel };
}

function lookup(index: ResultIndex, label: string, gameId?: string | null): Outcome | null {
  const norm = normalizeLabel(label);
  if (gameId) {
    const hit = index.byGame.get(`${gameId}|${norm}`);
    if (hit) return hit;
  }
  // Cross-game tickets carry legs from several games, so fall back to the label alone, but only
  // where it is unambiguous across the whole board.
  return index.byLabel.get(norm) ?? null;
}

/**
 * What this slip row should become, or null to leave it alone. Returning null covers both "not
 * graded yet" and "we cannot tell", and both mean the member keeps control of the row.
 */
export function settleItem(item: SlipItem, index: ResultIndex): SlipStatus | null {
  const legs = item.legs ?? [];
  if (legs.length > 1) {
    const outcomes = legs.map((l) => lookup(index, l.label, item.game_id));
    if (outcomes.some((o) => o === null)) return null; // a leg is still open
    if (outcomes.some((o) => o === 'loss')) return 'lost';
    if (outcomes.every((o) => o === 'push')) return 'push';
    return outcomes.every((o) => o === 'win' || o === 'push') ? 'won' : null;
  }
  const single = lookup(index, legs[0]?.label ?? item.label, item.game_id);
  return single === 'win' ? 'won' : single === 'loss' ? 'lost' : single === 'push' ? 'push' : null;
}

/** Rows a member has already judged are theirs; only untouched ones are ours to settle. */
export const isSettleable = (i: SlipItem) => i.status === 'queued' || i.status === 'placed';

/** Every row the board can now decide, with the status it should take. */
export function pendingSettlements(
  items: SlipItem[],
  board: Board | null | undefined,
): { id: string; status: SlipStatus }[] {
  // results.legs carries outcomes for players who only ever appeared inside a ticket, which is
  // what lets a parlay settle. They are kept out of the desk's record but belong here.
  const index = indexResults([...(board?.results?.items ?? []), ...(board?.results?.legs ?? [])]);
  if (!index.byGame.size) return [];
  const out: { id: string; status: SlipStatus }[] = [];
  for (const item of items) {
    if (!isSettleable(item)) continue;
    const status = settleItem(item, index);
    if (status) out.push({ id: item.id, status });
  }
  return out;
}
