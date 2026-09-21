// Monte Carlo for a single game, used to answer one question: which legs survive most simulations,
// and how often does a chosen set of them survive TOGETHER.
//
// The point is the joint number. Multiplying leg probabilities assumes the legs are independent,
// and inside one game they never are: the same simulated script that puts the Giants within a
// touchdown also keeps the total down and gets their back a carry near the goal line. Every leg in
// a sim is read off the same simulated game, so the joint survival rate below is the real one.
//
// Calibration. Each player distribution is fitted to that player's own de-vigged market price, so
// the sim inherits the book's read on usage rather than inventing one. The only places our own
// model enters are the game script (the desk's projected score) and the touchdown allocation.
//
//   GAME=nyg-lar SIMS=1000 node scripts/simulate-game.mjs
//   SEEDS=10 ...     repeat the whole run on different seeds to show the sampling noise
import path from 'node:path';
import { DATA, readJson, writeJson, nowIso } from './lib.mjs';
import { impliedFromAmerican } from './parlays.mjs';

const GAME = process.env.GAME || 'nyg-lar';
const SIMS = Number(process.env.SIMS ?? 1000);
const SEEDS = Number(process.env.SEEDS ?? 1);
const FLOOR = Number(process.env.FLOOR ?? 0.7);
const PICK = Number(process.env.PICK ?? 5);
const board = readJson(path.join(DATA, 'board.json'));
const game = board?.games.find((g) => g.id === GAME);
const sheet = readJson(
  path.join(DATA, 'sheets', `${board.season}-w${String(board.week).padStart(2, '0')}-${GAME}.json`),
);
if (!game || !sheet) {
  console.error(`need board.json and the ${GAME} sheet; run build-game.mjs first`);
  process.exit(1);
}

// Spread of a final margin and a final total around their projections. NFL margins run about 13.5
// points of standard deviation and totals about 10.5; the desk's teaser maths uses 16 for both,
// which is wider than the game actually is. Both are printed at the end against the desk's own
// numbers so the gap is visible rather than buried.
const SD_MARGIN = Number(process.env.SD_MARGIN ?? 13.4);
const SD_TOTAL = Number(process.env.SD_TOTAL ?? 10.6);
const proj = game.market.projected; // { away, home }
const muTotal = proj.away + proj.home;
const muMargin = proj.home - proj.away; // positive: home favoured

const mulberry32 = (a) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
function rng(seed) {
  let s = seed;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    return mulberry32(s)();
  };
  next.normal = () => {
    // Box-Muller; the tail beyond six sigma is irrelevant at these sample sizes.
    const u = Math.max(next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  next.poisson = (lam) => {
    if (lam <= 0) return 0;
    const L = Math.exp(-lam);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= next();
    } while (p > L);
    return k - 1;
  };
  return next;
}

const normCdf = (z) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
};
const devig = (over, under) => {
  if (over == null || under == null) return null;
  const a = impliedFromAmerican(over);
  const b = impliedFromAmerican(under);
  return a + b > 0 ? a / (a + b) : null;
};

