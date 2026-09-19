// College football, run the way the NFL board is run: free ESPN feeds in, opponent-adjusted numbers
// out, every play priced against a market number instead of argued for in prose.
//
// Free: no key, no Odds API credits. ESPN's scoreboard carries the DraftKings spread, total and
// moneyline for the upcoming slate, and its core API keeps the closing number on games already
// played -- which is what makes a market-anchored fit possible three weeks into a season.
//
// Two models are fitted and both are reported, because they answer different questions:
//   market  - ratings fitted to every closing line this season. Projecting a slate game from these
//             should reproduce its own posted line; where it does not, the market is pricing that
//             team differently here than it does everywhere else. That gap is the line-shop signal.
//   form    - how far each team has run ahead of or behind the number, shrunk for a tiny sample.
//             Laid on top of the market fit, this is the "the market has not caught up" signal.
//
// CFB_WEEKS=1,2,3    completed weeks to fit on (default: walk forward until a week has no finals)
// CFB_DATE=20260919  the slate to price (default: today, US Eastern)
// CFB_FORM=1         weight on form residuals when projecting (default 1; 0 = market only)
import path from 'node:path';
import { DATA, getJson, writeJson, nowIso } from './lib.mjs';
import {
  rateTeams,
  projectGame,
  edgeVsMarket,
  breakEven,
  impliedPoints,
  formResiduals,
  applyResiduals,
  coverProb,
} from './cfb-ratings.mjs';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/college-football';
const SEASON = Number(process.env.CFB_SEASON || new Date().getUTCFullYear());
const FORM_WEIGHT = Number(process.env.CFB_FORM ?? 1);
const OUT = path.join(DATA, 'cfb');
const easternDate = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(d)
    .replaceAll('-', '');
const SLATE = process.env.CFB_DATE || easternDate();

// 1) Who is FBS. Conference ids rather than a hand-kept list: the scoreboard tags every competitor
// with one, so a single call classifies the whole season and new members never go stale.
const groups = await getJson(`${CORE}/seasons/${SEASON}/types/2/groups/80/children?limit=50`);
if (!groups.ok) {
  console.error(`FBS group list failed (${groups.status})`);
  process.exit(1);
}
const FBS = new Set(groups.body.items.map((i) => i.$ref.match(/groups\/(\d+)/)[1]));
// Every non-FBS opponent is pooled under one replacement-level team. Individually an FCS side plays
// one game against FBS and cannot be rated; together they are the best-sampled team in the fit.
const FCS = 'FCS';
const teamName = (c) => (FBS.has(String(c.team.conferenceId)) ? c.team.abbreviation : FCS);

// 2) Completed games.
const weeks = (process.env.CFB_WEEKS || '')
  .split(',')
  .map((w) => Number(w.trim()))
  .filter(Boolean);
const finals = [];
const usedWeeks = [];
for (const w of weeks.length ? weeks : Array.from({ length: 16 }, (_, i) => i + 1)) {
  const r = await getJson(`${SITE}/scoreboard?seasontype=2&week=${w}&groups=80&limit=400`);
  if (!r.ok || !r.body?.events?.length) break;
  const done = r.body.events.filter((e) => e.competitions[0].status?.type?.name === 'STATUS_FINAL');
  if (!done.length && !weeks.length) break;
  usedWeeks.push(w);
  for (const e of done) {
    const c = e.competitions[0];
    const h = c.competitors.find((x) => x.homeAway === 'home');
    const a = c.competitors.find((x) => x.homeAway === 'away');
    finals.push({
      id: e.id,
      week: w,
      home: teamName(h),
      away: teamName(a),
      homePts: Number(h.score),
      awayPts: Number(a.score),
      neutral: !!c.neutralSite,
    });
  }
}

// 3) The closing number on each of those games. ESPN strips odds from the site scoreboard once a
// game is final, so they come one event at a time from the core API, eight at a time.
const closing = {};
{
  const q = finals.map((g) => g.id);
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (q.length) {
        const id = q.shift();
        const r = await getJson(`${CORE}/events/${id}/competitions/${id}/odds`);
        if (!r.ok) continue;
        const items = r.body?.items || [];
        const dk = items.find((i) => /draftkings/i.test(i.provider?.name || '')) || items[0];
        if (dk) closing[id] = { spreadHome: dk.spread ?? null, total: dk.overUnder ?? null };
      }
    }),
  );
}
for (const g of finals) Object.assign(g, closing[g.id] ?? { spreadHome: null, total: null });

