// A run-expectation model for one day's baseball, and the pricing that follows from it.
//
// Structure, and why it is this shape. The market total and moneyline already contain the park,
// the starters, the weather and the lineup — they are the sharpest numbers available and a model
// built in an afternoon does not beat them by pretending otherwise. So this builds its own
// estimate of each side's run expectation from components the market also sees, then BLENDS toward
// the market rather than replacing it. MARKET_WEIGHT is the honest part of the file: at 0.65 the
// model is a tilt on a sharp line, not a claim to have out-thought it. Anything that survives that
// blend with an edge is a real disagreement, not an artefact of the model being loud.
//
// Each side's expectation:
//   runs = leagueRunsPerTeam x offence(team, opposing hand) x pitching(starter, bullpen) x park
//
// Every component is an index where 1.00 is league average, every rate is regressed toward league
// by innings or plate appearances, and every team rate is de-parked before it is used so a park is
// never counted twice.
import {
  runDist,
  marginDist,
  atLeast,
  winProb,
  solveRuns,
  impliedProb,
  noVig,
  payout,
  CLUSTER,
} from './mlb-runline.mjs';

/** How much of the final number comes from the market rather than from this model. */
export const MARKET_WEIGHT = 0.65;
/** Innings of regression toward league for a starter's and a bullpen's run rate. */
export const SP_REGRESS = 70;
export const BP_REGRESS = 150;
/** Plate appearances of regression for a platoon split. */
export const SPLIT_REGRESS = 900;
/** Runs are to OPS roughly as this power. */
export const OPS_EXPONENT = 1.8;

/**
 * Baseball innings notation to real innings: 813.1 is 813 and one third, not 813.1.
 * Reading it as a decimal is a silent 0.2-inning error on every pitcher on the board.
 */
export function innings(x) {
  if (x == null) return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  const whole = Math.trunc(n);
  const tenths = Math.round(Math.abs(n - whole) * 10);
  return whole + (n < 0 ? -1 : 1) * (tenths / 3);
}

/** Runs allowed per nine innings. Runs, not earned runs: a total pays on unearned ones too. */
export function ra9(runs, ip) {
  const i = innings(ip);
  return i && i > 0 ? (runs * 9) / i : null;
}

/** Regress a rate toward a league mean by sample size. */
export function regress(rate, sample, leagueRate, k) {
  if (rate == null || !sample) return leagueRate;
  return (rate * sample + leagueRate * k) / (sample + k);
}

/**
 * Remove the home park from a season rate that was earned roughly half at home.
 * A team's runs per game and a pitcher's run rate both carry their own park; multiplying the
 * result by tonight's park factor without this step counts one park twice.
 */
export function dePark(rate, homeParkFactor, homeShare = 0.5) {
  return rate / (1 + homeShare * (homeParkFactor - 1));
}

/** Share of a game's innings the listed starter is expected to cover. */
export function starterShare(ip, starts) {
  const i = innings(ip);
  if (!i || !starts) return 0.5; // no track record: assume a short outing
  return Math.min(0.78, Math.max(0.25, i / starts / 9));
}

/**
 * One side's expected runs, before any blend with the market.
 * Every argument is already an index or a rate; nothing here reaches for data.
 */
export function sideRuns({ leagueRunsPerTeam, offenceIndex, pitchingIndex, parkFactor }) {
  return leagueRunsPerTeam * offenceIndex * pitchingIndex * parkFactor;
}

/** Blend a model pair with the market pair. */
export function blend(model, market, w = MARKET_WEIGHT) {
  return {
    away: market.away * w + model.away * (1 - w),
    home: market.home * w + model.home * (1 - w),
  };
}

/**
 * The market's own view of each side's run expectation: de-vig the moneyline for the win
 * probability, then solve the two run means that reproduce it at the posted total.
 */
export function marketRuns({ total, mlAway, mlHome, overPrice, underPrice }) {
  // The juice is rarely symmetric. Over -114 / under -105 says the fair total sits slightly below
  // the posted number; shift it by the half-point the price gap implies.
  const o = impliedProb(overPrice ?? -110);
  const u = impliedProb(underPrice ?? -110);
  const lean = (o - u) / (o + u); // + means the over is the shorter price
  const fairTotal = total + lean * 0.5;
  const homeFav = mlHome < mlAway;
  const favP = homeFav ? noVig(mlHome, mlAway) : noVig(mlAway, mlHome);
  const r = solveRuns(fairTotal, favP);
  return {
    fairTotal: +fairTotal.toFixed(3),
    favWinProb: +favP.toFixed(4),
    away: homeFav ? r.dog : r.fav,
    home: homeFav ? r.fav : r.dog,
  };
}

