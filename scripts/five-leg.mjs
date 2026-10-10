// The five-leg formula (docs/FIVE_LEG_FORMULA.md): volume props only, alternate lines one notch
// below the main number, model shrunk toward the book, and the five legs that pay the target with
// the highest joint probability. Projections come from the receiver brief; prices from the Odds API
// alternate markets or a compact hand-entered sheet.
import path from 'node:path';
import fs from 'node:fs';
import { DATA, readJson, writeJson, impliedProb, normName, nowIso } from './lib.mjs';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? '1'] : []))
    .filter((x) => x.length),
);
const SEASON = Number(args.season || new Date().getUTCFullYear());
const WEEK = Number(args.week);
const TARGET = Number(args.target || 6); // decimal payout floor; 6.0 = +500
const LEGS = Number(args.legs || 5);
const ONLY = args.game || null;

export const SHRINK = 0.3; // weight on the book's implied number
export const MIN_P = 0.58; // shrunk probability floor per leg
export const MIN_EDGE = 0; // model minus implied, before the shrink: never worse than the book
export const ANCHOR_EDGE = 0.05; // at least one leg on the ticket must carry a real edge
export const WORST_PRICE = -250;
export const MAX_PER_OFFENSE = 4;
// A fringe receiving role can go to zero on volume alone (Hurst, Week 5 Thursday: 2.5 projected
// catches, zero targets), so receiving legs need an established share of the targets.
export const MIN_RECEPTIONS = 3.0;

const MARKETS = {
  receptions: {
    key: 'player_receptions_alternate',
    main: 'player_receptions',
    field: 'receptions',
    dist: 'poisson',
  },
  rec_yds: {
    key: 'player_reception_yds_alternate',
    main: 'player_reception_yds',
    field: 'recYds',
    dist: 'normal',
    sd: (m) => Math.max(12, 0.6 * m),
  },
  rush_yds: {
    key: 'player_rush_yds_alternate',
    main: 'player_rush_yds',
    field: 'rushYds',
    dist: 'normal',
    sd: (m) => Math.max(15, 0.55 * m),
  },
  // Quarterback yardage swings about 65 yards either way on a 250 mean, so only a line well below
  // the projection qualifies; the main number never will.
  pass_yds: {
    key: 'player_pass_yds_alternate',
    main: 'player_pass_yds',
    field: 'passYds',
    dist: 'normal',
    sd: (m) => Math.max(45, 0.26 * m),
  },
};

// --- distributions -------------------------------------------------------------------------
export function poissonAtLeast(n, mean) {
  if (mean <= 0) return n <= 0 ? 1 : 0;
  let term = Math.exp(-mean),
    cdf = 0;
  for (let k = 0; k < n; k++) {
    cdf += term;
    term *= mean / (k + 1);
  }
  return Math.max(0, 1 - cdf);
}
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
export function normalAtLeast(x, mean, sd) {
  return 1 - Phi((x - mean) / sd);
}
export function legProb(market, side, point, mean) {
  const m = MARKETS[market];
  let over;
  if (m.dist === 'poisson') over = poissonAtLeast(Math.ceil(point), mean);
  else over = normalAtLeast(point, mean, m.sd(mean));
  return side === 'over' ? over : 1 - over;
}
export const dec = (a) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
export const american = (d) => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));

// --- prices --------------------------------------------------------------------------------
/** Flatten an Odds API event body, or the compact sheet, into [{player, market, side, point, price, book}]. */
export function flattenPrices(body) {
  const out = [];
  if (body?.bookmakers) {
    for (const b of body.bookmakers)
      for (const mk of b.markets || []) {
        const market = Object.keys(MARKETS).find(
          (k) => MARKETS[k].key === mk.key || MARKETS[k].main === mk.key,
        );
        if (!market) continue;
        for (const o of mk.outcomes || [])
          out.push({
            player: o.description,
            market,
            side: o.name.toLowerCase(),
            point: Number(o.point),
            price: Number(o.price),
            book: b.key,
          });
      }
    return out;
  }
  // compact: { "Chris Olave": { "receptions": { "courtside": [[6.5, -140, "over"], [7.5, 131]] } } }
  for (const [player, markets] of Object.entries(body || {}))
    for (const [market, books] of Object.entries(markets))
      for (const [book, rows] of Object.entries(books))
        for (const [point, price, side = 'over'] of rows)
          out.push({ player, market, side, point: Number(point), price: Number(price), book });
  return out;
}

