// Sunday Night Football one-pager: the 2+ TD plays, the three-scorer stack and three or four
// +3000 to +4000 same-game tickets for the night game, priced off the pre-kick pull.
//
//   node scripts/build-snf.mjs            build, render, register
//   SHEETS_NO_RENDER=1 ...                skip Chromium
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATA, ROOT, readJson, writeJson, nowIso } from './lib.mjs';
import { fmtPrice, fmtPct } from './sheets.mjs';
import { atdLegs, toDecimal, toAmerican, fairAmerican, impliedFromAmerican } from './parlays.mjs';
import { twoPlusLegs } from './sheets.mjs';

const board = readJson(path.join(DATA, 'board.json'));
const odds = readJson(path.join(DATA, 'odds', 'latest.json'));
if (!board || !odds) {
  console.error('need board.json and odds/latest.json');
  process.exit(1);
}
const GAME = process.env.SNF_GAME || 'ind-kc';
const game = board.games.find((g) => g.id === GAME);
const ev = odds.events.find((e) => `${e.away}-${e.home}`.toLowerCase() === GAME);
if (!game || !ev) {
  console.error(`no ${GAME} on the board`);
  process.exit(1);
}
const week = String(board.week).padStart(2, '0');
const stem = `w${week}-snf`;
const SHEETS = path.join(ROOT, 'site', 'sheets');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const et = (iso, o = {}) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', ...o });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pulledAt = et(board.oddsFetchedAt, { hour: 'numeric', minute: '2-digit' }).toUpperCase();
const evPct = (x) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
const favAbbr = game.lines.spread.split(' ')[0];
const margin = Math.abs(Number(game.lines.spread.split(' ')[1]));
const favPts = (game.lines.total + margin) / 2;
const dogPts = (game.lines.total - margin) / 2;
const dogAbbr = favAbbr === game.home.abbr ? game.away.abbr : game.home.abbr;
const VIG = 0.93; // a single anytime price carries roughly 7% hold once the whole market is summed

// ---- Legs. Model probability where the model has one; the de-vigged market where it does not. ----
const books = (market, name) =>
  Object.values(ev.markets[market]?.players ?? {}).find((p) => p.name === name)?.books ?? {};
const best = (bk) => (Object.keys(bk).length ? Math.max(...Object.values(bk)) : null);
const bestOf = (bk, keys) => {
  const k = keys.filter((b) => bk[b] != null).sort((a, b) => bk[b] - bk[a])[0];
  return k ? { price: bk[k], book: k === 'fanduel' ? 'FD' : k === 'draftkings' ? 'DK' : k } : null;
};
const modelBy = Object.fromEntries(
  atdLegs(board)
    .filter((l) => l.game === GAME)
    .map((l) => [l.player, l]),
);
const roster = Object.values(ev.markets.player_anytime_td.players)
  .map((p) => p.name)
  .filter((n) => !/D\/ST|Defense/.test(n));
const anytime = roster
  .map((name) => {
    const bk = books('player_anytime_td', name);
    const fd = bestOf(bk, ['fanduel', 'draftkings']);
    if (!fd) return null;
    const m = modelBy[name];
    const market = impliedFromAmerican(fd.price) * VIG;
    const prob = m ? m.prob : market;
    return {
      type: 'atd',
      name,
      team: m?.team ?? null,
      pos: m?.pos ?? null,
      price: fd.price,
      book: fd.book,
      implied: impliedFromAmerican(fd.price),
      prob,
      source: m ? 'model' : 'market',
      best: best(bk),
    };
  })
  .filter(Boolean)
  .sort((a, b) => b.prob - a.prob);
// 2+ from the anytime number: Poisson touchdowns, with the bell-cow lift the 2+ sheet uses above 50%.
const twoPlusProb = (p) => {
  const lam = -Math.log(1 - p) * (p > 0.5 ? 1.3 : 1);
  return 1 - Math.exp(-lam) * (1 + lam);
};
const TD2_POS = new Set(['RB', 'QB']);
const twoPlus = twoPlusLegs(atdLegs(board).filter((l) => l.game === GAME))
  .filter((l) => TD2_POS.has(l.pos))
  .map((l) => ({
    type: 'td2',
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
  }))
  .filter((l) => l.ev > 0)
  .sort((a, b) => b.ev * Math.sqrt(b.prob) - a.ev * Math.sqrt(a.prob));
