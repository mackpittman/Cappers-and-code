// Merges the research file with the latest schedule, injuries and odds into data/board.json (what the app reads).
import path from 'node:path';
import fs from 'node:fs';
import { DATA, ROOT, readJson, writeJson, nowIso, normName, impliedProb, devig } from './lib.mjs';
import { buildParlays } from './parlays.mjs';

const research = readJson(path.join(ROOT, 'src', 'data', 'research.json'));
const schedule = readJson(path.join(DATA, 'schedule.json'), { games: [] });
const injuries = readJson(path.join(DATA, 'injuries.json'), { teams: {} });
const odds = readJson(path.join(DATA, 'odds', 'latest.json'), { events: [] });
const history = readLines(path.join(DATA, 'odds', 'history.jsonl'));
const credits = readLines(path.join(DATA, 'odds', 'credits.jsonl'));
const weekResults = readJson(
  path.join(DATA, 'results', `${research.season}-w${String(research.week).padStart(2, '0')}.json`),
  null,
);
const record = readJson(path.join(DATA, 'results', 'record.json'), null);
function readLines(file) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

const STATUS_KEEP = new Set([
  'Out',
  'Doubtful',
  'Questionable',
  'Injured Reserve',
  'Suspension',
  'Physically Unable to Perform',
]);
const MARKET_LABEL = {
  player_anytime_td: 'Anytime TD',
  player_pass_yds: 'Pass yds',
  player_rush_yds: 'Rush yds',
  player_reception_yds: 'Rec yds',
  player_receptions: 'Receptions',
  player_pass_tds: 'Pass TD',
  player_1st_td: 'First TD',
};

const games = research.games.map((g) => {
  const ev = odds.events.find((e) => e.home === g.home.abbr && e.away === g.away.abbr);
  const sched = schedule.games.find(
    (s) => s.espnId === g.espnId || (s.home.abbr === g.home.abbr && s.away.abbr === g.away.abbr),
  );
  const atd = ev?.markets?.player_anytime_td?.players || {};
  const evRows = ev
    ? history.filter((h) => h.ev === ev.id && (h.m || 'player_anytime_td') === 'player_anytime_td')
    : [];
  const firstPrice = (k) => {
    const r = evRows.filter((x) => x.p === k).sort((a, b) => a.d.localeCompare(b.d));
    return r.length ? (r[0].cons ?? r[0].best) : null;
  };

  // Live game lines: ESPN (free, DraftKings) first; multi-book Odds API lines override when present.
  let live = null;
  const el = sched?.espnLine;
  if (el?.ml?.home != null && el?.ml?.away != null) {
    const d = devig(el.ml.away, el.ml.home);
    live = {
      source: `ESPN/${el.provider || 'book'}`,
      fetchedAt: schedule.fetchedAt,
      ml: {
        home: el.ml.home,
        away: el.ml.away,
        bestHome: null,
        bestAway: null,
        openHome: el.ml.openHome,
        openAway: el.ml.openAway,
      },
      spread: { homePoint: el.spreadHome, homePrice: null, awayPrice: null },
      total: { point: el.total, over: null, under: null },
      winProb: d ? { away: +d.a.toFixed(3), home: +d.b.toFixed(3) } : null,
    };
  }
  if (ev?.lines?.ml?.home != null) {
    const d = devig(ev.lines.ml.away, ev.lines.ml.home);
    live = {
      source: 'Odds API (multi-book)',
      fetchedAt: ev.lines.fetchedAt,
      ...ev.lines,
      winProb: d ? { away: +d.a.toFixed(3), home: +d.b.toFixed(3) } : null,
    };
  }

  const attach = (p) => {
    const k = normName(p.name);
    const lp = atd[k];
    const open = firstPrice(k);
    return {
      ...p,
      live: lp
        ? {
            best: lp.best,
            bestBook: lp.bestBook,
            consensus: lp.consensus,
            books: lp.books,
            implied: +impliedProb(lp.consensus).toFixed(4),
            open,
            move: open != null ? lp.consensus - open : null,
            fetchedAt: ev.markets.player_anytime_td.fetchedAt,
          }
        : null,
      edge: lp
        ? +(p.est - impliedProb(lp.consensus)).toFixed(3)
        : p.implied != null
          ? +(p.est - p.implied).toFixed(3)
          : null,
    };
  };
  // Player prop lines for every non-TD market pulled, flagged with our lean when we have one.
  const propLines = [];
  for (const [mk, m] of Object.entries(ev?.markets || {})) {
    if (mk.endsWith('_td')) continue;
    for (const p of Object.values(m.players)) {
      const lean = (g.market?.propLeans || []).find(
        (l) => l.market === mk && normName(l.player) === normName(p.name),
      );
      propLines.push({
        market: mk,
        label: MARKET_LABEL[mk] || mk,
        name: p.name,
        line: p.line,
        over: p.over,
        under: p.under,
        bestOver: p.bestOver,
        bestUnder: p.bestUnder,
        lineLow: p.lineLow,
        lineHigh: p.lineHigh,
        fetchedAt: m.fetchedAt,
        lean: lean
          ? {
              side: lean.side,
              line: lean.line,
              why: lean.why,
              delta: lean.line != null && p.line != null ? +(p.line - lean.line).toFixed(1) : null,
            }
          : null,
      });
    }
  }
  propLines.sort(
    (a, b) =>
      (b.lean ? 1 : 0) - (a.lean ? 1 : 0) ||
      a.label.localeCompare(b.label) ||
      (b.line ?? 0) - (a.line ?? 0),
  );
  const teamInj = (abbr) =>
    (injuries.teams[abbr] || []).filter((i) => STATUS_KEEP.has(i.status)).slice(0, 12);
  return {
    ...g,
    status: sched
      ? {
          state: sched.status,
          detail: sched.statusDetail,
          score: { away: sched.away.score, home: sched.home.score },
        }
      : null,
    live,
    top3: g.top3.map(attach),
    value: g.value.map(attach),
    atdBoard: g.atdBoard.map((b) => {
      const lp = atd[normName(b.name)];
      return {
        ...b,
        live: lp ? { best: lp.best, bestBook: lp.bestBook, consensus: lp.consensus } : null,
      };
    }),
    liveBoard: Object.values(atd)
      .map((p) => ({
        name: p.name,
        best: p.best,
        bestBook: p.bestBook,
        consensus: p.consensus,
        implied: +impliedProb(p.consensus).toFixed(4),
      }))
      .sort((a, b) => a.consensus - b.consensus)
      .slice(0, 16),
    propLines,
    pulls: ev?.pulls || {},
    injuryReport: {
      away: teamInj(g.away.abbr),
      home: teamInj(g.home.abbr),
      fetchedAt: injuries.fetchedAt || null,
    },
  };
});