// 4) The slate to price.
const slate = await getJson(`${SITE}/scoreboard?dates=${SLATE}&groups=80&limit=400`);
if (!slate.ok) {
  console.error(`slate ${SLATE} failed (${slate.status})`);
  process.exit(1);
}
const num = (v) => (v == null || v === '' ? null : Number(String(v).replace('+', '')));
const upcoming = (slate.body.events || []).map((e) => {
  const c = e.competitions[0];
  const h = c.competitors.find((x) => x.homeAway === 'home');
  const a = c.competitors.find((x) => x.homeAway === 'away');
  const o = c.odds?.[0];
  return {
    espnId: e.id,
    kickoff: e.date,
    name: e.shortName,
    status: c.status?.type?.name,
    statusDetail: c.status?.type?.shortDetail,
    neutral: !!c.neutralSite,
    home: {
      abbr: h.team.abbreviation,
      rated: teamName(h),
      rank: h.curatedRank?.current ?? null,
      record: h.records?.[0]?.summary ?? null,
    },
    away: {
      abbr: a.team.abbreviation,
      rated: teamName(a),
      rank: a.curatedRank?.current ?? null,
      record: a.records?.[0]?.summary ?? null,
    },
    market: {
      provider: o?.provider?.displayName ?? null,
      spreadHome: o?.spread ?? null,
      total: o?.overUnder ?? null,
      mlHome: num(o?.moneyline?.home?.close?.odds),
      mlAway: num(o?.moneyline?.away?.close?.odds),
    },
  };
});

// 5) Fit. The market model is fitted to implied team points from every priced game, this slate
// included: the newest lines are the best information in the file, and a fit that reproduces them
// is exactly what makes a game it does NOT reproduce worth looking at. Shrinkage is near zero
// because a market expectation carries no sampling noise, only the fit's own misfit.
const priced = [
  ...finals.filter((g) => g.spreadHome != null && g.total != null),
  ...upcoming
    .filter((g) => g.market.spreadHome != null && g.market.total != null)
    .map((g) => ({
      home: g.home.rated,
      away: g.away.rated,
      neutral: g.neutral,
      spreadHome: g.market.spreadHome,
      total: g.market.total,
    })),
].map((g) => {
  const p = impliedPoints(g.spreadHome, g.total);
  return { home: g.home, away: g.away, neutral: g.neutral, homePts: p.homePts, awayPts: p.awayPts };
});
const marketModel = rateTeams(priced, { shrink: 0.3, cap: 99, iters: 80 });
const resid = formResiduals(finals.filter((g) => g.spreadHome != null && g.total != null));
const playModel = applyResiduals(marketModel, resid, FORM_WEIGHT);

// 6) Price the slate.
const games = upcoming.map((g) => {
  const key = { home: g.home.rated, away: g.away.rated, neutral: g.neutral };
  const mkt = projectGame(marketModel, key);
  const play = projectGame(playModel, key);
  return {
    ...g,
    marketFit: mkt,
    model: play,
    edge: play ? edgeVsMarket(play, g.market, playModel.sigma) : null,
    // How far the market fit is from this game's own posted number. Small everywhere means the fit
    // is sound; large on one game means that number disagrees with the rest of the market's book.
    fitGap:
      mkt && g.market.spreadHome != null ? +(mkt.margin - -g.market.spreadHome).toFixed(1) : null,
    formGap: play && mkt ? +(play.margin - mkt.margin).toFixed(1) : null,
  };
});
games.sort((x, y) => Date.parse(x.kickoff) - Date.parse(y.kickoff));

const withGap = games.filter((g) => g.fitGap != null);
const rmse = withGap.length
  ? Math.sqrt(withGap.reduce((s, g) => s + g.fitGap ** 2, 0) / withGap.length)
  : null;

