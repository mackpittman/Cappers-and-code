// Pricing a baseball run line: turn a moneyline and a total into a distribution over the final
// margin, then read the -1.5 off it.
//
// Runs are modelled as negative binomial rather than Poisson, and that choice is the whole file.
// Poisson assumes runs arrive independently; baseball scores them in clusters, so a Poisson fit
// produces 36% one-run finals against a real rate near 28-29%. Too many one-run games means the
// model systematically understates how often a favourite wins by two, which is exactly the number a
// run line asks for. CLUSTER = 5 is the shape that reproduces the real rate (see the test).
//
// Pure functions. Everything here takes numbers and returns numbers.

/** Negative-binomial shape for runs per team per game. Lower = more clustered; Infinity = Poisson. */
export const CLUSTER = 5;
/** Highest run total the distributions are evaluated to. Nine-inning baseball never reaches it. */
const MAX = 40;

/** Log-gamma (Numerical Recipes), so the negative binomial can take a non-integer shape. */
export function gammaLn(z) {
  const C = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = z;
  let t = z + 5.5;
  t -= (z + 0.5) * Math.log(t);
  let s = 1.000000000190015;
  for (let j = 0; j < 6; j++) s += C[j] / ++y;
  return -t + Math.log((2.5066282746310005 * s) / z);
}

/** Distribution of one team's runs, as an array indexed by run total. */
export function runDist(mean, r = CLUSTER) {
  return Array.from({ length: MAX + 1 }, (_, k) =>
    Math.exp(
      gammaLn(k + r) -
        gammaLn(k + 1) -
        gammaLn(r) +
        r * Math.log(r / (r + mean)) +
        k * Math.log(mean / (r + mean)),
    ),
  );
}

/** Distribution of (favourite runs - underdog runs), as a Map from margin to probability. */
export function marginDist(favRuns, dogRuns, r = CLUSTER) {
  const f = runDist(favRuns, r);
  const d = runDist(dogRuns, r);
  const out = new Map();
  for (let a = 0; a <= MAX; a++)
    for (let b = 0; b <= MAX; b++) out.set(a - b, (out.get(a - b) ?? 0) + f[a] * d[b]);
  return out;
}

/** Probability the margin is at least `line`. The -1.5 run line is `atLeast(dist, 2)`. */
export function atLeast(dist, line) {
  let s = 0;
  for (const [k, p] of dist) if (k >= line) s += p;
  return s;
}

/** Probability the favourite wins. A regulation tie goes to extra innings, which is a coin flip. */
export function winProb(dist) {
  return atLeast(dist, 1) + (dist.get(0) ?? 0) * 0.5;
}

/**
 * Split a game total into the two run expectations that reproduce a given win probability.
 * Bisection on the favourite's share: monotone, so sixty steps is exact to the last decimal.
 */
export function solveRuns(total, favWinProb, r = CLUSTER) {
  let lo = total / 2;
  let hi = total - 0.3;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (winProb(marginDist(mid, total - mid, r)) < favWinProb) lo = mid;
    else hi = mid;
  }
  const fav = (lo + hi) / 2;
  return { fav: +fav.toFixed(3), dog: +(total - fav).toFixed(3) };
}

/** American odds -> implied probability, vig included. */
export function impliedProb(american) {
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}
/** Two-way market -> the favourite's vig-free probability. */
export function noVig(favML, dogML) {
  const a = impliedProb(favML);
  const b = impliedProb(dogML);
  return a / (a + b);
}
/** Profit per unit staked. */
export function payout(american) {
  return american > 0 ? american / 100 : 100 / -american;
}

/**
 * Price one run-line leg. Everything a bet needs in one object: what the market says the team is,
 * what that implies about the margin, and whether the offered price covers it.
 */
export function priceRunLine({ total, favML, dogML, price, line = 1.5, r = CLUSTER }) {
  const p = noVig(favML, dogML);
  const runs = solveRuns(total, p, r);
  const dist = marginDist(runs.fav, runs.dog, r);
  // A -1.5 line needs a two-run win, a -2.5 a three-run win, and so on.
  const cover = atLeast(dist, Math.ceil(line + 0.0001));
  const need = impliedProb(price);
  const pay = payout(price);
  return {
    trueWinProb: +p.toFixed(4),
    runs,
    cover: +cover.toFixed(4),
    breakEven: +need.toFixed(4),
    edge: +(cover - need).toFixed(4),
    ev: +(cover * pay - (1 - cover)).toFixed(4),
  };
}

/** Combine legs into a parlay: model probability, offered price, and whether the two agree. */
export function priceParlay(legs) {
  const prob = legs.reduce((s, l) => s * l.cover, 1);
  const dec = legs.reduce((s, l) => s * (1 + payout(l.price)), 1);
  return {
    prob: +prob.toFixed(4),
    decimal: +dec.toFixed(3),
    american: dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1)),
    breakEven: +(1 / dec).toFixed(4),
    ev: +(prob * dec - 1).toFixed(4),
  };
}
