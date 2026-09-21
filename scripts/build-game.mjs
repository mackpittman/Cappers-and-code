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
const linesAt = stamp(board.oddsFetchedAt);
const staleMin = Math.round((Date.parse(board.oddsFetchedAt) - Date.parse(marketAt)) / 60000);
const evPct = (x) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
const VIG = 0.93; // a lone anytime price carries roughly 7% hold once the book's whole board is summed

// The board's lines.implied has its away/home keys swapped on every game, so derive the split from
// the spread and the total, which cannot be ambiguous.
const spreadNow = sideLegs(board).find((l) => l.game === GAME);
const totalNow = totalLegs(board).find((l) => l.game === GAME);
const totalNum = Number(/([\d.]+)/.exec(totalNow.label)[1]);
const sideNum = Math.abs(Number(spreadNow.label.split(' ').pop()));
const favAbbr = spreadNow.team === game.home.abbr ? game.away.abbr : game.home.abbr;
const dogAbbr = spreadNow.team;
const favPts = (totalNum + sideNum) / 2;
const dogPts = (totalNum - sideNum) / 2;

// ---------- legs ----------
const bookOf = (market, name) =>
  Object.values(evt.markets[market]?.players ?? {}).find((p) => p.name === name)?.books ?? {};
const bestOf = (bk) => {
  const k = Object.keys(bk)
    .filter((b) => bk[b] != null)
    .sort((a, b) => bk[b] - bk[a])[0];
  return k ? { price: bk[k], book: k === 'fanduel' ? 'FD' : k === 'draftkings' ? 'DK' : k } : null;
};
const modelBy = Object.fromEntries(
  atdLegs(board)
    .filter((l) => l.game === GAME)
    .map((l) => [l.player, l]),
);
const anytime = Object.values(evt.markets.player_anytime_td?.players ?? {})
  .map((p) => p.name)
  .filter((n) => !/D\/ST|Defense/.test(n))
  .map((name) => {
    const b = bestOf(bookOf('player_anytime_td', name));
    if (!b) return null;
    const m = modelBy[name];
    const implied = impliedFromAmerican(b.price);
    const prob = m ? m.prob : implied * VIG;
    return {
      kind: 'atd',
      label: `${name} anytime TD`,
      name,
      team: m?.team ?? null,
      pos: m?.pos ?? null,
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

const twoPlus = twoPlusLegs(atdLegs(board).filter((l) => l.game === GAME))
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
const DEFS = [
  {
    name: 'The model stack',
    corr: 'positive',
    why: 'Both of the desk’s own calls on this game, at confidence 3. They pull the same way: the Giants covering almost always means a slower, shorter game, so the side and the total are one idea bet twice.',
    legs: () => [side, total],
  },
  {
    name: 'Ball control',
    corr: 'positive',
    why: 'The same script with the Giants’ goal-line back attached. If New York is keeping this close and shortening the game, Skattebo is the one carrying it in.',
    legs: () => [side, total, A['Cam Skattebo']],
  },
  {
    name: 'Dart in the red zone',
    corr: 'positive',
    why: 'Los Angeles got two QB hits all of Week 1 and Garrett is gone for months. A clean pocket let Dart throw three touchdowns in the opener; Likely is the body he looks for inside the 20.',
    legs: () => [propLeg('Jaxson Dart', 'player_pass_tds', 'over'), A['Isaiah Likely'], side],
  },
  {
    name: 'Rams script',
    corr: 'mixed',
    why: 'The counter, for anyone who wants Los Angeles. The Rams win the way the model expects this game to go: on the ground, low-scoring, with Kyren Williams finishing drives.',
    legs: () => [A['Kyren Williams'], total],
  },
];
const stacks = [];
for (const d of DEFS) {
  const legs = d.legs();
  if (legs.some((l) => !l || l.price == null)) {
    console.log(`skipped stack "${d.name}": a leg has no price`);
    continue;
  }
  const t = priceStack(legs);
  if (t.ev <= 0) {
    console.log(
      `skipped stack "${d.name}": ${Math.round(t.ev * 100)}% EV, the market prices its legs above our number`,
    );
    continue;
  }
  stacks.push({ ...d, ...t });
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
const css = fs
  .readFileSync(path.join(SHEETS, `w${week}-sunday.html`), 'utf8')
  .match(/<style>[\s\S]*?<\/style>/)[0];
const html = `<!doctype html>
<html><head><meta charset="utf-8" /><title>Cappers &amp; Code · ${esc(game.away.abbr)} @ ${esc(game.home.abbr)}</title>
${css}
<style>
  .tk .ft .why { flex: 1; color: #9DA59D; letter-spacing: 0; font-family: 'Manrope'; font-size: 13.5px; font-weight: 500; text-transform: none; text-align: right; line-height: 1.45; }
  .tk .hd { grid-template-columns: 92px 1fr 160px; }
  .line { display: flex; gap: 40px; margin: 14px 0 0; font-family: 'JetBrains Mono'; font-size: 15px; letter-spacing: 2px; color: #9DA59D; }
  .line b { color: #B6FF00; font-size: 22px; margin-right: 8px; }
  .read { border-left: 4px solid #B6FF00; background: #0B0E10; padding: 16px 22px; margin: 18px 0 0; color: #C8CFC8; font-size: 16px; line-height: 1.55; }
  table.td td.bad { color: #E06060; }
  table.td td.warn { color: #E0C040; }
  table.td td.w { font-size: 13.5px; color: #9DA59D; line-height: 1.45; padding-left: 18px; }
</style></head>
<body>
<section class="card" id="game">
  <div class="brand"><img src="../promo/assets/lockup.png" alt="Cappers &amp; Code"><span>WEEK ${board.week} · MONDAY NIGHT</span></div>
  <h1>${esc(game.away.abbr)} @ ${esc(game.home.abbr)}, <span>the whole sheet</span></h1>
  <p class="sub">Every play we have on the last game of the week: the board, the anytime board, the 2+ list, ${stacks.length} stack${stacks.length === 1 ? '' : 's'} and the long-shot band. Player prices are FanDuel/DraftKings as of ${pulledAt} ET${staleMin > 90 ? `, the last time this game's props were pulled; the line and total are current to ${linesAt} ET` : ''}. A same-game parlay engine reprices a stack; the model numbers hold. Units, not dollars.</p>
  <div class="line"><span><b>${esc(spreadNow.label)}</b> SIDE ${spreadNow.conf}/5</span><span><b>${esc(total.label)}</b> TOTAL ${totalNow.conf}/5</span><span><b>${esc(favAbbr)} ${favPts}</b> · <b>${esc(dogAbbr)} ${dogPts}</b> IMPLIED</span></div>
  <div class="read">${esc(game.market.why)}</div>

  <h2>Anytime TD <small>top 12 · model against the price</small></h2>
  <p class="rule">"Model" is our own number where the desk wrote one, and the book price with the hold stripped where it did not. Edge is the gap. A negative edge is a name the market likes more than we do.</p>
  <table class="td">
    <tr><th>#</th><th>Player</th><th class="r">Anytime</th><th class="r">Model</th><th class="r">Implied</th><th class="r">Edge</th></tr>
    ${atdRows}
  </table>

  <h2>2+ touchdowns <small>backs and quarterbacks · with the cushion</small></h2>
  <p class="rule">Break-even is what the price needs to be worth playing. Cushion is how many points of model edge sit above it. The 2+ model is 5-34 on the season and 0 for 3 in its top band, so a thin cushion is a pass, not a coin flip.</p>
  <table class="td">
    <tr><th>#</th><th>Player</th><th class="r">2+ price</th><th class="r">Model</th><th class="r">Break-even</th><th class="r">Cushion</th><th class="r">EV</th></tr>
    ${td2Rows}
  </table>

  <h2>The stacks <small>${stacks.length} · correlated by design</small></h2>
  <p class="rule">Each one is a single idea about how this game goes, bet more than once. Priced as if the legs were independent, which is the honest floor: a positively correlated stack hits more often than the number below and your book will shorten the payout to match.</p>
  ${stacks.map((t) => stackHtml(t, t.name.toUpperCase())).join('\n')}

  <h2>Long shots <small>${longs.length} tickets · ${fmtPrice(BAND[0])} to ${fmtPrice(BAND[1])}</small></h2>
  <p class="rule">Three legs each, drawn from the lists above, ranked by how often the model hits them. No player carries more than three tickets.</p>
  ${longs.map((t, i) => stackHtml(t, `#${i + 1}`)).join('\n')}

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
