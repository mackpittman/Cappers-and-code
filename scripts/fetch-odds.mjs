// Player props from The Odds API, spent as carefully as the free tier (500 credits/month) demands.
//
// Costs: /events is free; each /events/{id}/odds call costs (markets x regions) credits, so a
// four-market bundle on one game is 4 credits. Game lines are NOT fetched here (ESPN's free
// scoreboard covers them) unless ODDS_LINES=1.
//
// Policy (decidePhase in lib.mjs): each event is pulled at most three times per week:
//   open    -> MARKETS_OPEN    (default: anytime TD)                  ~16 credits / week
//   desig   -> MARKETS_DESIG   (default: ATD + pass/rush/rec yards)   ~64 credits / week
//   prekick -> MARKETS_PREKICK (default: anytime TD)                  ~16 credits / week
// Runs stop when the balance would drop below CREDIT_RESERVE and never exceed MAX_CREDITS_PER_RUN.
import path from 'node:path';
import fs from 'node:fs';
import {
  DATA,
  getJson,
  readJson,
  writeJson,
  nowIso,
  normName,
  ABBR_BY_NAME,
  decidePhase,
  prioritize,
} from './lib.mjs';

const KEY = process.env.ODDS_API_KEY;
const REGION = process.env.ODDS_REGION || 'us';
const PREKICK_HOURS = Number(process.env.PREKICK_HOURS ?? 8);
const CREDIT_RESERVE = Number(process.env.CREDIT_RESERVE ?? 40);
const MAX_CREDITS_PER_RUN = Number(process.env.MAX_CREDITS_PER_RUN ?? 80);
const FORCE_PHASE = process.env.FORCE_PHASE || null; // 'open' | 'desig' | 'prekick' overrides the calendar
const OPEN_HOURS = Number(process.env.OPEN_HOURS || 132); // how far out an opener pull is allowed
const MARKETS = {
  open: (process.env.MARKETS_OPEN || 'player_anytime_td').split(','),
  desig: (
    process.env.MARKETS_DESIG ||
    'player_anytime_td,player_pass_yds,player_rush_yds,player_reception_yds'
  ).split(','),
  prekick: (process.env.MARKETS_PREKICK || 'player_anytime_td,player_tds_over').split(','),
};
// EXTRA_PULL=player_tds_over pulls that market once for every game inside the pre-kick window that
// does not have it yet, whatever the phase log says (used when a market is added mid-week).
const EXTRA_PULL = (process.env.EXTRA_PULL || '').split(',').filter(Boolean);
// REPULL=1 prices a game's pre-kick markets again when the last pre-kick pull is older than
// REPULL_MIN minutes (default 60) and the game is inside the pre-kick window: line moves before a
// late-window slate, at the normal pre-kick cost per game.
const REPULL = process.env.REPULL === '1';
const REPULL_MIN = Number(process.env.REPULL_MIN ?? 60);
function repullPhase(ev, now) {
  if (!REPULL) return null;
  const h = (Date.parse(ev.commence) - now.getTime()) / 3600000;
  if (h < -0.5 || h > PREKICK_HOURS) return null;
  const last = ev.pulls?.prekick;
  return !last || now.getTime() - Date.parse(last) > REPULL_MIN * 60000 ? 'prekick' : null;
}
// Yes/No style markets: one price per player. player_tds_over is kept at the 1.5 line only (2+ TDs).
const YESNO = new Set(['player_anytime_td', 'player_1st_td', 'player_last_td', 'player_tds_over']);
const SPORT = 'americanfootball_nfl';
const BASE = 'https://api.the-odds-api.com/v4';
const latestFile = path.join(DATA, 'odds', 'latest.json');
const historyFile = path.join(DATA, 'odds', 'history.jsonl');
const creditsFile = path.join(DATA, 'odds', 'credits.jsonl');

if (!KEY) {
  console.error('ODDS_API_KEY not set; skipping props fetch (board keeps the last known prices).');
  process.exit(0);
}
const previous = readJson(latestFile, { events: [], usage: {} });
const usage = { remaining: previous.usage?.remaining ?? null, used: previous.usage?.used ?? null };
function noteUsage(h) {
  const r = h.get('x-requests-remaining');
  const u = h.get('x-requests-used');
  if (r != null) usage.remaining = Number(r);
  if (u != null) usage.used = Number(u);
}
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const medianF = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// 1) Event list (free). Carry forward markets and the per-event pull log.
const list = await getJson(`${BASE}/sports/${SPORT}/events?apiKey=${KEY}`);
if (!list.ok) {
  console.error(`events list failed (${list.status}):`, JSON.stringify(list.body).slice(0, 300));
  process.exit(0);
}
noteUsage(list.headers);
const events = list.body.map((e) => {
  const prev = previous.events?.find((p) => p.id === e.id);
  return {
    id: e.id,
    commence: e.commence_time,
    home: ABBR_BY_NAME[e.home_team] || e.home_team,
    away: ABBR_BY_NAME[e.away_team] || e.away_team,
    lines: prev?.lines ?? null,
    markets: prev?.markets ?? {}, // { marketKey: { fetchedAt, players: { normName: {...} } } }
    pulls: prev?.pulls ?? {},
  };
});