/**
 * How much of a favourite's win probability comes from winning by two or more, as the market
 * prices it and as this model prices it.
 *
 * This exists because of a mistake worth keeping. A -167 favourite with its -1.5 priced at -107
 * looked broken next to the rest of the board, and the first version of this file rejected it as a
 * stale feed row on the strength of a half-remembered "55-60% of wins are by 2+". The real figure
 * is about 71% — roughly 28.5% of games are decided by one run — and running the comparison across
 * every game on the board showed the market between 69% and 83% with this model between 67% and
 * 78%, the market above the model in six games out of seven.
 *
 * So nothing was wrong with that price. What the sweep found was a calibration gap in the model's
 * own margin distribution: at CLUSTER = 5 it produces slightly too many one-run games, which makes
 * every dog run line look better than it is. Run-line legs are excluded from tickets while that
 * stands, rather than filtered game by game.
 */
export function runLineShare({
  mlFav,
  mlDog,
  favRunLinePrice,
  dogRunLinePrice,
  total,
  r = CLUSTER,
}) {
  const pWin = noVig(mlFav, mlDog);
  const a = impliedProb(favRunLinePrice);
  const b = impliedProb(dogRunLinePrice);
  const market = a / (a + b) / pWin;
  const runs = solveRuns(total, pWin, r);
  const dist = marginDist(runs.fav, runs.dog, r);
  const model = atLeast(dist, 2) / winProb(dist);
  return {
    pWin: +pWin.toFixed(4),
    market: +market.toFixed(4),
    model: +model.toFixed(4),
    gap: +(market - model).toFixed(4),
  };
}

/** Every market on one game, priced off a pair of run expectations. */
export function priceGame({ away, home, total, runLine = 1.5, r = CLUSTER }) {
  const dist = marginDist(home, away, r); // margin is home minus away
  const pHome = winProb(dist);
  const pAway = 1 - pHome;
  const a = runDist(away, r);
  const h = runDist(home, r);
  // Baseball totals are posted on whole numbers as often as half numbers, and a whole number
  // PUSHES. Counting "exactly 8" as an under win is worth twelve points of probability on a line
  // of 8 — it made the model like the under in every single game whose total was an integer, which
  // is what gave this away. Push mass is kept separate and belongs to neither side.
  let over = 0;
  let push = 0;
  let under = 0;
  for (let x = 0; x < a.length; x++)
    for (let y = 0; y < h.length; y++) {
      const p = a[x] * h[y];
      if (x + y > total) over += p;
      else if (x + y === total) push += p;
      else under += p;
    }
  const need = Math.ceil(runLine + 1e-9);
  return {
    runs: { away: +away.toFixed(3), home: +home.toFixed(3), total: +(away + home).toFixed(3) },
    ml: { away: +pAway.toFixed(4), home: +pHome.toFixed(4) },
    // Covering -1.5 means winning by two or more; +1.5 is everything else. A 1.5 run line cannot
    // push, but a whole-number one can, so this uses the same three-way split.
    runLine: {
      homeMinus: +atLeast(dist, need).toFixed(4),
      awayMinus: +(1 - atLeast(dist, -(need - 1))).toFixed(4),
      homePlus: +atLeast(dist, -(need - 1)).toFixed(4),
      awayPlus: +(1 - atLeast(dist, need)).toFixed(4),
    },
    total: { over: +over.toFixed(4), push: +push.toFixed(4), under: +under.toFixed(4) },
  };
}

/**
 * Expected value per unit staked, and the price the model would post.
 *
 * `push` is the probability the bet is refunded rather than won or lost. It changes two things: the
 * stake comes back so it does not enter the EV as a loss, and the number to compare against the
 * price is the chance of winning GIVEN a result, not the raw probability. Ignoring it overstates
 * whichever side of a whole number sits below the mean.
 */
export function grade(prob, price, push = 0) {
  const pay = payout(price);
  const lose = Math.max(0, 1 - prob - push);
  // Conditional on the bet resolving at all.
  const decided = prob + lose;
  const conditional = decided > 0 ? prob / decided : 0;
  return {
    prob: +prob.toFixed(4),
    push: +push.toFixed(4),
    conditional: +conditional.toFixed(4),
    price,
    breakEven: +impliedProb(price).toFixed(4),
    edge: +(conditional - impliedProb(price)).toFixed(4),
    ev: +(prob * pay - lose).toFixed(4),
    fair:
      conditional >= 0.5
        ? Math.round(-100 * (conditional / (1 - conditional)))
        : Math.round(100 * ((1 - conditional) / conditional)),
  };
}

export { CLUSTER, impliedProb, payout, noVig };
