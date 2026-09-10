// Merges the research file with the latest schedule, injuries and odds into data/board.json (what the app reads).
import path from 'node:path';
import { DATA, ROOT, readJson, writeJson, nowIso, normName, impliedProb, devig } from './lib.mjs';

const research = readJson(path.join(ROOT, 'src', 'data', 'research.json'));
const schedule = readJson(path.join(DATA, 'schedule.json'), { games: [] });
const injuries = readJson(path.join(DATA, 'injuries.json'), { teams: {} });
const odds = readJson(path.join(DATA, 'odds', 'latest.json'), { events: [] });
const history = readHistory(path.join(DATA, 'odds', 'history.jsonl'));

function readHistory(file) {
  try {
    return require('node:fs')
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
function findEvent(g) {
  return odds.events.find((e) => e.home === g.home.abbr && e.away === g.away.abbr);
}
function firstPrice(rows, key) {
  const r = rows.filter((x) => x.p === key).sort((a, b) => a.d.localeCompare(b.d));
  return r.length ? r[0].best : null;
}
const STATUS_KEEP = new Set([
  'Out',
  'Doubtful',
  'Questionable',
  'Injured Reserve',
  'Suspension',
  'Physically Unable to Perform',
]);

const games = research.games.map((g) => {
  const ev = findEvent(g);
  const sched = schedule.games.find(
    (s) => s.espnId === g.espnId || (s.home.abbr === g.home.abbr && s.away.abbr === g.away.abbr),
  );
  const evRows = ev ? history.filter((h) => h.ev === ev.id) : [];
  const live = ev
    ? {
        fetchedAt: odds.fetchedAt,
        ml: ev.lines.ml,
        spread: ev.lines.spread,
        total: ev.lines.total,
        winProb: (() => {
          const d = devig(ev.lines.ml.away, ev.lines.ml.home);
          return d ? { away: +d.a.toFixed(3), home: +d.b.toFixed(3) } : null;
        })(),
      }
    : null;
  const attach = (p) => {
    const k = normName(p.name);
    const lp = ev?.props?.[k];
    const open = firstPrice(evRows, k);
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
          }
        : null,
      edge: lp
        ? +(p.est - impliedProb(lp.consensus)).toFixed(3)
        : p.implied != null
          ? +(p.est - p.implied).toFixed(3)
          : null,
    };
  };
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
      const lp = ev?.props?.[normName(b.name)];
      return {
        ...b,
        live: lp ? { best: lp.best, bestBook: lp.bestBook, consensus: lp.consensus } : null,
      };
    }),
    liveBoard: ev
      ? Object.values(ev.props)
          .map((p) => ({
            name: p.name,
            best: p.best,
            bestBook: p.bestBook,
            consensus: p.consensus,
            implied: +impliedProb(p.consensus).toFixed(4),
          }))
          .sort((a, b) => a.consensus - b.consensus)
          .slice(0, 16)
      : [],
    injuryReport: {
      away: teamInj(g.away.abbr),
      home: teamInj(g.home.abbr),
      fetchedAt: injuries.fetchedAt || null,
    },
  };
});

// Slate-wide boards derived from the per-game picks.
const all = games.flatMap((g) =>
  [...g.top3, ...g.value].map((p) => ({ ...p, gameId: g.id, kickoff: g.kickoff })),
);
const slateTop = [...all].sort((a, b) => b.est - a.est).slice(0, 20);
const slateValue = all
  .filter((p) => p.edge != null)
  .sort((a, b) => b.edge - a.edge)
  .slice(0, 12);

writeJson(path.join(DATA, 'board.json'), {
  season: research.season,
  week: schedule.week ?? research.week,
  generatedAt: nowIso(),
  researchAsOf: research.researchAsOf,
  oddsFetchedAt: odds.fetchedAt || null,
  oddsCredits: odds.usage || null,
  injuriesFetchedAt: injuries.fetchedAt || null,
  notes: research.notes,
  completed: research.completed,
  games,
  slateTop,
  slateValue,
  crossStacks: research.crossStacks,
  upsetLeans: research.upsetLeans,
});
console.log(
  `board: ${games.length} games, ${games.filter((g) => g.live).length} with live lines, ${games.filter((g) => g.liveBoard.length).length} with live TD props`,
);
