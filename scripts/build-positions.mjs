// Position boards: the top touchdown scorers at a position for the day, ranked by the model's
// anytime probability, with the price, what the price implies, and the edge. Ranked by hit rate
// rather than edge on purpose: this is the "who scores" list, and the edge column tells the
// reader which of those the price is also wrong about.
//
//   node scripts/build-positions.mjs       WR and RB boards for the day's games
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATA, ROOT, readJson, writeJson, nowIso } from './lib.mjs';
import { impliedShare, shareCeiling, fmtPct, fmtPrice } from './sheets.mjs';
import { atdLegs } from './parlays.mjs';

const board = readJson(path.join(DATA, 'board.json'));
const week = String(board.week).padStart(2, '0');
const SHEETS = path.join(ROOT, 'site', 'sheets');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const N = Number(process.env.POSITIONS_N || 10);

const et = (iso, o = {}) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', ...o });
const upcoming = board.games.filter((g) => g.status?.state !== 'STATUS_FINAL');
const dayKey = (iso) => et(iso, { weekday: 'long', month: 'long', day: 'numeric' });
const day = dayKey(upcoming.map((g) => g.kickoff).sort()[0]);
const inDay = new Set(upcoming.filter((g) => dayKey(g.kickoff) === day).map((g) => g.id));
const gameOf = (id) => board.games.find((g) => g.id === id);
const legs = atdLegs(board)
  .filter((l) => inDay.has(l.game))
  .map((l) => ({ ...l, share: impliedShare(gameOf(l.game), l) }));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pulledAt = board.oddsFetchedAt
  ? et(board.oddsFetchedAt, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).toUpperCase()
  : 'UNKNOWN';
const clock = (iso) => et(iso, { hour: 'numeric', minute: '2-digit' }).toUpperCase();

