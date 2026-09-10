// Pulls ESPN's league-wide injury feed and keeps only what the board needs.
import path from 'node:path';
import { DATA, getJson, writeJson, nowIso } from './lib.mjs';

const url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries';
const { ok, status, body } = await getJson(url, { timeoutMs: 180000 });
if (!ok || !body?.injuries) {
  console.error(`ESPN injuries failed (${status}); keeping previous injuries.json`);
  process.exit(0);
}
const NAME_TO_ABBR = {};
const teams = {};
for (const t of body.injuries) {
  const abbr = t.abbreviation || guessAbbr(t.displayName);
  NAME_TO_ABBR[t.displayName] = abbr;
  teams[abbr] = (t.injuries || [])
    .map((i) => ({
      name: i.athlete?.displayName,
      pos: i.athlete?.position?.abbreviation,
      status: i.status,
      type: i.type?.description,
      detail: i.shortComment,
      date: i.date,
    }))
    .filter((i) => i.name)
    .sort((a, b) => rank(b.status) - rank(a.status));
}
function rank(s) {
  return (
    {
      Out: 6,
      Doubtful: 5,
      Questionable: 4,
      Suspension: 3,
      'Injured Reserve': 2,
      'Physically Unable to Perform': 2,
    }[s] ?? 1
  );
}
function guessAbbr(displayName) {
  const map = {
    'Arizona Cardinals': 'ARI',
    'Atlanta Falcons': 'ATL',
    'Baltimore Ravens': 'BAL',
    'Buffalo Bills': 'BUF',
    'Carolina Panthers': 'CAR',
    'Chicago Bears': 'CHI',
    'Cincinnati Bengals': 'CIN',
    'Cleveland Browns': 'CLE',
    'Dallas Cowboys': 'DAL',
    'Denver Broncos': 'DEN',
    'Detroit Lions': 'DET',
    'Green Bay Packers': 'GB',
    'Houston Texans': 'HOU',
    'Indianapolis Colts': 'IND',
    'Jacksonville Jaguars': 'JAX',
    'Kansas City Chiefs': 'KC',
    'Los Angeles Chargers': 'LAC',
    'Los Angeles Rams': 'LAR',
    'Las Vegas Raiders': 'LV',
    'Miami Dolphins': 'MIA',
    'Minnesota Vikings': 'MIN',
    'New England Patriots': 'NE',
    'New Orleans Saints': 'NO',
    'New York Giants': 'NYG',
    'New York Jets': 'NYJ',
    'Philadelphia Eagles': 'PHI',
    'Pittsburgh Steelers': 'PIT',
    'Seattle Seahawks': 'SEA',
    'San Francisco 49ers': 'SF',
    'Tampa Bay Buccaneers': 'TB',
    'Tennessee Titans': 'TEN',
    'Washington Commanders': 'WSH',
  };
  return map[displayName] || displayName;
}
writeJson(path.join(DATA, 'injuries.json'), {
  fetchedAt: nowIso(),
  sourceTimestamp: body.timestamp,
  teams,
});
console.log(
  `injuries: ${Object.keys(teams).length} teams, ${Object.values(teams).reduce((n, t) => n + t.length, 0)} entries`,
);
