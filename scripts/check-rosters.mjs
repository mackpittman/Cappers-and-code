// Checks every player named in src/data/research.json against ESPN's current team rosters (free).
// Catches the classic research failure: a real player on the wrong team, or a name ESPN spells
// differently (which would make the grader miss him). Exit 1 when any pick or prop lean fails;
// atdBoard and stack legs only warn.
import path from 'node:path';
import { ROOT, getJson, readJson } from './lib.mjs';

const research = readJson(process.argv[2] || path.join(ROOT, 'src', 'data', 'research.json'));
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const base = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams';
const teams = await getJson(`${base}?limit=40`);
if (!teams.ok) {
  console.error(`ESPN teams failed (${teams.status})`);
  process.exit(2);
}
const list = teams.body.sports[0].leagues[0].teams.map((t) => t.team);
const rosters = {}; // abbr -> Set(normalized names)
const owner = {}; // normalized name -> abbr
await Promise.all(
  list.map(async (t) => {
    const r = await getJson(`${base}/${t.id}/roster`);
    const names = new Set();
    for (const g of r.body?.athletes || [])
      for (const a of g.items || []) {
        names.add(norm(a.displayName));
        owner[norm(a.displayName)] = t.abbreviation;
      }
    rosters[t.abbreviation] = names;
  }),
);
const problems = [];
const warnings = [];
const check = (name, team, where, hard = true) => {
  const n = norm(name);
  if (rosters[team]?.has(n)) return;
  const msg = owner[n]
    ? `${where}: ${name} is on ${owner[n]}, not ${team}`
    : `${where}: ${name} not found on any ESPN roster (spelling?)`;
  (hard ? problems : warnings).push(msg);
};
for (const g of research.games || []) {
  const abbrs = [g.away.abbr, g.home.abbr];
  const inGame = (team) => abbrs.includes(team);
  for (const p of [...(g.top3 || []), ...(g.value || [])]) {
    if (!inGame(p.team)) problems.push(`${g.id} pick: ${p.name} team ${p.team} not in this game`);
    else check(p.name, p.team, `${g.id} pick`);
  }
  for (const b of g.atdBoard || []) {
    if (inGame(b.team)) check(b.name, b.team, `${g.id} atdBoard`, false);
  }
  for (const pl of g.market?.propLeans || []) {
    const n = norm(pl.player);
    const team = abbrs.find((a) => rosters[a]?.has(n));
    if (!team)
      problems.push(
        owner[n]
          ? `${g.id} propLean: ${pl.player} is on ${owner[n]}, not in ${abbrs.join('/')}`
          : `${g.id} propLean: ${pl.player} not found on any ESPN roster`,
      );
  }
}
for (const w of warnings) console.log(`warn ${w}`);
for (const p of problems) console.log(`FAIL ${p}`);
console.log(
  `rosters: ${Object.keys(rosters).length} teams, ${problems.length} problems, ${warnings.length} warnings`,
);
process.exit(problems.length ? 1 : 0);