// 2) Optional multi-book game lines (3 credits). Off by default: ESPN's scoreboard is free.
if (process.env.ODDS_LINES === '1') {
  const lines = await getJson(
    `${BASE}/sports/${SPORT}/odds?apiKey=${KEY}&regions=${REGION}&markets=h2h,spreads,totals&oddsFormat=american`,
  );
  if (lines.ok) {
    noteUsage(lines.headers);
    for (const e of lines.body) {
      const ev = events.find((x) => x.id === e.id);
      if (!ev) continue;
      const ml = { home: [], away: [] },
        sp = { home: [], away: [] },
        pts = [],
        tot = { over: [], under: [] },
        tp = [];
      for (const b of e.bookmakers || [])
        for (const m of b.markets || [])
          for (const o of m.outcomes || []) {
            if (m.key === 'h2h') (o.name === e.home_team ? ml.home : ml.away).push(o.price);
            if (m.key === 'spreads') {
              (o.name === e.home_team ? sp.home : sp.away).push(o.price);
              if (o.name === e.home_team) pts.push(o.point);
            }
            if (m.key === 'totals') {
              (o.name === 'Over' ? tot.over : tot.under).push(o.price);
              if (o.name === 'Over') tp.push(o.point);
            }
          }
      ev.lines = {
        fetchedAt: nowIso(),
        ml: {
          home: median(ml.home),
          away: median(ml.away),
          bestHome: ml.home.length ? Math.max(...ml.home) : null,
          bestAway: ml.away.length ? Math.max(...ml.away) : null,
        },
        spread: { homePoint: medianF(pts), homePrice: median(sp.home), awayPrice: median(sp.away) },
        total: { point: medianF(tp), over: median(tot.over), under: median(tot.under) },
      };
    }
  }
}

// 3) Decide what to pull now: soonest kickoff first, within budget.
const now = new Date();
const candidates = prioritize(events, now)
  .map((ev) => ({
    ev,
    phase:
      FORCE_PHASE ||
      decidePhase(ev.commence, ev.pulls, now, {
        prekickHours: PREKICK_HOURS,
        openHours: OPEN_HOURS,
      }) ||
      repullPhase(ev, now),
  }))
  .filter((c) => c.phase);
let spent = 0;
const pulled = [];
for (const { ev, phase } of candidates) {
  const markets = MARKETS[phase];
  const cost = markets.length;
  if (spent + cost > MAX_CREDITS_PER_RUN) {
    console.log(`run cap ${MAX_CREDITS_PER_RUN} reached; deferring ${ev.away}@${ev.home}`);
    break;
  }
  if (usage.remaining != null && usage.remaining - cost < CREDIT_RESERVE) {
    console.log(
      `reserve ${CREDIT_RESERVE} would be breached (${usage.remaining} left); deferring ${ev.away}@${ev.home}`,
    );
    break;
  }
  const r = await getJson(
    `${BASE}/sports/${SPORT}/events/${ev.id}/odds?apiKey=${KEY}&regions=${REGION}&markets=${markets.join(',')}&oddsFormat=american&includeLinks=true`,
  );
  if (!r.ok) {
    console.error(
      `props ${ev.away}@${ev.home} failed (${r.status}):`,
      JSON.stringify(r.body).slice(0, 200),
    );
    continue;
  }
  noteUsage(r.headers);
  spent += cost;
  const byMarket = ingest(ev, r.body, phase);
  ev.pulls = { ...ev.pulls, [phase]: nowIso() };
  pulled.push(`${ev.away}@${ev.home}:${phase}:${Object.keys(byMarket).join('+') || 'empty'}`);
}

// 3b) Extra one-off market pulls inside the pre-kick window (see EXTRA_PULL above).
for (const ev of EXTRA_PULL.length ? prioritize(events, now) : []) {
  const h = (Date.parse(ev.commence) - now.getTime()) / 3600000;
  if (h < -1 || h > PREKICK_HOURS) continue;
  const need = EXTRA_PULL.filter((mk) => !ev.markets[mk]);
  if (!need.length) continue;
  const cost = need.length;
  if (spent + cost > MAX_CREDITS_PER_RUN) break;
  if (usage.remaining != null && usage.remaining - cost < CREDIT_RESERVE) break;
  const r = await getJson(
    `${BASE}/sports/${SPORT}/events/${ev.id}/odds?apiKey=${KEY}&regions=${REGION}&markets=${need.join(',')}&oddsFormat=american&includeLinks=true`,
  );
  if (!r.ok) {
    console.error(`extra ${ev.away}@${ev.home} failed (${r.status})`);
    continue;
  }
  noteUsage(r.headers);
  spent += cost;
  const byMarket = ingest(ev, r.body, 'extra');
  for (const mk of need) ev.pulls = { ...ev.pulls, [`extra:${mk}`]: nowIso() };
  pulled.push(`${ev.away}@${ev.home}:extra:${Object.keys(byMarket).join('+') || 'empty'}`);
}

