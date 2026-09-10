// Pulls game lines and anytime-TD props from The Odds API (free tier: 500 credits/month).
// Cost: game lines = markets x regions per call (3 credits with h2h,spreads,totals + us);
// props = 1 credit per event per market per region. Set PROPS_DAYS_AHEAD to bound spend.
import path from 'node:path';
import fs from 'node:fs';
import { DATA, getJson, readJson, writeJson, nowIso, normName, ABBR_BY_NAME } from './lib.mjs';

const KEY = process.env.ODDS_API_KEY;
const REGION = process.env.ODDS_REGION || 'us';
const PROPS_DAYS_AHEAD = Number(process.env.PROPS_DAYS_AHEAD ?? 4);
const SPORT = 'americanfootball_nfl';
const BASE = 'https://api.the-odds-api.com/v4';
const latestFile = path.join(DATA, 'odds', 'latest.json');
const historyFile = path.join(DATA, 'odds', 'history.jsonl');

if (!KEY) {
  console.error('ODDS_API_KEY not set; skipping odds fetch (board will use research prices).');
  process.exit(0);
}
const usage = { remaining: null, used: null };
function noteUsage(h) {
  usage.remaining = Number(h.get('x-requests-remaining') ?? usage.remaining);
  usage.used = Number(h.get('x-requests-used') ?? usage.used);
}

// 1) Game lines for all upcoming events (one call).
const lines = await getJson(
  `${BASE}/sports/${SPORT}/odds?apiKey=${KEY}&regions=${REGION}&markets=h2h,spreads,totals&oddsFormat=american`,
);
if (!lines.ok) {
  console.error(`odds lines failed (${lines.status}):`, JSON.stringify(lines.body).slice(0, 300));
  process.exit(0);
}
noteUsage(lines.headers);
const events = lines.body.map((e) => ({
  id: e.id,
  commence: e.commence_time,
  home: ABBR_BY_NAME[e.home_team] || e.home_team,
  away: ABBR_BY_NAME[e.away_team] || e.away_team,
  lines: summarizeLines(e),
  props: {},
}));

function summarizeLines(e) {
  const out = { ml: {}, spread: {}, total: {}, books: 0 };
  const ml = { home: [], away: [] },
    sp = { home: [], away: [] },
    tot = { over: [], under: [] },
    pts = [],
    totPts = [];
  for (const b of e.bookmakers || []) {
    out.books++;
    for (const m of b.markets || []) {
      for (const o of m.outcomes || []) {
        if (m.key === 'h2h') (o.name === e.home_team ? ml.home : ml.away).push(o.price);
        if (m.key === 'spreads') {
          (o.name === e.home_team ? sp.home : sp.away).push(o.price);
          if (o.name === e.home_team) pts.push(o.point);
        }
        if (m.key === 'totals') {
          (o.name === 'Over' ? tot.over : tot.under).push(o.price);
          if (o.name === 'Over') totPts.push(o.point);
        }
      }
    }
  }
  out.ml = {
    home: median(ml.home),
    away: median(ml.away),
    bestHome: best(ml.home),
    bestAway: best(ml.away),
  };
  out.spread = { homePoint: median(pts), homePrice: median(sp.home), awayPrice: median(sp.away) };
  out.total = { point: median(totPts), over: median(tot.over), under: median(tot.under) };
  return out;
}
function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
function best(a) {
  return a.length ? Math.max(...a) : null;
}

// 2) Anytime TD props, one event at a time, only inside the window (bounded credit spend).
const horizon = Date.now() + PROPS_DAYS_AHEAD * 86400000;
const previous = readJson(latestFile, { events: [] });
for (const ev of events) {
  const t = Date.parse(ev.commence);
  if (t > horizon || t < Date.now() - 6 * 3600000) {
    // Outside window: carry forward last known props so the board keeps prices.
    const prev = previous.events?.find((p) => p.id === ev.id);
    if (prev?.props) ev.props = prev.props;
    continue;
  }
  const r = await getJson(
    `${BASE}/sports/${SPORT}/events/${ev.id}/odds?apiKey=${KEY}&regions=${REGION}&markets=player_anytime_td&oddsFormat=american`,
  );
  if (!r.ok) {
    console.error(`props ${ev.away}@${ev.home} failed (${r.status})`);
    continue;
  }
  noteUsage(r.headers);
  const byPlayer = {};
  for (const b of r.body.bookmakers || []) {
    for (const m of b.markets || []) {
      if (m.key !== 'player_anytime_td') continue;
      for (const o of m.outcomes || []) {
        if (o.name !== 'Yes') continue;
        const k = normName(o.description);
        byPlayer[k] ||= { name: o.description, books: {} };
        byPlayer[k].books[b.key] = o.price;
      }
    }
  }
  for (const p of Object.values(byPlayer)) {
    const prices = Object.values(p.books);
    p.best = Math.max(...prices);
    p.bestBook = Object.entries(p.books).find(([, v]) => v === p.best)?.[0];
    p.consensus = median(prices);
  }
  ev.props = byPlayer;
}

const snapshot = { fetchedAt: nowIso(), region: REGION, usage, events };
writeJson(latestFile, snapshot);
// Append a compact history row per player for price-movement tracking.
const day = snapshot.fetchedAt.slice(0, 10);
const rows = [];
for (const ev of events) {
  for (const [k, p] of Object.entries(ev.props)) {
    rows.push(
      JSON.stringify({
        d: day,
        ev: ev.id,
        g: `${ev.away}@${ev.home}`,
        p: k,
        best: p.best,
        cons: p.consensus,
      }),
    );
  }
  rows.push(
    JSON.stringify({
      d: day,
      ev: ev.id,
      g: `${ev.away}@${ev.home}`,
      p: '__lines__',
      ml: ev.lines.ml,
      sp: ev.lines.spread.homePoint,
      tot: ev.lines.total.point,
    }),
  );
}
fs.mkdirSync(path.dirname(historyFile), { recursive: true });
const existing = fs.existsSync(historyFile) ? fs.readFileSync(historyFile, 'utf8') : '';
const kept = existing.split('\n').filter((l) => l && !l.startsWith(`{"d":"${day}"`)); // one snapshot per day
fs.writeFileSync(historyFile, [...kept, ...rows].join('\n') + '\n');
console.log(
  `odds: ${events.length} events, ${rows.length} history rows, credits remaining ${usage.remaining}`,
);
