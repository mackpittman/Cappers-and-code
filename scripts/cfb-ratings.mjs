// Opponent-adjusted college-football ratings: the same arithmetic the NFL board runs on, fitted to
// a college sample that is an order of magnitude thinner and an order of magnitude wider in the
// tails. Every constant below exists because of that difference; read the notes before tuning one.
//
// A team's line is split into offence and defence rather than a single power number so totals can
// be projected from the same fit as sides. Ratings are points per game above (offence) or below
// (defence) the FBS average, adjusted for who they were earned against and where.
//
// Pure functions, no imports: `node --test` loads this module directly.

/** Home-field edge in points. College HFA has compressed toward the NFL's; 2.4 is the modern fit. */
export const HFA = 2.4;
/** Standard deviation of college margin against the number. NFL is ~13.5; college tails are wider. */
export const SIGMA = 16.0;
/**
 * A team's scored points are capped before rating. Week 1 college slates contain 70-3 results
 * against overmatched opponents; uncapped, one of those moves a two-game rating by twenty points
 * and the model spends the rest of the season believing it.
 */
export const POINT_CAP = 52;
/**
 * Shrinkage in games. A rating is pulled toward the FBS average by n/(n+SHRINK), so after two
 * games a team keeps a third of what it has shown. This is the single most important constant in
 * the file: without it a September college model is a list of schedule artifacts.
 */
export const SHRINK = 4;

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf approximation). */
export function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

/** Probability a team favoured by `margin` points wins outright. */
export function winProbFromMargin(margin, sigma = SIGMA) {
  return normCdf(margin / sigma);
}

/** Probability a side covering `margin` clears a market number of `line` (home-margin convention). */
export function coverProb(margin, line, sigma = SIGMA) {
  return normCdf((margin - line) / sigma);
}

/**
 * Fit offence/defence ratings from completed games.
 *
 * `games`: { home, away, homePts, awayPts, neutral }. Teams are whatever string you pass, so pool
 * every non-FBS opponent under one name before calling: individually an FCS team plays one game
 * against FBS and cannot be rated, but together they are the best-sampled team in the file.
 */
export function rateTeams(games, opts = {}) {
  const hfa = opts.hfa ?? HFA;
  const cap = opts.cap ?? POINT_CAP;
  const shrink = opts.shrink ?? SHRINK;
  const iters = opts.iters ?? 60;
  const rows = [];
  for (const g of games) {
    const site = g.neutral ? 0 : hfa / 2;
    const hp = Math.min(g.homePts, cap);
    const ap = Math.min(g.awayPts, cap);
    rows.push({ team: g.home, opp: g.away, pf: hp, pa: ap, site });
    rows.push({ team: g.away, opp: g.home, pf: ap, pa: hp, site: -site });
  }
  const names = [...new Set(rows.map((r) => r.team))];
  const mu = rows.length ? rows.reduce((s, r) => s + r.pf, 0) / rows.length : 0;
  const byTeam = new Map(names.map((n) => [n, rows.filter((r) => r.team === n)]));
  let off = new Map(names.map((n) => [n, 0]));
  let def = new Map(names.map((n) => [n, 0]));
  for (let i = 0; i < iters; i++) {
    const nOff = new Map();
    const nDef = new Map();
    for (const n of names) {
      const rs = byTeam.get(n);
      const w = rs.length / (rs.length + shrink);
      // Points scored, less what an average offence would have scored against that defence there.
      const o = rs.reduce((s, r) => s + (r.pf - (mu - def.get(r.opp) + r.site)), 0) / rs.length;
      // Points an average defence would have allowed to that offence there, less what was allowed.
      const d = rs.reduce((s, r) => s + (mu + off.get(r.opp) - r.site - r.pa), 0) / rs.length;
      nOff.set(n, o * w);
      nDef.set(n, d * w);
    }
    off = nOff;
    def = nDef;
  }
  const teams = {};
  for (const n of names) {
    const rs = byTeam.get(n);
    teams[n] = {
      off: +off.get(n).toFixed(2),
      def: +def.get(n).toFixed(2),
      net: +(off.get(n) + def.get(n)).toFixed(2),
      games: rs.length,
      // Strength of schedule: the average net rating of who they played, in points.
      sos: +(rs.reduce((s, r) => s + off.get(r.opp) + def.get(r.opp), 0) / rs.length).toFixed(2),
    };
  }
  return { mu: +mu.toFixed(2), hfa, sigma: opts.sigma ?? SIGMA, teams };
}

