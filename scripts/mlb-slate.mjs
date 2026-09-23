// Applies the model to one day's board and prints every market with the model's number beside the
// price. Reads data/mlb/<date>.json (mlb-fetch) and data/mlb/parks-<season>.json (mlb-parks).
//
//   DATE=2026-09-23 node scripts/mlb-slate.mjs
//   MIN_MINUTES=25 ...   ignore anything starting sooner than this
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './lib.mjs';
import { loadFactors } from './mlb-parks.mjs';
import {
  innings,
  ra9,
  regress,
  dePark,
  starterShare,
  sideRuns,
  blend,
  marketRuns,
  priceGame,
  grade,
  impliedProb,
  runLineShare,
  CLUSTER,
  MARKET_WEIGHT,
  SP_REGRESS,
  BP_REGRESS,
  SPLIT_REGRESS,
  OPS_EXPONENT,
} from './mlb-model.mjs';

/** Clustering values either side of the fitted one, for the sensitivity sweep. */
const CLUSTER_ALT_LOW = 4;
const CLUSTER_ALT_HIGH = 6;

const DATE = process.env.DATE ?? new Date().toISOString().slice(0, 10);
const MIN_MINUTES = Number(process.env.MIN_MINUTES ?? 20);
const d = JSON.parse(fs.readFileSync(path.join(DATA, 'mlb', `${DATE}.json`), 'utf8'));
const parks = loadFactors(d.season);
const LEAGUE_TOTAL = parks.league ?? 8.96;
const LEAGUE_TEAM = LEAGUE_TOTAL / 2;

// Which park each team calls home, so a season rate can be de-parked.
const homeParkOf = {};
for (const [venue, p] of Object.entries(parks.table ?? {})) homeParkOf[p.teamId] = p.factor;

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const sign = (x) => `${x > 0 ? '+' : ''}${x}`;

/** Team offence index against a given pitcher hand, de-parked and platoon-adjusted. */
function offenceIndex(team, hand) {
  const rpg = team.runs / team.games;
  const base = dePark(rpg, homeParkOf[team.id] ?? 1) / LEAGUE_TEAM;
  const split = hand === 'L' ? team.vsL : team.vsR;
  if (!split?.ops || !team.ops) return { index: base, platoon: 1, base };
  // Regress the split toward the team's own overall line by plate appearances, then turn the OPS
  // ratio into a run ratio.
  const ops = regress(split.ops, split.plateAppearances ?? 0, team.ops, SPLIT_REGRESS);
  const platoon = Math.pow(ops / team.ops, OPS_EXPONENT);
  return { index: base * platoon, platoon, base };
}

/** Opposing pitching index: the listed starter for his share of the game, the bullpen for the rest. */
function pitchingIndex(starter, defTeam) {
  const park = homeParkOf[defTeam.id] ?? 1;
  const spRaw = starter ? ra9(starter.runs, starter.ip) : null;
  const spIp = starter ? innings(starter.ip) : 0;
  const sp = dePark(regress(spRaw, spIp ?? 0, LEAGUE_TEAM, SP_REGRESS), park) / LEAGUE_TEAM;
  const bpRaw = ra9(defTeam.bullpen.runs, defTeam.bullpen.ip);
  const bpIp = innings(defTeam.bullpen.ip) ?? 0;
  const bp = dePark(regress(bpRaw, bpIp, LEAGUE_TEAM, BP_REGRESS), park) / LEAGUE_TEAM;
  const share = starter ? starterShare(starter.ip, starter.starts) : 0.4;
  return { index: sp * share + bp * (1 - share), sp, bp, share };
}