// ---- player distributions, each fitted to its own de-vigged price ----
// Yardage is lognormal: non-negative and right-skewed, which is how a receiving line behaves.
const LOG_SIGMA = { player_pass_yds: 0.3, player_rush_yds: 0.62, player_reception_yds: 0.72 };
const props = (game.propLines ?? []).filter(
  (p) => LOG_SIGMA[p.market] || p.market === 'player_receptions',
);
const yardage = [];
const counts = [];
for (const p of props) {
  const pOver = devig(p.over, p.under);
  if (pOver == null || !(p.line > 0)) continue;
  if (p.market === 'player_receptions') {
    // Solve the Poisson mean that reproduces the market's P(receptions > line).
    const need = Math.ceil(p.line);
    let lo = 0.05;
    let hi = 25;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      let cum = 0;
      let term = Math.exp(-mid);
      for (let k = 0; k < need; k++) {
        cum += term;
        term *= mid / (k + 1);
      }
      if (1 - cum > pOver) hi = mid;
      else lo = mid;
    }
    counts.push({ name: p.name, market: p.market, line: p.line, mean: (lo + hi) / 2, pOver });
  } else {
    // Solve the lognormal median that reproduces the market's P(yards > line).
    const sigma = LOG_SIGMA[p.market];
    const z = -sigma * inverseNorm(pOver);
    yardage.push({
      name: p.name,
      market: p.market,
      line: p.line,
      median: p.line / Math.exp(z),
      sigma,
      pOver,
    });
  }
}
function inverseNorm(p) {
  // Acklam's rational approximation, plenty for a distribution fit.
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - pl) return -inverseNorm(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

// ---- touchdown shares ----
// Expected touchdowns from an anytime price, then a share of the team's simulated scores. The
// residual bucket is everything the board does not price: defensive and special-teams scores and
// the third-string body who gets one carry on the goal line.
const TEAMS = { away: game.away.abbr, home: game.home.abbr };
const rosterTeam = (name) => {
  const hit = sheet.anytime.find((a) => a.name === name);
  if (hit?.team) return hit.team;
  const fromBoard = (game.atdBoard ?? []).find((p) => p.name === name)?.team;
  return fromBoard ?? null;
};
const scorers = sheet.anytime.map((a) => ({
  name: a.name,
  team: rosterTeam(a.name),
  exp: -Math.log(1 - Math.min(0.95, a.prob)),
}));
const unknown = scorers.filter((s) => !s.team);
const byTeam = {};
for (const side of ['away', 'home']) {
  const abbr = TEAMS[side];
  const mine = scorers.filter((s) => s.team === abbr);
  const sum = mine.reduce((x, s) => x + s.exp, 0);
  byTeam[abbr] = { players: mine, sum };
}

function simulate(seed) {
  const r = rng(seed);
  const legs = new Map(); // label -> Uint8Array
  const mark = (label, i, hit) => {
    let arr = legs.get(label);
    if (!arr) legs.set(label, (arr = new Uint8Array(SIMS)));
    if (hit) arr[i] = 1;
  };
  const scoreOf = { [TEAMS.away]: new Int16Array(SIMS), [TEAMS.home]: new Int16Array(SIMS) };
  for (let i = 0; i < SIMS; i++) {
    const margin = muMargin + SD_MARGIN * r.normal();
    const total = Math.max(6, muTotal + SD_TOTAL * r.normal());
    let homePts = Math.max(0, Math.round((total + margin) / 2));
    let awayPts = Math.max(0, Math.round((total - margin) / 2));
    const realTotal = homePts + awayPts;
    const realMargin = homePts - awayPts;
    scoreOf[TEAMS.home][i] = homePts;
    scoreOf[TEAMS.away][i] = awayPts;

    // sides and totals
    for (let n = 1.5; n <= 17.5; n += 1) {
      mark(`${TEAMS.away} +${n}`, i, realMargin < n);
      mark(`${TEAMS.home} -${n}`, i, realMargin > n);
    }
    for (let n = 28.5; n <= 64.5; n += 1) {
      mark(`Under ${n}`, i, realTotal < n);
      mark(`Over ${n}`, i, realTotal > n);
    }
    for (const side of ['away', 'home']) {
      const abbr = TEAMS[side];
      const pts = side === 'home' ? homePts : awayPts;
      for (let n = 6.5; n <= 34.5; n += 1) {
        mark(`${abbr} team total Over ${n}`, i, pts > n);
        mark(`${abbr} team total Under ${n}`, i, pts < n);
      }
    }

    // touchdowns
    const scored = new Set();
    for (const side of ['away', 'home']) {
      const abbr = TEAMS[side];
      const pts = side === 'home' ? homePts : awayPts;
      const lam = Math.max(0.2, (pts - 1.5) / 7);
      let tds = Math.min(r.poisson(lam), Math.floor(pts / 6));
      const pool = byTeam[abbr];
      if (!pool || !pool.sum) continue;
      // Everything the board does not price shares the rest of the team's scores.
      const priced = Math.min(0.9, pool.sum / Math.max(pool.sum, lam));
      for (let k = 0; k < tds; k++) {
        if (r() > priced) continue; // a score the board does not name
        let x = r() * pool.sum;
        for (const p of pool.players) {
          x -= p.exp;
          if (x <= 0) {
            scored.add(p.name);
            break;
          }
        }
      }
    }
    for (const s of scorers) mark(`${s.name} anytime TD`, i, scored.has(s.name));

    // Yardage and receptions, nudged by the script this sim produced: passing and receiving rise
    // with a team's own points, rushing rises with its margin. Both factors average one.
    const ptsFor = (name) => {
      const tm = rosterTeam(name);
      return tm === TEAMS.home ? homePts : tm === TEAMS.away ? awayPts : (homePts + awayPts) / 2;
    };
    const expPts = muTotal / 2;
    for (const y of yardage) {
      const mine = ptsFor(y.name);
      const air = 1 + 0.22 * ((mine - expPts) / Math.max(8, expPts));
      const ground =
        1 + 0.16 * ((rosterTeam(y.name) === TEAMS.home ? realMargin : -realMargin) / 14);
      const scale = y.market === 'player_rush_yds' ? ground : air;
      const val = y.median * Math.exp(y.sigma * r.normal()) * Math.max(0.35, scale);
      for (const n of ladder(y.line)) mark(`${y.name} Over ${n} ${short(y.market)}`, i, val > n);
    }
    for (const c of counts) {
      const mine = ptsFor(c.name);
      const scale = Math.max(0.4, 1 + 0.18 * ((mine - expPts) / Math.max(8, expPts)));
      const val = r.poisson(c.mean * scale);
      for (let n = 0.5; n <= Math.ceil(c.line) + 0.5; n += 1)
        mark(`${c.name} Over ${n} rec`, i, val > n);
    }
  }
  return { legs, scoreOf };
}
const short = (m) =>
  m === 'player_pass_yds' ? 'pass yds' : m === 'player_rush_yds' ? 'rush yds' : 'rec yds';
function ladder(line) {
  const out = [];
  const step = line > 150 ? 25 : line > 60 ? 10 : 5;
  for (let n = Math.max(4.5, Math.round((line * 0.25) / step) * step + 0.5); n < line; n += step)
    out.push(+n.toFixed(1));
  out.push(line);
  return out;
}

// ---- run ----
const base = simulate(12345);
const rate = (arr) => arr.reduce((a, b) => a + b, 0) / SIMS;
const all = [...base.legs.entries()].map(([label, arr]) => ({ label, arr, p: rate(arr) }));
const survivors = all.filter((l) => l.p >= FLOOR).sort((a, b) => b.p - a.p);

// The recommended set. Two things have to be true at once and neither alone is enough.
//
// Maximising the payout alone picks legs that fight each other: the search's first answer paired a
// game Over with a Giants team-total Under and the Giants covering a big number, five legs whose
// joint survival (11%) came in well UNDER the 18% that multiplying them would claim. Maximising
// the joint alone is just as useless the other way: it converges on 99% legs that pay nothing.
//
// So: every leg clears the floor, the ticket must still pay at least MIN_PAY, and among everything
// that qualifies we take the set whose JOINT survival is highest. That is a ticket whose legs agree
// about how the game goes. Legs are packed into bitsets so every combination is scored exactly.
const WORDS = Math.ceil(SIMS / 32);
const packed = (arr) => {
  const bits = new Uint32Array(WORDS);
  for (let i = 0; i < SIMS; i++) if (arr[i]) bits[i >> 5] |= 1 << (i & 31);
  return bits;
};
const CEIL = Number(process.env.CEIL ?? 0.92);
const family = (label) => {
  const m = /^(.*?) Over [\d.]+ (pass yds|rush yds|rec yds|rec)$/.exec(label);
  if (m) return `${m[1]}|${m[2]}`;
  if (/team total/.test(label)) return `${label.split(' ')[0]}|team total`;
  if (/^(Over|Under) /.test(label)) return 'game total';
  if (/anytime TD/.test(label)) return `${label.replace(' anytime TD', '')}|td`;
  return 'side';
};
const person = (label) => family(label).split('|')[0];
const kind = (label) => (family(label).includes('|') ? family(label).split('|')[1] : family(label));

// Where the book already gives us a number, use it. Everything else is an alternate rung we do not
// hold a price for, and the sim's fair price is the floor to accept rather than a quote.
const KNOWN = new Map();
KNOWN.set(sheet.side.label, sheet.side.price);
KNOWN.set(sheet.total.label.replace(/ .*@.*/, ''), sheet.total.price);
for (const pl of game.propLines ?? []) {
  const tag = pl.market === 'player_receptions' ? 'rec' : short(pl.market);
  if (pl.over != null) KNOWN.set(`${pl.name} Over ${pl.line} ${tag}`, pl.over);
}
for (const a of sheet.anytime) KNOWN.set(`${a.name} anytime TD`, a.price);
const dec = (american) => (american > 0 ? 1 + american / 100 : 1 + 100 / -american);
const fairDec = (p) => 1 / p;
const toAmer = (d) => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));