const A = Object.fromEntries(anytime.map((l) => [l.name, l]));
const T2 = Object.fromEntries(twoPlus.map((l) => [l.name, l]));
const over = {
  type: 'total',
  name: `Over ${game.lines.total}`,
  price: -110,
  book: 'FD/DK',
  implied: impliedFromAmerican(-110),
  prob: 0.58,
  source: 'model',
};

const ticket = (legs, why) => {
  const dec = legs.reduce((p, l) => p * toDecimal(l.price), 1);
  const prob = legs.reduce((p, l) => p * l.prob, 1);
  return { legs, why, price: toAmerican(dec), dec, prob, implied: 1 / dec, ev: prob * dec - 1 };
};
// The three-scorer stack: the three most likely scorers, one ticket.
const stack = ticket(
  anytime.slice(0, 3),
  'The three most likely scorers on the field. Hit rate over payout: the model gives this stack a real chance, not an edge.',
);
// Long tickets: every 3-leg combination of 2+ and anytime legs plus the total, kept to +3000..+4000,
// ranked by model hit rate with the edge as tie-break. One 2+ leg per ticket at most two.
const legPool = [...twoPlus, ...anytime.slice(0, 7), over];
const combos = [];
for (let i = 0; i < legPool.length; i++)
  for (let j = i + 1; j < legPool.length; j++)
    for (let k = j + 1; k < legPool.length; k++) {
      const legs = [legPool[i], legPool[j], legPool[k]];
      const names = legs.map((l) => l.name);
      if (new Set(names).size < 3) continue; // no player twice (2+ and anytime of the same man)
      const t = ticket(legs);
      if (t.price < 3000 || t.price > 4000 || t.ev <= 0) continue;
      combos.push(t);
    }
combos.sort((a, b) => b.prob - a.prob);
const longs = [];
const seen = new Map();
for (const t of combos) {
  if (t.legs.some((l) => (seen.get(l.name) ?? 0) >= 3)) continue;
  longs.push(t);
  for (const l of t.legs) seen.set(l.name, (seen.get(l.name) ?? 0) + 1);
  if (longs.length === 4) break;
}
const out = {
  builtAt: nowIso(),
  game: GAME,
  oddsFetchedAt: board.oddsFetchedAt,
  twoPlus,
  stack,
  longs,
  anytime,
};
writeJson(path.join(DATA, 'sheets', `${board.season}-w${week}-snf.json`), out);

// ---- Render ----
const legHtml = (l) =>
  `<span class="leg">${esc(l.name)}${l.type === 'td2' ? ' 2+' : ''} <b>${fmtPrice(l.price)}</b><i>${l.book} · ${fmtPct(l.prob)} ${l.source === 'model' ? 'model' : 'market'} vs ${fmtPct(l.implied)}</i></span>`;
const tk = (t, tag) =>
  `<div class="tk"><div class="hd"><span class="tag">${tag}</span><span class="legs">${t.legs.map(legHtml).join('')}</span><span class="odds">${fmtPrice(t.price)}</span></div><div class="ft"><span><b>${fmtPct(t.prob)}</b> MODEL HIT</span><span class="m"><b>${fmtPct(t.implied)}</b> BOOK</span><span class="ev"><b>${evPct(t.ev)}</b> EV</span>${t.why ? `<span class="why">${esc(t.why)}</span>` : ''}</div></div>`;
const td2Rows = twoPlus
  .map(
    (l, i) =>
      `<tr><td class="p">${i + 1}</td><td class="n">${esc(l.name)}<small>${esc(l.team ?? '')} · ${esc(l.pos ?? '')} · anytime ${fmtPrice(A[l.name].price)}</small></td><td class="r p">${fmtPrice(l.price)} ${l.book}</td><td class="r e">${fmtPct(l.prob)}</td><td class="r">${fmtPct(l.implied)}</td><td class="r">${fmtPrice(l.fair)}</td><td class="r e">${evPct(l.ev)}</td></tr>`,
  )
  .join('\n');
const css = fs
  .readFileSync(path.join(SHEETS, `w${week}-sunday.html`), 'utf8')
  .match(/<style>[\s\S]*?<\/style>/)[0];
