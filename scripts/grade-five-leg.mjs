// Grades the week's five-leg tickets from ESPN box scores and writes the result next to them, so
// the record table in docs/FIVE_LEG_FORMULA.md can be appended from real stat lines.
//
//   node scripts/grade-five-leg.mjs --week 5 [--season 2026] [--skip tb-dal]
//
// Reads data/five-leg/<season>-w<wk>.json (the published ticket per game; a game that kicked off
// keeps the ticket it was published with) and data/five-leg/<season>-w<wk>-checks.json (which
// tickets were on the max-confidence card and which the morning check pulled). Writes
// data/five-leg/<season>-w<wk>-results.json and prints one markdown row per graded ticket.
// A game that is not final is left ungraded. A player missing from the box score counts as zero.
import path from 'node:path';
import { DATA, readJson, writeJson, normName } from './lib.mjs';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? '1'] : []))
    .filter((x) => x.length),
);
const SEASON = Number(args.season || new Date().getUTCFullYear());
const WEEK = Number(args.week);
if (!WEEK) {
  console.error('usage: node scripts/grade-five-leg.mjs --week N [--skip game,game]');
  process.exit(1);
}
const SKIP = new Set(
  String(args.skip || '')
    .split(',')
    .filter(Boolean),
);
const wk = `${SEASON}-w${String(WEEK).padStart(2, '0')}`;
const tickets = readJson(path.join(DATA, 'five-leg', `${wk}.json`));
const checks = readJson(path.join(DATA, 'five-leg', `${wk}-checks.json`), {});
const board = readJson(path.join(DATA, 'board.json'));

// ESPN box score category and stat key for each formula market.
const STAT = {
  receptions: ['receiving', 'receptions'],
  rec_yds: ['receiving', 'receivingYards'],
  rush_yds: ['rushing', 'rushingYards'],
  pass_yds: ['passing', 'passingYards'],
};
const SHORT = { receptions: 'rec', rec_yds: 'rec yds', rush_yds: 'rush yds', pass_yds: 'pass yds' };
const UA = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
};

/** { normName: { receiving: {receptions, receivingYards}, rushing: {...}, passing: {...} } } */
async function boxScore(espnId) {
  const r = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${espnId}`,
    { headers: UA },
  );
  if (!r.ok) throw new Error(`espn ${r.status} for ${espnId}`);
  const s = await r.json();
  const state = s.header?.competitions?.[0]?.status?.type;
  const out = {};
  for (const team of s.boxscore?.players ?? [])
    for (const cat of team.statistics ?? [])
      for (const a of cat.athletes ?? []) {
        const k = normName(a.athlete?.displayName ?? '');
        out[k] ??= {};
        out[k][cat.name] = Object.fromEntries(cat.keys.map((key, i) => [key, a.stats[i]]));
      }
  return { final: !!state?.completed, players: out };
}

const lastName = (player) =>
  player
    .replace(/\s+(Jr|Sr|II|III|IV)\.?$/i, '')
    .trim()
    .split(/\s+/)
    .pop();
function shortLabel(leg, legs) {
  const parts = leg.player.split(/\s+/);
  const last = lastName(leg.player);
  const clash = legs.some((l) => l !== leg && lastName(l.player) === last);
  // Two players share a last name: first initials, or the first name when those match too.
  const initialClash = legs.some(
    (l) => l !== leg && lastName(l.player) === last && l.player[0] === leg.player[0],
  );
  const name = !clash ? last : initialClash ? `${parts[0]} ${last}` : `${parts[0][0]}. ${last}`;
  return `${name} ${Math.ceil(leg.point)}+ ${SHORT[leg.market]}`;
}

const results = [];
for (const g of tickets.games) {
  const t = g.ticket || g.fallback;
  if (!t || SKIP.has(g.game)) continue;
  const bg = board.games.find((x) => x.id === g.game);
  if (!bg?.espnId) continue;
  const box = await boxScore(bg.espnId);
  if (!box.final) {
    console.log(`${g.game}: not final, left ungraded`);
    continue;
  }
  const legs = t.legs.map((l) => {
    const [cat, key] = STAT[l.market];
    const raw = box.players[normName(l.player)]?.[cat]?.[key];
    const actual = raw == null ? 0 : Number(raw);
    const hit = l.side === 'over' ? actual > l.point : actual < l.point;
    return {
      label: l.label,
      short: shortLabel(l, t.legs),
      point: l.point,
      actual,
      hit,
      inBox: raw != null,
    };
  });
  const hits = legs.filter((l) => l.hit).length;
  results.push({
    game: g.game,
    gameLabel: `${bg.away.abbr} @ ${bg.home.abbr}`,
    price: t.price,
    joint: t.joint,
    short: !g.ticket,
    card: !!checks?.notes?.[g.game] && !checks?.pulled?.[g.game],
    pulled: checks?.pulled?.[g.game] ?? null,
    won: hits === legs.length,
    hits,
    legs,
  });
}
writeJson(path.join(DATA, 'five-leg', `${wk}-results.json`), {
  season: SEASON,
  week: WEEK,
  gradedAt: new Date().toISOString(),
  results,
});

const am = (n) => (n > 0 ? `+${n}` : `${n}`);
for (const r of results) {
  const tag = r.card
    ? ' (card)'
    : r.pulled
      ? ' (pulled)'
      : r.short
        ? ` (${r.legs.length} legs)`
        : '';
  const res = `${r.won ? 'Won' : `Lost ${r.hits}/${r.legs.length}`} (${r.legs.map((l) => `${l.actual}${l.inBox ? '' : '*'}`).join(', ')})`;
  console.log(
    `| ${WEEK}    | ${r.gameLabel}${tag} | ${r.legs.map((l) => l.short).join(', ')} | ${am(r.price)} | ${Math.round(r.joint * 100)}% | ${res} |`,
  );
}
const card = results.filter((r) => r.card);
console.log(
  `\n${results.filter((r) => r.won).length}/${results.length} tickets won; card ${card.filter((r) => r.won).length}/${card.length}; legs ${results.reduce((a, r) => a + r.hits, 0)}/${results.reduce((a, r) => a + r.legs.length, 0)}`,
);
