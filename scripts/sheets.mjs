// The weekly sheets: five tickets per category, chosen for quality rather than coverage.
//
// The board's parlay builder (parlays.mjs) answers "what can be built"; this answers "what goes on
// the sheet". The rules are stricter and they are the point:
//
//   - Every leg carries positive model edge against its own price. A long shot is not a place to
//     hide a leg the model does not like because the payout is big.
//   - One leg per game, always. Two legs from the same game are correlated and a straight product
//     overstates the ticket; the sheets never claim a number they cannot defend.
//   - A player ruled Out or Doubtful is never a leg (parlays.mjs enforces that). A player carrying
//     any designation at all is never on a long shot: one Questionable tag on a five-leg ticket is
//     a five-leg ticket with a hole in it.
//   - No leg appears on more than one ticket within a sheet (long shots: at most two), so five
//     tickets are five different opinions rather than one opinion permuted.
//
// Pure functions, no I/O. build-sheets.mjs renders the result.
import {
  atdLegs,
  sideLegs,
  totalLegs,
  twoPlusProb,
  isBellcow,
  fairAmerican,
  toDecimal,
  toAmerican,
  impliedFromAmerican,
  priceParlay,
  combos,
} from './parlays.mjs';

const round = (x, d = 3) => +x.toFixed(d);

/** Price bands for the long-shot sheets, in American odds. */
export const BANDS = {
  long2k: { min: 2000, max: 2999, minProb: 0.04, sizes: [3, 4] },
  long3k: { min: 3000, max: 5999, minProb: 0.02, sizes: [3, 4, 5] },
};

/** Joint implied probability of a ticket at the book's prices: what the price says, not the model. */
export function impliedJoint(legs) {
  return round(
    legs.reduce((p, l) => p * impliedFromAmerican(l.price), 1),
    4,
  );
}

/**
 * Greedy diversification. Takes candidates already sorted best-first and keeps the first `n` that
 * pass two tests: no leg has been used more than `maxPerLeg` times, and the ticket shares no more
 * than `maxShared` legs with any ticket already kept (or listed in `against`). The second test is
 * what turns "five permutations of one idea" into five ideas: two four-leg tickets that agree on
 * three legs are the same opinion with one name swapped.
 *
 * `used` may be passed in and is mutated, so a second sheet can be built against the first one's
 * legs. Sorting first and filtering second is deliberate: the best ticket always makes the sheet.
 */
export function diversify(sorted, n, opts = {}) {
  const {
    maxPerLeg = 1,
    maxShared = Infinity,
    used = new Map(),
    against = [],
    maxSharedAgainst = maxShared,
  } = opts;
  const out = [];
  const shared = (a, b) => a.legs.filter((l) => b.legs.some((m) => m.label === l.label)).length;
  for (const t of sorted) {
    if (out.length === n) break;
    if (t.legs.some((l) => (used.get(l.label) ?? 0) >= maxPerLeg)) continue;
    if (out.some((k) => shared(t, k) > maxShared)) continue;
    if (against.some((k) => shared(t, k) > maxSharedAgainst)) continue;
    for (const l of t.legs) used.set(l.label, (used.get(l.label) ?? 0) + 1);
    out.push(t);
  }
  return out.map((t, i) => ({ rank: i + 1, ...t }));
}

/** Cross-game combinations of `sizes` legs, priced, with one leg per game. */
export function tickets(legs, sizes, filter = () => true) {
  const out = [];
  for (const k of sizes) {
    if (legs.length < k) continue;
    for (const c of combos(legs, k)) {
      if (new Set(c.map((l) => l.game)).size !== k) continue;
      const priced = priceParlay(c);
      const t = { legs: c, ...priced, implied: impliedJoint(c) };
      if (filter(t)) out.push(t);
    }
  }
  return out;
}

/** Playable-ticket score: EV weighted toward tickets that actually hit. */
export const playable = (t) => t.ev * Math.sqrt(t.prob);
const byScore = (score) => (a, b) => score(b) - score(a) || b.prob - a.prob;

/** 2+ TD legs from anytime legs that carry a real FD/DK 2+ price. */
export function twoPlusLegs(atd) {
  const out = [];
  for (const l of atd) {
    if (!l.td2) continue;
    const prob = round(twoPlusProb(l.prob));
    const implied = round(impliedFromAmerican(l.td2.price));
    out.push({
      ...l,
      type: 'td2',
      label: `${l.player} 2+ TDs`,
      price: l.td2.price,
      book: l.td2.book,
      prob,
      implied,
      edge: round(prob - implied),
      fair: fairAmerican(prob),
      bellcow: isBellcow(l.prob),
      anytime: l.prob,
      td2: null,
    });
  }
  return out;
}

/** Edge a leg needs, in probability points, to be trusted on a ticket of that length. */
export const EDGE_FLOOR = { short: 0.03, long: 0.05 };
/** Positions the 2+ TD sheet is written for: the ones the conversion was graded on. */
export const TD2_POSITIONS = new Set(['RB', 'QB']);
/** Anytime sheet ceiling: above this a ticket belongs on a long-shot sheet, not here. */
export const ANYTIME_MAX_PRICE = 1500;