const BOARDS = {
  WR: {
    title: 'Wide receivers',
    kicker: 'TOP WIDE RECEIVERS TO SCORE',
    sub: 'The receivers most likely to find the end zone today by the model, in order. Edge is the model against the price: green means the book is paying more than it should.',
  },
  RB: {
    title: 'Running backs',
    kicker: 'TOP RUNNING BACKS TO SCORE',
    sub: 'The backs most likely to score today by the model, in order. Most are favourites at the window, so read the edge column: a back at -260 the model has at 68% is a scorer, not a bet.',
  },
};
const sections = [];
const out = [];
for (const [pos, meta] of Object.entries(BOARDS)) {
  const rows = legs
    .filter((l) => l.pos === pos)
    .sort((a, b) => b.prob - a.prob)
    .slice(0, N);
  const wild = rows.filter((l) => l.share != null && l.share > shareCeiling(pos));
  const tr = rows
    .map((l, i) => {
      const e = l.edge * 100;
      const cls = e >= 3 ? 'e' : e <= -3 ? 'neg' : '';
      return `<tr><td class="p">${i + 1}</td><td class="n">${esc(l.player)}${l.status ? ` <em>${esc(l.status.toUpperCase())}</em>` : ''}<small>${esc(l.team)} · ${esc(l.gameLabel)} · ${clock(l.kickoff)}</small></td><td class="r e">${fmtPct(l.prob)}</td><td class="r">${fmtPct(l.implied)}</td><td class="r ${cls}">${e >= 0 ? '+' : ''}${e.toFixed(0)}</td><td class="r p">${fmtPrice(l.price)} ${esc(l.book)}</td></tr>`;
    })
    .join('\n');
  sections.push(`<section class="card" id="${pos.toLowerCase()}">
  <div class="brand"><img src="../promo/assets/lockup.png" alt="Cappers &amp; Code"><span>WEEK ${board.week} · ${esc(day.toUpperCase())} · ${meta.kicker}</span></div>
  <h1>${meta.title}, <span>to score</span></h1>
  <p class="sub">${meta.sub}</p>
  <table class="td">
    <tr><th>#</th><th>Player</th><th class="r">Model</th><th class="r">Implied</th><th class="r">Edge</th><th class="r">Anytime</th></tr>
    ${tr}
  </table>
  ${wild.length ? `<p class="note">Estimate demands more of the team's touchdowns than the position usually owns: ${esc(wild.map((l) => l.player).join(', '))}. Priced for reference; not on any parlay sheet.</p>` : ''}
  <div class="foot"><span>UNITS, NOT DOLLARS</span><span>FD/DK PRICES AS OF ${pulledAt} ET</span></div>
</section>`);
  out.push({
    id: pos.toLowerCase(),
    title: `${meta.title} to score`,
    file: `w${week}-${pos.toLowerCase()}.png`,
  });
}

const html = `<!doctype html><html><head><meta charset="utf-8" /><title>Cappers &amp; Code · Week ${board.week} position boards</title>
<style>
  @font-face { font-family: 'Barlow Condensed'; font-weight: 900; src: url(../promo/assets/fonts/BarlowCondensed_900Black.ttf); }
  @font-face { font-family: 'Barlow Condensed'; font-weight: 800; src: url(../promo/assets/fonts/BarlowCondensed_800ExtraBold.ttf); }
  @font-face { font-family: 'Manrope'; font-weight: 700; src: url(../promo/assets/fonts/Manrope_700Bold.ttf); }
  @font-face { font-family: 'Manrope'; font-weight: 500; src: url(../promo/assets/fonts/Manrope_500Medium.ttf); }
  @font-face { font-family: 'JetBrains Mono'; font-weight: 700; src: url(../promo/assets/fonts/JetBrainsMono_700Bold.ttf); }
  @font-face { font-family: 'JetBrains Mono'; font-weight: 500; src: url(../promo/assets/fonts/JetBrainsMono_500Medium.ttf); }
  * { box-sizing: border-box; }
  body { margin: 0; background: #050608; color: #F5F7F2; font-family: 'Manrope', sans-serif; }
  .card { width: 1200px; padding: 48px 64px 64px; background: #050608 radial-gradient(ellipse at 50% 0%, rgba(182,255,0,.10), transparent 55%); position: relative; overflow: hidden; display: flex; flex-direction: column; }
  body.only .card { display: none; } body.only .card:target { display: flex; }
  .card::before { content: ""; position: absolute; left: 0; top: 0; width: 100%; height: 6px; background: #B6FF00; }
  .brand { display: flex; justify-content: space-between; align-items: center; font-family: 'JetBrains Mono'; letter-spacing: 3px; font-size: 16px; color: #B6FF00; font-weight: 700; }
  .brand img { width: 220px; display: block; }
  h1 { font-family: 'Barlow Condensed'; font-weight: 900; text-transform: uppercase; font-size: 84px; margin: 22px 0 6px; letter-spacing: 1px; line-height: .92; }
  h1 span { color: #B6FF00; }
  .sub { color: #C8CFC8; font-size: 20px; margin: 0 0 22px; line-height: 1.4; font-weight: 500; }
  table.td { width: 100%; border-collapse: collapse; }
  table.td th { text-align: left; font-family: 'JetBrains Mono'; color: #B6FF00; letter-spacing: 3px; font-size: 14px; padding: 0 12px 10px; border-bottom: 1px solid #23282A; }
  table.td th.r { text-align: right; }
  table.td td { padding: 12px 12px; border-bottom: 1px solid #16191B; }
  table.td td.n { font-family: 'Barlow Condensed'; font-weight: 800; font-size: 34px; text-transform: uppercase; line-height: 1; }
  table.td td.n em { font-family: 'JetBrains Mono'; font-style: normal; font-size: 12px; letter-spacing: 2px; color: #050608; background: #F5F7F2; border-radius: 3px; padding: 2px 6px; margin-left: 10px; vertical-align: middle; }
  table.td td.n small { display: block; font-family: 'JetBrains Mono'; font-weight: 500; font-size: 13px; color: #9DA59D; letter-spacing: 1px; margin-top: 5px; text-transform: uppercase; }
  table.td td.r { text-align: right; font-family: 'JetBrains Mono'; font-weight: 700; font-size: 23px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.td td.p { color: #B6FF00; }
  table.td td.e { color: #79E000; }
  table.td td.neg { color: #9DA59D; }
  .note { color: #9DA59D; font-size: 16px; margin: 16px 0 0; line-height: 1.4; }
  .foot { margin-top: 26px; display: flex; justify-content: space-between; font-family: 'JetBrains Mono'; color: #79E000; font-size: 15px; letter-spacing: 4px; font-weight: 700; }
</style></head><body><script>if (location.hash) document.body.classList.add('only');</script>
${sections.join('\n\n')}
</body></html>`;
const htmlFile = path.join(SHEETS, `w${week}-positions.html`);
fs.writeFileSync(htmlFile, html);

const heights = {};
if (!process.env.SHEETS_NO_RENDER)
  for (const r of out) {
    const png = path.join(SHEETS, r.file);
    execFileSync(
      CHROME,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--hide-scrollbars',
        '--virtual-time-budget=4000',
        '--window-size=1200,2400',
        `--screenshot=${png}`,
        `file://${htmlFile}#${r.id}`,
      ],
      { stdio: 'ignore' },
    );
    heights[r.file] = Number(
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
const id = `${board.season}-w${week}-positions`;
index.sheets = [
  {
    id,
    week: board.week,
    season: board.season,
    title: `Week ${board.week}: top receivers and backs to score`,
    subtitle: `Ranked by the model's anytime probability, with the price and the edge.`,
    postedAt: nowIso(),
    images: out.map((r) => ({ title: r.title, file: r.file, h: heights[r.file] ?? null })),
    tags: ['td', 'wr', 'rb'],
  },
  ...index.sheets.filter((s) => s.id !== id),
];
index.updatedAt = nowIso();
writeJson(indexFile, index);
for (const r of out)
  console.log(`rendered ${r.file}${heights[r.file] ? ' ' + heights[r.file] + 'px' : ''}`);
