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
/**
 * The most of his own team's touchdowns a scorer estimate may demand. Backed out of the model's
 * own game projection: P(scores) = 1 - (1 - share)^n for n projected team touchdowns. A tight end
 * whose 55% needs 30% of every Arizona score, in a game the model projects Arizona for 17 points,
 * is the player call and the game call contradicting each other, and it does not go on a ticket.
 */
export const MAX_TEAM_TD_SHARE = { RB: 0.4, QB: 0.4, default: 0.25 };
/** Ceiling for a leg's position: a goal-line back legitimately owns a third of his team's scores. */
export const shareCeiling = (pos) => MAX_TEAM_TD_SHARE[pos] ?? MAX_TEAM_TD_SHARE.default;
/** Projected touchdowns for a team from the model's score: a field goal or two out, the rest TDs. */
export function teamTouchdowns(game, abbr) {
  const p = game?.market?.projected;
  if (!p) return null;
  const pts = abbr === game.home.abbr ? p.home : p.away;
  return Math.max(0.5, (pts - 1.5) / 7);
}
/** The share of team touchdowns a scorer's anytime estimate implies. */
export function impliedShare(game, leg) {
  const n = teamTouchdowns(game, leg.team);
  if (!n) return null;
  return 1 - Math.pow(1 - leg.prob, 1 / n);
}

/** Standard six-point teaser: sides and totals move six points in the bettor's favour. */
export const TEASER_POINTS = 6;
const SIGMA = 13.5;
/**
 * Six-point teaser legs from the model's sides and totals, priced by the model's own projection
 * moved the six points. A teaser is only worth its price when the six points cross the numbers
 * football games actually land on, so a leg that crosses both 3 and 7 is marked as such.
 */
export function teaserLegs(board, sides, totals) {
  const out = [];
  const crosses = (from, to) => {
    const lo = Math.min(Math.abs(from), Math.abs(to));
    const hi = Math.max(Math.abs(from), Math.abs(to));
    return [3, 7].filter((k) => k > lo && k < hi).length;
  };
  for (const l of sides) {
    const g = board.games.find((x) => x.id === l.game);
    const p = g?.market?.projected;
    if (!p) continue;
    const num = Number(l.label.split(' ').pop());
    const projMargin = l.team === g.home.abbr ? p.home - p.away : p.away - p.home;
    const teased = +(num + TEASER_POINTS).toFixed(1);
    const prob = normCdf((projMargin + teased) / SIGMA);
    out.push({
      ...l,
      type: 'tease-side',
      label: `${l.team} ${teased > 0 ? '+' : ''}${teased}`,
      from: `${l.team} ${num > 0 ? '+' : ''}${num}`,
      prob: +prob.toFixed(3),
      keys: crosses(num, teased),
    });
  }
  for (const l of totals) {
    const g = board.games.find((x) => x.id === l.game);
    const p = g?.market?.projected;
    if (!p) continue;
    const m = /^(Over|Under)\s+([\d.]+)/.exec(l.label);
    if (!m) continue;
    const dir = m[1];
    const num = Number(m[2]);
    const projTotal = p.home + p.away;
    const teased = dir === 'Over' ? num - TEASER_POINTS : num + TEASER_POINTS;
    const prob =
      dir === 'Over'
        ? normCdf((projTotal - teased) / SIGMA)
        : normCdf((teased - projTotal) / SIGMA);
    out.push({
      ...l,
      type: 'tease-total',
      label: `${dir} ${teased} ${l.gameLabel}`,
      from: `${dir} ${num}`,
      prob: +prob.toFixed(3),
      keys: 0,
    });
  }
  return out;
}
function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Positions the 2+ TD sheet is written for: the ones the conversion was graded on. */
export const TD2_POSITIONS = new Set(['RB', 'QB']);
/** Anytime sheet ceiling: above this a ticket belongs on a long-shot sheet, not here. */
export const ANYTIME_MAX_PRICE = 1500;

export function buildSheets(board, opts = {}) {
  const n = opts.perSheet ?? 5;
  // Optionally restrict to a set of games (a Sunday sheet leaves Monday night off).
  const inScope = (l) => !opts.games || opts.games.has(l.game);
  const gameOf = (id) => board.games.find((x) => x.id === id);

  // Leg pools. Positive edge is the entry ticket; a long ticket asks for more of it, because a
  // near-coin-flip favourite added to a three-leg ticket does nothing but push it into a band.
  // A scorer whose estimate demands more of his team's touchdowns than the ceiling allows is out
  // of every parlay pool: that is the model disagreeing with itself, not an edge.
  const scorers = atdLegs(board)
    .filter(inScope)
    .map((l) => ({ ...l, share: impliedShare(gameOf(l.game), l) }))
    .filter((l) => l.share == null || l.share <= shareCeiling(l.pos));
  const atdAll = scorers.filter((l) => l.edge >= EDGE_FLOOR.short && l.prob >= 0.35);
  const atdLong = atdAll.filter((l) => !l.status && l.edge >= EDGE_FLOOR.long);
  // The 2+ market is its own market. A back priced -225 to score once carries no anytime edge and
  // is rightly off the anytime sheets, but that same price is why his 2+ number can be the best
  // value on the board: the book has already paid for the first touchdown.
  const td2All = twoPlusLegs(scorers.filter((l) => l.prob >= 0.35)).filter(
    (l) => l.edge >= EDGE_FLOOR.short,
  );
  const td2Long = td2All.filter((l) => !l.status && l.edge >= EDGE_FLOOR.long);
  const sides = sideLegs(board)
    .filter(inScope)
    .filter((l) => l.conf >= 2 && l.edge > 0);
  const totals = totalLegs(board)
    .filter(inScope)
    .filter((l) => l.conf >= 2 && l.edge > 0);

  // Six-point teaser: the five legs with the highest teased cover probability, one per game, a
  // side or a total from each. Priced from the model's projection; the sheet also shows the
  // conservative read, since a five-leg teaser is where a hopeful number costs the most.
  const teaserPool = teaserLegs(board, sides, totals).sort(
    (a, b) => b.prob - a.prob || b.keys - a.keys,
  );
  const teaser = [];
  const teaserGames = new Set();
  for (const l of teaserPool) {
    if (teaser.length === 5) break;
    if (teaserGames.has(l.game)) continue;
    teaserGames.add(l.game);
    teaser.push(l);
  }

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
    teaser: {
      points: TEASER_POINTS,
      legs: teaser,
      prob: +teaser.reduce((p, l) => p * l.prob, 1).toFixed(3),
      // A six-point move on a fair line is worth about phi(6/13.5) = 67% a leg before any key
      // numbers; 70% is the honest floor for legs chosen for their key numbers.
      conservative: +Math.pow(0.7, teaser.length).toFixed(3),
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
