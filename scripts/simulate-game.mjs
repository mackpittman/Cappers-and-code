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
// Players ruled out after the last odds pull. Their legs are dropped and their share of the team's
// touchdowns redistributes across whoever is left, because shares are normalised per team.
const BAN = (process.env.BAN ?? '')
  .split('||')
  .map((x) => x.trim())
  .filter(Boolean);
const banned = (label) => BAN.some((b) => label.includes(b));
const SCRATCH = new Set(
  (process.env.SCRATCH ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
);
// Losing a front-line receiver costs a team points the stale market line has not taken out yet.
const SCRATCH_PTS = Number(process.env.SCRATCH_PTS ?? 0);
const SCRATCH_TEAM = process.env.SCRATCH_TEAM ?? null;
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
const rawProj = game.market.projected; // { away, home }
const proj = { ...rawProj };
if (SCRATCH_PTS && SCRATCH_TEAM) {
  if (SCRATCH_TEAM === game.home.abbr) proj.home = +(proj.home - SCRATCH_PTS).toFixed(2);
  else proj.away = +(proj.away - SCRATCH_PTS).toFixed(2);
}
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

const pctf = (x) => `${(x * 100).toFixed(1)}%`;
/**
 * Survival inside a slice of the sims rather than across all of them. A ticket that hits 10% of
 * the time can be one that hits 25% in a close game and never in a blowout, and the headline
 * number does not say which.
 */
/**
 * The same legs inside each kind of game. A blowout column is the honest answer to "what if they
 * get run over", which a single headline percentage cannot give.
 */
function scriptReport(legs) {
  const HOME = TEAMS.home;
  const AWAY = TEAMS.away;
  const h = base.scoreOf[HOME];
  const a = base.scoreOf[AWAY];
  const buckets = [
    [`${HOME} by 14+`, (i) => h[i] - a[i] >= 14],
    [`${HOME} by 7-13`, (i) => h[i] - a[i] >= 7 && h[i] - a[i] < 14],
    ['within a TD', (i) => Math.abs(h[i] - a[i]) < 7],
    [`${AWAY} wins by 7+`, (i) => a[i] - h[i] >= 7],
  ];
  console.log('  How it holds up by script:');
  for (const [name, keep] of buckets) {
    const c = conditional(legs, keep);
    const share = ((c.n / SIMS) * 100).toFixed(0);
    console.log(`    ${name.padEnd(16)} ${share.padStart(3)}% of sims   slip hits ${pctf(c.p)}`);
  }
  console.log('  Per leg in a blowout:');
  for (const l of legs) {
    const c = conditional([l], (i) => h[i] - a[i] >= 14);
    console.log(
      `    ${l.label.padEnd(38)} ${pctf(l.p).padStart(6)} overall -> ${pctf(c.p).padStart(6)} if ${HOME} wins big`,
    );
  }
}
function conditional(legs, keep) {
  let n = 0;
  let hit = 0;
  for (let i = 0; i < SIMS; i++) {
    if (!keep(i)) continue;
    n++;
    if (legs.every((l) => l.arr[i])) hit++;
  }
  return { n, p: n ? hit / n : 0 };
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
// How much of a scratched player's volume his team-mates actually absorb. Not all of it: some of
// what a number one receiver generates simply does not happen when he is not on the field.
const REDIST = Number(process.env.REDIST ?? 0.8);
const ROSTER0 = readJson(path.join(DATA, `rosters-${GAME}.json`), {});
const rosterTeamRaw = (name) => ROSTER0[name] ?? null;
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

// Hand the scratched players' volume to their team-mates in the same market, damped by REDIST.
// Their own entries are dropped afterwards.
for (const bucket of [yardage, counts]) {
  const key = bucket === yardage ? 'median' : 'mean';
  const markets = new Set(bucket.map((x) => x.market));
  for (const m of markets) {
    for (const abbr of [game.away.abbr, game.home.abbr]) {
      const mine = bucket.filter((x) => x.market === m && rosterTeamRaw(x.name) === abbr);
      const gone = mine.filter((x) => SCRATCH.has(x.name));
      const left = mine.filter((x) => !SCRATCH.has(x.name));
      if (!gone.length || !left.length) continue;
      const freed = gone.reduce((a, x) => a + x[key], 0) * REDIST;
      // Spread the vacated volume over the whole offence, not just the team-mates who happen to
      // carry a posted line. Using the priced players as the denominator gave Davante Adams and
      // Kyren Williams a 119% raise between them, because they are the only two Rams with a
      // receiving line on the board. The quarterback's passing number is the real pie.
      const qb = (game.propLines ?? []).find(
        (x) => x.market === 'player_pass_yds' && rosterTeamRaw(x.name) === abbr,
      );
      const priced = left.reduce((a, x) => a + x[key], 0);
      const whole =
        m === 'player_reception_yds' && qb
          ? Math.max(priced, qb.line - gone.reduce((a, x) => a + x[key], 0))
          : priced;
      if (whole <= 0) continue;
      const lift = Math.min(0.35, freed / whole); // a team-mate's number does not double
      for (const x of left) x[key] = x[key] * (1 + lift);
      console.log(
        `redistributed ${gone.map((g) => g.name).join(', ')} (${m}) across ${left.length} team-mates: +${Math.round(lift * 100)}%`,
      );
    }
  }
}
for (const bucket of [yardage, counts]) {
  for (let i = bucket.length - 1; i >= 0; i--) if (SCRATCH.has(bucket[i].name)) bucket.splice(i, 1);
}

// ---- touchdown shares ----
// Expected touchdowns from an anytime price, then a share of the team's simulated scores. The
// residual bucket is everything the board does not price: defensive and special-teams scores and
// the third-string body who gets one carry on the goal line.
const TEAMS = { away: game.away.abbr, home: game.home.abbr };
// Most names on a props board arrive without a team, and a sim that cannot tell whose offence a
// player belongs to cannot correlate him with anything. The rosters are a free ESPN pull.
const ROSTER = readJson(path.join(DATA, `rosters-${GAME}.json`), {});
const rosterTeam = (name) => {
  if (ROSTER[name]) return ROSTER[name];
  const hit = sheet.anytime.find((a) => a.name === name);
  if (hit?.team) return hit.team;
  return (game.atdBoard ?? []).find((p) => p.name === name)?.team ?? null;
};
const scorers = sheet.anytime
  .filter((a) => !SCRATCH.has(a.name))
  .map((a) => ({
    name: a.name,
    team: rosterTeam(a.name),
    exp: -Math.log(1 - Math.min(0.95, a.prob)),
  }));
const unknown = scorers.filter((s) => !s.team);
const byTeam = {};
for (const side of ['away', 'home']) {
  const abbr = TEAMS[side];
  byTeam[abbr] = { players: scorers.filter((s) => s.team === abbr) };
}

// Calibrating the touchdown allocation.
//
// Tying team touchdowns to the simulated score is right, but on its own it does not reproduce the
// board: capping touchdowns at what the points allow truncates the draw, and every scorer came out
// well under his own market number (Davante Adams at 37% against a board price implying 48%). A leg
// cannot be judged against a market the sim does not reproduce.
//
// So: draw the distribution of team touchdowns first, then solve each player's per-touchdown share
// q so that 1 - E[(1-q)^T] equals his market probability. Each touchdown is then handed out
// independently at those shares, with the remainder going to whoever the board does not price.
function teamTdDistribution(side, seed) {
  const r = rng(seed);
  const counts = [];
  for (let i = 0; i < 4000; i++) {
    const margin = muMargin + SD_MARGIN * r.normal();
    const total = Math.max(6, muTotal + SD_TOTAL * r.normal());
    const pts = Math.max(0, Math.round((side === 'home' ? total + margin : total - margin) / 2));
    counts.push(Math.min(r.poisson(Math.max(0.2, (pts - 1.5) / 7)), Math.floor(pts / 6)));
  }
  const dist = new Map();
  for (const c of counts) dist.set(c, (dist.get(c) ?? 0) + 1 / counts.length);
  return dist;
}
/** Solve q with 1 - sum_t P(T=t) (1-q)^t = target. */
function solveShare(dist, target) {
  let lo = 0;
  let hi = 1;
  for (let it = 0; it < 80; it++) {
    const q = (lo + hi) / 2;
    let miss = 0;
    for (const [t, w] of dist) miss += w * Math.pow(1 - q, t);
    if (1 - miss > target) hi = q;
    else lo = q;
  }
  return (lo + hi) / 2;
}
for (const side of ['away', 'home']) {
  const abbr = TEAMS[side];
  const dist = teamTdDistribution(side, side === 'home' ? 777 : 991);
  const pool = byTeam[abbr];
  for (const pl of pool.players) pl.q = solveShare(dist, 1 - Math.exp(-pl.exp));
  const sum = pool.players.reduce((a, x) => a + x.q, 0);
  // More than the whole pie means the board's anytime prices imply more scorers than the score
  // supports. Scale back rather than silently double-count, and say so.
  // TD_FULL=1 keeps the board's anytime prices at face value even when they sum past the score,
  // which is the market's own view of the touchdown legs. Useful for grading a ticket the way the
  // book priced it rather than the way our projection sees it.
  pool.scale = process.env.TD_FULL === '1' ? 1 : sum > 0.95 ? 0.95 / sum : 1;
  if (pool.scale < 1)
    console.log(
      `${abbr}: priced anytime board sums to ${(sum * 100).toFixed(0)}% of its touchdowns; scaled to 95%`,
    );
  pool.sum = Math.min(0.95, sum);
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
      const tds = Math.min(r.poisson(lam), Math.floor(pts / 6));
      const pool = byTeam[abbr];
      if (!pool?.players.length) continue;
      for (let k = 0; k < tds; k++) {
        let x = r();
        for (const pl of pool.players) {
          x -= pl.q * pool.scale;
          if (x <= 0) {
            scored.add(pl.name);
            break;
          }
        }
        // anything left over is a scorer the board does not price
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
      for (const n of ladder(y.line, y.market))
        mark(`${y.name} Over ${n} ${short(y.market)}`, i, val > n);
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
// Books post alternates on fixed numbers, and they post them ABOVE the main line as well as
// below. The short rungs are where a 70% leg lives; the long ones are what a long-odds slip is
// made of. A ladder that only went down could not even look up a "60+ yards" leg.
const ALT = {
  'pass yds': [
    24.5, 49.5, 74.5, 99.5, 124.5, 149.5, 174.5, 199.5, 224.5, 249.5, 274.5, 299.5, 324.5,
  ],
  'rush yds': [4.5, 9.5, 14.5, 19.5, 24.5, 29.5, 34.5, 39.5, 49.5, 59.5, 69.5, 79.5, 89.5, 99.5],
  'rec yds': [4.5, 9.5, 14.5, 19.5, 24.5, 29.5, 39.5, 49.5, 59.5, 69.5, 79.5, 89.5, 99.5],
};
function ladder(line, market) {
  const rungs = ALT[short(market)] ?? [];
  return [...new Set([...rungs.filter((n) => n >= line * 0.2 && n <= line * 2.6), line])].sort(
    (a, b) => a - b,
  );
}

// ---- run ----
const base = simulate(12345);
const rate = (arr) => arr.reduce((a, b) => a + b, 0) / SIMS;
const all = [...base.legs.entries()]
  .filter(([label]) => !banned(label))
  .map(([label, arr]) => ({ label, arr, p: rate(arr) }));
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

// TARGET=11 builds a slip that PRICES near a number (11.0 decimal is +1000) and, among everything
// that prices there, survives the most sims. This is a different question from the five above: it
// fixes the payout and buys back as much hit rate as the correlation allows, rather than fixing
// the hit rate and taking what it pays.
//
// The search is a beam over set size, scored by joint x payout. That product is the ticket's return
// at fair prices: it sits at 1.0 for independent legs and rises above it exactly when the legs lean
// the same way, so the beam naturally walks toward sets that agree with each other. Sets are kept
// whenever their price lands in the band and the best joint wins.
if (process.env.TARGET) {
  const TARGET = Number(process.env.TARGET);
  const LO = Number(process.env.TARGET_LO ?? TARGET * 0.9);
  const HI = Number(process.env.TARGET_HI ?? TARGET * 1.3);
  const BEAM = Number(process.env.BEAM ?? 400);
  const MAXLEGS = Number(process.env.MAXLEGS ?? 9);
  // A wider pool than the five-leg search, and deliberately spread across the probability range.
  // Taking the most likely legs first fills the pool with 90% legs that pay nothing, and no
  // combination of them ever reaches a long price; taking the longest first throws away the short
  // legs that hold the joint up. So sample every band.
  const POOL_LO = Number(process.env.POOL_LO ?? 0.42);
  const BANDS = [
    [POOL_LO, 0.42],
    [0.42, 0.55],
    [0.55, 0.65],
    [0.65, 0.75],
    [0.75, 0.85],
    [0.85, 0.93],
  ];
  // MIN_BLOWOUT keeps out legs that die when the favourite runs away with it. Banning one spread
  // is not enough: the search simply picks the next spread along, and the ticket still needs the
  // game to stay close. This filters on the outcome instead of on the label.
  const MIN_BLOWOUT = Number(process.env.MIN_BLOWOUT ?? 0);
  const bh = base.scoreOf[TEAMS.home];
  const ba = base.scoreOf[TEAMS.away];
  const blowoutIdx = [];
  for (let i = 0; i < SIMS; i++) if (bh[i] - ba[i] >= 14) blowoutIdx.push(i);
  const survivesBlowout = (l) =>
    !blowoutIdx.length ||
    blowoutIdx.reduce((a, i) => a + l.arr[i], 0) / blowoutIdx.length >= MIN_BLOWOUT;
  // MIN_SCRIPT is the stronger version: a leg has to hold up in EVERY kind of game, not just the
  // blowout. It buys a ticket that does not care who wins, and it costs price to have it.
  const MIN_SCRIPT = Number(process.env.MIN_SCRIPT ?? 0);
  const SCRIPTS = [
    (i) => bh[i] - ba[i] >= 14,
    (i) => bh[i] - ba[i] >= 7 && bh[i] - ba[i] < 14,
    (i) => Math.abs(bh[i] - ba[i]) < 7,
    (i) => ba[i] - bh[i] >= 7,
  ].map((keep) => {
    const idx = [];
    for (let i = 0; i < SIMS; i++) if (keep(i)) idx.push(i);
    return idx;
  });
  const scriptNeutral = (l) =>
    MIN_SCRIPT <= 0 ||
    SCRIPTS.every(
      (idx) => !idx.length || idx.reduce((a, i) => a + l.arr[i], 0) / idx.length >= MIN_SCRIPT,
    );
  const wide = [];
  const seen = new Map();
  for (const [lo, hi] of BANDS) {
    let taken = 0;
    for (const l of all
      .filter((x) => x.p >= lo && x.p < hi && survivesBlowout(x) && scriptNeutral(x))
      .sort((a, b) => b.p - a.p)) {
      const f = family(l.label);
      if ((seen.get(f) ?? 0) >= 2) continue;
      seen.set(f, (seen.get(f) ?? 0) + 1);
      wide.push({ ...l, bits: packed(l.arr), price: KNOWN.get(l.label) ?? null });
      if (++taken >= 10) break;
    }
  }
  const andBits = (a, b) => {
    const out = new Uint32Array(WORDS);
    for (let w = 0; w < WORDS; w++) out[w] = a[w] & b[w];
    return out;
  };
  const count = (bits) => {
    let c = 0;
    for (let w = 0; w < WORDS; w++) {
      let v = bits[w];
      v = v - ((v >> 1) & 0x55555555);
      v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
      c += (((v + (v >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
    }
    return c;
  };
  const ones = new Uint32Array(WORDS).fill(0xffffffff);
  if (SIMS % 32) ones[WORDS - 1] = (1 << SIMS % 32) - 1;
  let beam = [{ idx: [], bits: ones, pay: 1 }];
  let bestSlip = null;
  for (let depth = 1; depth <= MAXLEGS; depth++) {
    const next = [];
    for (const st of beam) {
      const last = st.idx.length ? st.idx[st.idx.length - 1] : -1;
      for (let i = last + 1; i < wide.length; i++) {
        const cand = wide[i];
        if (st.idx.some((j) => person(wide[j].label) === person(cand.label))) continue;
        if (st.idx.filter((j) => kind(wide[j].label) === kind(cand.label)).length >= 2) continue;
        const bits = andBits(st.bits, cand.bits);
        const joint = count(bits) / SIMS;
        if (joint <= 0) continue;
        const pay = st.pay * (cand.price != null ? dec(cand.price) : fairDec(cand.p));
        if (pay > HI) continue; // already too long; adding legs only lengthens it
        const state = { idx: [...st.idx, i], bits, pay, joint };
        next.push(state);
        if (pay >= LO && (!bestSlip || joint > bestSlip.joint)) bestSlip = state;
      }
    }
    if (!next.length) break;
    // Keep the best states at every price level, not just the best overall: a slip on its way to
    // +1000 looks worse than a short one at every depth until the moment it arrives.
    const BUCKETS = 12;
    const lane = (pay) =>
      Math.min(BUCKETS - 1, Math.max(0, Math.floor((Math.log(pay) / Math.log(HI)) * BUCKETS)));
    const lanes = new Map();
    for (const st of next) {
      const k = lane(st.pay);
      if (!lanes.has(k)) lanes.set(k, []);
      lanes.get(k).push(st);
    }
    beam = [];
    const per = Math.max(20, Math.floor(BEAM / Math.max(1, lanes.size)));
    for (const arr of lanes.values()) {
      arr.sort((a, b) => b.joint * b.pay - a.joint * a.pay);
      beam.push(...arr.slice(0, per));
    }
  }
  if (!bestSlip) {
    console.log(`\nNo slip prices between ${toAmer(LO)} and ${toAmer(HI)} from this pool.`);
  } else {
    const legs = bestSlip.idx.map((i) => wide[i]);
    const ind = legs.reduce((a, l) => a * l.p, 1);
    console.log(
      `\nSlip built to price near ${toAmer(TARGET) > 0 ? '+' : ''}${toAmer(TARGET)} (${legs.length} legs):`,
    );
    for (const l of legs)
      console.log(
        `  ${pctf(l.p).padStart(6)}  ${l.label.padEnd(38)} ${l.price != null ? `book ${l.price > 0 ? '+' : ''}${l.price}` : `fair ${toAmer(fairDec(l.p)) > 0 ? '+' : ''}${toAmer(fairDec(l.p))}`}`,
      );
    console.log(
      `  PRICE  ${toAmer(bestSlip.pay) > 0 ? '+' : ''}${toAmer(bestSlip.pay)} if the book treats the legs as independent`,
    );
    console.log(
      `  JOINT  ${pctf(bestSlip.joint)} of ${SIMS} sims, against ${pctf(ind)} if you multiplied them`,
    );
    console.log(
      `  Break-even at that price is ${pctf(1 / bestSlip.pay)}, so the ticket returns ${((bestSlip.joint * bestSlip.pay - 1) * 100).toFixed(0)}% at fair legs.`,
    );
    console.log(
      `  A same-game engine that prices the correlation will shade it toward ${toAmer(1 / bestSlip.joint) > 0 ? '+' : ''}${toAmer(1 / bestSlip.joint)}; below that it stops being a bet.`,
    );
    scriptReport(legs);
    writeJson(
      path.join(
        DATA,
        'sheets',
        `${board.season}-w${String(board.week).padStart(2, '0')}-${GAME}-slip.json`,
      ),
      {
        builtAt: nowIso(),
        game: GAME,
        sims: SIMS,
        target: TARGET,
        price: toAmer(bestSlip.pay),
        joint: bestSlip.joint,
        independent: ind,
        shadeFloor: toAmer(1 / bestSlip.joint),
        legs: legs.map((l) => ({
          label: l.label,
          p: +l.p.toFixed(4),
          price: l.price ?? null,
          fair: toAmer(fairDec(l.p)),
        })),
      },
    );
  }
}
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
scriptReport(best.legs);
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
