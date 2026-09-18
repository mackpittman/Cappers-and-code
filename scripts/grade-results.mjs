// Grades the week's research against ESPN's final box scores. Real results only; nothing is
// claimed until the game is final. Writes data/results/<season>-w<week>.json and updates
// data/results/record.json (season running record). Free feed, no credits.
import path from 'node:path';
import fs from 'node:fs';
import { DATA, ROOT, readJson, writeJson, getJson, normName, nowIso } from './lib.mjs';
import { parseStatLeg, gradeStatLeg } from './leg-grade.mjs';
import { twoPlusProb } from './parlays.mjs';

const research = readJson(path.join(ROOT, 'src', 'data', 'research.json'));
const season = research.season,
  week = research.week;
const outFile = path.join(DATA, 'results', `${season}-w${String(week).padStart(2, '0')}.json`);
const recordFile = path.join(DATA, 'results', 'record.json');
const previous = readJson(outFile, { items: [] });

const items = [];
const summaries = {};
for (const g of research.games) {
  const r = await getJson(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${g.espnId}`,
    { timeoutMs: 60000 },
  );
  if (!r.ok) {
    console.error(`summary ${g.id} failed (${r.status})`);
    continue;
  }
  summaries[g.id] = r.body;
}
function finalScore(g) {
  const s = summaries[g.id];
  if (!s) return null;
  const comp = s.header?.competitions?.[0];
  if (comp?.status?.type?.name !== 'STATUS_FINAL') return null;
  const away = comp.competitors.find((c) => c.homeAway === 'away'),
    home = comp.competitors.find((c) => c.homeAway === 'home');
  return {
    away: Number(away.score),
    home: Number(home.score),
    awayAbbr: away.team.abbreviation,
    homeAbbr: home.team.abbreviation,
  };
}
function tdScorers(g) {
  return new Set(tdCounts(g).keys());
}
/** Touchdowns per player from the scoring summary (offensive TDs credited to the scorer). */
function tdCounts(g) {
  const s = summaries[g.id];
  const out = new Map();
  for (const p of s?.scoringPlays || []) {
    if (p.scoringType?.name !== 'touchdown') continue;
    // "Kyren Williams 5 Yd Rush (...)" or "Mike Evans 2 Yd pass from Brock Purdy (...)"
    const m = /^(.+?)\s+\d+\s+Yd\s/i.exec(p.text || '');
    if (m) out.set(normName(m[1]), (out.get(normName(m[1])) ?? 0) + 1);
  }
  return out;
}
function gradeTd2(g, player) {
  return (tdCounts(g).get(normName(player)) ?? 0) >= 2 ? 'win' : 'loss';
}
// Same 2+ conversion we post with, so the graded estimate is the number we actually played.
function stat(g, player, market) {
  const s = summaries[g.id];
  const cat = {
    player_pass_yds: ['passing', 'YDS'],
    player_rush_yds: ['rushing', 'YDS'],
    player_reception_yds: ['receiving', 'YDS'],
    player_receptions: ['receiving', 'REC'],
    player_pass_tds: ['passing', 'TD'],
  }[market];
  if (!cat || !s?.boxscore?.players) return null;
  for (const t of s.boxscore.players)
    for (const st of t.statistics) {
      if (st.name !== cat[0]) continue;
      const idx = st.labels.indexOf(cat[1]);
      for (const a of st.athletes)
        if (normName(a.athlete.displayName) === normName(player)) return Number(a.stats[idx]);
    }
  return 0; // player dressed but no line in that category counts as zero
}
const teamAbbr = (g, abbr) =>
  abbr === g.away.abbr ? 'away' : abbr === g.home.abbr ? 'home' : null;
function gradeSide(g, text, sc) {
  // "DEN +2.5", "PHI -5.5", "SF +3.5", "Colts ML" style handled by abbr + number.
  const m = /^([A-Z]{2,3})\s*([+-]\d+(\.\d+)?)/.exec(text);
  if (!m) return null;
  const side = teamAbbr(g, m[1]);
  if (!side) return null;
  const line = Number(m[2]);
  const margin = side === 'away' ? sc.away - sc.home : sc.home - sc.away;
  const adj = margin + line;
  return adj > 0 ? 'win' : adj < 0 ? 'loss' : 'push';
}
function gradeTotal(text, sc) {
  const m = /^(Over|Under)\s+(\d+(\.\d+)?)/i.exec(text);
  if (!m) return null;
  const total = sc.away + sc.home,
    line = Number(m[2]);
  if (total === line) return 'push';
  return (/over/i.test(m[1]) ? total > line : total < line) ? 'win' : 'loss';
}
function gradeAtd(g, player) {
  return tdScorers(g).has(normName(player)) ? 'win' : 'loss';
}

// Gradings that exist only so a member's slip can settle itself: every player named in a ticket
// leg, whether or not the desk published that player as a pick. They are deliberately NOT part of
// `items`, because summary.all counts items and the desk's record must not move because somebody
// happened to build a parlay around a fourth receiver.
const legItems = [];

for (const g of research.games) {
  const sc = finalScore(g);
  const base = {
    game: g.id,
    gameLabel: `${g.away.abbr}@${g.home.abbr}`,
    final: sc ? `${sc.awayAbbr} ${sc.away}, ${sc.homeAbbr} ${sc.home}` : null,
  };
  const pending = (type, label, extra = {}) =>
    items.push({ ...base, type, label, result: 'pending', ...extra });
  // Best bets (slate-wide list)
  for (const b of (research.bestBets || []).filter((x) => x.game === g.id)) {
    const type = /ATD/.test(b.bet) ? 'atd' : /^(Over|Under)/i.test(b.bet) ? 'total' : 'side';
    if (!sc) {
      pending(type, b.bet, { conf: b.conf, bucket: 'lockedIn' });
      continue;
    }
    let result = null;
    if (type === 'atd') {
      const m = /^(.+?)\s+ATD/.exec(b.bet);
      result = m ? gradeAtd(g, m[1]) : null;
    } else if (type === 'total') result = gradeTotal(b.bet, sc);
    else result = gradeSide(g, b.bet, sc);
    items.push({
      ...base,
      type,
      label: b.bet,
      conf: b.conf,
      bucket: 'lockedIn',
      result: result ?? 'ungraded',
    });
  }
  // Market leans
  const m = g.market || {};
  if (m.side) {
    sc
      ? items.push({
          ...base,
          type: 'side',
          label: m.side,
          conf: m.sideConf,
          bucket: 'lean',
          result: gradeSide(g, m.side, sc) ?? 'ungraded',
        })
      : pending('side', m.side, { conf: m.sideConf, bucket: 'lean' });
  }
  if (m.total) {
    sc
      ? items.push({
          ...base,
          type: 'total',
          label: m.total,
          conf: m.totalConf,
          bucket: 'lean',
          result: gradeTotal(m.total, sc) ?? 'ungraded',
        })
      : pending('total', m.total, { conf: m.totalConf, bucket: 'lean' });
  }
  // TD scorers: top3 (max confidence) and value
  for (const p of g.top3)
    sc
      ? items.push({
          ...base,
          type: 'atd',
          label: `${p.name} ATD`,
          est: p.est,
          bucket: 'top3',
          result: gradeAtd(g, p.name),
        })
      : pending('atd', `${p.name} ATD`, { est: p.est, bucket: 'top3' });
  // 2+ TD calls on the max-confidence scorers (the 2+ TD board is built from these)
  for (const p of g.top3)
    sc
      ? items.push({
          ...base,
          type: 'td2',
          label: `${p.name} 2+ TD`,
          est: twoPlusProb(p.est ?? 0),
          bucket: 'td2',
          result: gradeTd2(g, p.name),
        })
      : pending('td2', `${p.name} 2+ TD`, { est: twoPlusProb(p.est ?? 0), bucket: 'td2' });
  for (const p of g.value)
    sc
      ? items.push({
          ...base,
          type: 'atd',
          label: `${p.name} ATD`,
          est: p.est,
          bucket: 'value',
          result: gradeAtd(g, p.name),
        })
      : pending('atd', `${p.name} ATD`, { est: p.est, bucket: 'value' });
  // Ticket legs. A ticket is a parlay the desk published, and the slip settles one by grading each
  // leg, so every player named in a leg needs an outcome even when they were never a headline pick.
  if (sc) {
    const seen = new Set();
    for (const tk of m.tickets || [])
      for (const leg of tk.legs || []) {
        const raw = leg.label ?? '';
        const atd = /^(.+?)\s+anytime TD$/i.exec(raw);
        const td2 = /^(.+?)\s+2\+\s*TDs?$/i.exec(raw);
        const who = (atd || td2)?.[1];
        if (who) {
          const label = atd ? `${who} ATD` : `${who} 2+ TD`;
          if (seen.has(label)) continue;
          seen.add(label);
          legItems.push({
            ...base,
            type: atd ? 'atd' : 'td2',
            label,
            bucket: 'ticketLeg',
            result: atd ? gradeAtd(g, who) : gradeTd2(g, who),
          });
          continue;
        }
        // Yardage and reception legs. The label is kept verbatim so the slip matches it exactly
        // rather than relying on both sides spelling the market the same way.
        const parsed = parseStatLeg(raw);
        if (!parsed || seen.has(raw)) continue;
        const result = gradeStatLeg(parsed, stat(g, parsed.player, parsed.market));
        if (!result) continue;
        seen.add(raw);
        legItems.push({ ...base, type: 'prop', label: raw, bucket: 'ticketLeg', result });
      }
  }

  // Prop leans
  for (const l of m.propLeans || []) {
    const label = `${l.player} ${l.side} ${l.line} ${l.market.replace('player_', '').replace(/_/g, ' ')}`;
    if (!sc) {
      pending('prop', label, { bucket: 'prop' });
      continue;
    }
    const actual = stat(g, l.player, l.market);
    const result =
      actual == null
        ? 'ungraded'
        : actual === l.line
          ? 'push'
          : (l.side === 'over' ? actual > l.line : actual < l.line)
            ? 'win'
            : 'loss';
    items.push({ ...base, type: 'prop', label, bucket: 'prop', actual, result });
  }
}
function tally(list) {
  const t = { wins: 0, losses: 0, pushes: 0, pending: 0 };
  for (const i of list)
    t[
      i.result === 'win'
        ? 'wins'
        : i.result === 'loss'
          ? 'losses'
          : i.result === 'push'
            ? 'pushes'
            : 'pending'
    ]++;
  return t;
}
const byBucket = {};
for (const b of ['lockedIn', 'lean', 'top3', 'td2', 'value', 'prop'])
  byBucket[b] = tally(items.filter((i) => i.bucket === b));

/**
 * Calibration: for every bucket that carries a model estimate, how often did the calls in each
 * estimate band actually hit? This is what tunes the bell-cow boost and any other haircut. A band
 * where actual runs well above the model average is under-estimated; below is over-estimated.
 */
export function calibrate(rows, edges) {
  const graded = rows.filter(
    (i) => (i.result === 'win' || i.result === 'loss') && typeof i.est === 'number',
  );
  const bands = [];
  for (let k = 0; k < edges.length; k++) {
    const lo = edges[k],
      hi = edges[k + 1] ?? 1.01;
    const inBand = graded.filter((i) => i.est >= lo && i.est < hi);
    if (!inBand.length) continue;
    const wins = inBand.filter((i) => i.result === 'win').length;
    bands.push({
      band: `${Math.round(lo * 100)}-${hi > 1 ? '100' : Math.round(hi * 100)}%`,
      n: inBand.length,
      model: +(inBand.reduce((a, i) => a + i.est, 0) / inBand.length).toFixed(3),
      actual: +(wins / inBand.length).toFixed(3),
      wins,
    });
  }
  return bands;
}
const calibration = {
  td2: calibrate(
    items.filter((i) => i.bucket === 'td2'),
    [0, 0.08, 0.15, 0.25],
  ),
  top3: calibrate(
    items.filter((i) => i.bucket === 'top3'),
    [0, 0.4, 0.5, 0.6],
  ),
};
const week_result = {
  season,
  week,
  gradedAt: nowIso(),
  finals: research.games.filter((g) => finalScore(g)).length,
  games: research.games.length,
  summary: { all: tally(items), ...byBucket, calibration },
  items,
  legs: legItems,
};
writeJson(outFile, week_result);
// Season record: one entry per week, recomputed from files so re-grading is idempotent.
const weeks = fs
  .readdirSync(path.join(DATA, 'results'))
  .filter((f) => /^\d{4}-w\d{2}\.json$/.test(f))
  .map((f) => readJson(path.join(DATA, 'results', f)))
  .sort((a, b) => a.week - b.week);
const record = {
  season,
  updatedAt: nowIso(),
  weeks: weeks.map((w) => ({ week: w.week, finals: w.finals, games: w.games, summary: w.summary })),
  season_totals: {},
};
for (const b of ['all', 'lockedIn', 'lean', 'top3', 'td2', 'value', 'prop']) {
  record.season_totals[b] = weeks.reduce(
    (acc, w) => {
      const s = w.summary[b] || {};
      for (const k of ['wins', 'losses', 'pushes', 'pending']) acc[k] += s[k] || 0;
      return acc;
    },
    { wins: 0, losses: 0, pushes: 0, pending: 0 },
  );
}
writeJson(recordFile, record);
const s = week_result.summary;
for (const [k, bands] of Object.entries(calibration)) {
  const line = bands
    .map(
      (b) =>
        `${b.band} n=${b.n} model ${Math.round(b.model * 100)}% actual ${Math.round(b.actual * 100)}%`,
    )
    .join(' · ');
  if (line) console.log(`calibration ${k}: ${line}`);
}
console.log(
  `graded week ${week}: ${week_result.finals}/${week_result.games} finals · locked in ${s.lockedIn.wins}-${s.lockedIn.losses}-${s.lockedIn.pushes} · top3 ATD ${s.top3.wins}-${s.top3.losses} · 2+ TD ${s.td2.wins}-${s.td2.losses} · leans ${s.lean.wins}-${s.lean.losses}-${s.lean.pushes} · props ${s.prop.wins}-${s.prop.losses}-${s.prop.pushes} · pending ${s.all.pending}`,
);