const now = Date.now();
const rows = [];
for (const g of d.games) {
  if (g.status !== 'Preview') continue;
  const minutes = (Date.parse(g.kickoff) - now) / 60000;
  // ESPN stamps "2026-09-24T00:05Z" where StatsAPI writes "2026-09-24T00:05:00Z", so the two feeds
  // are joined on the parsed instant and the away club, never on the raw string.
  // ESPN stamps "2026-09-24T00:05Z" where StatsAPI writes "2026-09-24T00:05:00Z", and the two feeds
  // disagree by as much as ten minutes on a start time, so they are joined on the club with the
  // nearest start rather than on an exact instant.
  const o = Object.values(d.odds)
    .filter((x) => x.awayName === g.away.name && x.homeName === g.home.name)
    .sort(
      (x, y) =>
        Math.abs(Date.parse(x.start) - Date.parse(g.kickoff)) -
        Math.abs(Date.parse(y.start) - Date.parse(g.kickoff)),
    )[0];
  if (!o || o.ml.away == null || o.ml.home == null || o.total.line == null) continue;

  const away = d.teams[g.away.id];
  const home = d.teams[g.home.id];
  const ap = g.probables.away ? d.pitchers[g.probables.away.id] : null;
  const hp = g.probables.home ? d.pitchers[g.probables.home.id] : null;
  const park = parks.park(g.venue);

  const awayOff = offenceIndex(away, hp?.throws);
  const homeOff = offenceIndex(home, ap?.throws);
  const awayPit = pitchingIndex(hp, home); // what the away bats face
  const homePit = pitchingIndex(ap, away);

  const model = {
    away: sideRuns({
      leagueRunsPerTeam: LEAGUE_TEAM,
      offenceIndex: awayOff.index,
      pitchingIndex: awayPit.index,
      parkFactor: park,
    }),
    home: sideRuns({
      leagueRunsPerTeam: LEAGUE_TEAM,
      offenceIndex: homeOff.index,
      pitchingIndex: homePit.index,
      parkFactor: park,
    }),
  };
  const market = marketRuns({
    total: o.total.line,
    mlAway: o.ml.away,
    mlHome: o.ml.home,
    overPrice: o.total.over,
    underPrice: o.total.under,
  });
  const final = blend(model, market);
  const priced = priceGame({ away: final.away, home: final.home, total: o.total.line });

  const homeRlIsMinus = (o.runLine.home?.line ?? -1.5) < 0;
  // Measure, do not filter. The model's margin shape runs below the market's on almost every game,
  // so a dog run line always looks like value and the reason is this model, not the price.
  const homeFav = o.ml.home < o.ml.away;
  const rlShare = runLineShare({
    mlFav: homeFav ? o.ml.home : o.ml.away,
    mlDog: homeFav ? o.ml.away : o.ml.home,
    favRunLinePrice: homeRlIsMinus ? o.runLine.home?.price : o.runLine.away?.price,
    dogRunLinePrice: homeRlIsMinus ? o.runLine.away?.price : o.runLine.home?.price,
    total: o.total.line,
  });
  // A leg is only worth listing if it survives the model's own uncertainty. Three parameters here
  // are judgement calls, not measurements: how far a one-season park factor is shrunk, how much
  // weight the market gets, and the negative binomial's clustering. Re-price every leg across the
  // plausible range of all three and keep only the ones that stay profitable throughout. Coors is
  // the reason this exists — at the shrunk park factor the model likes the under, at the raw one it
  // likes the over, and a bet whose side depends on that dial is not a bet.
  // The sweep has to be symmetric. Testing the park only between the shrunk factor and neutral asks
  // "what if this park matters less than I think" and never "what if it matters more" — and for
  // Coors the honest answer is that one season of home/road almost certainly understates it against
  // the historical 1.25-1.35. So the range runs from neutral to an over-extended factor that
  // assumes the shrink was too aggressive, and a leg has to survive both ends.
  const rawPark = (parks.table ?? {})[g.venue]?.raw ?? park;
  const stretched = 1 + 1.5 * (rawPark - 1);
  const variants = [];
  for (const pk of [park, rawPark, stretched, 1]) {
    for (const w of [MARKET_WEIGHT, 0.5, 0.8]) {
      for (const cl of [CLUSTER_ALT_LOW, CLUSTER, CLUSTER_ALT_HIGH]) {
        const m = {
          away: sideRuns({
            leagueRunsPerTeam: LEAGUE_TEAM,
            offenceIndex: awayOff.index,
            pitchingIndex: awayPit.index,
            parkFactor: pk,
          }),
          home: sideRuns({
            leagueRunsPerTeam: LEAGUE_TEAM,
            offenceIndex: homeOff.index,
            pitchingIndex: homePit.index,
            parkFactor: pk,
          }),
        };
        const f = blend(m, market, w);
        variants.push(priceGame({ away: f.away, home: f.home, total: o.total.line, r: cl }));
      }
    }
  }
  const worst = (pick) => Math.min(...variants.map(pick));

  const legs = [
    {
      key: `${o.awayAbbr} ML`,
      prob: priced.ml.away,
      floor: worst((v) => v.ml.away),
      price: o.ml.away,
    },
    {
      key: `${o.homeAbbr} ML`,
      prob: priced.ml.home,
      floor: worst((v) => v.ml.home),
      price: o.ml.home,
    },
    {
      kind: 'runline',
      key: `${o.awayAbbr} ${sign(o.runLine.away?.line ?? 1.5)}`,
      prob: homeRlIsMinus ? priced.runLine.awayPlus : priced.runLine.awayMinus,
      floor: worst((v) => (homeRlIsMinus ? v.runLine.awayPlus : v.runLine.awayMinus)),
      price: o.runLine.away?.price,
    },
    {
      kind: 'runline',
      key: `${o.homeAbbr} ${sign(o.runLine.home?.line ?? -1.5)}`,
      prob: homeRlIsMinus ? priced.runLine.homeMinus : priced.runLine.homePlus,
      floor: worst((v) => (homeRlIsMinus ? v.runLine.homeMinus : v.runLine.homePlus)),
      price: o.runLine.home?.price,
    },
    {
      key: `Over ${o.total.line}`,
      prob: priced.total.over,
      push: priced.total.push,
      floor: worst((v) => v.total.over),
      pushFloor: Math.max(...variants.map((v) => v.total.push)),
      price: o.total.over,
    },
    {
      key: `Under ${o.total.line}`,
      prob: priced.total.under,
      push: priced.total.push,
      floor: worst((v) => v.total.under),
      pushFloor: Math.max(...variants.map((v) => v.total.push)),
      price: o.total.under,
    },
  ]
    .filter((l) => l.price != null)
    .map((l) => {
      const g = grade(l.prob, l.price, l.push ?? 0);
      // The edge that survives the worst corner of the parameter sweep, on the same conditional
      // footing as the headline number: win chance given the bet resolves, against the price.
      const floorLose = Math.max(0, 1 - l.floor - (l.pushFloor ?? 0));
      const floorDecided = l.floor + floorLose;
      const floorConditional = floorDecided > 0 ? l.floor / floorDecided : 0;
      return {
        ...l,
        ...g,
        robustEdge: +(floorConditional - impliedProb(l.price)).toFixed(4),
        // Run lines carry a known model bias this run; see runLineShare.
        trusted: l.kind !== 'runline',
        game: `${o.awayAbbr}@${o.homeAbbr}`,
      };
    });

  rows.push({
    id: `${o.awayAbbr}@${o.homeAbbr}`,
    kickoff: g.kickoff,
    minutes: Math.round(minutes),
    venue: g.venue,
    park,
    rlShare,
    weather:
      Object.entries(d.weather ?? {}).find(([k]) =>
        k.startsWith(`${o.awayAbbr}@${o.homeAbbr}@`),
      )?.[1] ?? null,
    away: o.awayAbbr,
    home: o.homeAbbr,
    pitchers: {
      away: ap ? `${ap.name} (${ap.throws})` : 'TBD',
      home: hp ? `${hp.name} (${hp.throws})` : 'TBD',
    },
    market,
    model,
    final,
    priced,
    legs,
    detail: { awayOff, homeOff, awayPit, homePit },
  });
}