// --- the formula ---------------------------------------------------------------------------
export function gradeLegs(projection, prices) {
  const byName = new Map(projection.players.map((p) => [normName(p.player), p]));
  const legs = [];
  for (const q of prices) {
    const p = byName.get(normName(q.player));
    if (!p) continue;
    const mean = p[MARKETS[q.market].field];
    if (mean == null) continue;
    if (q.price < WORST_PRICE) continue;
    const flags = p.flags || [];
    if (flags.some((f) => /questionable|doubtful|out|one-game-sample/.test(f))) continue;
    if (
      (q.market === 'receptions' || q.market === 'rec_yds') &&
      (p.receptions ?? 0) < MIN_RECEPTIONS
    )
      continue;
    const model = legProb(q.market, q.side, q.point, mean);
    const implied = impliedProb(q.price);
    const shrunk = (1 - SHRINK) * model + SHRINK * implied;
    legs.push({
      game: projection.game,
      team: p.team,
      player: p.player,
      market: q.market,
      side: q.side,
      point: q.point,
      price: q.price,
      book: q.book,
      mean: +mean.toFixed(1),
      model: +model.toFixed(3),
      implied: +implied.toFixed(3),
      p: +shrunk.toFixed(3),
      edge: +(model - implied).toFixed(3),
      label: `${p.player} ${q.side === 'over' ? `${Math.ceil(q.point)}+` : `under ${q.point}`} ${q.market.replace('_', ' ')}`,
    });
  }
  // Best price per (player, market, side, point); then the qualifying set.
  const best = new Map();
  for (const l of legs) {
    const k = `${l.player}|${l.market}|${l.side}|${l.point}`;
    if (!best.has(k) || best.get(k).price < l.price) best.set(k, l);
  }
  return [...best.values()]
    .filter((l) => l.p >= MIN_P && l.edge >= MIN_EDGE)
    .sort((a, b) => b.p - a.p);
}

/** The LEGS-leg ticket paying at least TARGET with the highest joint shrunk probability. */
export function buildTicket(qualifying, { legs = LEGS, target = TARGET } = {}) {
  // One leg per player: keep each player's highest-probability qualifying line.
  const perPlayer = new Map();
  for (const l of qualifying)
    if (!perPlayer.has(l.player) || perPlayer.get(l.player).p < l.p) perPlayer.set(l.player, l);
  const pool = [...perPlayer.values()].sort((a, b) => b.p - a.p).slice(0, 18);
  let bestT = null,
    bestAny = null;
  const rec = (i, chosen, prod, prob, perTeam) => {
    if (chosen.length === legs) {
      const teams = Object.keys(perTeam);
      const bothSides = teams.length > 1 || pool.every((l) => l.team === teams[0]);
      const t = {
        legs: chosen.slice(),
        decimal: +prod.toFixed(2),
        price: american(prod),
        joint: +prob.toFixed(4),
        bookJoint: +chosen.reduce((a, l) => a * l.implied, 1).toFixed(4),
      };
      const anchored = chosen.some((l) => l.edge >= ANCHOR_EDGE);
      if (!bestAny || prob > bestAny.joint) bestAny = t;
      if (prod >= target && bothSides && anchored && (!bestT || prob > bestT.joint)) bestT = t;
      return;
    }
    for (let k = i; k < pool.length; k++) {
      const l = pool[k];
      if ((perTeam[l.team] || 0) >= MAX_PER_OFFENSE) continue;
      chosen.push(l);
      perTeam[l.team] = (perTeam[l.team] || 0) + 1;
      rec(k + 1, chosen, prod * dec(l.price), prob * l.p, perTeam);
      chosen.pop();
      perTeam[l.team] -= 1;
    }
  };
  rec(0, [], 1, 1, {});
  return { ticket: bestT, fallback: bestT ? null : bestAny };
}

// --- run -----------------------------------------------------------------------------------
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  if (!WEEK) {
    console.error('usage: node scripts/five-leg.mjs --week N [--game id] [--target 6] [--legs 5]');
    process.exit(1);
  }
  const wk = `${SEASON}-w${String(WEEK).padStart(2, '0')}`;
  const projFile = path.join(DATA, 'projections', `${wk}.json`);
  const proj = readJson(projFile, null);
  if (!proj) {
    console.error(`no projections at ${projFile}; run the receiver brief first`);
    process.exit(1);
  }
  const altDir = path.join(DATA, 'odds', 'alts');
  const out = {
    season: SEASON,
    week: WEEK,
    builtAt: nowIso(),
    target: TARGET,
    legs: LEGS,
    games: [],
  };
  for (const g of proj.games) {
    if (ONLY && g.game !== ONLY) continue;
    // Alternate lines: a hand-entered or merged sheet in odds/alts, else the raw relay pull in odds/raw.
    const priceFile = [
      path.join(altDir, `${wk}-${g.game}.json`),
      path.join(DATA, 'odds', 'raw', `${wk}-${g.game}.json`),
    ].find((f) => fs.existsSync(f));
    if (!priceFile) {
      console.log(`${g.game}: no alt lines yet (odds/alts or odds/raw ${wk}-${g.game}.json)`);
      continue;
    }
    const prices = flattenPrices(readJson(priceFile));
    const qualifying = gradeLegs(g, prices);
    const { ticket, fallback } = buildTicket(qualifying);
    out.games.push({ game: g.game, kick: g.kick, qualifying, ticket, fallback });
    console.log(`\n== ${g.game}  (${qualifying.length} qualifying legs)`);
    const t = ticket || fallback;
    if (!t) {
      console.log('   nothing qualifies');
      continue;
    }
    console.log(
      `   ${ticket ? 'ticket' : 'short of target'}: ${t.price > 0 ? '+' : ''}${t.price}  joint ${(t.joint * 100).toFixed(1)}%  book ${(t.bookJoint * 100).toFixed(1)}%`,
    );
    for (const l of t.legs)
      console.log(
        `     ${l.label.padEnd(40)} ${String(l.price).padStart(5)}  model ${(l.model * 100).toFixed(0)}%  shrunk ${(l.p * 100).toFixed(0)}%  ${l.book}`,
      );
  }
  writeJson(path.join(DATA, 'five-leg', `${wk}.json`), out);
}