/** Project one matchup from a fit. Returns the spread in ESPN convention (negative = home laying). */
export function projectGame(model, { home, away, neutral = false }) {
  const h = model.teams[home];
  const a = model.teams[away];
  if (!h || !a) return null;
  const site = neutral ? 0 : model.hfa / 2;
  const homePts = model.mu + h.off - a.def + site;
  const awayPts = model.mu + a.off - h.def - site;
  const margin = homePts - awayPts;
  return {
    homePts: +homePts.toFixed(1),
    awayPts: +awayPts.toFixed(1),
    margin: +margin.toFixed(1),
    spreadHome: +(-margin).toFixed(1),
    total: +(homePts + awayPts).toFixed(1),
    homeWinProb: +winProbFromMargin(margin, model.sigma).toFixed(3),
  };
}

/**
 * Model against market. `marketSpreadHome` and `marketTotal` are the book's numbers in the same
 * conventions. A positive `spreadEdge` means the model likes the home side by that many points more
 * than the market does; a positive `totalEdge` means the model scores more points than the market.
 */
export function edgeVsMarket(proj, { spreadHome, total }, sigma = SIGMA) {
  if (!proj) return null;
  const out = { spreadEdge: null, totalEdge: null, side: null, sideCoverProb: null };
  if (spreadHome != null) {
    const marketMargin = -spreadHome; // ESPN stores the home spread, so the market's home margin is its negation
    out.spreadEdge = +(proj.margin - marketMargin).toFixed(1);
    out.side = out.spreadEdge >= 0 ? 'home' : 'away';
    const p = coverProb(proj.margin, marketMargin, sigma);
    out.sideCoverProb = +(out.side === 'home' ? p : 1 - p).toFixed(3);
  }
  if (total != null) out.totalEdge = +(proj.total - total).toFixed(1);
  return out;
}

/** Break-even win rate for an American price, used to turn a cover probability into an edge. */
export function breakEven(american) {
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

/**
 * A market line decomposed into the two team totals it implies. `spreadHome` is ESPN's convention
 * (negative = home laying), `total` the over/under. This is what lets the same rating engine be
 * fitted to what the market expected as well as to what actually happened.
 */
export function impliedPoints(spreadHome, total) {
  if (spreadHome == null || total == null) return null;
  const margin = -spreadHome;
  return { homePts: (total + margin) / 2, awayPts: (total - margin) / 2 };
}

/**
 * How far each team has run ahead of, or behind, what the market expected of it.
 *
 * Opponent and venue need no adjustment here: they are already inside the number the market hung,
 * so the residual is clean by construction. `offResid` is points scored above expectation per game,
 * `defResid` points allowed below it. Both are shrunk by n/(n+shrink) for the same reason the
 * ratings are — three September games is not a season.
 */
export function formResiduals(games, shrink = SHRINK) {
  const rows = new Map();
  const push = (team, dOff, dDef) => {
    if (!rows.has(team)) rows.set(team, { off: [], def: [] });
    rows.get(team).off.push(dOff);
    rows.get(team).def.push(dDef);
  };
  for (const g of games) {
    const exp = impliedPoints(g.spreadHome, g.total);
    if (!exp) continue;
    push(g.home, g.homePts - exp.homePts, exp.awayPts - g.awayPts);
    push(g.away, g.awayPts - exp.awayPts, exp.homePts - g.homePts);
  }
  const out = {};
  for (const [team, r] of rows) {
    const n = r.off.length;
    const w = n / (n + shrink);
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    out[team] = {
      games: n,
      offResid: +(mean(r.off) * w).toFixed(2),
      defResid: +(mean(r.def) * w).toFixed(2),
      rawOff: +mean(r.off).toFixed(2),
      rawDef: +mean(r.def).toFixed(2),
    };
  }
  return out;
}

/** Add form residuals onto a market-fitted model, producing the ratings a play is priced from. */
export function applyResiduals(model, resid, weight = 1) {
  const teams = {};
  for (const [name, t] of Object.entries(model.teams)) {
    const r = resid[name];
    const off = t.off + (r ? r.offResid * weight : 0);
    const def = t.def + (r ? r.defResid * weight : 0);
    teams[name] = {
      ...t,
      off: +off.toFixed(2),
      def: +def.toFixed(2),
      net: +(off + def).toFixed(2),
      form: r ?? null,
    };
  }
  return { ...model, teams };
}
