// Assembles src/data/research.json for a week from the per-game drafts the research agents write
// (research-draft/w<wk>/<game>.json, one Game object each, see docs/briefs/game-research-brief.md).
// The slate-level lists (bestBets, crossStacks, upsetLeans, maxConfidence) fall out of the games by
// rule, so the judgement stays in the per-game files and this stays mechanical.
//
//   node scripts/assemble-research.mjs --week 5 [--season 2026] [--dry]
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, DATA, readJson, writeJson, nowIso, impliedProb, getJson } from './lib.mjs';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? '1'] : []))
    .filter((x) => x.length),
);
const SEASON = Number(args.season || new Date().getUTCFullYear());
const WEEK = Number(args.week);
if (!WEEK) {
  console.error('usage: node scripts/assemble-research.mjs --week N [--dry]');
  process.exit(1);
}
const dir = path.join(ROOT, 'research-draft', `w${String(WEEK).padStart(2, '0')}`);
const schedule = readJson(path.join(DATA, 'schedule.json'), { games: [] });
const previous = readJson(path.join(ROOT, 'src', 'data', 'research.json'), {});
const files = fs.existsSync(dir)
  ? fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
  : [];
if (!files.length) {
  console.error(`no drafts in ${dir}`);
  process.exit(1);
}
const games = [];
const problems = [];
for (const f of files) {
  const g = readJson(path.join(dir, f));
  if (!g?.id) {
    problems.push(`${f}: not a game object`);
    continue;
  }
  const sched = schedule.games.find((s) => String(s.espnId) === String(g.espnId));
  if (!sched) problems.push(`${g.id}: espnId ${g.espnId} is not in schedule.json`);
  else if (sched.away.abbr !== g.away?.abbr || sched.home.abbr !== g.home?.abbr)
    problems.push(
      `${g.id}: teams ${g.away?.abbr}@${g.home?.abbr} do not match the schedule (${sched.away.abbr}@${sched.home.abbr})`,
    );
  // The lines come from the schedule's book line when the draft left any of them out.
  if (sched?.espnLine) {
    const L = sched.espnLine;
    g.lines ||= {};
    g.lines.spread ||= L.details;
    g.lines.total ??= L.total;
    g.lines.ml ||= { away: L.ml.away, home: L.ml.home };
    if (!g.lines.winProb) {
      const a = impliedProb(L.ml.away),
        h = impliedProb(L.ml.home);
      g.lines.winProb = { away: +(a / (a + h)).toFixed(3), home: +(h / (a + h)).toFixed(3) };
    }
    if (!g.lines.implied && typeof L.total === 'number' && typeof L.spreadHome === 'number') {
      const home = (L.total - L.spreadHome) / 2,
        away = L.total - home;
      g.lines.implied = { away: +away.toFixed(2), home: +home.toFixed(2) };
    }
  }
  games.push(g);
}
games.sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));

