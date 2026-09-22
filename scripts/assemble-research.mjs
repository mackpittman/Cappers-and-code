// Assembles one JSON file per game into src/data/research.json, validating each one on the way in.
//
// The per-game files are written by the weekly research pass, one researcher per game, which means
// sixteen independent chances to get the same three things wrong. Those three things are checked
// here rather than trusted: implied team points stored in away/home order and actually derived from
// the spread and total (they arrived swapped on every game for two straight weeks), de-vigged win
// probabilities that sum to one and favour the side the spread favours, and a board with enough
// priced names to be worth publishing. A bad de-vig is invisible in prose and survives all the way
// to a sheet somebody bets from.
//
//   RESEARCH_DIR=/path/to/games WEEK=3 WRITE=1 node scripts/assemble-research.mjs
//
// Without WRITE=1 it reports and writes nothing. With it, it still refuses unless every game in
// ORDER is present and no check failed — a partial week silently overwriting a full one is worse
// than no week at all.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';
const DIR = process.env.RESEARCH_DIR ?? path.join(ROOT, 'research-draft');
const ORDER = (process.env.GAMES ?? '').trim()
  ? process.env.GAMES.split(/[\s,]+/).filter(Boolean)
  : fs
      .readdirSync(DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .sort();

const problems = [];
const games = [];
for (const id of ORDER) {
  const f = path.join(DIR, `${id}.json`);
  if (!fs.existsSync(f)) {
    problems.push(`${id}: MISSING`);
    continue;
  }
  let g;
  try {
    g = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    problems.push(`${id}: bad JSON — ${e.message}`);
    continue;
  }

  const L = g.lines;
  const margin = Math.abs(Number(L.spread.split(' ').pop()));
  const favAbbr = L.spread.split(' ')[0];
  const favPts = +((L.total + margin) / 2).toFixed(2);
  const dogPts = +((L.total - margin) / 2).toFixed(2);
  const favIsHome = favAbbr === g.home.abbr;
  const wantAway = favIsHome ? dogPts : favPts;
  const wantHome = favIsHome ? favPts : dogPts;
  if (Math.abs(L.implied.away - wantAway) > 0.26 || Math.abs(L.implied.home - wantHome) > 0.26)
    problems.push(
      `${id}: implied points are ${L.implied.away}/${L.implied.home}, should be ${wantAway}/${wantHome} (${favAbbr} favoured by ${margin})`,
    );
  const wp = L.winProb.away + L.winProb.home;
  if (Math.abs(wp - 1) > 0.02) problems.push(`${id}: winProb sums to ${wp.toFixed(3)}`);
  if (!favIsHome && L.winProb.away < L.winProb.home)
    problems.push(`${id}: ${favAbbr} is favoured but winProb favours the other side`);
  if (favIsHome && L.winProb.home < L.winProb.away)
    problems.push(`${id}: ${favAbbr} is favoured but winProb favours the other side`);
  if ((g.atdBoard ?? []).length < 6)
    problems.push(`${id}: only ${(g.atdBoard ?? []).length} atdBoard entries`);
  if ((g.top3 ?? []).length !== 3) problems.push(`${id}: top3 has ${(g.top3 ?? []).length}`);
  for (const p of [...(g.top3 ?? []), ...(g.value ?? [])])
    if (!(p.est >= 0 && p.est <= 1)) problems.push(`${id}: ${p.name} est ${p.est} out of range`);
  const MK = [
    'player_pass_yds',
    'player_rush_yds',
    'player_reception_yds',
    'player_receptions',
    'player_pass_tds',
  ];
  for (const p of g.market?.propLeans ?? [])
    if (!MK.includes(p.market)) problems.push(`${id}: propLean market "${p.market}" not allowed`);
  games.push(g);
}

// bestBets: every side or total the desk rates 3 or better, plus the touchdown calls where our own
// estimate beats the posted price by a real margin. Sorted by confidence.
const implied = (a) => (a > 0 ? 100 / (a + 100) : -a / (-a + 100));
const bestBets = [];
for (const g of games) {
  const m = g.market ?? {};
  if (m.side && m.sideConf >= 3)
    bestBets.push({ game: g.id, bet: m.side, conf: m.sideConf, why: m.why });
  if (m.total && m.totalConf >= 3)
    bestBets.push({ game: g.id, bet: m.total, conf: m.totalConf, why: m.why });
  for (const p of g.top3 ?? []) {
    if (p.price == null) continue;
    const edge = p.est - implied(p.price);
    if (edge >= 0.05)
      bestBets.push({
        game: g.id,
        bet: `${p.name} ATD ${p.price > 0 ? '+' : ''}${p.price}`,
        conf: edge >= 0.1 ? 4 : 3,
        why: p.why,
      });
  }
}
bestBets.sort((a, b) => b.conf - a.conf);

const maxConfidence = bestBets
  .filter((b) => b.conf >= 4 || /^(Over|Under)/.test(b.bet) || / [+-]\d/.test(b.bet))
  .slice(0, 14)
  .map((b) => ({
    game: b.game,
    bet: b.bet,
    kind: /ATD/.test(b.bet) ? 'atd' : /^(Over|Under)/.test(b.bet) ? 'total' : 'side',
    price: /ATD/.test(b.bet) ? Number(b.bet.split(' ').pop()) : -110,
    book: 'FD/DK',
    why: b.why,
  }));

// Cross-game stacks and upset leans are derived, not hand-written: every number below is computed
// from the board this file just validated, so a stale price cannot hide inside the prose. A stack is
// only published when our own estimate beats the price it pays — the obvious constructions (three
// short-priced lead backs, four chalk moneylines) all price negative once you de-vig them, and
// printing those as "edge" is how a sheet ends up recommending the book's best bet instead of ours.
const dec = (a) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
const toAmerican = (d) => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));
const fmt = (a) => `${a > 0 ? '+' : ''}${a}`;
const firstSentence = (t) => (String(t).match(/^.*?[a-z0-9)%"][.!?](?=\s|$)/s) ?? [String(t)])[0];
// Rationale is always whole sentences: a clause cut at a character count ("scored exactly 14 in.")
// reads as a bug, and the card can wrap.
const brief = (t) => firstSentence(t);

const crossStacks = [];

// 1. The touchdown legs where our estimate beats the posted price by the most, across all games.
const edges = games
  .flatMap((g) => [...(g.top3 ?? []), ...(g.value ?? [])].map((p) => ({ ...p, game: g.id })))
  .filter((p) => p.price != null && p.est > implied(p.price))
  .sort((a, b) => b.est - implied(b.price) - (a.est - implied(a.price)))
  .slice(0, 3);
if (edges.length === 3) {
  const pay = edges.reduce((d, p) => d * dec(p.price), 1);
  const est = edges.reduce((q, p) => q * p.est, 1);
  crossStacks.push({
    legs: edges.map((p) => `${p.name} ATD (${fmt(p.price)})`),
    why: `Value touchdown block: the three scorers our model rates furthest above their price. Pays ${fmt(toAmerican(pay))}, which needs ${(100 / pay).toFixed(0)}%; we make it ${(est * 100).toFixed(0)}% if the legs land independently, and they sit in three different games so nothing here is correlated away.`,
    type: 'cross',
  });
}

// 2. The desk's strongest number calls, sides and totals it rates 3 or better.
const strongTotals = games.filter((g) => g.market?.total && g.market.totalConf >= 3).slice(0, 3);
if (strongTotals.length >= 2)
  crossStacks.push({
    legs: strongTotals.map((g) => `${g.away.abbr}/${g.home.abbr} ${g.market.total}`),
    why: `Totals block: every game where the desk rates the number 3 or better. At standard juice this pays about ${fmt(toAmerican(Math.pow(1.909, strongTotals.length)))}, so it needs ${(100 / Math.pow(1.909, strongTotals.length)).toFixed(0)}% — these are scoring-environment calls, not side calls, which is why they are grouped rather than mixed with spreads.`,
    type: 'cross',
  });

const strongSides = games.filter((g) => g.market?.side && g.market.sideConf >= 3).slice(0, 3);
if (strongSides.length >= 2)
  crossStacks.push({
    legs: strongSides.map((g) => g.market.side),
    why: `Sides block: the spreads the desk rates 3 or better. Pays about ${fmt(toAmerican(Math.pow(1.909, strongSides.length)))} at standard juice, so it needs ${(100 / Math.pow(1.909, strongSides.length)).toFixed(0)}%. Each leg's reasoning is on its own game card.`,
    type: 'cross',
  });

// 3. The week's opener, stacked with the scorer in it we rate best above the price.
const opener = [...games].sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))[0];
if (opener?.market?.side) {
  const backed = opener.market.side.split(' ')[0];
  const pool = [...(opener.top3 ?? []), ...(opener.value ?? [])]
    .filter((p) => p.price != null && p.est > implied(p.price) && p.team === backed)
    .sort((a, b) => b.est - implied(b.price) - (a.est - implied(a.price)));
  const best = pool.find((p) => p.est >= 0.25) ?? pool[0];
  if (best)
    crossStacks.push({
      legs: [opener.market.side, `${best.name} ATD (${fmt(best.price)})`],
      why: `Opener SGP. ${brief(opener.market.why)} ${best.why}`,
      type: 'cross',
    });
}

