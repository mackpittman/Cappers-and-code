// Builds data/odds/latest.json from raw Odds API event bodies saved on disk, in the same shape
// scripts/fetch-odds.mjs writes, for weeks when the prices were pulled through the desk's relay
// rather than by the runner. Alternate markets are kept whole for the five-leg builder, and a
// main line (the point where over and under sit nearest -110) is synthesized for the board.
//
//   node scripts/ingest-odds-raw.mjs --week 5 [--season 2026] [--remaining 300]
//
// Inputs: data/odds/raw/<season>-w<wk>-events.json (ids, teams, commence) and one
// data/odds/raw/<season>-w<wk>-<game>.json per pulled game (the /events/{id}/odds body).
import path from 'node:path';
import fs from 'node:fs';
import { DATA, readJson, writeJson, nowIso, normName } from './lib.mjs';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? '1'] : []))
    .filter((x) => x.length),
);
const SEASON = Number(args.season || new Date().getUTCFullYear());
const WEEK = Number(args.week);
if (!WEEK) {
  console.error('usage: node scripts/ingest-odds-raw.mjs --week N');
  process.exit(1);
}
const wk = `${SEASON}-w${String(WEEK).padStart(2, '0')}`;
const RAW = path.join(DATA, 'odds', 'raw');
const index = readJson(path.join(RAW, `${wk}-events.json`));
if (!index) {
  console.error(`no ${wk}-events.json in ${RAW}`);
  process.exit(1);
}
const YESNO = new Set(['player_anytime_td', 'player_1st_td', 'player_last_td', 'player_tds_over']);
const MAIN_OF = {
  player_receptions_alternate: 'player_receptions',
  player_reception_yds_alternate: 'player_reception_yds',
  player_rush_yds_alternate: 'player_rush_yds',
  player_pass_yds_alternate: 'player_pass_yds',
};
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)) : null;
};
const medianF = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null;
};

/** Mirror of fetch-odds ingest(): per-market player maps with books, best, consensus or line/over/under. */
function ingest(body, phase, now) {
  const byMarket = {};
  const alts = {}; // market -> player -> book -> [{point, over, under}]
  for (const b of body.bookmakers || [])
    for (const m of b.markets || []) {
      const mk = (byMarket[m.key] ||= {});
      for (const o of m.outcomes || []) {
        const k = normName(o.description || o.name);
        const p = (mk[k] ||= { name: o.description || o.name, books: {} });
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
        } else if (MAIN_OF[m.key]) {
          // Alternates: keep every point per book; the main line is chosen below.
          const rows = (((alts[m.key] ||= {})[k] ||= {
            name: o.description || o.name,
            books: {},
          }).books[b.key] ||= {});
          const r = (rows[o.point] ||= { point: Number(o.point) });
          r[o.name === 'Over' ? 'over' : 'under'] = o.price;
        } else {
          const side = o.name === 'Over' ? 'over' : 'under';
          (p.books[b.key] ||= {})[side] = { price: o.price, point: o.point };
        }
      }
    }
  // Synthesize the main line from the alternates: per book, the point whose over is nearest -110.
  for (const [altKey, players] of Object.entries(alts)) {
    const mainKey = MAIN_OF[altKey];
    const mk = (byMarket[mainKey] ||= {});
    for (const [k, p] of Object.entries(players)) {
      const entry = (mk[k] ||= { name: p.name, books: {} });
      for (const [book, rows] of Object.entries(p.books)) {
        const pts = Object.values(rows).filter((r) => r.over != null);
        if (!pts.length) continue;
        const best = pts.reduce((a, r) =>
          Math.abs(r.over + 110) < Math.abs(a.over + 110) ? r : a,
        );
        entry.books[book] = { over: { price: best.over, point: best.point } };
        if (best.under != null) entry.books[book].under = { price: best.under, point: best.point };
      }
      if (!Object.keys(entry.books).length) delete mk[k];
    }
    delete byMarket[altKey];
  }
  const markets = {};
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
    if (Object.keys(players).length) markets[mkKey] = { fetchedAt: now, phase, players };
  }
  return markets;
}

const now = nowIso();
const events = [];
let pulled = 0;
for (const e of index.events) {
  const file = path.join(RAW, `${wk}-${e.game}.json`);
  const ev = {
    id: e.id,
    commence: e.commence,
    home: e.home,
    away: e.away,
    lines: null,
    markets: {},
    pulls: {},
  };
  if (fs.existsSync(file)) {
    const body = readJson(file);
    if (body?.bookmakers) {
      const phase = (Date.parse(e.commence) - Date.parse(now)) / 3600000 <= 8 ? 'prekick' : 'desig';
      ev.markets = ingest(body, phase, now);
      ev.pulls[phase] = now;
      pulled++;
    }
  }
  events.push(ev);
}
const remaining =
  args.remaining != null ? Number(args.remaining) : (index.requestsRemaining ?? null) - pulled * 6;
const snapshot = {
  fetchedAt: now,
  region: 'us',
  usage: { remaining, used: null, last: pulled * 6, at: now },
  policy: {
    prekickHours: 8,
    reserve: 40,
    maxPerRun: 80,
    markets: { relay: ['player_anytime_td', 'player_tds_over', 'alternates'] },
  },
  events,
};
writeJson(path.join(DATA, 'odds', 'latest.json'), snapshot);
console.log(
  `ingested ${pulled}/${index.events.length} games into data/odds/latest.json; markets per game:`,
);
for (const ev of events)
  console.log(
    `  ${ev.away}@${ev.home}: ${
      Object.keys(ev.markets)
        .map((k) => `${k}(${Object.keys(ev.markets[k].players).length})`)
        .join(' ') || 'none'
    }`,
  );
