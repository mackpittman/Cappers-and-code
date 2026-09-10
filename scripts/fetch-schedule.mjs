// Pulls the current NFL week's schedule, status, scores and consensus lines from ESPN's public scoreboard.
import path from 'node:path';
import { DATA, getJson, writeJson, nowIso } from './lib.mjs';

const url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const { ok, status, body } = await getJson(url);
if (!ok || !body?.events) {
  console.error(`ESPN scoreboard failed (${status}); keeping previous schedule.json`);
  process.exit(0);
}
const games = body.events.map((e) => {
  const c = e.competitions[0];
  const home = c.competitors.find((x) => x.homeAway === 'home');
  const away = c.competitors.find((x) => x.homeAway === 'away');
  const odds = c.odds?.[0];
  return {
    espnId: e.id,
    kickoff: e.date,
    name: e.shortName,
    status: c.status?.type?.name,
    statusDetail: c.status?.type?.shortDetail,
    home: { abbr: home.team.abbreviation, score: Number(home.score ?? 0) },
    away: { abbr: away.team.abbreviation, score: Number(away.score ?? 0) },
    espnLine: odds ? { details: odds.details, overUnder: odds.overUnder } : null,
  };
});
writeJson(path.join(DATA, 'schedule.json'), {
  fetchedAt: nowIso(),
  season: body.season?.year,
  week: body.week?.number,
  games,
});
console.log(`schedule: week ${body.week?.number}, ${games.length} games`);
