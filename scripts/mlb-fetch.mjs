// Pulls everything a baseball model needs for one day, all from free public feeds:
// MLB StatsAPI for the schedule, probable pitchers, team hitting splits by opposing hand, and
// pitcher lines; ESPN for the DraftKings moneyline, run line and total with both sides' prices.
//
//   DATE=2026-09-23 node scripts/mlb-fetch.mjs   ->  data/mlb/<date>.json
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './lib.mjs';

const DATE = process.env.DATE ?? new Date().toISOString().slice(0, 10);
const SEASON = DATE.slice(0, 4);
const get = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};
const num = (x) => (x == null || x === '' || x === '-.--' || x === '-' ? null : Number(x));

// ---- schedule and probables -------------------------------------------------------------------
const sched = await get(
  `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${DATE}&hydrate=probablePitcher,team,venue,linescore`,
);
const mlbGames = (sched.dates?.[0]?.games ?? []).map((g) => ({
  gamePk: g.gamePk,
  kickoff: g.gameDate,
  status: g.status?.abstractGameState, // Preview | Live | Final
  venue: g.venue?.name,
  venueId: g.venue?.id,
  doubleHeader: g.doubleHeader,
  gameNumber: g.gameNumber,
  away: { id: g.teams.away.team.id, name: g.teams.away.team.name },
  home: { id: g.teams.home.team.id, name: g.teams.home.team.name },
  probables: {
    away: g.teams.away.probablePitcher
      ? { id: g.teams.away.probablePitcher.id, name: g.teams.away.probablePitcher.fullName }
      : null,
    home: g.teams.home.probablePitcher
      ? { id: g.teams.home.probablePitcher.id, name: g.teams.home.probablePitcher.fullName }
      : null,
  },
}));

// ---- odds (ESPN's DraftKings feed) ------------------------------------------------------------
const espn = await get(
  `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${DATE.replace(/-/g, '')}`,
);
// Weather comes from the same feed as the odds. A components model cannot see wind, and wind is
// the single biggest thing separating a market total from a model total at an open-air park — a
// 20mph gust in off the lake at Wrigley is worth three runs on a number.
const weather = {};
const odds = {};
for (const e of espn.events ?? []) {
  const c = e.competitions[0];
  const away = c.competitors.find((x) => x.homeAway === 'away');
  const home = c.competitors.find((x) => x.homeAway === 'home');
  const o = (c.odds ?? [])[0];
  if (!o) continue;
  // A doubleheader puts two rows under one pair of abbreviations; key on the start time too.
  const key = `${away.team.abbreviation}@${home.team.abbreviation}@${e.date}`;
  weather[key] = null; // filled below from the summary endpoint
  odds[key] = {
    book: o.provider?.name ?? null,
    awayAbbr: away.team.abbreviation,
    homeAbbr: home.team.abbreviation,
    awayName: away.team.displayName,
    homeName: home.team.displayName,
    start: e.date,
    ml: { away: num(o.moneyline?.away?.close?.odds), home: num(o.moneyline?.home?.close?.odds) },
    mlOpen: { away: num(o.moneyline?.away?.open?.odds), home: num(o.moneyline?.home?.open?.odds) },
    runLine: {
      away: {
        line: num(o.pointSpread?.away?.close?.line),
        price: num(o.pointSpread?.away?.close?.odds),
      },
      home: {
        line: num(o.pointSpread?.home?.close?.line),
        price: num(o.pointSpread?.home?.close?.odds),
      },
    },
    total: {
      line: num(o.overUnder),
      open: num(o.total?.over?.open?.line?.replace?.('o', '')) ?? null,
      over: num(o.total?.over?.close?.odds),
      under: num(o.total?.under?.close?.odds),
    },
  };
}

// One summary call per priced game for its forecast.
for (const [key, row] of Object.entries(odds)) {
  const ev = (espn.events ?? []).find(
    (e) =>
      e.date === row.start &&
      e.competitions[0].competitors.find((c) => c.homeAway === 'away')?.team.abbreviation ===
        row.awayAbbr,
  );
  if (!ev) continue;
  try {
    const sum = await get(
      `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${ev.id}`,
    );
    const w = sum.gameInfo?.weather;
    weather[key] = w
      ? {
          temperature: w.temperature ?? null,
          gust: w.gust ?? null,
          precipitation: w.precipitation ?? null,
          conditionId: w.conditionId ?? null,
        }
      : null;
    // A dome has no wind to report; note the venue so the model does not treat null as calm.
    row.roof =
      sum.gameInfo?.venue?.grass === undefined ? null : (sum.gameInfo?.venue?.indoor ?? null);
  } catch {
    weather[key] = null;
  }
}

