// The max-confidence five-legs as a brand sheet: reads board.maxFive (scripts/best-of.mjs), writes
// the spec to data/sheets/free/<day>-w<wk>-max-five.json and renders it with build-free-sheet.mjs
// (site/sheets/<id>.png, .html and a Discord .txt).
//
//   node scripts/build-board.mjs && node scripts/max-five-sheet.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATA, ROOT, readJson, writeJson } from './lib.mjs';

const board = readJson(path.join(DATA, 'board.json'));
const m = board.maxFive;
if (!m?.tickets?.length) {
  console.error('board.maxFive is empty: run scripts/build-board.mjs on a day with open games');
  process.exit(1);
}
const pct = (x) => `${Math.round(x * 100)}%`;
const day = new Date(`${m.day}T12:00:00Z`);
const dayUpper = day
  .toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' })
  .toUpperCase();
const priced = new Date(m.pricedAt ?? m.checkedAt ?? m.builtAt).toLocaleString('en-US', {
  timeZone: 'America/Chicago',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const id = `w${String(board.week).padStart(2, '0')}-${m.day}-max-five`;
const spec = {
  id,
  kicker: `WEEK ${board.week} · ${dayUpper} · ${m.tickets.length} TICKET${m.tickets.length === 1 ? '' : 'S'}`,
  title: 'Max-confidence <span>five-legs</span>',
  sub: 'No touchdowns: every leg is a volume prop at an alternate line under the main number. These are the tickets with the best hit rate on the slate, and every leg was checked before kickoff against the injury report, the main line and the conditions. 0.25u each.',
  footRight: `DK/FD PRICES ${priced} CT · 21+ · BET RESPONSIBLY`,
  sections: [
    {
      kind: 'tickets',
      label: m.tickets.length === 1 ? 'THE TICKET' : 'BEST HIT RATE FIRST',
      tickets: m.tickets.map((t) => ({
        tag: String(t.rank),
        players: [`${t.gameLabel} five-leg, no TDs`],
        rows: [
          ...t.legs.map((l) => ({ play: l.label, odds: l.price, units: '' })),
          {
            play: `Ticket · model ${pct(t.joint)} vs book ${pct(t.bookJoint)}`,
            odds: t.price,
            units: '0.25u',
          },
        ],
        times: t.kickoffLabel,
      })),
    },
  ],
};
const specFile = path.join(
  DATA,
  'sheets',
  'free',
  `${m.day}-w${String(board.week).padStart(2, '0')}-max-five.json`,
);
writeJson(specFile, spec);
console.log(`spec: ${path.relative(ROOT, specFile)}`);
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-free-sheet.mjs'), specFile], {
  stdio: 'inherit',
  env: process.env,
});
// The Discord text matches the app's COPY FOR DISCORD block.
const txt = path.join(ROOT, 'site', 'sheets', `${id}.txt`);
fs.writeFileSync(txt, `${m.text}\n`);
console.log(`text: ${path.relative(ROOT, txt)}`);
