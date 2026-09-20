// The Sunday one-pager: the board's sides and totals, the five anytime-TD parlays, the 2+ TD list
// and the six-point teaser, on one graphic the group can read top to bottom. Monday night is left
// off on purpose; it gets its own re-price and its own post.
//
//   node scripts/build-sunday.mjs            build, render, register
//   SHEETS_NO_RENDER=1 ...                   skip Chromium
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATA, ROOT, readJson, writeJson, nowIso } from './lib.mjs';
import { buildSheets, fmtPrice, fmtPct } from './sheets.mjs';
import { sideLegs, totalLegs, toDecimal, toAmerican, impliedFromAmerican } from './parlays.mjs';

const board = readJson(path.join(DATA, 'board.json'));
if (!board) {
  console.error('no board.json');
  process.exit(1);
}
const week = String(board.week).padStart(2, '0');
const stem = `w${week}-sunday`;
const SHEETS = path.join(ROOT, 'site', 'sheets');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// Sunday only: the calendar day of the earliest un-started game, in US Eastern.
const et = (iso, o = {}) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', ...o });
const upcoming = board.games.filter((g) => g.status?.state !== 'STATUS_FINAL');
const day = et(upcoming.map((g) => g.kickoff).sort()[0], {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});
const sunday = new Set(
  upcoming
    .filter((g) => et(g.kickoff, { weekday: 'long', month: 'long', day: 'numeric' }) === day)
    .map((g) => g.id),
);
const built = buildSheets(board, { games: sunday });
writeJson(path.join(DATA, 'sheets', `${board.season}-w${week}-sunday.json`), built);

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const clock = (iso) => et(iso, { hour: 'numeric', minute: '2-digit' }).toUpperCase();
const pulledAt = board.oddsFetchedAt
  ? et(board.oddsFetchedAt, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).toUpperCase()
  : 'UNKNOWN';
const evPct = (ev) => `${ev >= 0 ? '+' : ''}${Math.round(ev * 100)}%`;
/** Surname for a tight cell: drops a generational suffix so "Michael Pittman Jr." reads Pittman. */
const surname = (name) =>
  name
    .replace(/\s+(Jr|Sr|II|III|IV)\.?$/i, '')
    .split(' ')
    .slice(-1)[0];
const by = Object.fromEntries(built.sheets.map((s) => [s.key, s]));

// ---------- 1. The board: every Sunday side and total the model posts, with its number now ----------
const sides = sideLegs(board).filter((l) => sunday.has(l.game));
const totals = totalLegs(board).filter((l) => sunday.has(l.game));
const boardRows = board.games
  .filter((g) => sunday.has(g.id))
  .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))
  .map((g) => {
    const s = sides.find((l) => l.game === g.id);
    const t = totals.find((l) => l.game === g.id);
    const cell = (l, label) =>
      l
        ? `<td class="pick${l.conf >= 3 ? ' hot' : ''}">${esc(label)}<small>${l.conf}/5 · model ${fmtPct(l.prob)}${l.moved ? ' · was ' + esc(l.moved.replace('model liked ', '')) : ''}</small></td>`
        : '<td class="pick muted">—</td>';
    return `<tr><td class="g">${esc(g.away.abbr)} @ ${esc(g.home.abbr)}<small>${clock(g.kickoff)}${g.scratched?.length ? ' · out: ' + esc(g.scratched.map((x) => surname(x.name)).join(', ')) : ''}</small></td>${cell(s, s?.label)}${cell(t, t?.label.replace(` ${g.away.abbr}@${g.home.abbr}`, ''))}</tr>`;
  })
  .join('\n');
const hot = [...sides, ...totals].filter((l) => l.conf >= 3).length;

// ---------- 2. Five anytime-TD parlays ----------
const tdTickets = by.anytime.tickets
  .map(
    (t) =>
      `<div class="tk"><div class="hd"><span class="tag">#${t.rank}</span><span class="legs">${t.legs
        .map(
          (l) =>
            `<span class="leg">${esc(l.player)} <b>${fmtPrice(l.price)}</b><i>${esc(l.team)} · ${esc(l.gameLabel)} · ${fmtPct(l.prob)} vs ${fmtPct(l.implied)}</i></span>`,
        )
        .join(
          '',
        )}</span><span class="odds">${fmtPrice(t.price)}</span></div><div class="ft"><span><b>${fmtPct(t.prob)}</b> MODEL HIT</span><span class="m"><b>${fmtPct(t.implied)}</b> BOOK</span><span class="ev"><b>${evPct(t.ev)}</b> EV</span></div></div>`,
  )
  .join('\n');

