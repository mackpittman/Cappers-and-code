import test from 'node:test';
import assert from 'node:assert/strict';
import { poissonAtLeast, legProb, flattenPrices, gradeLegs, buildTicket, american } from './five-leg.mjs';

// Week 4 Monday night: the first ticket the formula produced. The means are the desk's projections
// that night and the prices are Courtside's alternate lines; the ticket cashed at +977.
const projection = {
  game: 'atl-no',
  players: [
    { team: 'NO', player: 'Chris Olave', receptions: 8.4, recYds: 92 },
    { team: 'NO', player: 'Juwan Johnson', receptions: 5.0, recYds: 48 },
    { team: 'ATL', player: 'Kyle Pitts Sr.', receptions: 3.1, recYds: 36 },
    { team: 'NO', player: 'Alvin Kamara', receptions: 4.0, recYds: 24 },
    { team: 'NO', player: 'Devaughn Vele', receptions: 4.8, recYds: 46 },
    { team: 'ATL', player: 'Drake London', receptions: 6.0, recYds: 82 },
    { team: 'ATL', player: 'Bijan Robinson', receptions: 2.8, recYds: 22, flags: ['one-game-sample'] },
  ],
};
const prices = {
  'Chris Olave': { receptions: { courtside: [[6.5, -140], [7.5, 131]] }, rec_yds: { courtside: [[86.5, -110]] } },
  'Juwan Johnson': { receptions: { courtside: [[3.5, -190], [4.5, 118]] } },
  'Kyle Pitts Sr.': { rec_yds: { courtside: [[24.5, -170], [31.5, -109]] }, receptions: { courtside: [[2.5, -168]] } },
  'Alvin Kamara': { receptions: { courtside: [[2.5, -176], [3.5, 141]] } },
  'Devaughn Vele': { receptions: { courtside: [[3.5, -153], [4.5, 140]] } },
  'Drake London': { receptions: { courtside: [[5.5, -164]] } },
  'Bijan Robinson': { receptions: { courtside: [[3.5, -202]] } },
};

test('poisson tail', () => {
  assert.ok(Math.abs(poissonAtLeast(5, 6.27) - 0.75) < 0.02);
  assert.equal(poissonAtLeast(0, 3), 1);
});

test('a one-notch-down line beats the main line on probability', () => {
  assert.ok(legProb('receptions', 'over', 3.5, 4.6) > legProb('receptions', 'over', 4.5, 4.6));
});

test('the Monday night ticket falls out of the rules', () => {
  const legs = gradeLegs(projection, flattenPrices(prices));
  assert.ok(!legs.some((l) => l.player === 'Bijan Robinson'), 'one-game samples are excluded');
  const { ticket } = buildTicket(legs, { legs: 5, target: 6 });
  assert.ok(ticket, 'a ticket reaches +500');
  const names = ticket.legs.map((l) => l.player).sort();
  assert.deepEqual(names, ['Alvin Kamara', 'Chris Olave', 'Devaughn Vele', 'Juwan Johnson', 'Kyle Pitts Sr.']);
  assert.ok(ticket.price >= 500 && ticket.price <= 1100, `price ${ticket.price}`);
  assert.ok(ticket.legs.every((l) => l.p >= 0.58));
  assert.ok(ticket.legs.filter((l) => l.team === 'NO').length <= 4);
});

test('american conversion', () => {
  assert.equal(american(2.0), 100);
  assert.equal(american(1.5), -200);
});