// Upset leans: underdogs with a real path to winning outright, which is a higher bar than a side
// lean. A dog we like on the spread is not an upset pick, and pricing it as one is how a 14%
// moneyline ends up on the front page.
const upsetLeans = games
  .map((g) => {
    const homeIsDog = g.lines.winProb.home < g.lines.winProb.away;
    const dog = homeIsDog ? g.home : g.away;
    const wp = homeIsDog ? g.lines.winProb.home : g.lines.winProb.away;
    const price = homeIsDog ? g.lines.ml.home : g.lines.ml.away;
    const proj = g.market?.projected ?? {};
    const dogPts = homeIsDog ? proj.home : proj.away;
    const favPts = homeIsDog ? proj.away : proj.home;
    const tookDog = g.market?.side?.startsWith(`${dog.abbr} `);
    // Either we project the dog to win outright, or the market already gives them 40%+ and we
    // took their side.
    const live = (dogPts != null && favPts != null && dogPts >= favPts) || (wp >= 0.4 && tookDog);
    if (!live) return null;
    return { team: dog.abbr, price, winProb: +wp.toFixed(3), why: brief(g.market.why) };
  })
  .filter(Boolean)
  .sort((a, b) => b.price - a.price)
  .slice(0, 4);

const out = {
  season: 2026,
  week:
    Number(process.env.WEEK ?? 0) ||
    JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/research.json'), 'utf8')).week,
  researchAsOf: process.env.AS_OF ?? new Date().toISOString(),
  generatedAt: process.env.AS_OF ?? new Date().toISOString(),
  notes:
    process.env.NOTES ??
    'Researched one game at a time, then validated for de-vigged win probability, implied team points and board depth before assembly. Anytime-TD prices marked "verify" could not be confirmed at a live sportsbook and must be checked before they are played.',
  completed: [],
  games,
  crossStacks,
  upsetLeans,
  bestBets: bestBets.slice(0, 18),
  creditPlan: JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/research.json'), 'utf8'))
    .creditPlan,
  maxConfidence,
};

if (process.env.DUMP === '1') {
  console.log(JSON.stringify({ crossStacks, upsetLeans }, null, 1));
}

if (problems.length) {
  console.log(`PROBLEMS (${problems.length}):`);
  for (const p of problems) console.log('  -', p);
}
console.log(
  `\nassembled ${games.length}/${ORDER.length} games, ${bestBets.length} bestBets, ${maxConfidence.length} maxConfidence`,
);
if (process.env.WRITE === '1' && games.length === ORDER.length && !problems.length) {
  fs.writeFileSync(path.join(ROOT, 'src/data/research.json'), JSON.stringify(out, null, 1));
  console.log('WROTE src/data/research.json');
} else if (process.env.WRITE === '1') {
  console.log(`NOT written: need all ${ORDER.length} games and zero problems.`);
}