// ---- team hitting, split by the hand of the pitcher they face ---------------------------------
// vl = versus left-handed pitching, vr = versus right. A team's platoon split is one of the few
// things a day-of model can know that the season line alone does not tell it.
const teamIds = [...new Set(mlbGames.flatMap((g) => [g.away.id, g.home.id]))];
const teams = {};
for (const id of teamIds) {
  const [season, splits, pitch] = await Promise.all([
    get(
      `https://statsapi.mlb.com/api/v1/teams/${id}/stats?stats=season&group=hitting&season=${SEASON}&gameType=R`,
    ),
    get(
      `https://statsapi.mlb.com/api/v1/teams/${id}/stats?stats=statSplits&group=hitting&season=${SEASON}&gameType=R&sitCodes=vl,vr`,
    ),
    get(
      `https://statsapi.mlb.com/api/v1/teams/${id}/stats?stats=statSplits&group=pitching&season=${SEASON}&gameType=R&sitCodes=sp,rp`,
    ),
  ]);
  const h = season.stats?.[0]?.splits?.[0]?.stat ?? {};
  const bySit = {};
  for (const s of splits.stats?.[0]?.splits ?? []) bySit[s.split?.code] = s.stat;
  const byRole = {};
  for (const s of pitch.stats?.[0]?.splits ?? []) byRole[s.split?.code] = s.stat;
  teams[id] = {
    id,
    games: num(h.gamesPlayed),
    runs: num(h.runs),
    ops: num(h.ops),
    vsL: {
      ops: num(bySit.vl?.ops),
      plateAppearances: num(bySit.vl?.plateAppearances),
      runs: num(bySit.vl?.runs),
    },
    vsR: {
      ops: num(bySit.vr?.ops),
      plateAppearances: num(bySit.vr?.plateAppearances),
      runs: num(bySit.vr?.runs),
    },
    starters: {
      era: num(byRole.sp?.era),
      ip: num(byRole.sp?.inningsPitched),
      er: num(byRole.sp?.earnedRuns),
      runs: num(byRole.sp?.runs),
    },
    bullpen: {
      era: num(byRole.rp?.era),
      ip: num(byRole.rp?.inningsPitched),
      er: num(byRole.rp?.earnedRuns),
      runs: num(byRole.rp?.runs),
    },
  };
}

// ---- probable starters --------------------------------------------------------------------
const pitcherIds = [
  ...new Set(mlbGames.flatMap((g) => [g.probables.away?.id, g.probables.home?.id]).filter(Boolean)),
];
const pitchers = {};
for (const id of pitcherIds) {
  const [stat, person] = await Promise.all([
    get(
      `https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=season&group=pitching&season=${SEASON}&gameType=R`,
    ),
    get(`https://statsapi.mlb.com/api/v1/people/${id}`),
  ]);
  const s = stat.stats?.[0]?.splits?.[0]?.stat ?? {};
  const p = person.people?.[0] ?? {};
  pitchers[id] = {
    id,
    name: p.fullName,
    throws: p.pitchHand?.code ?? null, // L or R
    starts: num(s.gamesStarted),
    ip: num(s.inningsPitched),
    era: num(s.era),
    runs: num(s.runs),
    earnedRuns: num(s.earnedRuns),
    hits: num(s.hits),
    walks: num(s.baseOnBalls),
    strikeOuts: num(s.strikeOuts),
    homeRuns: num(s.homeRuns),
    whip: num(s.whip),
    battersFaced: num(s.battersFaced),
  };
}

const out = {
  date: DATE,
  season: Number(SEASON),
  fetchedAt: new Date().toISOString(),
  games: mlbGames,
  odds,
  weather,
  teams,
  pitchers,
};
const file = path.join(DATA, 'mlb', `${DATE}.json`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 1));
const pre = mlbGames.filter((g) => g.status === 'Preview').length;
console.log(
  `${DATE}: ${mlbGames.length} games (${pre} not started), ${Object.keys(odds).length} priced, ${Object.keys(teams).length} teams, ${Object.keys(pitchers).length} probables`,
);