writeJson(path.join(OUT, `slate-${SLATE}.json`), {
  fetchedAt: nowIso(),
  season: SEASON,
  slate: SLATE,
  fit: {
    finals: finals.length,
    pricedFinals: finals.filter((g) => g.spreadHome != null).length,
    weeks: usedWeeks,
    mu: marketModel.mu,
    hfa: marketModel.hfa,
    sigma: marketModel.sigma,
    formWeight: FORM_WEIGHT,
    fitRmseVsPostedSpread: rmse == null ? null : +rmse.toFixed(2),
  },
  ratings: playModel.teams,
  games,
});

// 7) Report.
// A game against the pooled FCS side is fitted from a rating that stands for forty different
// programs, so its gap measures the pooling and not the number. Same for a team the fit has barely
// seen. Neither is playable, and both are excluded from the ranked lists rather than quietly
// carried into them.
const playable = (g) =>
  g.status === 'STATUS_SCHEDULED' &&
  g.edge?.spreadEdge != null &&
  g.home.rated !== FCS &&
  g.away.rated !== FCS &&
  (resid[g.home.rated]?.games ?? 0) >= 2 &&
  (resid[g.away.rated]?.games ?? 0) >= 2;
const live = games.filter(playable);
const gaps = live.filter((g) => g.fitGap != null).map((g) => g.fitGap);
const liveRmse = gaps.length ? Math.sqrt(gaps.reduce((s, x) => s + x * x, 0) / gaps.length) : null;
console.log(
  `fit: ${finals.length} finals (weeks ${usedWeeks.join(',')}), ${finals.filter((g) => g.spreadHome != null).length} with a closing number; mu=${marketModel.mu} pts/team/game`,
);
console.log(
  `market fit vs posted spreads: ${rmse?.toFixed(2)} pts RMSE over all ${withGap.length}, ${liveRmse?.toFixed(2)} over the ${live.length} playable FBS-vs-FBS games`,
);
console.log(
  `=> a gap smaller than ${liveRmse?.toFixed(1)} points is the fit's own error, not an edge.`,
);
console.log(`slate ${SLATE}: ${games.length} games, ${live.length} playable\n`);

// A play is only as good as the fit under it. Two questions, in order:
//  1. Does the market's own rating of these two teams reproduce this game's posted number? If not,
//     the market is pricing something this fit cannot see -- an injury, a suspension, a look-ahead
//     -- and the disagreement is information against us, not an edge for us.
//  2. Given a number the fit agrees with, how far has form moved it?
// Only a game that passes (1) gets ranked on (2). That ordering is the whole discipline here.
const tolerance = liveRmse ?? 4;
for (const g of live) {
  g.clean = Math.abs(g.fitGap) <= tolerance;
  g.sideTier = !g.clean
    ? 'market disagrees'
    : g.edge.sideCoverProb >= 0.65
      ? 'A'
      : g.edge.sideCoverProb >= 0.58
        ? 'B'
        : 'pass';
  g.totalTier = !g.clean
    ? 'market disagrees'
    : Math.abs(g.edge.totalEdge ?? 0) >= 6
      ? 'A'
      : Math.abs(g.edge.totalEdge ?? 0) >= 4
        ? 'B'
        : 'pass';
}
const rank = (arr, f) => [...arr].sort((x, y) => Math.abs(f(y)) - Math.abs(f(x)));
console.log('BOARD  (fit agrees with the posted number; ranked by how far form moves it)');
for (const g of rank(
  live.filter((x) => x.clean && x.sideTier !== 'pass'),
  (g) => g.formGap,
).slice(0, 10)) {
  const side = g.edge.side === 'home' ? g.home.abbr : g.away.abbr;
  const line = g.edge.side === 'home' ? g.market.spreadHome : -g.market.spreadHome;
  const price = g.edge.side === 'home' ? g.market.mlHome : g.market.mlAway;
  console.log(
    [
      `[${g.sideTier}]`,
      `${side} ${line > 0 ? '+' : ''}${line}`.padEnd(12),
      g.name.padEnd(13),
      `cover ${(g.edge.sideCoverProb * 100).toFixed(1)}%`.padEnd(13),
      `form ${(g.formGap > 0 ? '+' : '') + g.formGap} pts`.padEnd(15),
      `fit gap ${(g.fitGap > 0 ? '+' : '') + g.fitGap}`.padEnd(14),
      price != null ? `ML ${price}` : '',
    ].join(' '),
  );
}
console.log('\nBOARD TOTALS');
for (const g of rank(
  live.filter((x) => x.clean && x.totalTier !== 'pass'),
  (g) => g.edge.totalEdge,
).slice(0, 10)) {
  console.log(
    [
      `[${g.totalTier}]`,
      `${g.edge.totalEdge > 0 ? 'OVER ' : 'UNDER'} ${g.market.total}`.padEnd(12),
      g.name.padEnd(13),
      `model ${g.model.total}`.padEnd(13),
      `edge ${(g.edge.totalEdge > 0 ? '+' : '') + g.edge.totalEdge}`.padEnd(12),
      `fit gap ${(g.fitGap > 0 ? '+' : '') + g.fitGap}`,
    ].join(' '),
  );
}
console.log("\nSET ASIDE  (fit and the posted number disagree by more than the fit's own error)");
for (const g of rank(
  live.filter((x) => !x.clean),
  (g) => g.fitGap,
).slice(0, 8)) {
  console.log(
    `  ${g.name.padEnd(13)} mkt ${String(g.market.spreadHome).padStart(6)}  fit ${String(g.marketFit.spreadHome).padStart(6)}  gap ${(g.fitGap > 0 ? '+' : '') + g.fitGap}`,
  );
}
console.log('');

