// Renders a free-plays sheet (a hand-written slate, not the model's board) as a brand graphic.
//
//   node scripts/build-free-sheet.mjs data/sheets/free/2026-10-10-cfb.json
//   SHEETS_NO_RENDER=1 ...                                   write the HTML only
//
// The spec is a JSON file: kicker, title, sub, footRight and sections of two kinds, `table`
// (play / odds / units / game and time) and `tickets` (parlay cards with their own rows). The
// PNG lands in site/sheets/<id>.png next to the weekly sheets so Discord embeds can link to it.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, readJson } from './lib.mjs';

const specFile = process.argv[2];
if (!specFile) {
  console.error('usage: node scripts/build-free-sheet.mjs <spec.json>');
  process.exit(1);
}
const spec = readJson(path.resolve(specFile));
const SHEETS = path.join(ROOT, 'site', 'sheets');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const price = (p) => (typeof p === 'number' ? (p > 0 ? `+${p}` : String(p)) : String(p));
const units = (u) => (typeof u === 'number' ? `${u}u` : String(u));

function tableSection(s) {
  const rows = s.rows
    .map(
      (r) => `<div class="row">
  <span class="nm">${esc(r.play)}${r.note ? `<small>${esc(r.note)}</small>` : ''}</span>
  <span class="px">${price(r.odds)}</span>
  <span class="un">${units(r.units)}</span>
  <span class="meta">${esc(r.game)}${r.time ? `<br>${esc(r.time)}` : ''}</span>
</div>`,
    )
    .join('\n');
  return `<div class="block">
  <div class="bh"><span class="tag">${esc(s.label)}</span><span class="cols"><i>ODDS</i><i>UNITS</i><i>GAME · TIME</i></span></div>
  ${rows}
</div>`;
}
function ticketsSection(s) {
  const cards = s.tickets
    .map(
      (t) => `<div class="ticket">
  <div class="hd"><span class="tag">${esc(t.tag)}</span><span class="names">${t.players.map(esc).join(' <i>/</i> ')}</span></div>
  ${t.rows
    .map(
      (r) =>
        `<div class="trow"><span class="nm">${esc(r.play)}</span><span class="px">${price(r.odds)}</span><span class="un">${esc(r.units)}</span></div>`,
    )
    .join('\n')}
  <div class="ft">${esc(t.times)}</div>
</div>`,
    )
    .join('\n');
  return `<div class="block">
  <div class="bh"><span class="tag">${esc(s.label)}</span></div>
  <div class="grid">${cards}</div>
</div>`;
}

const body = spec.sections
  .map((s) => (s.kind === 'tickets' ? ticketsSection(s) : tableSection(s)))
  .join('\n');
