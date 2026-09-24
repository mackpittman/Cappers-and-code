// A full single-game sheet: the line and the model's read, the anytime-TD board, the 2+ TD list
// with its break-even cushion, the correlated stacks, a long-shot band and the graded props.
// Built for a night game, where one game is the whole slate and the group wants everything on it.
//
//   GAME=nyg-lar node scripts/build-game.mjs
//   SHEETS_NO_RENDER=1 ...                   skip Chromium
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATA, ROOT, readJson, writeJson, nowIso } from './lib.mjs';
import { fmtPrice, fmtPct, twoPlusLegs, TD2_POSITIONS } from './sheets.mjs';
import {
  atdLegs,
  sideLegs,
  totalLegs,
  toDecimal,
  toAmerican,
  fairAmerican,
  impliedFromAmerican,
} from './parlays.mjs';

const board = readJson(path.join(DATA, 'board.json'));
const odds = readJson(path.join(DATA, 'odds', 'latest.json'));
const GAME = process.env.GAME || 'nyg-lar';
// Players ruled out after the last odds pull. The feed's injury report lags the beat reporters by
// hours on a night game, so this is the manual override: their legs come off every list and the
// sheet says who is out rather than quietly dropping them.
const SCRATCH = new Set(
  (process.env.SCRATCH ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
);
const game = board?.games.find((g) => g.id === GAME);
const evt = odds?.events.find((e) => `${e.away}-${e.home}`.toLowerCase() === GAME);
if (!game || !evt) {
  console.error(`no ${GAME} on the board`);
  process.exit(1);
}
const week = String(board.week).padStart(2, '0');
const stem = `w${week}-${GAME}`;
const SHEETS = path.join(ROOT, 'site', 'sheets');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const et = (iso, o = {}) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', ...o });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const marketAt = evt.markets.player_anytime_td?.fetchedAt ?? board.oddsFetchedAt;
const stamp = (iso) =>
  et(iso, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).toUpperCase();
const pulledAt = stamp(marketAt);
// Which window this game sits in, from its own kickoff. Hard-coding it meant a Thursday sheet
// carried a MONDAY NIGHT banner.
const kickEt = new Date(game.kickoff);
const kickDay = et(game.kickoff, { weekday: 'long' }).toUpperCase();
const kickHour = Number(et(game.kickoff, { hour: 'numeric', hour12: false }));
const slot = kickHour >= 19 ? `${kickDay} NIGHT` : kickHour >= 16 ? `${kickDay} LATE` : kickDay;
const soloNight = kickHour >= 19 && /THURSDAY|SUNDAY|MONDAY/.test(kickDay);
const linesAt = stamp(board.oddsFetchedAt);
const staleMin = Math.round((Date.parse(board.oddsFetchedAt) - Date.parse(marketAt)) / 60000);
const evPct = (x) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
const VIG = 0.93; // a lone anytime price carries roughly 7% hold once the book's whole board is summed

// The board's lines.implied has its away/home keys swapped on every game, so derive the split from
// the spread and the total, which cannot be ambiguous.
const spreadNow = sideLegs(board).find((l) => l.game === GAME);
const totalNow = totalLegs(board).find((l) => l.game === GAME);
const totalNum = Number(/([\d.]+)/.exec(totalNow.label)[1]);
const sideRaw = Number(spreadNow.label.split(' ').pop());
const sideNum = Math.abs(sideRaw);
// Who is favoured comes from the sign on the number, not from which side the desk took. Reading it
// off spreadNow.team assumed the desk is always on the dog, so on a game where we lay the points
// the implied split printed backwards — GB -6 came out as ATL 25.25 / GB 19.25.
const favAbbr =
  sideRaw < 0
    ? spreadNow.team
    : spreadNow.team === game.home.abbr
      ? game.away.abbr
      : game.home.abbr;
const dogAbbr = favAbbr === game.home.abbr ? game.away.abbr : game.home.abbr;
const favPts = (totalNum + sideNum) / 2;
const dogPts = (totalNum - sideNum) / 2;

// ---------- what changed since the research went out ----------
// A card built on game day is not a research card. The desk prose was written on Tuesday and says
// "closer to 39 than 44.5"; by kickoff the number itself has moved and the final injury report has
// landed. Both belong on the card, because a reader comparing it to their book needs to know which
// number we are on and a stale total reads as a mistake.
const research = game.lines ?? {};
const researchSide = research.spread ?? null;
const researchTotal = research.total ?? null;
const movedSide =
  researchSide && researchSide !== spreadNow.label ? `${researchSide} → ${spreadNow.label}` : null;
const movedTotal =
  researchTotal != null && Number(researchTotal) !== totalNum
    ? `${researchTotal} → ${totalNum}`
    : null;
const injuries = readJson(path.join(DATA, 'injuries.json'));
const DESIGNATED = /^(out|doubtful|questionable|injured reserve)$/i;
const designations = [game.away.abbr, game.home.abbr].flatMap((abbr) =>
  (injuries?.teams?.[abbr] ?? [])
    .filter((p) => DESIGNATED.test(p.status ?? ''))
    .map((p) => ({ abbr, ...p })),
);
// Out and Doubtful first, then Questionable; IR last since it is not news on the day.
const RANK = { out: 0, doubtful: 1, questionable: 2, 'injured reserve': 3 };
designations.sort(
  (a, b) => (RANK[a.status.toLowerCase()] ?? 9) - (RANK[b.status.toLowerCase()] ?? 9),
);

// ---------- legs ----------
const bookOf = (market, name) =>
  Object.values(evt.markets[market]?.players ?? {}).find((p) => p.name === name)?.books ?? {};
const bestOf = (bk) => {
  const k = Object.keys(bk)
    .filter((b) => bk[b] != null)
    .sort((a, b) => bk[b] - bk[a])[0];
  return k ? { price: bk[k], book: k === 'fanduel' ? 'FD' : k === 'draftkings' ? 'DK' : k } : null;
};
// The odds feed writes "Kyle Pitts" where the research writes "Kyle Pitts Sr.", so every lookup
// between the two is keyed on the name with its generational suffix stripped. Without this the
// desk's own estimate for Pitts never reached the card and he printed as "— · — · MARKET".
const key = (name) =>
  String(name)
    .replace(/\s+(Jr|Sr|II|III|IV|V)\.?$/i, '')
    .trim()
    .toLowerCase();
const modelBy = Object.fromEntries(
  atdLegs(board)
    .filter((l) => l.game === GAME)
    .map((l) => [key(l.player), l]),
);
// modelBy only covers the players the desk wrote an estimate for. Everyone else on the book's board
// still has a team on the research board, and "— · —" under a name reads like missing data rather
// than a name we simply did not write a number on.
const teamBy = Object.fromEntries((game.atdBoard ?? []).map((p) => [key(p.name), p.team]));
const posBy = Object.fromEntries(
  [...(game.top3 ?? []), ...(game.value ?? [])]
    .filter((p) => p.pos)
    .map((p) => [key(p.name), p.pos]),
);
const anytime = Object.values(evt.markets.player_anytime_td?.players ?? {})
  .map((p) => p.name)
  .filter((n) => !/D\/ST|Defense/.test(n))
  .filter((n) => !SCRATCH.has(n))
  .map((name) => {
    const b = bestOf(bookOf('player_anytime_td', name));
    if (!b) return null;
    const m = modelBy[key(name)];
    const implied = impliedFromAmerican(b.price);
    const prob = m ? m.prob : implied * VIG;
    return {
      kind: 'atd',
      label: `${name} anytime TD`,
      name,
      team: m?.team ?? teamBy[key(name)] ?? null,
      pos: m?.pos ?? posBy[key(name)] ?? null,
      price: b.price,
      book: b.book,
      implied,
      prob,
      source: m ? 'model' : 'market',
      edge: prob - implied,
    };
  })
  .filter(Boolean)
  .sort((a, b) => b.prob - a.prob);
const A = Object.fromEntries(anytime.map((l) => [l.name, l]));

const twoPlus = twoPlusLegs(atdLegs(board).filter((l) => l.game === GAME && !SCRATCH.has(l.player)))
  .filter((l) => TD2_POSITIONS.has(l.pos))
  .map((l) => ({
    kind: 'td2',
    label: `${l.player} 2+ TDs`,
    name: l.player,
    team: l.team,
    pos: l.pos,
    price: l.price,
    book: l.book,
    implied: l.implied,
    prob: l.prob,
    source: 'model',
    ev: l.prob * toDecimal(l.price) - 1,
    fair: fairAmerican(l.prob),
    breakEven: impliedFromAmerican(l.price),
  }))
  .sort((a, b) => b.ev * Math.sqrt(b.prob) - a.ev * Math.sqrt(a.prob));

const side = {
  kind: 'side',
  label: spreadNow.label,
  name: spreadNow.label,
  price: spreadNow.price,
  book: spreadNow.book,
  implied: spreadNow.implied,
  prob: spreadNow.prob,
  source: 'model',
};
const total = {
  kind: 'total',
  label: totalNow.label.replace(` ${game.away.abbr}@${game.home.abbr}`, ''),
  name: totalNow.label,
  price: totalNow.price,
  book: totalNow.book,
  implied: totalNow.implied,
  prob: totalNow.prob,
  source: 'model',
};

// Props the desk wrote a lean on, priced where the market carries that line.
const props = (game.propLines ?? [])
  .filter((p) => !SCRATCH.has(p.name))
  .map((p) => {
    const lean =
      p.lean ??
      (game.market.propLeans ?? []).find((x) => x.player === p.name && x.market === p.market);
    if (!lean) return null;
    const over = lean.side === 'over';
    return {
      kind: 'prop',
      name: p.name,
      market: p.label ?? p.market,
      line: p.line,
      side: lean.side,
      label: `${p.name} ${over ? 'Over' : 'Under'} ${p.line}`,
      price: over ? p.over : p.under,
      book: 'FD/DK',
      // A prop that ends up inside a stack needs a probability like any other leg. Without one the
      // stack's hit rate and EV both came out NaN and printed that way.
      implied: over ? impliedFromAmerican(p.over) : impliedFromAmerican(p.under),
      prob: (over ? impliedFromAmerican(p.over) : impliedFromAmerican(p.under)) * VIG,
      source: 'market',
      why: lean.why,
      deskLine: lean.line ?? null,
    };
  })
  .filter(Boolean);
const propLeg = (player, market, wantSide) => {
  const p = (game.propLines ?? []).find((x) => x.name === player && x.market === market);
  if (!p) return null;
  const over = wantSide === 'over';
  const price = over ? p.over : p.under;
  if (price == null) return null;
  const implied = impliedFromAmerican(price);
  return {
    kind: 'prop',
    label: `${player} ${over ? 'Over' : 'Under'} ${p.line}`,
    name: player,
    price,
    book: 'FD/DK',
    implied,
    prob: implied * VIG,
    source: 'market',
  };
};

// ---------- stacks ----------
const priceStack = (legs) => {
  const dec = legs.reduce((d, l) => d * toDecimal(l.price), 1);
  const prob = legs.reduce((p, l) => p * l.prob, 1);
  return { legs, dec, price: toAmerican(dec), prob, implied: 1 / dec, ev: prob * dec - 1 };
};
// Stacks come from the game's own research rather than a hand-written list. The first version of
// this file carried four stacks named for one specific game ("Dart in the red zone", "Rams
// script"); pointed at any other game they resolved to nothing and the sheet printed no stacks at
// all while reporting success. So each researched stack's legs are resolved against the legs this
// sheet actually prices, and a stack whose legs cannot all be resolved is named in the log with the
// leg that failed, rather than dropped as "a leg has no price".
const TOTAL_RE = /^(over|under)\s+([\d.]+)/i;
const resolveLeg = (text) => {
  const t = String(text).trim();

  // "Under 44.5" / "Over 44.5 total points" — only the side the desk is actually on.
  const tm = TOTAL_RE.exec(t);
  if (tm) {
    const want = tm[1].toLowerCase();
    const have = /under/i.test(total.label) ? 'under' : 'over';
    return want === have ? total : { fail: `${t} is the other side of ${total.label}` };
  }

  // "Packers -6", "Bengals -3.5", "GB -6" — again only the side the desk is on.
  if (/[+-]\d/.test(t) && !/\b(yards?|receptions?|touchdowns?)\b/i.test(t)) {
    const teams = [game.away, game.home];
    const named = teams.find(
      (x) => t.startsWith(`${x.abbr} `) || new RegExp(`\\b${x.short}\\b`, 'i').test(t),
    );
    if (named)
      return named.abbr === side.label.split(' ')[0] ? side : { fail: `${t} is not our side` };
  }

  // "Bijan Robinson anytime TD" / "Tucker Kraft anytime touchdown" — match on the player name.
  const hit = anytime.find((l) => t.toLowerCase().startsWith(l.name.toLowerCase()));
  if (hit) {
    if (/\b2\+|two\b/i.test(t)) {
      const two = twoPlus.find((l) => l.name === hit.name);
      return two ?? { fail: `no 2+ price for ${hit.name}` };
    }
    if (/anytime|touchdown|\bTD\b/i.test(t)) return hit;
  }

  // "Chris Olave over receiving yards", "Cade Otton over 3.5 receptions" — the desk's own props.
  const prop = props.find((x) => t.toLowerCase().startsWith(x.name.toLowerCase()));
  if (prop && prop.price != null) return prop;

  return { fail: `could not resolve "${t}"` };
};

const DEFS = [
  {
    name: 'The model stack',
    corr: 'positive',
    why: `Both of the desk's own calls on this game, at confidence ${spreadNow.conf} and ${totalNow.conf}. ${game.market.why.split('. ').slice(-1)[0]}`,
    legs: () => [side, total],
  },
  ...(game.stacks ?? []).map((st) => ({
    name: null, // derived from the resolved legs below; the research text is a full sentence

    corr: st.type === 'sgp' ? 'positive' : 'mixed',
    why: st.why,
    legs: () => st.legs.map(resolveLeg),
  })),
];
// The label beside a stack is a narrow column, so it gets last names and the bare side, not the
// researcher's full leg sentence ("CHRISTIAN WATSON ANYTIME TD + PACKERS -6" wrapped to six lines).
// Surname, ignoring a generational suffix: the naive last word turned "Michael Penix Jr." into
// "Jr." and the stack read "Kraft + Jr. un".
const surname = (full) => {
  const parts = String(full)
    .split(' ')
    .filter((w) => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(w));
  return parts[parts.length - 1] ?? full;
};
const shortLeg = (l) =>
  l.kind === 'atd'
    ? surname(l.name)
    : l.kind === 'td2'
      ? `${surname(l.name)} 2+`
      : l.kind === 'prop'
        ? `${surname(l.name)} ${l.side === 'over' ? 'ov' : 'un'}`
        : l.label;

const stacks = [];
for (const d of DEFS) {
  const legs = d.legs();
  const bad = legs.find((l) => !l || l.fail || l.price == null);
  if (bad) {
    console.log(
      `skipped stack "${d.name ?? d.why.slice(0, 60)}": ${bad?.fail ?? 'a leg has no price'}`,
    );
    continue;
  }
  const name = d.name ?? legs.map(shortLeg).join(' + ');
  const t = priceStack(legs);
  if (t.ev <= 0) {
    console.log(
      `skipped stack "${name}": ${Math.round(t.ev * 100)}% EV, the market prices its legs above our number`,
    );
    continue;
  }
  stacks.push({ ...d, ...t, name });
}

// ---------- the long-shot band ----------
const BAND = [Number(process.env.BAND_LO ?? 3000), Number(process.env.BAND_HI ?? 6000)];
const pool = [...twoPlus, ...anytime.slice(0, 8), total, side];
const combos = [];
for (let i = 0; i < pool.length; i++)
  for (let j = i + 1; j < pool.length; j++)
    for (let k = j + 1; k < pool.length; k++) {
      const legs = [pool[i], pool[j], pool[k]];
      if (new Set(legs.map((l) => l.name)).size < 3) continue;
      if (!legs.some((l) => l.source === 'model' && l.prob - l.implied > 0.02)) continue;
      const t = priceStack(legs);
      if (t.price < BAND[0] || t.price > BAND[1] || t.ev <= 0) continue;
      combos.push(t);
    }
combos.sort((a, b) => b.prob - a.prob);
const longs = [];
const used = new Map();
for (const t of combos) {
  if (t.legs.some((l) => (used.get(l.name) ?? 0) >= 3)) continue;
  longs.push(t);
  for (const l of t.legs) used.set(l.name, (used.get(l.name) ?? 0) + 1);
  if (longs.length === 4) break;
}

const fades = anytime
  .filter((l) => l.source === 'model' && l.edge < -0.05)
  .sort((a, b) => a.edge - b.edge);
const out = {
  builtAt: nowIso(),
  fades,
  game: GAME,
  oddsFetchedAt: board.oddsFetchedAt,
  side,
  total,
  anytime,
  twoPlus,
  stacks,
  longs,
  props,
};
writeJson(path.join(DATA, 'sheets', `${board.season}-w${week}-${GAME}.json`), out);

// ---------- render ----------
const legHtml = (l) =>
  `<span class="leg">${esc(l.label)} <b>${fmtPrice(l.price)}</b><i>${esc(l.book)} · ${fmtPct(l.prob)} ${l.source === 'model' ? 'model' : 'market'} vs ${fmtPct(l.implied)}</i></span>`;
const stackHtml = (t, tag) =>
  `<div class="tk"><div class="hd"><span class="tag">${esc(tag)}</span><span class="legs">${t.legs.map(legHtml).join('')}</span><span class="odds">${fmtPrice(t.price)}</span></div><div class="ft"><span><b>${fmtPct(t.prob)}</b> MODEL HIT</span><span class="m"><b>${fmtPct(t.implied)}</b> BOOK</span><span class="ev"><b>${evPct(t.ev)}</b> EV</span>${t.why ? `<span class="why">${esc(t.why)}</span>` : ''}</div></div>`;
const atdRows = anytime
  .slice(0, 12)
  .map(
    (l, i) =>
      `<tr><td class="p">${i + 1}</td><td class="n">${esc(l.name)}<small>${esc(l.team ?? '—')} · ${esc(l.pos ?? '—')} · ${l.source}</small></td><td class="r p">${fmtPrice(l.price)} ${esc(l.book)}</td><td class="r e">${fmtPct(l.prob)}</td><td class="r">${fmtPct(l.implied)}</td><td class="r ${l.edge > 0 ? 'e' : 'bad'}">${evPct(l.edge)}</td></tr>`,
  )
  .join('\n');
const td2Rows = twoPlus
  .map(
    (l, i) =>
      `<tr><td class="p">${i + 1}</td><td class="n">${esc(l.name)}<small>${esc(l.team)} · ${esc(l.pos)} · anytime ${fmtPrice(A[l.name]?.price ?? 0)}</small></td><td class="r p">${fmtPrice(l.price)} ${esc(l.book)}</td><td class="r e">${fmtPct(l.prob)}</td><td class="r">${fmtPct(l.breakEven)}</td><td class="r ${l.prob - l.breakEven < 0 ? 'bad' : l.prob - l.breakEven > 0.08 ? 'e' : 'warn'}">${Math.round((l.prob - l.breakEven) * 100)} pts</td><td class="r ${l.ev > 0 ? 'e' : 'bad'}">${evPct(l.ev)}</td></tr>`,
  )
  .join('\n');
const propRows = props
  .map(
    (p) =>
      `<tr><td class="n">${esc(p.label)}<small>${esc(p.market)}${p.deskLine && p.deskLine !== p.line ? ` · desk wrote ${p.deskLine}` : ''}</small></td><td class="r p">${p.price != null ? fmtPrice(p.price) : '—'}</td><td class="w">${esc(p.why)}</td></tr>`,
  )
  .join('\n');
// Styles are borrowed from an existing sheet so every card in a week looks identical. This used to
// read w<week>-sunday.html unconditionally, which does not exist on a Thursday — the first sheet of
// a week crashed on its own stylesheet. Prefer that file, then the newest sheet of any week.
const cssSource =
  [`w${week}-sunday.html`, `w${week}-mnf.html`]
    .map((f) => path.join(SHEETS, f))
    .find((f) => fs.existsSync(f)) ??
  fs
    .readdirSync(SHEETS)
    .filter((f) => f.endsWith('.html'))
    .map((f) => path.join(SHEETS, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    .find((f) => /<style>/.test(fs.readFileSync(f, 'utf8')));
if (!cssSource) {
  console.error('no existing sheet to take the stylesheet from');
  process.exit(1);
}
const css = fs.readFileSync(cssSource, 'utf8').match(/<style>[\s\S]*?<\/style>/)[0];
const html = `<!doctype html>
<html><head><meta charset="utf-8" /><title>Cappers &amp; Code · ${esc(game.away.abbr)} @ ${esc(game.home.abbr)}</title>
${css}
<style>
  .tk .ft .why { flex: 1; color: #9DA59D; letter-spacing: 0; font-family: 'Manrope'; font-size: 13.5px; font-weight: 500; text-transform: none; text-align: right; line-height: 1.45; }
  .tk .hd { grid-template-columns: 92px 1fr 160px; }
  .line { display: flex; gap: 40px; margin: 14px 0 0; font-family: 'JetBrains Mono'; font-size: 15px; letter-spacing: 2px; color: #9DA59D; }
  .line b { color: #B6FF00; font-size: 22px; margin-right: 8px; }
  .out { border-left: 4px solid #E06060; background: #170D0D; padding: 12px 20px; margin: 16px 0 0; color: #E8C8C8; font-size: 15px; line-height: 1.5; font-family: 'Manrope'; }
  .out b { font-family: 'JetBrains Mono'; color: #E06060; letter-spacing: 2px; margin-right: 10px; }
  .read { border-left: 4px solid #B6FF00; background: #0B0E10; padding: 16px 22px; margin: 18px 0 0; color: #C8CFC8; font-size: 16px; line-height: 1.55; }
  table.td td.bad { color: #E06060; }
  table.td td.warn { color: #E0C040; }
  table.td td.w { font-size: 13.5px; color: #9DA59D; line-height: 1.45; padding-left: 18px; }
  .moved { margin: 16px 0 0; padding: 14px 20px; border: 1px solid rgba(182,255,0,.35); border-left: 4px solid #B6FF00; border-radius: 10px; background: #0B0E0C; }
  .moved b { font-family: 'JetBrains Mono'; font-weight: 700; font-size: 15px; letter-spacing: 3px; color: #B6FF00; margin-right: 22px; }
  .moved .m { font-family: 'JetBrains Mono'; font-weight: 500; font-size: 14px; letter-spacing: 2px; color: #9DA59D; margin-right: 26px; }
  .moved .m i { font-style: normal; font-weight: 700; color: #F5F7F2; }
  .moved .inj { margin-top: 12px; font-family: 'Manrope'; font-size: 13.5px; color: #9DA59D; line-height: 1.7; }
  .moved .inj .o { font-family: 'JetBrains Mono'; font-weight: 700; font-size: 11.5px; letter-spacing: 1.5px; color: #E06060; }
  .moved .inj .q { font-family: 'JetBrains Mono'; font-weight: 700; font-size: 11.5px; letter-spacing: 1.5px; color: #E0C040; }
  .read .note { display: block; margin-top: 12px; font-size: 13.5px; color: #79E000; font-family: 'JetBrains Mono'; font-weight: 500; letter-spacing: 0.5px; }
</style></head>
<body>
<section class="card" id="game">
  <div class="brand"><img src="../promo/assets/lockup.png" alt="Cappers &amp; Code"><span>WEEK ${board.week} · ${slot}</span></div>
  <h1>${esc(game.away.abbr)} @ ${esc(game.home.abbr)}, <span>the whole sheet</span></h1>
  <p class="sub">Every play we have on ${soloNight ? "tonight's only game" : 'this game'}: ${[
    `the board`,
    `the anytime board`,
    twoPlus.length ? `the 2+ list` : null,
    stacks.length ? `${stacks.length} stack${stacks.length === 1 ? '' : 's'}` : null,
    longs.length ? `the long-shot band` : null,
  ]
    .filter(Boolean)
    .join(', ')
    .replace(
      /, ([^,]*)$/,
      ' and $1',
    )}. Player prices are FanDuel/DraftKings as of ${pulledAt} ET${staleMin > 90 ? `, the last time this game's props were pulled; the line and total are current to ${linesAt} ET` : ''}. A same-game parlay engine reprices a stack; the model numbers hold. Units, not dollars.</p>
  ${SCRATCH.size ? `<div class="out"><b>OUT</b> ${esc([...SCRATCH].join(', '))} &mdash; removed from every list below. Prices for his team-mates are the book's pre-news numbers, so they understate the players absorbing the work.</div>` : ''}
  <div class="line"><span><b>${esc(spreadNow.label)}</b> SIDE ${spreadNow.conf}/5</span><span><b>${esc(total.label)}</b> TOTAL ${totalNow.conf}/5</span><span><b>${esc(favAbbr)} ${favPts}</b> · <b>${esc(dogAbbr)} ${dogPts}</b> IMPLIED</span></div>
  ${
    movedSide || movedTotal || designations.length
      ? `<div class="moved">
    <b>SINCE TUESDAY</b>
    ${movedSide ? `<span class="m">SIDE <i>${esc(movedSide)}</i></span>` : ''}
    ${movedTotal ? `<span class="m">TOTAL <i>${esc(movedTotal)}</i></span>` : ''}
    ${
      designations.length
        ? `<div class="inj">${designations
            .map(
              (p) =>
                `<span class="${/^out|doubtful/i.test(p.status) ? 'o' : 'q'}">${esc(p.status.replace('Injured Reserve', 'IR').toUpperCase())}</span> ${esc(p.abbr)} ${esc(p.pos)} ${esc(p.name)}`,
            )
            .join(' &middot; ')}</div>`
        : ''
    }
  </div>`
      : ''
  }
  <div class="read">${esc(game.market.why)}${movedTotal || movedSide ? `<span class="note">Written Tuesday, before the market moved. The numbers in the header are the ones we are on.</span>` : ''}</div>

  <h2>Anytime TD <small>top 12 · model against the price</small></h2>
  <p class="rule">"Model" is our own number where the desk wrote one, and the book price with the hold stripped where it did not. Edge is the gap. A negative edge is a name the market likes more than we do.</p>
  <table class="td">
    <tr><th>#</th><th>Player</th><th class="r">Anytime</th><th class="r">Model</th><th class="r">Implied</th><th class="r">Edge</th></tr>
    ${atdRows}
  </table>

  ${
    td2Rows
      ? `<h2>2+ touchdowns <small>backs and quarterbacks · with the cushion</small></h2>
  <p class="rule">Break-even is what the price needs to be worth playing. Cushion is how many points of model edge sit above it. The 2+ model is 5-34 on the season and 0 for 3 in its top band, so a thin cushion is a pass, not a coin flip.</p>
  <table class="td">
    <tr><th>#</th><th>Player</th><th class="r">2+ price</th><th class="r">Model</th><th class="r">Break-even</th><th class="r">Cushion</th><th class="r">EV</th></tr>
    ${td2Rows}
  </table>`
      : ''
  }

  <h2>The stacks <small>${stacks.length} · correlated by design</small></h2>
  <p class="rule">Each one is a single idea about how this game goes, bet more than once. Priced as if the legs were independent, which is the honest floor: a positively correlated stack hits more often than the number below and your book will shorten the payout to match.</p>
  ${stacks.map((t) => stackHtml(t, t.name.toUpperCase())).join('\n')}

  ${
    longs.length
      ? `<h2>Long shots <small>${longs.length} tickets · ${fmtPrice(BAND[0])} to ${fmtPrice(BAND[1])}</small></h2>
  <p class="rule">Three legs each, drawn from the lists above, ranked by how often the model hits them. No player carries more than three tickets.</p>
  ${longs.map((t, i) => stackHtml(t, `#${i + 1}`)).join('\n')}`
      : ''
  }

  ${
    fades.length
      ? `<h2>What we are off <small>the desk is ${fades.length === 1 ? 'a long way' : 'well'} under the market here</small></h2>
  <p class="rule">These carry a real desk number and the market is pricing them well above it. They are not plays to fade outright at these prices, they are names to leave out of a stack.</p>
  <table class="td">
    <tr><th>Player</th><th class="r">Anytime</th><th class="r">Model</th><th class="r">Implied</th><th class="r">Gap</th></tr>
    ${fades.map((l) => `<tr><td class="n">${esc(l.name)}<small>${esc(l.team ?? '')} · ${esc(l.pos ?? '')}</small></td><td class="r p">${fmtPrice(l.price)} ${esc(l.book)}</td><td class="r">${fmtPct(l.prob)}</td><td class="r">${fmtPct(l.implied)}</td><td class="r bad">${evPct(l.edge)}</td></tr>`).join('\n')}
  </table>`
      : ''
  }

  ${
    propRows
      ? `<h2>Props <small>the desk's written leans</small></h2>
  <table class="td">
    <tr><th>Prop</th><th class="r">Price</th><th>Why</th></tr>
    ${propRows}
  </table>`
      : ''
  }

  <div class="foot"><span>UNITS, NOT DOLLARS</span><span>${staleMin > 90 ? `PROPS ${pulledAt} ET · LINE ${linesAt} ET` : `PRICED ${pulledAt} ET`} · CAPPERSANDCODE.COM</span></div>
</section>
</body></html>
`;
const htmlFile = path.join(SHEETS, `${stem}.html`);
fs.writeFileSync(htmlFile, html);
let height = null;
if (!process.env.SHEETS_NO_RENDER) {
  const png = path.join(SHEETS, `${stem}.png`);
  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--virtual-time-budget=4000',
      '--window-size=1200,5200',
      `--screenshot=${png}`,
      `file://${htmlFile}#game`,
    ],
    { stdio: 'ignore' },
  );
  height = Number(
    execFileSync('python3', [
      '-c',
      `
from PIL import Image
im = Image.open(${JSON.stringify(png)}).convert('RGB'); w, h = im.size; px = im.load(); b = h - 1
while b > 0 and all(px[x, b] == (5, 6, 8) for x in range(0, w, 8)): b -= 1
cut = min(h, b + 40); im.crop((0, 0, w, cut)).save(${JSON.stringify(png)}); print(cut)`,
    ])
      .toString()
      .trim(),
  );
}
const indexFile = path.join(SHEETS, 'index.json');
const index = readJson(indexFile, { updatedAt: null, sheets: [] });
const id = `${board.season}-w${week}-${GAME}`;
// A night sheet is the whole slate, so it leads the Edge tab by default. Exactly one sheet may
// carry the flag, or the front page shows whichever the index happens to list first.
const feature = process.env.FEATURED !== '0';
index.sheets = [
  {
    id,
    week: board.week,
    season: board.season,
    title: `Week ${board.week}: ${game.away.abbr} @ ${game.home.abbr}, the whole sheet`,
    subtitle: `The board, the anytime board, the 2+ list, ${stacks.length} stack${stacks.length === 1 ? '' : 's'} and the long-shot band.`,
    postedAt: nowIso(),
    ...(feature ? { featured: true } : {}),
    images: [{ title: `${game.away.abbr} @ ${game.home.abbr}`, file: `${stem}.png`, h: height }],
    tags: ['game', 'stacks', 'td2', 'longshot'],
  },
  ...index.sheets
    .filter((s) => s.id !== id)
    .map(({ featured, ...rest }) =>
      feature ? rest : { ...rest, ...(featured ? { featured } : {}) },
    ),
];
index.updatedAt = nowIso();
writeJson(indexFile, index);

