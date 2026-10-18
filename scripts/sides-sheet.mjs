// The front page's spreads and moneylines as a brand sheet: reads board.sides (scripts/sides.mjs),
// writes the spec to data/sheets/free/<day>-w<wk>-sides.json and renders it with
// build-free-sheet.mjs (site/sheets/<id>.png, .html and a Discord .txt).
//
//   node scripts/build-board.mjs && node scripts/sides-sheet.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATA, ROOT, readJson, writeJson } from './lib.mjs';

const board = readJson(path.join(DATA, 'board.json'));
const s = board.sides;
if (!s?.rows?.length) {
  console.error('board.sides is empty: run scripts/build-board.mjs on a day with open games');
  process.exit(1);
}
const pct = (x) => (x == null ? '' : `${Math.round(x * 100)}%`);
const am = (n) => (n == null ? '' : n > 0 ? `+${n}` : String(n));
const wk = String(board.week).padStart(2, '0');
const id = `w${wk}-${s.day}-sides`;
const dayUpper = new Date(`${s.day}T12:00:00Z`)
  .toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' })
  .toUpperCase();
const game = (r) => r.gameLabel.replace('@', ' @ ');
const spec = {
  id,
  kicker: `WEEK ${board.week} · ${dayUpper} · ${s.rows.length} GAMES`,
  title: 'Spreads and <span>moneylines</span>',
  sub: 'Every game on the slate, the side most likely to cover first: our projected score against the posted number, the winner the projection picks, and any underdog it rates above the price. 1u singles.',
  footRight: `LINES ${new Date(s.builtAt).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })} CT · 21+ · BET RESPONSIBLY`,
  sections: [
    {
      kind: 'table',
      label: 'SPREADS · MOST LIKELY COVER FIRST',
      rows: s.rows.map((r) => ({
        play: `${r.spread.bet} · ${pct(r.spread.prob)} to cover`,
        note: `Projected ${r.projected.away}-${r.projected.home}${r.spread.conf ? ` · confidence ${r.spread.conf} of 5` : ''}`,
        odds: r.spread.price,
        units: 1,
        game: game(r),
        time: r.kickoffLabel,
      })),
    },
    {
      kind: 'table',
      label: 'MONEYLINES · MOST LIKELY WINNER FIRST',
      rows: [...s.rows]
        .sort((a, b) => b.ml.prob - a.ml.prob)
        .map((r) => ({
          play: `${r.ml.bet} · wins ${pct(r.ml.prob)}`,
          note: r.ml.implied != null ? `Book says ${pct(r.ml.implied)}` : '',
          odds: r.ml.price ?? '',
          units: 1,
          game: game(r),
          time: r.kickoffLabel,
        })),
    },
    ...(s.rows.some((r) => r.dog)
      ? [
          {
            kind: 'table',
            label: 'UNDERDOG VALUE',
            rows: s.rows
              .filter((r) => r.dog)
              .map((r) => ({
                play: `${r.dog.bet} · wins ${pct(r.dog.prob)}`,
                note: `Book says ${pct(r.dog.implied)}`,
                odds: r.dog.price ?? '',
                units: 0.5,
                game: game(r),
                time: r.kickoffLabel,
              })),
          },
        ]
      : []),
  ],
};
const specFile = path.join(DATA, 'sheets', 'free', `${s.day}-w${wk}-sides.json`);
writeJson(specFile, spec);
console.log(`spec: ${path.relative(ROOT, specFile)}`);
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-free-sheet.mjs'), specFile], {
  stdio: 'inherit',
  env: process.env,
});
const txt = path.join(ROOT, 'site', 'sheets', `${id}.txt`);
fs.writeFileSync(txt, `${s.text}\n`);
console.log(`text: ${path.relative(ROOT, txt)}`);
