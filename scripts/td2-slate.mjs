// Two-plus-touchdown probabilities for every skill player on the slate, from usage alone.
//
// No price enters this. The market-calibrated path got the Adams game wrong because the book had
// not repriced a role change, and it flattered Kaleb Johnson because the book had. So this reads
// role straight off the play-by-play: red-zone targets and goal-line carries through this season's
// games, last season's touchdown totals for each player as a prior, and each team's expected
// touchdowns from its implied total. Poisson thinning gives P(2+) = 1 - e^-x (1 + x), x = mu*q.
//
//   node scripts/td2-slate.mjs            reads data/board.json, writes data/td2-week<NN>.json
import fs from 'node:fs';
import path from 'node:path';
import { DATA, readJson } from './lib.mjs';

const board = readJson(path.join(DATA, 'board.json'));
const injuries = readJson(path.join(DATA, 'injuries.json'));
const SEASON = board.season,
  PRIOR = SEASON - 1;
const get = async (u) => {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${r.status} ${u}`);
  return r.json();
};
const clean = (n) => String(n).replace(/\.$/, '');
const key = (n) =>
  String(n)
    .replace(/\s+(Jr|Sr|II|III|IV|V)\.?$/i, '')
    .trim()
    .toLowerCase();

// ---- ESPN team ids ---------------------------------------------------------------------------
const teamsApi = await get(
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=40',
);
const espnId = {};
for (const t of teamsApi.sports[0].leagues[0].teams) espnId[t.team.abbreviation] = t.team.id;
espnId.WSH ??= espnId.WAS;
espnId.WAS ??= espnId.WSH;

// ---- games still to play, with expected touchdowns per side ---------------------------------
const upcoming = board.games.filter(
  (g) =>
    g.status?.state !== 'STATUS_FINAL' &&
    g.status?.state !== 'STATUS_IN_PROGRESS' &&
    Date.parse(g.kickoff) > Date.now(),
);
const teams = {};
for (const g of upcoming) {
  const hp =
    g.live?.spread?.homePoint ??
    -Number(String(g.lines.spread).split(' ').pop()) *
      (String(g.lines.spread).startsWith(g.home.abbr) ? 1 : -1);
  const tot = g.live?.total?.point ?? g.lines.total;
  const homePts = (tot - hp) / 2,
    awayPts = (tot + hp) / 2;
  // Roughly (points - 1.5) / 7.5 touchdowns; a 23.5-point team scores about 2.7.
  const td = (p) => Math.max(0.6, (p - 1.5) / 7.5);
  teams[g.home.abbr] = {
    abbr: g.home.abbr,
    game: g.id,
    opp: g.away.abbr,
    pts: homePts,
    mu: td(homePts),
    id: espnId[g.home.abbr],
  };
  teams[g.away.abbr] = {
    abbr: g.away.abbr,
    game: g.id,
    opp: g.home.abbr,
    pts: awayPts,
    mu: td(awayPts),
    id: espnId[g.away.abbr],
  };
}

// ---- this season's usage from play-by-play --------------------------------------------------
const usage = {}; // abbr -> name -> {tgt, rush, rzTgt, rzRush, glTgt, glRush, recTd, rushTd, g}
const teamSplit = {}; // abbr -> {pass, rush}
const bump = (t, n, k, v = 1) => {
  usage[t] ??= {};
  const p = (usage[t][n] ??= {
    tgt: 0,
    rush: 0,
    rzTgt: 0,
    rzRush: 0,
    glTgt: 0,
    glRush: 0,
    recTd: 0,
    rushTd: 0,
  });
  p[k] += v;
};
const seenGames = new Set();
for (const t of Object.values(teams)) {
  const sched = await get(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${t.id}/schedule?season=${SEASON}`,
  );
  const done = (sched.events || []).filter(
    (e) => e.competitions?.[0]?.status?.type?.completed && e.seasonType?.type === 2,
  );
  t.games = done.length;
  for (const e of done) {
    if (seenGames.has(e.id)) {
      /* still need this team's side */
    }
    seenGames.add(e.id);
    const s = await get(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${e.id}`,
    );
    teamSplit[t.abbr] ??= { pass: 0, rush: 0 };
    for (const d of s.drives?.previous || []) {
      if (String(d.team?.id) !== String(t.id)) continue;
      for (const p of d.plays || []) {
        const txt = p.text || '';
        const yte = p.start?.yardsToEndzone ?? 0;
        if (yte <= 0 || /timeout|two-minute|end quarter|end of|no play/i.test(txt)) continue;
        const rz = yte <= 20,
          gl = yte <= 5,
          isTd = /TOUCHDOWN/i.test(txt);
        let tgt = null,
          rusher = null;
        const pm = txt.match(/pass (?:\w+ )*?(?:to )([A-Z][\w'-]*\.[A-Z][\w'-]+)/);
        if (/ pass /.test(txt) && pm) tgt = clean(pm[1]);
        else if (
          !/sack|kick|punt|spike|kneel|field goal|extra point|two-point|penalty/i.test(txt)
        ) {
          const rm = txt.match(
            /\(?(?:Shotgun\)\s*)?([A-Z][\w'-]*\.[A-Z][\w'-]+)\s+(?:left|right|up the middle|middle|scrambles)/i,
          );
          if (rm) rusher = clean(rm[1]);
        }
        if (tgt) {
          bump(t.abbr, tgt, 'tgt');
          if (rz) bump(t.abbr, tgt, 'rzTgt');
          if (gl) bump(t.abbr, tgt, 'glTgt');
          if (isTd) {
            bump(t.abbr, tgt, 'recTd');
            teamSplit[t.abbr].pass++;
          }
        }
        if (rusher) {
          bump(t.abbr, rusher, 'rush');
          if (rz) bump(t.abbr, rusher, 'rzRush');
          if (gl) bump(t.abbr, rusher, 'glRush');
        }
      }
    }
    // Rushing touchdowns from the box score: the play text parser misses them.
    const side = (s.boxscore?.players || []).find((x) => String(x.team?.id) === String(t.id));
    const rushCat = (side?.statistics || []).find((c) => c.name === 'rushing');
    const recCat = (side?.statistics || []).find((c) => c.name === 'receiving');
    const fullName = {};
    for (const cat of [rushCat, recCat])
      for (const a of cat?.athletes || []) {
        const st = Object.fromEntries((cat.labels || []).map((l, i) => [l, a.stats[i]]));
        // The play text writes "J.Cook" for James Cook III; the athlete record carries the suffix.
        // Strip it before building the key or every suffixed player loses his usage to his team-mates.
        const parts = a.athlete.displayName
          .replace(/\s+(Jr|Sr|II|III|IV|V)\.?$/i, '')
          .trim()
          .split(' ');
        const short = `${parts[0][0]}.${parts.slice(-1)[0]}`;
        fullName[clean(short)] = a.athlete.displayName;
        if (cat === rushCat && Number(st.TD) > 0) {
          bump(t.abbr, clean(short), 'rushTd', Number(st.TD));
          teamSplit[t.abbr].rush += Number(st.TD);
        }
      }
    t.fullName = Object.assign(t.fullName || {}, fullName);
  }
}

// ---- last season's touchdown totals as a prior -----------------------------------------------
const prior = {}; // displayName -> {recTd, rushTd, gp}
const rosterIds = {};
for (const t of Object.values(teams)) {
  const r = await get(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${t.id}/roster`,
  );
  // The roster endpoint's own injury field is more current than the injuries file: it had Jordan
  // Mason on IR and Puka Nacua doubtful when the file had neither. Out, doubtful and IR are
  // excluded here; a player who is not going to play has no share to give.
  for (const grp of r.athletes || [])
    for (const a of grp.items || [])
      if (/^(QB|RB|WR|TE|FB)$/.test(a.position?.abbreviation || '')) {
        const st = (a.injuries || []).map((x) => String(x.status || '')).join(' ');
        rosterIds[a.displayName] = {
          id: a.id,
          pos: a.position.abbreviation,
          team: t.abbr,
          out: /out|doubtful|injured reserve/i.test(st),
          status: st || 'ok',
        };
      }
}
const wanted = [];
for (const t of Object.values(teams)) {
  const arr = Object.entries(usage[t.abbr] || {})
    .map(([short, u]) => ({ short, u, full: t.fullName?.[short] }))
    .filter((x) => x.full && rosterIds[x.full])
    .sort((a, b) => b.u.tgt + b.u.rush - (a.u.tgt + a.u.rush))
    .slice(0, 7);
  for (const x of arr) wanted.push(x.full);
}
const pool = [...new Set(wanted)];
let i = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (i < pool.length) {
      const nm = pool[i++];
      const aid = rosterIds[nm].id;
      try {
        const s = await get(
          `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${PRIOR}/types/2/athletes/${aid}/statistics`,
        );
        const cats = s.splits?.categories || [];
        const pick = (c, n) =>
          Number(cats.find((x) => x.name === c)?.stats?.find((y) => y.name === n)?.value ?? 0);
        prior[nm] = {
          recTd: pick('receiving', 'receivingTouchdowns'),
          rushTd: pick('rushing', 'rushingTouchdowns'),
          gp: pick('general', 'gamesPlayed') || 17,
        };
      } catch {
        prior[nm] = { recTd: 0, rushTd: 0, gp: 17 };
      }
    }
  }),
);

