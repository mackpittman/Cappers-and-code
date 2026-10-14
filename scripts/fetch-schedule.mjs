// Pulls the current NFL week's schedule, status, scores and DraftKings lines from ESPN's public
// scoreboard. Free: no key, no credits. Spread, total and moneyline (open and close) come from here,
// which is why The Odds API is reserved for touchdown props only.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, getJson, writeJson, nowIso } from './lib.mjs';

const base = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const weekUrl = (year, week) => `${base}?year=${year}&seasontype=2&week=${week}`;
let { ok, status, body } = await getJson(
  process.env.NFL_WEEK
    ? weekUrl(process.env.NFL_SEASON || new Date().getUTCFullYear(), process.env.NFL_WEEK)
    : base,
);
if (!ok || !body?.events) {
  console.error(`ESPN scoreboard failed (${status}); keeping previous schedule.json`);
  process.exit(0);
}
// ESPN's default scoreboard lags a day or so after Monday night: when every game in the week it
// returns is already final, roll forward to the next week so Tuesday runs research the right slate.
const allFinal = (b) =>
  b.events.length > 0 &&
  b.events.every((e) => e.competitions[0].status?.type?.name === 'STATUS_FINAL');
// Every fetched week is also kept under data/schedules/<season>-w<wk>.json. build-board.mjs reads
// the research week's copy once ESPN has rolled the live file forward (Tuesday through Saturday),
// so the Monday-night final and the graded record still reach the board that week.
function archive(s) {
  if (!s.season || !s.week) return;
  const dir = path.join(DATA, 'schedules');
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, `${s.season}-w${String(s.week).padStart(2, '0')}.json`), s);
}
const num = (v) => (v == null || v === '' ? null : Number(String(v).replace('+', '')));
let current = toSchedule(body);
if (!process.env.NFL_WEEK && allFinal(body) && body.week?.number) {
  const next = await getJson(weekUrl(body.season?.year, body.week.number + 1));
  if (next.ok && next.body?.events?.length) {
    console.log(
      `schedule: week ${body.week.number} is complete, rolling to week ${body.week.number + 1}`,
    );
    archive(current); // the completed week, every game final
    body = next.body;
    current = toSchedule(body);
  }
}
archive(current);
writeJson(path.join(DATA, 'schedule.json'), current);
console.log(
  `schedule: week ${current.week}, ${current.games.length} games, ${current.games.filter((g) => g.espnLine?.ml?.home != null).length} with moneylines`,
);

/** The schedule file for one ESPN scoreboard body. */
function toSchedule(b) {
  const games = b.events.map((e) => {
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
  return { fetchedAt: nowIso(), season: b.season?.year, week: b.week?.number, games };
}