// ---------- 3. 2+ TD ----------
const td2Rows = by.twoPlus.tickets
  .map((t) => {
    const l = t.legs[0];
    return `<tr><td class="p">${t.rank}</td><td class="n">${esc(l.player)}<small>${esc(l.team)} · ${esc(l.gameLabel)} · ${clock(l.kickoff)}</small></td><td class="r p">${fmtPrice(l.price)} ${esc(l.book)}</td><td class="r e">${fmtPct(l.prob)}</td><td class="r">${fmtPct(l.implied)}</td><td class="r">${fmtPrice(l.fair)}</td><td class="r e">${evPct(t.ev)}</td></tr>`;
  })
  .join('\n');

// ---------- 4. The teaser ----------
const T = built.teaser;
const teaserRows = T.legs
  .map(
    (l) =>
      `<tr><td class="n">${esc(l.label)}<small>from ${esc(l.from)} · ${esc(l.gameLabel)} · ${clock(l.kickoff)}${l.keys ? ' · crosses ' + (l.keys === 2 ? '3 and 7' : l.keys === 1 ? 'a key number' : '') : ''}</small></td><td class="r e">${fmtPct(l.prob)}</td><td class="r">${l.conf}/5</td></tr>`,
  )
  .join('\n');

const html = `<!doctype html>
<html><head><meta charset="utf-8" /><title>Cappers &amp; Code · Week ${board.week} Sunday</title>
<style>
  @font-face { font-family: 'Barlow Condensed'; font-weight: 900; src: url(../promo/assets/fonts/BarlowCondensed_900Black.ttf); }
  @font-face { font-family: 'Barlow Condensed'; font-weight: 800; src: url(../promo/assets/fonts/BarlowCondensed_800ExtraBold.ttf); }
  @font-face { font-family: 'Manrope'; font-weight: 700; src: url(../promo/assets/fonts/Manrope_700Bold.ttf); }
  @font-face { font-family: 'Manrope'; font-weight: 500; src: url(../promo/assets/fonts/Manrope_500Medium.ttf); }
  @font-face { font-family: 'JetBrains Mono'; font-weight: 700; src: url(../promo/assets/fonts/JetBrainsMono_700Bold.ttf); }
  @font-face { font-family: 'JetBrains Mono'; font-weight: 500; src: url(../promo/assets/fonts/JetBrainsMono_500Medium.ttf); }
  * { box-sizing: border-box; }
  body { margin: 0; background: #050608; color: #F5F7F2; font-family: 'Manrope', sans-serif; }
  .card { width: 1200px; padding: 48px 64px 64px; background: #050608 radial-gradient(ellipse at 50% 0%, rgba(182,255,0,.10), transparent 40%); position: relative; overflow: hidden; }
  .card::before { content: ""; position: absolute; left: 0; top: 0; width: 100%; height: 6px; background: #B6FF00; }
  .brand { display: flex; justify-content: space-between; align-items: center; font-family: 'JetBrains Mono'; letter-spacing: 3px; font-size: 17px; color: #B6FF00; font-weight: 700; }
  .brand img { width: 220px; display: block; }
  h1 { font-family: 'Barlow Condensed'; font-weight: 900; text-transform: uppercase; font-size: 84px; margin: 22px 0 6px; letter-spacing: 1px; line-height: .92; }
  h1 span { color: #B6FF00; }
  .sub { color: #C8CFC8; font-size: 20px; margin: 0 0 8px; line-height: 1.4; font-weight: 500; }
  h2 { font-family: 'Barlow Condensed'; font-weight: 900; text-transform: uppercase; font-size: 44px; margin: 40px 0 6px; letter-spacing: 1px; line-height: 1; display: flex; align-items: baseline; gap: 16px; }
  h2 small { font-family: 'JetBrains Mono'; font-size: 14px; letter-spacing: 3px; color: #79E000; font-weight: 700; text-transform: uppercase; }
  .rule { color: #9DA59D; font-size: 17px; margin: 0 0 16px; line-height: 1.4; }

  table.board { width: 100%; border-collapse: collapse; }
  table.board th { text-align: left; font-family: 'JetBrains Mono'; color: #B6FF00; letter-spacing: 3px; font-size: 13px; padding: 0 12px 10px; border-bottom: 1px solid #23282A; }
  table.board td { padding: 10px 12px; border-bottom: 1px solid #14181A; vertical-align: top; }
  table.board td.g { font-family: 'Barlow Condensed'; font-weight: 800; font-size: 28px; text-transform: uppercase; white-space: nowrap; width: 190px; }
  table.board td small { display: block; font-family: 'JetBrains Mono'; font-weight: 500; font-size: 12px; color: #9DA59D; letter-spacing: 1px; margin-top: 3px; text-transform: uppercase; }
  table.board td.pick { font-family: 'Barlow Condensed'; font-weight: 800; font-size: 30px; text-transform: uppercase; color: #F5F7F2; }
  table.board td.pick.hot { color: #B6FF00; }
  table.board td.pick.muted { color: #3A4040; }

  .tk { border: 1px solid rgba(182,255,0,.35); border-left: 5px solid #B6FF00; border-radius: 10px; background: #0B0E10; margin-bottom: 10px; }
  .tk .hd { display: grid; grid-template-columns: 56px 1fr 150px; align-items: center; gap: 14px; padding: 12px 20px; }
  .tk .tag { font-family: 'JetBrains Mono'; font-size: 16px; font-weight: 700; color: #B6FF00; letter-spacing: 2px; }
  .tk .legs { display: flex; flex-direction: column; gap: 6px; }
  .tk .leg { font-family: 'Barlow Condensed'; font-weight: 800; font-size: 30px; text-transform: uppercase; line-height: 1; display: flex; align-items: baseline; gap: 12px; }
  .tk .leg b { font-family: 'JetBrains Mono'; font-size: 19px; color: #F5F7F2; }
  .tk .leg i { font-family: 'JetBrains Mono'; font-style: normal; font-weight: 500; font-size: 12px; color: #9DA59D; letter-spacing: 1px; text-transform: uppercase; }
  .tk .odds { font-family: 'JetBrains Mono'; font-size: 34px; font-weight: 700; color: #B6FF00; text-align: right; }
  .tk .ft { display: flex; gap: 30px; padding: 8px 20px 11px; border-top: 1px solid #1B2022; font-family: 'JetBrains Mono'; font-size: 12px; letter-spacing: 2px; color: #9DA59D; }
  .tk .ft b { font-size: 20px; color: #F5F7F2; margin-right: 8px; letter-spacing: 0; }
  .tk .ft .ev b { color: #B6FF00; }
  .tk .ft .m b { color: #C8CFC8; }

  table.td { width: 100%; border-collapse: collapse; }
  table.td th { text-align: left; font-family: 'JetBrains Mono'; color: #B6FF00; letter-spacing: 3px; font-size: 13px; padding: 0 12px 10px; border-bottom: 1px solid #23282A; }
  table.td th.r { text-align: right; }
  table.td td { padding: 11px 12px; border-bottom: 1px solid #16191B; }
  table.td td.n { font-family: 'Barlow Condensed'; font-weight: 800; font-size: 30px; text-transform: uppercase; }
  table.td td.n small { display: block; font-family: 'JetBrains Mono'; font-weight: 500; font-size: 12px; color: #9DA59D; letter-spacing: 1px; margin-top: 3px; text-transform: uppercase; }
  table.td td.r { text-align: right; font-family: 'JetBrains Mono'; font-weight: 700; font-size: 21px; white-space: nowrap; }
  table.td td.p { color: #B6FF00; }
  table.td td.e { color: #79E000; }

  .teaser { border: 1px solid rgba(182,255,0,.45); box-shadow: 0 0 22px rgba(182,255,0,.12); border-radius: 12px; background: #0B0E10; padding: 20px 24px; }
  .teaser .top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .teaser .top .k { font-family: 'JetBrains Mono'; letter-spacing: 3px; color: #B6FF00; font-weight: 700; font-size: 15px; }
  .teaser .top .v { font-family: 'JetBrains Mono'; font-weight: 700; font-size: 22px; }
  .teaser .top .v i { font-style: normal; color: #9DA59D; font-size: 15px; font-weight: 500; margin-left: 12px; }
  .foot { margin-top: 30px; display: flex; justify-content: space-between; font-family: 'JetBrains Mono'; color: #79E000; font-size: 15px; letter-spacing: 4px; font-weight: 700; }
</style></head>
<body>
<section class="card" id="sunday">
  <div class="brand"><img src="../promo/assets/lockup.png" alt="Cappers &amp; Code"><span>WEEK ${board.week} · SUNDAY · ONE PAGE</span></div>
  <h1>Sunday, <span>on one page</span></h1>
  <p class="sub">${esc(day)}. The board, five anytime-TD parlays, the 2+ TD list and the six-point teaser. Prices FanDuel/DraftKings as of ${pulledAt} ET; the app carries live numbers. Units, not dollars.</p>

  <h2>The board <small>${sides.length} sides · ${totals.length} totals · ${hot} at confidence 3 or higher, in green</small></h2>
  <p class="rule">Model side and total for every Sunday game at the current number, all -110. "Was" is the number the desk posted Tuesday when the market has moved it since.</p>
  <table class="board">
    <tr><th>Game</th><th>Side</th><th>Total</th></tr>
    ${boardRows}
  </table>

  <h2>Anytime TD <small>five tickets · one scorer per game · under +1500</small></h2>
  <p class="rule">Every leg beats its price in the model, and no leg is allowed to demand more of his team's touchdowns than his position can plausibly own. No leg appears twice.</p>
  ${tdTickets}

  <h2>2+ touchdowns <small>backs and quarterbacks · the five that price</small></h2>
  <p class="rule">Real FanDuel/DraftKings 2+ prices against the model's number for two or more. Fair is what the model would charge; play the book price or longer.</p>
  <table class="td">
    <tr><th>#</th><th>Player</th><th class="r">2+ price</th><th class="r">Model</th><th class="r">Implied</th><th class="r">Fair</th><th class="r">EV</th></tr>
    ${td2Rows}
  </table>

  <h2>Six-point teaser <small>five legs · max confidence</small></h2>
  <p class="rule">Each side or total moved six points in our favour, ranked by how often the model's own projection clears the teased number. One leg per game. A five-leg six-point teaser pays about +400 at FanDuel or DraftKings; check yours.</p>
  <div class="teaser">
    <div class="top"><span class="k">ALL FIVE HIT</span><span class="v">${fmtPct(T.prob)} model<i>${fmtPct(T.conservative)} if every leg is a flat 70%</i></span></div>
    <table class="td">
      <tr><th>Leg</th><th class="r">Teased cover</th><th class="r">Conf</th></tr>
      ${teaserRows}
    </table>
  </div>

  <div class="foot"><span>UNITS, NOT DOLLARS</span><span>RE-PRICED BEFORE THE 1PM WINDOW · CAPPERSANDCODE.COM</span></div>
</section>
</body></html>
`;
const htmlFile = path.join(SHEETS, `${stem}.html`);
fs.writeFileSync(htmlFile, html);