// ---- shares and probabilities ----------------------------------------------------------------
const OUT = new Set();
for (const [abbr, list] of Object.entries(injuries?.teams || {}))
  for (const p of list)
    if (/^(out|doubtful|injured reserve)$/i.test(p.status || '')) OUT.add(`${abbr}|${key(p.name)}`);
const rows = [];
for (const t of Object.values(teams)) {
  const u = usage[t.abbr] || {};
  const sp = teamSplit[t.abbr] || { pass: 0, rush: 0 };
  // Pass fraction: this season's split regressed toward a 62/38 league split by touchdown count.
  const n = sp.pass + sp.rush;
  const passFrac = (sp.pass + 0.62 * 4) / (n + 4);
  const players = Object.entries(u)
    .map(([short, s]) => ({ short, s, full: t.fullName?.[short] }))
    .filter(
      (x) =>
        x.full &&
        rosterIds[x.full] &&
        !rosterIds[x.full].out &&
        !OUT.has(`${t.abbr}|${key(x.full)}`),
    );
  // Receiving share: red-zone targets (weight 3), overall targets (1), last season's receiving TDs per game x 6.
  const recW = (x) =>
    3 * x.s.rzTgt +
    1 * x.s.tgt +
    6 * ((prior[x.full]?.recTd ?? 0) / (prior[x.full]?.gp || 17)) * 2 +
    2 * x.s.recTd;
  const rushW = (x) =>
    4 * x.s.glRush +
    2 * x.s.rzRush +
    0.3 * x.s.rush +
    6 * ((prior[x.full]?.rushTd ?? 0) / (prior[x.full]?.gp || 17)) * 2 +
    2 * x.s.rushTd;
  const recSum = players.reduce((a, x) => a + recW(x), 0) || 1;
  const rushSum = players.reduce((a, x) => a + rushW(x), 0) || 1;
  for (const x of players) {
    if (OUT.has(`${t.abbr}|${key(x.full)}`) || rosterIds[x.full]?.out) continue;
    const q = (recW(x) / recSum) * passFrac + (rushW(x) / rushSum) * (1 - passFrac);
    const xx = t.mu * q;
    rows.push({
      team: t.abbr,
      game: t.game,
      opp: t.opp,
      name: x.full,
      pos: rosterIds[x.full].pos,
      teamTd: +t.mu.toFixed(2),
      share: +q.toFixed(3),
      expTd: +xx.toFixed(2),
      p1: +(1 - Math.exp(-xx)).toFixed(3),
      p2: +(1 - Math.exp(-xx) * (1 + xx)).toFixed(3),
      usage: {
        tgt: x.s.tgt,
        rzTgt: x.s.rzTgt,
        glTgt: x.s.glTgt,
        rush: x.s.rush,
        rzRush: x.s.rzRush,
        glRush: x.s.glRush,
        td: x.s.recTd + x.s.rushTd,
        lastYr: (prior[x.full]?.recTd ?? 0) + (prior[x.full]?.rushTd ?? 0),
        lastYrGp: prior[x.full]?.gp,
      },
    });
  }
}
rows.sort((a, b) => b.p2 - a.p2);
const file = path.join(DATA, `td2-week${String(board.week).padStart(2, '0')}.json`);
fs.writeFileSync(
  file,
  JSON.stringify({ builtAt: new Date().toISOString(), week: board.week, rows }, null, 1),
);
console.log(
  `${rows.length} players across ${Object.keys(teams).length} teams. Top 30 by P(2+ TD), usage only:\n`,
);
console.log(
  '  #  player                 team  game      teamTD share  E[TD]  P(1+)  P(2+)  | this yr: tgt/RZ/GL  rush/RZ/GL  TD | last yr TD (gp)',
);
rows
  .slice(0, 30)
  .forEach((r, k) =>
    console.log(
      `  ${String(k + 1).padStart(2)} ${r.name.padEnd(22)} ${r.team.padEnd(4)} ${r.game.padEnd(9)} ${String(r.teamTd).padStart(5)} ${(r.share * 100).toFixed(0).padStart(4)}%  ${String(r.expTd).padStart(5)}  ${(r.p1 * 100).toFixed(0).padStart(4)}%  ${(r.p2 * 100).toFixed(1).padStart(5)}%  | ${String(r.usage.tgt).padStart(2)}/${r.usage.rzTgt}/${r.usage.glTgt}   ${String(r.usage.rush).padStart(2)}/${r.usage.rzRush}/${r.usage.glRush}   ${r.usage.td}  | ${r.usage.lastYr} (${r.usage.lastYrGp})`,
    ),
  );
