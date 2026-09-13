// One-shot recovery: rebuild data/odds/latest.json (and the ledgers) from the latest PUBLISHED board
// when the runner's git push was lost after a pull. Costs no credits: the board already carries the
// prices for every listed scorer, and the per-game pull log, so fetch-odds will not re-pull.
// Needs SUPABASE_URL, SUPABASE_ANON_KEY, BOARD_PUBLISH_SECRET. Safe to run when nothing is missing.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, readJson, writeJson, normName } from './lib.mjs';

const { SUPABASE_URL, SUPABASE_ANON_KEY, BOARD_PUBLISH_SECRET } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !BOARD_PUBLISH_SECRET) {
  console.error(
    'SUPABASE_URL, SUPABASE_ANON_KEY or BOARD_PUBLISH_SECRET missing; recovery skipped.',
  );
  process.exit(0);
}
const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_board_full`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  },
  body: JSON.stringify({ secret: BOARD_PUBLISH_SECRET }),
});
if (!r.ok) {
  console.error(`get_board_full: ${r.status} ${(await r.text()).slice(0, 200)}`);
  process.exit(1);
}
const board = await r.json();
const latestFile = path.join(DATA, 'odds', 'latest.json');
const local = readJson(latestFile, { events: [] });
const { events: recovered, usage, pulled, rows } = recoverFromBoard(board, local);
if (!recovered) {
  console.log(
    `recover-odds: local odds ${local.fetchedAt ?? 'none'} already cover the published board (${board.oddsFetchedAt ?? 'none'}); nothing to do`,
  );
  process.exit(0);
}
writeJson(latestFile, {
  fetchedAt: board.oddsFetchedAt,
  region: local.region ?? 'us',
  usage,
  policy: local.policy ?? null,
  events: recovered,
  recoveredFromBoard: board.generatedAt,
});
const creditsFile = path.join(DATA, 'odds', 'credits.jsonl');
const prevUsed = (() => {
  try {
    const lines = fs.readFileSync(creditsFile, 'utf8').trim().split('\n').filter(Boolean);
    return JSON.parse(lines[lines.length - 1]).used ?? 0;
  } catch {
    return 0;
  }
})();
fs.appendFileSync(
  creditsFile,
  JSON.stringify({
    t: board.oddsFetchedAt,
    spent: Math.max(0, (usage.used ?? 0) - prevUsed),
    remaining: usage.remaining,
    used: usage.used,
    pulled,
    recovered: true,
  }) + '\n',
);
const historyFile = path.join(DATA, 'odds', 'history.jsonl');
const existing = fs.existsSync(historyFile)
  ? fs.readFileSync(historyFile, 'utf8').split('\n').filter(Boolean)
  : [];
const keyOf = (o) => `${o.d}|${o.ev}|${o.m || 'player_anytime_td'}|${o.p}`;
const keys = new Set(rows.map(keyOf));
fs.writeFileSync(
  historyFile,
  [
    ...existing.filter((l) => !keys.has(keyOf(JSON.parse(l)))),
    ...rows.map((x) => JSON.stringify(x)),
  ].join('\n') + '\n',
);
console.log(
  `recover-odds: rebuilt ${recovered.length} events from the board published ${board.generatedAt} (odds ${board.oddsFetchedAt}); ${pulled.length} games with prices; credits ${usage.used} used / ${usage.remaining} remaining`,
);

/** Pure part, unit-tested: returns null events when the local snapshot is already as fresh. */
export function recoverFromBoard(board, local) {
  const localAt = local?.fetchedAt ? Date.parse(local.fetchedAt) : 0;
  const boardAt = board?.oddsFetchedAt ? Date.parse(board.oddsFetchedAt) : 0;
  if (!boardAt || boardAt <= localAt) return { events: null };
  const day = board.oddsFetchedAt.slice(0, 10);
  const pulled = [];
  const rows = [];
  const events = (board.games || []).map((g) => {
    const prev = (local?.events || []).find(
      (e) => e.home === g.home.abbr && e.away === g.away.abbr,
    );
    const id = prev?.id ?? `recovered-${g.id}`;
    const players = {};
    for (const p of [...(g.top3 || []), ...(g.value || [])]) {
      if (!p.live?.books || !Object.keys(p.live.books).length) continue;
      players[normName(p.name)] = {
        name: p.name,
        books: p.live.books,
        best: p.live.best,
        bestBook: p.live.bestBook,
        consensus: p.live.consensus,
      };
    }
    for (const p of g.liveBoard || []) {
      const k = normName(p.name);
      if (!players[k])
        players[k] = {
          name: p.name,
          books: {},
          best: p.best,
          bestBook: p.bestBook,
          consensus: p.consensus,
        };
    }
    const fetchedAt =
      [...(g.top3 || []), ...(g.value || [])].find((p) => p.live?.fetchedAt)?.live.fetchedAt ??
      board.oddsFetchedAt;
    const markets = { ...(prev?.markets ?? {}) };
    if (Object.keys(players).length) {
      const phase =
        Object.entries(g.pulls || {}).sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]))[0]?.[0] ??
        'prekick';
      markets.player_anytime_td = { fetchedAt, phase, players };
      pulled.push(`${g.away.abbr}@${g.home.abbr}:${phase}:player_anytime_td(recovered)`);
      for (const [k, p] of Object.entries(players))
        rows.push({
          d: day,
          ev: id,
          g: `${g.away.abbr}@${g.home.abbr}`,
          m: 'player_anytime_td',
          p: k,
          best: p.best,
          cons: p.consensus,
        });
    }
    return {
      id,
      commence: g.kickoff,
      home: g.home.abbr,
      away: g.away.abbr,
      lines: prev?.lines ?? null,
      markets,
      pulls: { ...(prev?.pulls ?? {}), ...(g.pulls || {}) },
    };
  });
  return {
    events,
    usage: {
      remaining: board.oddsCredits?.remaining ?? null,
      used: board.oddsCredits?.used ?? null,
    },
    pulled,
    rows,
  };
}