const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Cappers &amp; Code · ${esc(spec.id)}</title>
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
  .card::before { content: ""; position: absolute; left: 0; top: 0; width: 100%; height: 6px; background: #B6FF00; }
  .brand { display: flex; justify-content: space-between; align-items: center; font-family: 'JetBrains Mono'; letter-spacing: 3px; font-size: 16px; color: #B6FF00; font-weight: 700; }
  .brand img { width: 220px; display: block; }
  h1 { font-family: 'Barlow Condensed'; font-weight: 900; text-transform: uppercase; font-size: 84px; margin: 22px 0 6px; letter-spacing: 1px; line-height: .92; }
  h1 span { color: #B6FF00; }
  .sub { color: #C8CFC8; font-size: 20px; margin: 0 0 26px; line-height: 1.4; font-weight: 500; }

  .block { border: 1px solid rgba(182,255,0,.35); box-shadow: 0 0 18px rgba(182,255,0,.10); border-left: 5px solid #B6FF00; border-radius: 10px; background: #0B0E10; margin-bottom: 18px; overflow: hidden; }
  .bh { display: flex; justify-content: space-between; align-items: center; padding: 14px 22px; border-bottom: 1px solid #1B2022; }
  .tag { font-family: 'JetBrains Mono'; font-size: 15px; font-weight: 700; color: #B6FF00; letter-spacing: 3px; }
  .cols { display: grid; grid-template-columns: 120px 110px 300px; gap: 14px; font-family: 'JetBrains Mono'; font-size: 12px; letter-spacing: 2px; color: #9DA59D; }
  .cols i { font-style: normal; text-align: right; }
  .cols i:last-child { text-align: left; }
  .row { display: grid; grid-template-columns: 1fr 120px 110px 300px; gap: 14px; align-items: center; padding: 12px 22px; border-bottom: 1px solid #14181A; }
  .row:last-child { border-bottom: 0; }
  .nm { font-family: 'Barlow Condensed'; font-weight: 800; font-size: 30px; text-transform: uppercase; line-height: 1; }
  .nm small { display: block; font-family: 'JetBrains Mono'; font-weight: 500; font-size: 12px; letter-spacing: 1.5px; color: #9DA59D; margin-top: 6px; text-transform: uppercase; }
  .px { font-family: 'JetBrains Mono'; font-size: 24px; font-weight: 700; color: #B6FF00; text-align: right; white-space: nowrap; }
  .un { font-family: 'JetBrains Mono'; font-size: 20px; font-weight: 700; color: #F5F7F2; text-align: right; white-space: nowrap; }
  .meta { font-family: 'JetBrains Mono'; font-size: 13px; color: #9DA59D; letter-spacing: 1px; line-height: 1.5; }

  .grid { padding: 16px 22px 6px; }
  .ticket { border: 1px solid #1F2622; border-radius: 10px; background: #080B0D; margin-bottom: 14px; overflow: hidden; }
  .ticket .hd { display: flex; align-items: center; gap: 18px; padding: 12px 20px; border-bottom: 1px solid #1B2022; }
  .ticket .hd .tag { background: #B6FF00; color: #050608; border-radius: 4px; padding: 3px 10px; letter-spacing: 1px; font-size: 16px; }
  .ticket .names { font-family: 'Barlow Condensed'; font-weight: 800; font-size: 30px; text-transform: uppercase; line-height: 1; }
  .ticket .names i { font-style: normal; color: #79E000; padding: 0 4px; }
  .trow { display: grid; grid-template-columns: 1fr 330px 150px; gap: 14px; align-items: center; padding: 9px 20px; border-bottom: 1px solid #14181A; }
  .trow .nm { font-size: 24px; }
  .trow .px { font-size: 22px; }
  .trow .un { font-size: 17px; color: #C8CFC8; }
  .ticket .ft { padding: 9px 20px 12px; font-family: 'JetBrains Mono'; font-size: 12.5px; letter-spacing: 1.5px; color: #9DA59D; text-transform: uppercase; }
  .foot { margin-top: 10px; display: flex; justify-content: space-between; font-family: 'JetBrains Mono'; color: #79E000; font-size: 15px; letter-spacing: 4px; font-weight: 700; }
</style>
</head>
<body>
<section class="card" id="${esc(spec.id)}">
  <div class="brand"><img src="../promo/assets/lockup.png" alt="Cappers &amp; Code"><span>${esc(spec.kicker)}</span></div>
  <h1>${spec.title}</h1>
  <p class="sub">${esc(spec.sub)}</p>
  ${body}
  <div class="foot"><span>UNITS, NOT DOLLARS</span><span>${esc(spec.footRight)}</span></div>
</section>
</body>
</html>
`;
const htmlFile = path.join(SHEETS, `${spec.id}.html`);
fs.writeFileSync(htmlFile, html);
const out = path.join(SHEETS, `${spec.id}.png`);
if (!process.env.SHEETS_NO_RENDER) {
  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--virtual-time-budget=4000',
      '--window-size=1200,3200',
      `--screenshot=${out}`,
      `file://${htmlFile}`,
    ],
    { stdio: 'ignore' },
  );
  try {
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
    console.log(`${path.relative(ROOT, out)} (1200x${h})`);
  } catch {
    console.log(`${path.relative(ROOT, out)} (uncropped)`);
  }
} else console.log(`${path.relative(ROOT, htmlFile)} written; render skipped`);