const pool = [];
const seenFamily = new Map();
for (const l of survivors.filter((x) => x.p <= CEIL).sort((a, b) => a.p - b.p)) {
  const f = family(l.label);
  if ((seenFamily.get(f) ?? 0) >= 1) continue; // one rung per ladder in the candidate pool
  seenFamily.set(f, 1);
  pool.push({ ...l, bits: packed(l.arr), price: KNOWN.get(l.label) ?? null });
  if (pool.length >= 26) break;
}
const jointBits = (set) => {
  let c = 0;
  for (let w = 0; w < WORDS; w++) {
    let v = set[0].bits[w];
    for (let k = 1; k < set.length; k++) v &= set[k].bits[w];
    // popcount
    v = v - ((v >> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
    c += (((v + (v >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
  }
  return c / SIMS;
};
const payout = (set) =>
  set.reduce((d, l) => d * (l.price != null ? dec(l.price) : fairDec(l.p)), 1);
// The ticket has to be worth writing: five legs at the floor are about +500 fair, so anything
// under this is a lot of risk for no return.
const MIN_PAY = Number(process.env.MIN_PAY ?? 4.0);
let best = null;
let bestAny = null;
const acc = [];
const choose = (start) => {
  if (acc.length === PICK) {
    const pay = payout(acc);
    const p = jointBits(acc);
    if (!bestAny || p > bestAny.p) bestAny = { pay, p, legs: [...acc] };
    if (pay >= MIN_PAY && (!best || p > best.p)) best = { pay, p, legs: [...acc] };
    return;
  }
  for (let i = start; i < pool.length; i++) {
    const cand = pool[i];
    if (acc.some((x) => person(x.label) === person(cand.label))) continue;
    if (acc.filter((x) => kind(x.label) === kind(cand.label)).length >= 2) continue;
    acc.push(cand);
    choose(i + 1);
    acc.pop();
  }
};
choose(0);
if (!best) {
  console.log(
    `no five-leg set clears both the ${FLOOR * 100}% floor and a ${MIN_PAY.toFixed(1)}x payout; showing the most likely set instead`,
  );
  best = bestAny;
}
const joint = (set) => jointBits(set);

// LEGS="a || b || c" scores a set you name instead of the one the search picked, so a leg can be
// swapped by hand (a fringe receiver the sim likes but a human would not write down) and the cost
// of the swap read off the same run.
if (process.env.LEGS) {
  const want = process.env.LEGS.split('||').map((x) => x.trim());
  const chosen = want.map((label) => {
    const hit = all.find((l) => l.label === label);
    if (!hit) {
      console.error(`no such leg: "${label}"`);
      process.exit(1);
    }
    return { ...hit, bits: packed(hit.arr), price: KNOWN.get(label) ?? null };
  });
  best = { pay: payout(chosen), p: jointBits(chosen), legs: chosen };
}
const indep = best.legs.reduce((a, l) => a * l.p, 1);
const out = {
  builtAt: nowIso(),
  game: GAME,
  sims: SIMS,
  floor: FLOOR,
  projected: proj,
  sd: { margin: SD_MARGIN, total: SD_TOTAL },
  survivors: survivors.map((l) => ({ label: l.label, p: +l.p.toFixed(4) })),
  pick: {
    joint: best.p,
    independent: indep,
    fairParlay: toAmer(1 / best.p),
    payoutIfFair: toAmer(best.pay),
    legs: best.legs.map((l) => ({
      label: l.label,
      p: +l.p.toFixed(4),
      price: l.price ?? null,
      fair: toAmer(fairDec(l.p)),
    })),
  },
};
writeJson(
  path.join(
    DATA,
    'sheets',
    `${board.season}-w${String(board.week).padStart(2, '0')}-${GAME}-sim.json`,
  ),
  out,
);

const pctf = (x) => `${(x * 100).toFixed(1)}%`;
console.log(
  `${GAME}: ${SIMS} sims, projected ${TEAMS.away} ${proj.away} / ${TEAMS.home} ${proj.home}, margin SD ${SD_MARGIN}, total SD ${SD_TOTAL}`,
);
console.log(
  `\nSim vs the desk's published numbers (a gap here is the model disagreeing with itself):`,
);
for (const [label, deskP] of [
  [sheet.side.label, sheet.side.prob],
  [sheet.total.label.replace(/ .*@.*/, ''), sheet.total.prob],
]) {
  const l = all.find((x) => x.label === label);
  console.log(`  ${label.padEnd(16)} sim ${pctf(l ? l.p : NaN)}   desk ${pctf(deskP)}`);
}
console.log(`\n${survivors.length} legs survive at least ${pctf(FLOOR)}:`);
for (const l of survivors.slice(0, 28)) console.log(`  ${pctf(l.p).padStart(6)}  ${l.label}`);
if (survivors.length > 28) console.log(`  ... and ${survivors.length - 28} more`);
console.log(`\nBest ${PICK} together (each clears the floor; chosen for what they pay):`);
for (const l of best.legs)
  console.log(
    `  ${pctf(l.p).padStart(6)}  ${l.label.padEnd(38)} ${l.price != null ? `book ${l.price > 0 ? '+' : ''}${l.price}` : `no price held, fair ${toAmer(fairDec(l.p)) > 0 ? '+' : ''}${toAmer(fairDec(l.p))}`}`,
  );
console.log(
  `  JOINT ${pctf(best.p)} of ${SIMS} sims. Multiplying the five as if independent would say ${pctf(indep)}, so these legs ${best.p >= indep ? 'agree with each other' : 'fight each other'}.`,
);
console.log(
  `  Fair price for the five: ${toAmer(1 / best.p) > 0 ? '+' : ''}${toAmer(1 / best.p)}. Do not take less.`,
);

if (SEEDS > 1) {
  const spread = [];
  for (let s = 1; s <= SEEDS; s++) {
    const run = simulate(1000 + s * 7919);
    spread.push(
      joint(
        best.legs.map((l) => ({ bits: packed(run.legs.get(l.label) ?? new Uint8Array(SIMS)) })),
      ),
    );
  }
  spread.sort((a, b) => a - b);
  console.log(
    `\nSame five on ${SEEDS} fresh runs of ${SIMS}: ${pctf(spread[0])} to ${pctf(spread[spread.length - 1])}, median ${pctf(spread[Math.floor(SEEDS / 2)])}`,
  );
}
