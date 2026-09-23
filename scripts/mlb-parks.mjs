// Park run factors computed from this season's finals, not from a remembered table.
//
// The naive version — runs per game at a venue over the league average — is confounded by who
// plays there eighty times a year. Coors looks hot partly because it is Coors and partly because
// of the teams in it. So each park is measured as the home team's scoring environment at home
// against its own scoring environment on the road, which holds the home roster constant on both
// sides of the ratio.
//
// One season of ~81 home games is still a noisy estimate, so the raw ratio is shrunk toward 1.
// SHRINK is the weight kept on the observation.
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './lib.mjs';

export const SHRINK = 0.55;

/** Raw home/road ratio per venue from a list of {venue, homeTeamId, runs} finals. */
export function rawFactors(finals) {
  const home = new Map(); // teamId -> {g, r, venue}
  const road = new Map();
  for (const f of finals) {
    const h = home.get(f.homeTeamId) ?? { g: 0, r: 0, venues: new Map() };
    h.g++;
    h.r += f.runs;
    h.venues.set(f.venue, (h.venues.get(f.venue) ?? 0) + 1);
    home.set(f.homeTeamId, h);
    const a = road.get(f.awayTeamId) ?? { g: 0, r: 0 };
    a.g++;
    a.r += f.runs;
    road.set(f.awayTeamId, a);
  }
  const out = new Map();
  for (const [teamId, h] of home) {
    const a = road.get(teamId);
    if (!a || h.g < 30 || a.g < 30) continue;
    // The venue this team actually played most of its home games in.
    const venue = [...h.venues.entries()].sort((x, y) => y[1] - x[1])[0][0];
    out.set(venue, { venue, teamId, homeGames: h.g, roadGames: a.g, raw: h.r / h.g / (a.r / a.g) });
  }
  return out;
}

/** Shrink a raw ratio toward a neutral park. */
export const shrink = (raw, w = SHRINK) => 1 + w * (raw - 1);

/** Load the cached factors, or an empty map. Every lookup falls back to neutral. */
export function loadFactors(season) {
  const file = path.join(DATA, 'mlb', `parks-${season}.json`);
  if (!fs.existsSync(file)) return { league: null, park: () => 1, table: {} };
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    league: j.leagueRunsPerGame,
    table: j.parks,
    park: (venue) => j.parks[venue]?.factor ?? 1,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const season = process.env.SEASON ?? String(new Date().getFullYear());
  const url =
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${season}-03-01&endDate=${season}-11-01` +
    `&gameType=R&fields=dates,games,gamePk,status,abstractGameState,venue,id,name,teams,away,home,score,team`;
  const j = await (await fetch(url)).json();
  const finals = [];
  for (const d of j.dates ?? [])
    for (const g of d.games ?? []) {
      if (g.status?.abstractGameState !== 'Final') continue;
      const a = g.teams?.away?.score;
      const h = g.teams?.home?.score;
      if (a == null || h == null) continue;
      finals.push({
        venue: g.venue?.name,
        homeTeamId: g.teams.home.team.id,
        awayTeamId: g.teams.away.team.id,
        runs: a + h,
      });
    }
  const league = finals.reduce((s, f) => s + f.runs, 0) / finals.length;
  const parks = {};
  for (const [venue, v] of rawFactors(finals))
    parks[venue] = {
      teamId: v.teamId,
      homeGames: v.homeGames,
      roadGames: v.roadGames,
      raw: +v.raw.toFixed(4),
      factor: +shrink(v.raw).toFixed(4),
    };
  const file = path.join(DATA, 'mlb', `parks-${season}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        season: Number(season),
        finals: finals.length,
        leagueRunsPerGame: +league.toFixed(4),
        shrink: SHRINK,
        parks,
      },
      null,
      1,
    ),
  );
  const sorted = Object.entries(parks).sort((a, b) => b[1].factor - a[1].factor);
  console.log(`${finals.length} finals, league ${league.toFixed(2)} runs/game`);
  for (const [v, p] of [...sorted.slice(0, 4), ...sorted.slice(-4)])
    console.log(`  ${p.factor.toFixed(3)}  (raw ${p.raw.toFixed(3)})  ${v}`);
}
