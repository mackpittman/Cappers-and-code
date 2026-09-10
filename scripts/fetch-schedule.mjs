// Pulls the current NFL week's schedule, status, scores and DraftKings lines from ESPN's public
// scoreboard. Free: no key, no credits. Spread, total and moneyline (open and close) come from here,
// which is why The Odds API is reserved for touchdown props only.
import path from 'node:path';
import { DATA, getJson, writeJson, nowIso } from './lib.mjs';

const url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const { ok, status, body } = await getJson(url);
if (!ok || !body?.events) {
  console.error(`ESPN scoreboard failed (${status}); keeping previous schedule.json`);
  process.exit(0);
}
const num = (v) => (v == null || v === '' ? null : Number(String(v).replace('+', '')));
const games = body.events.map((e) => {
  const c = e.competitions[0];
  const home = c.competitors.find((x) => x.homeAway === 'home');
  const away = c.competitors.find((x) => x.homeAway === 'away');
  const o = c.odds?.[0];
  const line = o
    ? {
        provider: o.provider?.displayName ?? null,
        details: o.details ?? null,
        spreadHome: o.spread ?? null, // negative = home favored (ESPN convention)
        total: o.overUnder ?? null,
        ml: {
          home: num(o.moneyline?.home?.close?.odds),
          away: num(o.moneyline?.away?.close?.odds),
          openHome: num(o.moneyline?.home?.open?.odds),
          openAway: num(o.moneyline?.away?.open?.odds),
        },
      }
    : null;
  return {
    espnId: e.id,
    kickoff: e.date,
    name: e.shortName,
    status: c.status?.type?.name,
    statusDetail: c.status?.type?.shortDetail,
    home: { abbr: home.team.abbreviation, score: Number(home.score ?? 0) },
    away: { abbr: away.team.abbreviation, score: Number(away.score ?? 0) },
    espnLine: line,
  };
});
writeJson(path.join(DATA, 'schedule.json'), {
  fetchedAt: nowIso(),
  season: body.season?.year,
  week: body.week?.number,
  games,
});
console.log(
  `schedule: week ${body.week?.number}, ${games.length} games, ${games.filter((g) => g.espnLine?.ml?.home != null).length} with moneylines`,
);
