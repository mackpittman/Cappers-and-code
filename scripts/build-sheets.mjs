// Renders the weekly sheets: five tickets per category as brand graphics, plus the data behind
// them and a Discord-ready summary.
//
//   node scripts/build-sheets.mjs            build, write HTML, render PNGs, update the index
//   SHEETS_NO_RENDER=1 ...                   skip Chromium (CI without a browser)
//
// The ticket selection lives in sheets.mjs and is tested there; this file only lays it out.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATA, ROOT, readJson, writeJson, nowIso } from './lib.mjs';
import { buildSheets, fmtPrice, fmtPct, BANDS, EDGE_FLOOR } from './sheets.mjs';

const board = readJson(path.join(DATA, 'board.json'));
if (!board) {
  console.error('no board.json');
  process.exit(1);
}
const week = String(board.week).padStart(2, '0');
const stem = `w${week}-board`;
const SHEETS = path.join(ROOT, 'site', 'sheets');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const built = buildSheets(board);
writeJson(path.join(DATA, 'sheets', `${board.season}-w${week}.json`), built);

// ---------- helpers ----------
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const et = (iso) =>
  new Date(iso)
    .toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    })
    .replace(',', '')
    .toUpperCase();
const pulledAt = board.oddsFetchedAt
  ? new Date(board.oddsFetchedAt)
      .toLocaleString('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
      .toUpperCase()
  : 'UNKNOWN';
const evPct = (ev) => `${ev >= 0 ? '+' : ''}${Math.round(ev * 100)}%`;
const short = (l) => l.label.replace(' anytime TD', '').replace(' 2+ TDs', '');

/** One leg line. Scorers carry model vs implied; sides and totals carry the confidence grade. */
function legRow(l) {
  const name = esc(short(l));
  const kind =
    l.type === 'td2'
      ? '2+ TD'
      : l.type === 'atd'
        ? 'ANYTIME'
        : l.type === 'side'
          ? 'SIDE'
          : 'TOTAL';
  const q = l.status ? `<em class="q">${esc(l.status.toUpperCase())}</em>` : '';
  const meta =
    l.type === 'side' || l.type === 'total'
      ? `${esc(l.gameLabel)} · ${et(l.kickoff)} · CONF ${l.conf}/5`
      : `${esc(l.team)} · ${esc(l.gameLabel)} · ${et(l.kickoff)}`;
  return `<div class="leg"><span class="k">${kind}</span><span class="nm">${name}${q}</span><span class="meta">${meta}</span><span class="px">${fmtPrice(l.price)} ${esc(l.book)}</span><span class="mv">${fmtPct(l.prob)} <i>vs ${fmtPct(l.implied)}</i></span></div>`;
}
function ticketCard(t, tagText) {
  return `<div class="ticket">
  <div class="hd"><span class="tag">${esc(tagText)}</span><span class="odds">${fmtPrice(t.price)}</span></div>
  <div class="legs">${t.legs.map(legRow).join('')}</div>
  <div class="ft"><span class="stat"><b>${fmtPct(t.prob)}</b> MODEL HIT</span><span class="stat muted"><b>${fmtPct(t.implied)}</b> BOOK IMPLIES</span><span class="stat ev"><b>${evPct(t.ev)}</b> EV</span></div>
</div>`;
}
function sheetSection(id, kicker, h1, sub, body, footRight) {
  return `<section class="card" id="${id}">
  <div class="brand"><img src="../promo/assets/lockup.png" alt="Cappers &amp; Code"><span>${esc(kicker)}</span></div>
  <h1>${h1}</h1>
  <p class="sub">${sub}</p>
  ${body}
  <div class="foot"><span>UNITS, NOT DOLLARS</span><span>${esc(footRight)}</span></div>
</section>`;
}
const RULES = `Every leg beats its own price in the model. One leg per game, always. No leg twice on a sheet.`;

// ---------- sections ----------
const by = Object.fromEntries(built.sheets.map((s) => [s.key, s]));
const sections = [];
const rendered = [];

{
  const s = by.lockedIn;
  sections.push(
    sheetSection(
      'locked',
      `WEEK ${board.week} · LOCKED IN · SIDES AND TOTALS`,
      `Locked In, <span>five tickets</span>`,
      `Two doubles and three triples from the model's sides and totals at the current number, all at -110. ${RULES}`,
      s.tickets.map((t) => ticketCard(t, `#${t.rank} · ${t.legs.length}-LEG`)).join('\n'),
      `NUMBERS AS OF ${pulledAt} ET`,
    ),
  );
  rendered.push({ id: 'locked', title: 'Locked In', file: `${stem}-locked.png` });
}
{
  const s = by.anytime;
  sections.push(
    sheetSection(
      'anytime',
      `WEEK ${board.week} · ANYTIME TOUCHDOWN PARLAYS`,
      `Anytime TD, <span>five tickets</span>`,
      `Two- and three-scorer tickets under ${fmtPrice(1500)}, ranked by edge with the hit rate weighed in. A tag next to a name is Friday's designation. ${RULES}`,
      s.tickets.map((t) => ticketCard(t, `#${t.rank} · ${t.legs.length} SCORERS`)).join('\n'),
      `FD/DK PRICES AS OF ${pulledAt} ET`,
    ),
  );
  rendered.push({ id: 'anytime', title: 'Anytime TD', file: `${stem}-anytime.png` });
}
{
  const s = by.twoPlus;
  const rows = s.tickets
    .map((t) => {
      const l = t.legs[0];
      return `<tr><td class="p">${t.rank}</td><td>${esc(l.player)} <small>${esc(l.team)} · ${esc(l.gameLabel)} · ${et(l.kickoff)}${l.bellcow ? ' · bell-cow' : ''}${l.status ? ' · ' + esc(l.status.toUpperCase()) : ''}</small></td><td class="r p">${fmtPrice(l.price)} ${esc(l.book)}</td><td class="r e">${fmtPct(l.prob)}</td><td class="r">${fmtPct(l.implied)}</td><td class="r">${fmtPrice(l.fair)}</td><td class="r e">${evPct(t.ev)}</td><td class="r">${fmtPct(l.anytime)}</td></tr>`;
    })
    .join('\n');
  const body = s.tickets.length
    ? `<table class="td"><tr><th>#</th><th>Player</th><th class="r">2+ price</th><th class="r">Model</th><th class="r">Implied</th><th class="r">Fair</th><th class="r">EV</th><th class="r">Anytime</th></tr>${rows}</table>`
    : `<div class="empty">No 2+ TD price on FanDuel or DraftKings clears the model yet. Re-check after the next pull.</div>`;
  sections.push(
    sheetSection(
      'td2',
      `WEEK ${board.week} · TWO OR MORE TOUCHDOWNS`,
      `2+ TD, <span>the five that price</span>`,
      `Real FanDuel and DraftKings 2+ TD prices against the model's number for two or more, ranked by edge with the hit rate weighed in. Fair is what the model would charge; play the book price or longer. Week 1 graded this band 57% on the top calls.`,
      body,
      `FD/DK PRICES AS OF ${pulledAt} ET`,
    ),
  );
  rendered.push({ id: 'td2', title: '2+ TD', file: `${stem}-td2.png` });
}
for (const key of ['long2k', 'long3k']) {
  const s = by[key];
  const b = BANDS[key];
  const id = key;
  const label = key === 'long2k' ? '+2000s' : '+3000s';
  const body = s.tickets.length
    ? s.tickets.map((t) => ticketCard(t, `#${t.rank} · ${t.legs.length}-LEG`)).join('\n')
    : `<div class="empty">Nothing in this band clears the floors today. A ticket has to hit ${fmtPct(b.minProb)} of the time or more with every leg carrying ${Math.round(EDGE_FLOOR.long * 100)}+ points of edge; the sheet would rather be short than pad.</div>`;
  sections.push(
    sheetSection(
      id,
      `WEEK ${board.week} · LONG SHOTS · ${label}`,
      `Long shots, <span>${label}</span>`,
      `${fmtPrice(b.min)} to ${fmtPrice(b.max)}, ranked by expected value with a ${fmtPct(b.minProb)} hit-rate floor. Every leg carries at least ${Math.round(EDGE_FLOOR.long * 100)} points of model edge, no player with a designation rides, and two tickets never share more than one leg.`,
      body,
      `FD/DK PRICES AS OF ${pulledAt} ET`,
    ),
  );
  rendered.push({ id, title: `Long shots ${label}`, file: `${stem}-${key}.png` });
}

// ---------- page ----------
const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Cappers &amp; Code · Week ${board.week} sheets</title>
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
  body.only .card { display: none; }
  body.only .card:target { display: flex; }
  .card::before { content: ""; position: absolute; left: 0; top: 0; width: 100%; height: 6px; background: #B6FF00; }
  .brand { display: flex; justify-content: space-between; align-items: center; font-family: 'JetBrains Mono'; letter-spacing: 3px; font-size: 17px; color: #B6FF00; font-weight: 700; }
  .brand img { width: 220px; display: block; }
  h1 { font-family: 'Barlow Condensed'; font-weight: 900; text-transform: uppercase; font-size: 84px; margin: 22px 0 6px; letter-spacing: 1px; line-height: .92; }
  h1 span { color: #B6FF00; }
  .sub { color: #C8CFC8; font-size: 20px; margin: 0 0 22px; line-height: 1.4; font-weight: 500; }

  .ticket { border: 1px solid rgba(182,255,0,.35); box-shadow: 0 0 18px rgba(182,255,0,.10); border-left: 5px solid #B6FF00; border-radius: 10px; background: #0B0E10; margin-bottom: 14px; overflow: hidden; }
  .ticket .hd { display: flex; justify-content: space-between; align-items: center; padding: 12px 22px; border-bottom: 1px solid #1B2022; }
  .tag { font-family: 'JetBrains Mono'; font-size: 15px; font-weight: 700; color: #B6FF00; letter-spacing: 3px; }
  .odds { font-family: 'JetBrains Mono'; font-size: 34px; font-weight: 700; color: #B6FF00; }
  .legs { padding: 6px 22px; }
  .leg { display: grid; grid-template-columns: 92px 1fr 300px 120px 130px; gap: 14px; align-items: baseline; padding: 9px 0; border-bottom: 1px solid #14181A; }
  .leg:last-child { border-bottom: 0; }
  .leg .k { font-family: 'JetBrains Mono'; font-size: 12px; letter-spacing: 2px; color: #79E000; font-weight: 700; }
  .leg .nm { font-family: 'Barlow Condensed'; font-weight: 800; font-size: 32px; text-transform: uppercase; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .leg .nm .q { font-family: 'JetBrains Mono'; font-style: normal; font-size: 12px; letter-spacing: 2px; color: #050608; background: #F5F7F2; border-radius: 3px; padding: 2px 6px; margin-left: 10px; vertical-align: middle; }
  .leg .meta { font-family: 'JetBrains Mono'; font-size: 13px; color: #9DA59D; letter-spacing: 1px; white-space: nowrap; }
  .leg .px { font-family: 'JetBrains Mono'; font-size: 19px; font-weight: 700; color: #F5F7F2; text-align: right; white-space: nowrap; }
  .leg .mv { font-family: 'JetBrains Mono'; font-size: 17px; font-weight: 700; color: #B6FF00; text-align: right; white-space: nowrap; }
  .leg .mv i { font-style: normal; color: #9DA59D; font-weight: 500; font-size: 14px; }
  .ticket .ft { display: flex; gap: 34px; padding: 10px 22px 13px; border-top: 1px solid #1B2022; font-family: 'JetBrains Mono'; font-size: 13px; letter-spacing: 2px; color: #9DA59D; }
  .ticket .ft b { font-size: 22px; color: #F5F7F2; margin-right: 8px; letter-spacing: 0; }
  .ticket .ft .ev b { color: #B6FF00; }
  .ticket .ft .muted b { color: #C8CFC8; }

  table.td { width: 100%; border-collapse: collapse; font-size: 24px; }
  table.td td:nth-child(2) { font-family: 'Barlow Condensed'; font-weight: 800; font-size: 32px; text-transform: uppercase; }
  table.td td:nth-child(2) small { font-family: 'JetBrains Mono'; font-weight: 500; text-transform: uppercase; font-size: 13px; color: #9DA59D; display: block; letter-spacing: 1px; margin-top: 4px; }
  table.td th { text-align: left; font-family: 'JetBrains Mono'; color: #B6FF00; letter-spacing: 3px; font-size: 14px; padding: 0 12px 10px; border-bottom: 1px solid #23282A; }
  table.td th.r { text-align: right; }
  table.td td { padding: 13px 12px; border-bottom: 1px solid #16191B; }
  table.td td.r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; font-family: 'JetBrains Mono'; font-weight: 700; font-size: 21px; }
  table.td td.p { color: #B6FF00; }
  table.td td.e { color: #79E000; }
  .empty { border: 1px dashed rgba(182,255,0,.35); border-radius: 10px; padding: 28px; color: #C8CFC8; font-size: 20px; line-height: 1.45; }
  .foot { margin-top: 26px; display: flex; justify-content: space-between; font-family: 'JetBrains Mono'; color: #79E000; font-size: 15px; letter-spacing: 4px; font-weight: 700; }
</style>
</head>
<body>
<script>if (location.hash) document.body.classList.add('only');</script>
${sections.join('\n\n')}
</body>
</html>
`;
const htmlFile = path.join(SHEETS, `${stem}.html`);
fs.writeFileSync(htmlFile, html);

// ---------- render ----------
const heights = {};
if (!process.env.SHEETS_NO_RENDER) {
  for (const r of rendered) {
    const out = path.join(SHEETS, r.file);
    execFileSync(
      CHROME,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--hide-scrollbars',
        '--virtual-time-budget=4000',
        '--window-size=1200,3000',
        `--screenshot=${out}`,
        `file://${htmlFile}#${r.id}`,
      ],
      { stdio: 'ignore' },
    );
    // Trim the empty page below the card. The card and the page share one background, so the cut
    // is the last row that is not pure background, plus the card's own bottom padding.
    const h = execFileSync('python3', [
      '-c',
      `
from PIL import Image
im = Image.open(${JSON.stringify(out)}).convert('RGB')
w, h = im.size
px = im.load()
bottom = h - 1
while bottom > 0 and all(px[x, bottom] == (5, 6, 8) for x in range(0, w, 8)):
    bottom -= 1
cut = min(h, bottom + 40)
im.crop((0, 0, w, cut)).save(${JSON.stringify(out)})
print(cut)
`,
    ])
      .toString()
      .trim();
    heights[r.file] = Number(h);
  }
}

// ---------- index ----------
const indexFile = path.join(SHEETS, 'index.json');
const index = readJson(indexFile, { updatedAt: null, sheets: [] });
const id = `${board.season}-w${week}-board`;
const entry = {
  id,
  week: board.week,
  season: board.season,
  title: `Week ${board.week} sheets: five tickets a category`,
  subtitle: `Locked In, Anytime TD, 2+ TD and two long-shot bands. Every leg beats its price in the model; one leg per game; no leg twice on a sheet.`,
  postedAt: nowIso(),
  images: rendered.map((r) => ({ title: r.title, file: r.file, h: heights[r.file] ?? null })),
  tags: ['board', 'parlays', 'long-shots', 'td2'],
};
index.sheets = [entry, ...index.sheets.filter((s) => s.id !== id)];
index.updatedAt = nowIso();
writeJson(indexFile, index);

// ---------- summary ----------
console.log(
  `sheets: week ${board.week}, prices as of ${pulledAt} ET, pools ${JSON.stringify(built.pools)}`,
);
for (const s of built.sheets) {
  console.log(`\n${s.title} (${s.tickets.length})`);
  for (const t of s.tickets)
    console.log(
      `  #${t.rank} ${fmtPrice(t.price).padStart(6)}  hit ${fmtPct(t.prob).padStart(5)}  book ${fmtPct(t.implied).padStart(5)}  EV ${evPct(t.ev).padStart(6)}   ${t.legs.map((l) => `${short(l)} ${fmtPrice(l.price)}`).join(' / ')}`,
    );
}
for (const r of rendered)
  console.log(`rendered ${r.file}${heights[r.file] ? ` ${heights[r.file]}px` : ''}`);