rows.sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
console.log(
  `${DATE} — ${rows.length} priced games. League ${LEAGUE_TOTAL.toFixed(2)} runs/game, market weight ${MARKET_WEIGHT}.\n`,
);
for (const r of rows) {
  const late = r.minutes < MIN_MINUTES ? `  ** starts in ${r.minutes} min **` : '';
  console.log(
    `${r.id}  ${new Date(r.kickoff).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET  ${r.venue} (park ${r.park.toFixed(3)})${late}`,
  );
  console.log(
    `  ${r.pitchers.away} at ${r.pitchers.home}${r.weather ? `   ${r.weather.temperature}F, gust ${r.weather.gust}mph, precip ${r.weather.precipitation}%` : ''}`,
  );
  console.log(
    `  market ${r.market.away.toFixed(2)}-${r.market.home.toFixed(2)} (tot ${r.market.fairTotal})  model ${r.model.away.toFixed(2)}-${r.model.home.toFixed(2)} (tot ${(r.model.away + r.model.home).toFixed(2)})  used ${r.final.away.toFixed(2)}-${r.final.home.toFixed(2)}`,
  );
  console.log(
    `  margin: market has ${pct(r.rlShare.market)} of the favourite's wins by 2+, this model ${pct(r.rlShare.model)}${r.rlShare.gap > 0.02 ? '  (model too one-run-heavy; run lines not trusted)' : ''}`,
  );
  for (const l of r.legs)
    console.log(
      `    ${l.key.padEnd(14)} ${String(sign(l.price)).padStart(6)}  model ${pct(l.conditional).padStart(6)}${l.push ? ` (push ${pct(l.push)})` : ''}  need ${pct(l.breakEven).padStart(6)}  edge ${((l.edge * 100 >= 0 ? '+' : '') + (l.edge * 100).toFixed(1)).padStart(5)}  EV ${((l.ev * 100 >= 0 ? '+' : '') + (l.ev * 100).toFixed(1)).padStart(6)}%  robust ${((l.robustEdge * 100 >= 0 ? '+' : '') + (l.robustEdge * 100).toFixed(1)).padStart(5)}${l.robustEdge > 0 ? '  <-- survives' : ''}`,
    );
  console.log('');
}

fs.writeFileSync(
  path.join(DATA, 'mlb', `${DATE}-model.json`),
  JSON.stringify(
    { date: DATE, marketWeight: MARKET_WEIGHT, league: LEAGUE_TOTAL, games: rows },
    null,
    1,
  ),
);