/** Parse one /events/{id}/odds body into ev.markets; returns the per-market player maps. */
function ingest(ev, body, phase) {
  const byMarket = {};
  for (const b of body.bookmakers || [])
    for (const m of b.markets || []) {
      const mk = (byMarket[m.key] ||= {});
      for (const o of m.outcomes || []) {
        const k = normName(o.description || o.name);
        const p = (mk[k] ||= { name: o.description || o.name, books: {} });
        // Deep link: bet slip link when the book gives one, else the market page, else the event page.
        const link = o.link || m.link || b.link || null;
        if (m.key === 'player_tds_over') {
          if (o.name === 'Over' && Number(o.point) === 1.5) {
            p.books[b.key] = o.price;
            if (link) (p.links ||= {})[b.key] = link;
          }
        } else if (YESNO.has(m.key)) {
          if (o.name === 'Yes') {
            p.books[b.key] = o.price;
            if (link) (p.links ||= {})[b.key] = link;
          }
        } else {
          const side = o.name === 'Over' ? 'over' : 'under';
          (p.books[b.key] ||= {})[side] = { price: o.price, point: o.point };
        }
      }
    }
  for (const [mkKey, players] of Object.entries(byMarket)) {
    for (const [k, p] of Object.entries(players)) {
      if (YESNO.has(mkKey)) {
        const prices = Object.values(p.books);
        if (!prices.length) {
          delete players[k];
          continue;
        }
        p.best = Math.max(...prices);
        p.bestBook = Object.entries(p.books).find(([, v]) => v === p.best)?.[0];
        p.consensus = median(prices);
      } else {
        const overs = Object.values(p.books)
          .map((x) => x.over)
          .filter(Boolean);
        const unders = Object.values(p.books)
          .map((x) => x.under)
          .filter(Boolean);
        p.line = medianF(overs.map((x) => x.point));
        p.over = median(overs.map((x) => x.price));
        p.under = median(unders.map((x) => x.price));
        p.bestOver = overs.length ? Math.max(...overs.map((x) => x.price)) : null;
        p.bestUnder = unders.length ? Math.max(...unders.map((x) => x.price)) : null;
        p.lineLow = overs.length ? Math.min(...overs.map((x) => x.point)) : null;
        p.lineHigh = overs.length ? Math.max(...overs.map((x) => x.point)) : null;
      }
    }
    if (Object.keys(players).length) ev.markets[mkKey] = { fetchedAt: nowIso(), phase, players };
  }
  return byMarket;
}

const snapshot = {
  fetchedAt: nowIso(),
  region: REGION,
  usage,
  policy: {
    prekickHours: PREKICK_HOURS,
    reserve: CREDIT_RESERVE,
    maxPerRun: MAX_CREDITS_PER_RUN,
    markets: MARKETS,
  },
  events,
};
writeJson(latestFile, snapshot);
// Price history for movement tracking (one row per pull per player per market).
const day = snapshot.fetchedAt.slice(0, 10);
const rows = [];
for (const ev of events) {
  if (!pulled.some((p) => p.startsWith(`${ev.away}@${ev.home}:`))) continue;
  for (const [mk, m] of Object.entries(ev.markets)) {
    if (m.fetchedAt?.slice(0, 10) !== day) continue;
    for (const [k, p] of Object.entries(m.players))
      rows.push(
        JSON.stringify(
          YESNO.has(mk)
            ? {
                d: day,
                ev: ev.id,
                g: `${ev.away}@${ev.home}`,
                m: mk,
                p: k,
                best: p.best,
                cons: p.consensus,
              }
            : {
                d: day,
                ev: ev.id,
                g: `${ev.away}@${ev.home}`,
                m: mk,
                p: k,
                line: p.line,
                over: p.over,
                under: p.under,
              },
        ),
      );
  }
}
fs.mkdirSync(path.dirname(historyFile), { recursive: true });
const existing = fs.existsSync(historyFile)
  ? fs.readFileSync(historyFile, 'utf8').split('\n').filter(Boolean)
  : [];
const keyOf = (o) => `${o.d}|${o.ev}|${o.m || 'player_anytime_td'}|${o.p}`;
const keys = new Set(rows.map((r) => keyOf(JSON.parse(r))));
const kept = existing.filter((l) => !keys.has(keyOf(JSON.parse(l))));
fs.writeFileSync(historyFile, [...kept, ...rows].join('\n') + '\n');
fs.appendFileSync(
  creditsFile,
  JSON.stringify({
    t: snapshot.fetchedAt,
    spent,
    remaining: usage.remaining,
    used: usage.used,
    pulled,
  }) + '\n',
);
console.log(
  `props: spent ${spent} credits (${pulled.join(', ') || 'nothing due'}), remaining ${usage.remaining ?? 'unknown'}`,
);