console.log(
  `${GAME}: ${spreadNow.label} ${spreadNow.conf}/5, ${total.label} ${totalNow.conf}/5, implied ${favAbbr} ${favPts} / ${dogAbbr} ${dogPts}`,
);
for (const l of twoPlus)
  console.log(
    `2+  ${l.name} ${fmtPrice(l.price)}  model ${fmtPct(l.prob)} vs break-even ${fmtPct(l.breakEven)}  cushion ${Math.round((l.prob - l.breakEven) * 100)}pts  EV ${evPct(l.ev)}`,
  );
for (const t of stacks)
  console.log(
    `STACK ${t.name} ${fmtPrice(t.price)}  hit ${fmtPct(t.prob)} vs ${fmtPct(t.implied)}  EV ${evPct(t.ev)}  [${t.legs.map((l) => l.label).join(' + ')}]`,
  );
for (const [i, t] of longs.entries())
  console.log(
    `#${i + 1} ${fmtPrice(t.price)}  hit ${fmtPct(t.prob)}  EV ${evPct(t.ev)}  ${t.legs.map((l) => l.label).join(' / ')}`,
  );
for (const l of fades)
  console.log(
    `FADE ${l.name} ${fmtPrice(l.price)}  model ${fmtPct(l.prob)} vs implied ${fmtPct(l.implied)}  ${evPct(l.edge)}`,
  );
if (height) console.log(`rendered ${stem}.png ${height}px`);