export function buildSheets(board, opts = {}) {
  const n = opts.perSheet ?? 5;

  // Leg pools. Positive edge is the entry ticket; a long ticket asks for more of it, because a
  // near-coin-flip favourite added to a three-leg ticket does nothing but push it into a band.
  const scorers = atdLegs(board);
  const atdAll = scorers.filter((l) => l.edge >= EDGE_FLOOR.short && l.prob >= 0.35);
  const atdLong = atdAll.filter((l) => !l.status && l.edge >= EDGE_FLOOR.long);
  // The 2+ market is its own market. A back priced -225 to score once carries no anytime edge and
  // is rightly off the anytime sheets, but that same price is why his 2+ number can be the best
  // value on the board: the book has already paid for the first touchdown.
  const td2All = twoPlusLegs(scorers.filter((l) => l.prob >= 0.35)).filter(
    (l) => l.edge >= EDGE_FLOOR.short,
  );
  const td2Long = td2All.filter((l) => !l.status && l.edge >= EDGE_FLOOR.long);
  const sides = sideLegs(board).filter((l) => l.conf >= 2 && l.edge > 0);
  const totals = totalLegs(board).filter((l) => l.conf >= 2 && l.edge > 0);

  // Locked In: two doubles, then three triples, no leg twice. Sides and totals together, one leg
  // per game so a side never rides with its own total. The doubles exist because a reader who
  // plays one thing off this sheet should have a ticket that hits three times in ten.
  const lockedPool = [...sides, ...totals];
  const lockedUsed = new Map();
  const doubles = diversify(tickets(lockedPool, [2]).sort(byScore(playable)), 2, {
    used: lockedUsed,
  });
  const triples = diversify(tickets(lockedPool, [3]).sort(byScore(playable)), n - doubles.length, {
    used: lockedUsed,
  });
  const lockedIn = [...doubles, ...triples].map((t, i) => ({ ...t, rank: i + 1 }));

  // Anytime: two or three scorers across games, priced under the long-shot floor. A Questionable
  // player may ride here and is shown as such; the sheet is short enough to read the tag.
  const anytime = diversify(
    tickets(
      [...atdAll].sort((a, b) => b.edge - a.edge).slice(0, 16),
      [2, 3],
      (t) => t.prob >= 0.15 && t.price <= ANYTIME_MAX_PRICE,
    ).sort(byScore(playable)),
    n,
  );

  // 2+ TD: singles at the real price. Backs and quarterbacks only. The 2+ conversion, and the
  // bell-cow lift on top of it, were graded in Week 1 on players who own the goal line; a tight
  // end at +1700 whose whole case is one contrarian anytime estimate is a different bet, and it
  // has a home on the long-shot sheets if it clears their floors. The model's fair price is shown
  // beside the book's so the reader sees the gap rather than taking it on faith.
  const twoPlus = td2All
    .filter((l) => TD2_POSITIONS.has(l.pos))
    .map((l) => {
      const dec = toDecimal(l.price);
      return {
        legs: [l],
        decimal: round(dec),
        price: l.price,
        prob: l.prob,
        implied: l.implied,
        ev: round(l.prob * dec - 1),
      };
    })
    .filter((t) => t.ev > 0)
    // Playable score, not raw EV: a bell-cow at +260 for two is what this sheet is for, and raw EV
    // would bury him under +2000 tight ends whose whole edge is one contrarian estimate.
    .sort(byScore(playable))
    .slice(0, n)
    .map((t, i) => ({ rank: i + 1, ...t }));

  // Long shots: clean anytime legs with real edge plus priced 2+ TD legs, three to six legs,
  // inside a price band, above a hit-rate floor, ranked by EV. Within a sheet a leg may appear
  // twice but two tickets never share more than one leg. The +3000 sheet is built against the
  // +2000 sheet and may share two legs with a ticket there: a +2000 ticket extended by one more
  // real-edge scorer is a ladder, not a copy. What it may not do is extend one with a coin-flip
  // favourite, and the long-ticket edge floor is what stops that.
  const pool = [
    ...[...atdLong].sort((a, b) => b.edge - a.edge).slice(0, 18),
    ...[...td2Long].sort((a, b) => b.edge - a.edge).slice(0, 8),
  ];
  const longUsed = new Map();
  const band = (key, against) => {
    const b = BANDS[key];
    return diversify(
      tickets(
        pool,
        b.sizes,
        (t) => t.price >= b.min && t.price <= b.max && t.prob >= b.minProb,
      ).sort((a, c) => c.ev - a.ev || c.prob - a.prob),
      n,
      { maxPerLeg: 2, maxShared: 1, used: longUsed, against, maxSharedAgainst: 2 },
    );
  };
  const long2k = band('long2k', []);
  const long3k = band('long3k', long2k);

  return {
    builtAt: new Date().toISOString(),
    week: board.week,
    season: board.season,
    oddsFetchedAt: board.oddsFetchedAt ?? null,
    pools: {
      anytime: atdAll.length,
      anytimeLong: atdLong.length,
      twoPlusLong: td2Long.length,
      twoPlusPriced: td2All.length,
      sides: sides.length,
      totals: totals.length,
    },
    sheets: [
      { key: 'lockedIn', title: 'Locked In', tickets: lockedIn },
      { key: 'anytime', title: 'Anytime TD', tickets: anytime },
      { key: 'twoPlus', title: '2+ TD', tickets: twoPlus },
      { key: 'long2k', title: 'Long shots +2000', tickets: long2k },
      { key: 'long3k', title: 'Long shots +3000', tickets: long3k },
    ],
  };
}

/** American price as text. */
export const fmtPrice = (a) => (a > 0 ? `+${a}` : `${a}`);
/** Probability as a whole percentage, one decimal under ten. */
export const fmtPct = (p) => (p < 0.1 ? `${(p * 100).toFixed(1)}%` : `${Math.round(p * 100)}%`);