// Games already final this week (the Thursday game) are listed, not researched.
const completed = [];
for (const s of schedule.games || []) {
  if (s.status !== 'STATUS_FINAL' || games.some((g) => String(g.espnId) === String(s.espnId)))
    continue;
  let tds = [];
  try {
    const sum = await getJson(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${s.espnId}`,
    );
    tds = (sum.body?.scoringPlays || [])
      .filter(
        (p) =>
          /touchdown|TD/i.test(p.type?.text || '') ||
          /Yd (Rush|pass|Run|Return)/i.test(p.text || ''),
      )
      .map((p) => `${p.text.replace(/\s*\(.*$/, '')} (${p.team?.abbreviation})`);
  } catch {
    /* the list is a courtesy */
  }
  completed.push({
    id: `${s.away.abbr}-${s.home.abbr}`.toLowerCase(),
    away: s.away.abbr,
    home: s.home.abbr,
    final: `${s.away.abbr} ${s.away.score}, ${s.home.abbr} ${s.home.score}`,
    tds,
  });
}

const label = (g) => `${g.away.abbr}@${g.home.abbr}`;
const pct = (x) => `${Math.round(x * 100)}%`;
const price = (p) => (p == null ? '' : p > 0 ? `+${p}` : String(p));

// bestBets: every side or total lean at confidence 3+, then the top touchdown calls by estimate.
const bestBets = [];
for (const g of games) {
  const m = g.market || {};
  if (m.side && (m.sideConf ?? 0) >= 3)
    bestBets.push({ game: g.id, bet: m.side, conf: m.sideConf, why: m.why });
  if (m.total && (m.totalConf ?? 0) >= 3)
    bestBets.push({ game: g.id, bet: m.total, conf: m.totalConf, why: m.why });
}
const tdCalls = games
  .flatMap((g) => (g.top3 || []).map((p) => ({ ...p, game: g.id })))
  .filter(
    (p) =>
      typeof p.est === 'number' &&
      typeof p.price === 'number' &&
      p.est - (p.implied ?? impliedProb(p.price)) >= 0.03,
  )
  .sort((a, b) => b.est - a.est)
  .slice(0, Math.max(0, 16 - bestBets.length));
for (const p of tdCalls)
  bestBets.push({
    game: p.game,
    bet: `${p.name} ATD ${price(p.price)}`,
    conf: p.est >= 0.55 ? 4 : 3,
    why: p.why,
  });

// upsetLeans: underdogs the desk's projected score has winning.
const sd = 13.5;
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const upsetLeans = [];
for (const g of games) {
  const pr = g.market?.projected;
  if (!pr || g.lines?.ml?.away == null) continue;
  const dog = g.lines.ml.away > 0 ? 'away' : g.lines.ml.home > 0 ? 'home' : null;
  if (!dog) continue;
  const margin = dog === 'away' ? pr.away - pr.home : pr.home - pr.away;
  if (margin <= 0) continue;
  const winProb = +Phi(margin / sd).toFixed(3);
  upsetLeans.push({
    team: g[dog].abbr,
    price: g.lines.ml[dog],
    winProb,
    why: `The desk projects ${g[dog].abbr} ${pr[dog]}-${pr[dog === 'away' ? 'home' : 'away']}, about ${pct(winProb)} to win against a ${pct(g.lines.winProb?.[dog] ?? impliedProb(g.lines.ml[dog]))} market.`,
  });
}

// crossStacks: the RB hammer, the favorites' moneylines, and one same-game stack per time slot.
const crossStacks = [];
const rbs = games
  .flatMap((g) =>
    [...(g.top3 || []), ...(g.value || [])].map((p) => ({ ...p, game: g.id, gameLabel: label(g) })),
  )
  .filter((p) => p.pos === 'RB' && typeof p.price === 'number' && typeof p.est === 'number')
  .sort((a, b) => b.est - a.est);
const rbPick = [];
for (const p of rbs) if (!rbPick.some((x) => x.game === p.game)) rbPick.push(p);
if (rbPick.length >= 3) {
  const three = rbPick.slice(0, 3);
  const dec = three.reduce((a, p) => a * (p.price > 0 ? 1 + p.price / 100 : 1 + 100 / -p.price), 1);
  const joint = three.reduce((a, p) => a * p.est, 1);
  crossStacks.push({
    legs: three.map((p) => `${p.name} ATD (${price(p.price)})`),
    why: `RB hammer: the three lead backs the desk rates highest to score, three different games. Pays about ${price(Math.round((dec - 1) * 100))}; the desk makes it ${pct(joint)} against the book's ${pct(1 / dec)}.`,
    type: 'contrarian',
  });
}
const favs = games
  .filter((g) => g.lines?.ml && g.lines?.winProb)
  .map((g) => {
    const side = g.lines.ml.home < g.lines.ml.away ? 'home' : 'away';
    return {
      team: g[side].abbr,
      price: g.lines.ml[side],
      winProb: g.lines.winProb[side],
      proj: g.market?.projected,
      side,
      g,
    };
  })
  .filter(
    (f) => f.proj && (f.side === 'home' ? f.proj.home > f.proj.away : f.proj.away > f.proj.home),
  )
  .sort((a, b) => b.winProb - a.winProb)
  .slice(0, 3);
if (favs.length === 3) {
  const dec = favs.reduce((a, f) => a * (f.price > 0 ? 1 + f.price / 100 : 1 + 100 / -f.price), 1);
  crossStacks.push({
    legs: favs.map((f) => `${f.team} ML (${price(f.price)})`),
    why: `Favorites moneyline: the three biggest favorites the desk also projects to win. Pays about ${price(Math.round((dec - 1) * 100))}; joint ${pct(favs.reduce((a, f) => a * f.winProb, 1))} at the market's own numbers.`,
    type: 'contrarian',
  });
}
const slots = {};
for (const g of games) {
  const slot = new Date(g.kickoff).toISOString().slice(0, 13);
  const conf = Math.max(g.market?.sideConf ?? 0, g.market?.totalConf ?? 0);
  if (!slots[slot] || conf > slots[slot].conf) slots[slot] = { g, conf };
}
for (const { g } of Object.values(slots)) {
  const st = (g.stacks || []).find((s) => s.type === 'sgp') || (g.stacks || [])[0];
  if (st)
    crossStacks.push({ legs: st.legs, why: `${label(g)} same-game stack: ${st.why}`, type: 'sgp' });
}

const maxConfidence = bestBets
  .slice()
  .sort((a, b) => b.conf - a.conf)
  .slice(0, 5)
  .map((b) => ({
    game: b.game,
    bet: b.bet,
    kind: /ATD/.test(b.bet) ? 'atd' : /^(Over|Under)/.test(b.bet) ? 'total' : 'side',
    why: b.why,
  }));

const out = {
  season: SEASON,
  week: WEEK,
  researchAsOf: nowIso(),
  generatedAt: nowIso(),
  notes: `Week ${WEEK} research prepared Saturday from Friday's practice reports and designations, with DraftKings and FanDuel prices pulled Saturday morning. Touchdown estimates are built from role, not from the posted price; after Week 4's grading they are shaded down from where the desk would have put them a month ago.`,
  completed,
  games,
  crossStacks,
  upsetLeans,
  bestBets,
  creditPlan: previous.creditPlan ?? { monthly: 500, phases: {}, reserve: 40, note: '' },
  maxConfidence,
};
console.log(
  `${games.length} games, ${completed.length} completed, ${bestBets.length} best bets, ${crossStacks.length} cross stacks, ${upsetLeans.length} upset leans`,
);
for (const p of problems) console.log(`  PROBLEM ${p}`);
if (args.dry) process.exit(problems.length ? 1 : 0);
writeJson(path.join(ROOT, 'src', 'data', 'research.json'), out);
console.log('wrote src/data/research.json');
process.exit(problems.length ? 1 : 0);