const all = games.flatMap((g) =>
  [...g.top3, ...g.value].map((p) => ({ ...p, gameId: g.id, kickoff: g.kickoff })),
);
const slateTop = [...all].sort((a, b) => b.est - a.est).slice(0, 20);
const slateValue = all
  .filter((p) => p.edge != null)
  .sort((a, b) => b.edge - a.edge)
  .slice(0, 12);
// Credit ledger: spend in the trailing 7 and 30 days.
const since = (days) =>
  credits
    .filter((c) => Date.parse(c.t) > Date.now() - days * 86400000)
    .reduce((n, c) => n + (c.spent || 0), 0);

const board = {
  season: research.season,
  week: schedule.week ?? research.week,
  generatedAt: nowIso(),
  researchAsOf: research.researchAsOf,
  oddsFetchedAt: odds.fetchedAt || null,
  oddsCredits: odds.usage
    ? {
        ...odds.usage,
        spent7d: since(7),
        spent30d: since(30),
        reserve: odds.policy?.reserve ?? null,
      }
    : null,
  creditPlan: research.creditPlan || null,
  linesSource: games.find((g) => g.live)?.live?.source || null,
  injuriesFetchedAt: injuries.fetchedAt || null,
  notes: research.notes,
  completed: research.completed,
  games,
  slateTop,
  slateValue,
  bestBets: (research.bestBets || []).map((b) => ({
    ...b,
    gameLabel: (() => {
      const g = games.find((x) => x.id === b.game);
      return g ? `${g.away.abbr}@${g.home.abbr}` : b.game;
    })(),
  })),
  crossStacks: research.crossStacks,
  upsetLeans: research.upsetLeans,
};
// Ranked parlays per category from FanDuel / DraftKings prices and the model numbers above.
board.parlays = buildParlays(board);
writeJson(path.join(DATA, 'board.json'), board);
console.log(
  `board: ${games.length} games, ${games.filter((g) => g.live).length} with live lines (${games.find((g) => g.live)?.live?.source || 'none'}), ${games.filter((g) => g.liveBoard.length).length} with live ATD, ${games.filter((g) => g.propLines.length).length} with prop lines`,
);