console.log(
  "SIDES  (home convention: fit = market's own ratings, form = fit plus results vs the number)",
);
for (const g of rank(live, (g) => g.formGap).slice(0, 16)) {
  const side = g.edge.side === 'home' ? g.home.abbr : g.away.abbr;
  const price = g.edge.side === 'home' ? g.market.mlHome : g.market.mlAway;
  console.log(
    [
      g.name.padEnd(13),
      `mkt ${String(g.market.spreadHome).padStart(6)}`,
      `fit ${String(g.marketFit.spreadHome).padStart(6)}`,
      `form ${String(g.model.spreadHome).padStart(6)}`,
      `gap ${(g.fitGap > 0 ? '+' : '') + g.fitGap}`.padEnd(10),
      `dForm ${(g.formGap > 0 ? '+' : '') + g.formGap}`.padEnd(12),
      `${side} ${(g.edge.sideCoverProb * 100).toFixed(1)}%`.padEnd(14),
      price != null ? `ML ${price} be ${(breakEven(price) * 100).toFixed(1)}%` : '',
    ].join(' '),
  );
}
console.log('\nTOTALS');
for (const g of rank(live, (g) => g.edge.totalEdge ?? 0).slice(0, 14)) {
  console.log(
    [
      g.name.padEnd(13),
      `mkt ${String(g.market.total).padStart(5)}`,
      `fit ${String(g.marketFit.total).padStart(5)}`,
      `form ${String(g.model.total).padStart(5)}`,
      `edge ${(g.edge.totalEdge > 0 ? '+' : '') + g.edge.totalEdge}`.padEnd(11),
      g.edge.totalEdge > 0 ? 'lean OVER' : 'lean UNDER',
    ].join(' '),
  );
}
console.log('\nFORM: biggest movers against the number (per game, shrunk)');
const movers = Object.entries(playModel.teams)
  .filter(([n, t]) => n !== FCS && t.form && t.form.games >= 2)
  .sort(
    (a, b) =>
      Math.abs(b[1].form.offResid + b[1].form.defResid) -
      Math.abs(a[1].form.offResid + a[1].form.defResid),
  );
for (const [n, t] of movers.slice(0, 12)) {
  console.log(
    `${n.padEnd(6)} net ${(t.form.offResid + t.form.defResid > 0 ? '+' : '') + (t.form.offResid + t.form.defResid).toFixed(1)} pts/g  (off ${t.form.offResid >= 0 ? '+' : ''}${t.form.offResid}, def ${t.form.defResid >= 0 ? '+' : ''}${t.form.defResid}, ${t.form.games} g)`,
  );
}