const html = `<!doctype html>
<html><head><meta charset="utf-8" /><title>Cappers &amp; Code · Week ${board.week} SNF</title>
${css}
<style>
  .tk .ft .why { flex: 1; color: #9DA59D; letter-spacing: 0; font-family: 'Manrope'; font-size: 14px; font-weight: 500; text-transform: none; text-align: right; }
  .line { display: flex; gap: 40px; margin: 14px 0 0; font-family: 'JetBrains Mono'; font-size: 15px; letter-spacing: 2px; color: #9DA59D; }
  .line b { color: #B6FF00; font-size: 22px; margin-right: 8px; }
</style></head>
<body>
<section class="card" id="snf">
  <div class="brand"><img src="../promo/assets/lockup.png" alt="Cappers &amp; Code"><span>WEEK ${board.week} · SUNDAY NIGHT</span></div>
  <h1>${esc(game.away.abbr)} @ ${esc(game.home.abbr)}, <span>under the lights</span></h1>
  <p class="sub">The 2+ TD plays, the three-scorer stack and four +3000 to +4000 same-game tickets. FanDuel/DraftKings prices from the ${pulledAt} ET pull. A same-game parlay engine will shade these payouts; the model numbers hold. Units, not dollars.</p>
  <div class="line"><span><b>${esc(game.lines.spread)}</b> SIDE</span><span><b>${esc(game.market.total)}</b> TOTAL</span><span><b>${esc(favAbbr)} ${favPts}</b> · <b>${esc(dogAbbr)} ${dogPts}</b> IMPLIED</span></div>

  <h2>2+ touchdowns <small>backs and quarterbacks · the model's own list</small></h2>
  <p class="rule">Real FanDuel/DraftKings 2+ prices against the model's number for two or more. Fair is what the model would charge; play the book price or longer.</p>
  <table class="td">
    <tr><th>#</th><th>Player</th><th class="r">2+ price</th><th class="r">Model</th><th class="r">Implied</th><th class="r">Fair</th><th class="r">EV</th></tr>
    ${td2Rows}
  </table>

  <h2>Three-scorer stack <small>one ticket · highest hit rate</small></h2>
  ${tk(stack, 'STACK')}

  <h2>+3000 to +4000 <small>${longs.length} tickets · ranked by model hit rate</small></h2>
  <p class="rule">Three legs each, built from the 2+ and anytime legs above and the total. No player carries more than three tickets. "Market" legs are priced off the book with the hold removed; the model has no separate number on them.</p>
  ${longs.map((t, i) => tk(t, `#${i + 1}`)).join('\n')}

  <div class="foot"><span>UNITS, NOT DOLLARS</span><span>PRICED ${pulledAt} ET · CAPPERSANDCODE.COM</span></div>
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
      '--window-size=1200,3000',
      `--screenshot=${png}`,
      `file://${htmlFile}#snf`,
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
const id = `${board.season}-w${week}-snf`;
index.sheets = [
  {
    id,
    week: board.week,
    season: board.season,
    title: `Week ${board.week} Sunday night: ${game.away.abbr} @ ${game.home.abbr}`,
    subtitle: 'The 2+ TD plays, the three-scorer stack and four +3000 to +4000 tickets.',
    postedAt: nowIso(),
    images: [{ title: 'Sunday night', file: `${stem}.png`, h: height }],
    tags: ['snf', 'td2', 'longshot'],
  },
  ...index.sheets.filter((s) => s.id !== id),
];
index.updatedAt = nowIso();
writeJson(indexFile, index);

for (const l of twoPlus)
  console.log(
    `2+  ${l.name} ${fmtPrice(l.price)} ${l.book}  model ${fmtPct(l.prob)} vs ${fmtPct(l.implied)}  EV ${evPct(l.ev)}`,
  );
console.log(
  `STACK ${stack.legs.map((l) => l.name).join(' + ')} ${fmtPrice(stack.price)}  hit ${fmtPct(stack.prob)} vs ${fmtPct(stack.implied)}  EV ${evPct(stack.ev)}`,
);
for (const [i, t] of longs.entries())
  console.log(
    `#${i + 1} ${fmtPrice(t.price)}  hit ${fmtPct(t.prob)} vs ${fmtPct(t.implied)}  EV ${evPct(t.ev)}  ${t.legs.map((l) => l.name + (l.type === 'td2' ? ' 2+' : '')).join(' / ')}`,
  );
if (height) console.log(`rendered ${stem}.png ${height}px`);