let height = null;
if (!process.env.SHEETS_NO_RENDER) {
  const out = path.join(SHEETS, `${stem}.png`);
  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--virtual-time-budget=4000',
      '--window-size=1200,4200',
      `--screenshot=${out}`,
      `file://${htmlFile}#sunday`,
    ],
    { stdio: 'ignore' },
  );
  height = Number(
    execFileSync('python3', [
      '-c',
      `
from PIL import Image
im = Image.open(${JSON.stringify(out)}).convert('RGB'); w, h = im.size; px = im.load(); b = h - 1
while b > 0 and all(px[x, b] == (5, 6, 8) for x in range(0, w, 8)): b -= 1
cut = min(h, b + 40); im.crop((0, 0, w, cut)).save(${JSON.stringify(out)}); print(cut)`,
    ])
      .toString()
      .trim(),
  );
}

const indexFile = path.join(SHEETS, 'index.json');
const index = readJson(indexFile, { updatedAt: null, sheets: [] });
const id = `${board.season}-w${week}-sunday`;
index.sheets = [
  {
    id,
    week: board.week,
    season: board.season,
    title: `Week ${board.week} Sunday, on one page`,
    subtitle: `The board, five anytime-TD parlays, the 2+ TD list and the six-point teaser.`,
    postedAt: nowIso(),
    images: [{ title: 'Sunday, on one page', file: `${stem}.png`, h: height }],
    tags: ['board', 'sunday', 'teaser', 'td2'],
  },
  ...index.sheets.filter((s) => s.id !== id),
];
index.updatedAt = nowIso();
writeJson(indexFile, index);

console.log(
  `sunday: ${day}, ${sunday.size} games, ${sides.length} sides, ${totals.length} totals, ${hot} hot`,
);
console.log(
  `teaser: ${T.legs.map((l) => l.label).join(' / ')}  model ${fmtPct(T.prob)} conservative ${fmtPct(T.conservative)}`,
);
for (const t of by.anytime.tickets)
  console.log(
    `  TD #${t.rank} ${fmtPrice(t.price)} hit ${fmtPct(t.prob)}  ${t.legs.map((l) => l.player).join(' + ')}`,
  );
for (const t of by.twoPlus.tickets)
  console.log(`  2+ #${t.rank} ${t.legs[0].player} ${fmtPrice(t.price)} hit ${fmtPct(t.prob)}`);
if (height) console.log(`rendered ${stem}.png ${height}px`);
