// Builds the ticket from a priced slate: the legs that survived the sensitivity sweep, one per
// game, best robust edge first.
//
//   DATE=2026-09-23 LEGS=3 STAKE=100 node scripts/mlb-ticket.mjs
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './lib.mjs';
import { priceTicket, checkIndependence } from './mlb-parlay.mjs';
import { payout } from './mlb-model.mjs';

const DATE = process.env.DATE ?? new Date().toISOString().slice(0, 10);
const WANT = Number(process.env.LEGS ?? 3);
const STAKE = Number(process.env.STAKE ?? 100);
const MIN_MINUTES = Number(process.env.MIN_MINUTES ?? 15);
const m = JSON.parse(fs.readFileSync(path.join(DATA, 'mlb', `${DATE}-model.json`), 'utf8'));

const now = Date.now();
const all = m.games
  .filter((g) => (Date.parse(g.kickoff) - now) / 60000 >= MIN_MINUTES)
  .flatMap((g) => g.legs.map((l) => ({ ...l, kickoff: g.kickoff })))
  .filter((l) => l.robustEdge > 0)
  .filter((l) => l.trusted !== false) // run lines sit on a known model bias this run
  .sort((a, b) => b.robustEdge - a.robustEdge);

// One leg per game: two legs off the same run distribution are not independent, and multiplying
// them prices a correlation that is not there.
const picked = [];
for (const l of all) {
  if (picked.some((p) => p.game === l.game)) continue;
  picked.push(l);
  if (picked.length === WANT) break;
}

const clashes = checkIndependence(picked);
if (clashes.length) {
  console.error('refusing to price a same-game parlay as independent:', clashes.join('; '));
  process.exit(1);
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const sign = (x) => `${x > 0 ? '+' : ''}${x}`;

console.log(`Candidates that survived the sweep (${all.length}):`);
for (const l of all)
  console.log(
    `  ${l.game.padEnd(9)} ${l.key.padEnd(12)} ${sign(l.price).padStart(6)}  model ${pct(l.conditional)}  need ${pct(l.breakEven)}  robust +${(l.robustEdge * 100).toFixed(1)}  single EV ${(l.ev * 100).toFixed(1)}%`,
  );

const t = priceTicket(picked, STAKE);
// The same ticket priced at the worst corner of the sensitivity sweep. The headline number uses
// each leg's central estimate; this uses the floor that survived every park factor, market weight
// and clustering value tried. It is the number to believe.
const floorLegs = picked.map((l) => ({
  ...l,
  prob: Math.max(0, l.floor * (1 - (l.pushFloor ?? l.push ?? 0))),
  push: l.pushFloor ?? l.push ?? 0,
}));
const tFloor = priceTicket(floorLegs, STAKE);
console.log(`\n$${STAKE} parlay, ${t.legs} legs, one per game:\n`);
for (const l of picked)
  console.log(
    `  ${l.game.padEnd(9)} ${l.key.padEnd(12)} ${sign(l.price).padStart(6)}   model ${pct(l.conditional)}${l.push ? `, push ${pct(l.push)}` : ''}   ${new Date(l.kickoff).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET`,
  );
console.log('');
console.log(`  price          ${sign(t.american)}  (decimal ${t.decimal})`);
console.log(
  `  returns        $${t.payout.toFixed(2)} on a $${STAKE} stake, profit $${t.toWin.toFixed(2)}`,
);
console.log(`  book needs     ${pct(t.breakEven)} to break even`);
console.log(`  model, all win ${pct(t.modelWinAll)}`);
console.log(
  `  any return     ${pct(t.modelAnyReturn)}  (a whole-number total that lands exactly on the number voids that leg)`,
);
console.log(
  `  expected       $${t.expectedReturn.toFixed(2)}  =  ${(t.ev * 100).toFixed(1)}% on the stake, at the model's central estimate`,
);
console.log(
  `  conservative   $${tFloor.expectedReturn.toFixed(2)}  =  ${(tFloor.ev * 100).toFixed(1)}%, at the worst corner of the sweep`,
);
if (t.modelWinAll < t.breakEven)
  console.log(
    `\n  Note: all three landing clean is ${pct(t.modelWinAll)} against a ${pct(t.breakEven)} break-even. This\n  ticket is only ahead because a whole-number total lands exactly on the number often\n  enough to void a leg and pay the rest. Without pushes it would be a losing bet.`,
  );
console.log('');
console.log(`  The same $${STAKE} split evenly across the ${picked.length} legs straight:`);
let straight = 0;
let straightFloor = 0;
for (let i = 0; i < picked.length; i++) {
  straight += (STAKE / picked.length) * (1 + picked[i].ev);
  straightFloor += (STAKE / picked.length) * (1 + priceTicket([floorLegs[i]], 1).ev);
}
console.log(
  `    expected $${straight.toFixed(2)} = ${(((straight - STAKE) / STAKE) * 100).toFixed(1)}% central, $${straightFloor.toFixed(2)} = ${(((straightFloor - STAKE) / STAKE) * 100).toFixed(1)}% at the same worst corner.`,
);
console.log(
  `    Multiplying three thin edges multiplies the uncertainty with them: the parlay swings\n    ${(t.ev * 100).toFixed(1)}% to ${(tFloor.ev * 100).toFixed(1)}% across the sweep where the straights swing ${(((straight - STAKE) / STAKE) * 100).toFixed(1)}% to ${(((straightFloor - STAKE) / STAKE) * 100).toFixed(1)}%.`,
);
