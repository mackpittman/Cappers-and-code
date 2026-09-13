import test from 'node:test';
import assert from 'node:assert/strict';
import { twoPlusProb, toAmerican, toDecimal, bookPrice, buildParlays, phi } from './parlays.mjs';

test('two-plus TD probability from the anytime estimate', () => {
  assert.ok(Math.abs(twoPlusProb(0.5) - 0.153) < 0.005); // lambda 0.693 -> 15.3%
  assert.ok(twoPlusProb(0.78) > 0.4 && twoPlusProb(0.78) < 0.5);
  assert.equal(twoPlusProb(0), 0);
});
test('odds conversions round-trip', () => {
  assert.equal(toAmerican(toDecimal(-150)), -150);
  assert.equal(toAmerican(toDecimal(230)), 230);
  assert.ok(Math.abs(phi(0) - 0.5) < 1e-6 && Math.abs(phi(1.96) - 0.975) < 0.001);
});
test('book price uses only FanDuel and DraftKings', () => {
  assert.deepEqual(bookPrice({ betmgm: 200, draftkings: 150, fanduel: 160 }), {
    price: 160,
    book: 'FD',
  });
  assert.equal(bookPrice({ betmgm: 200 }), null);
});
test('builder ranks cross-game TD parlays by expected value', () => {
  const pick = (name, team, est, dk, fd, td2) => ({
    name,
    team,
    pos: 'RB',
    price: dk,
    est,
    why: 'w',
    live: { books: { draftkings: dk, fanduel: fd } },
    live2: td2
      ? {
          books: td2,
          best: Math.max(...Object.values(td2)),
          consensus: Math.max(...Object.values(td2)),
          implied: 0,
        }
      : null,
  });
  const game = (id, away, home, top3, side, total, proj) => ({
    id,
    kickoff: '2026-09-13T17:00:00Z',
    away: { abbr: away },
    home: { abbr: home },
    top3,
    value: [],
    stacks: [],
    market: { projected: proj, side, sideConf: 3, total, totalConf: 3, why: 'why' },
    status: { state: 'STATUS_SCHEDULED' },
  });
  const board = {
    oddsFetchedAt: new Date().toISOString(),
    crossStacks: [{ legs: ['A', 'B'], why: 'w', type: 'cross' }],
    games: [
      game(
        'a',
        'TB',
        'CIN',
        [pick('Chase Brown', 'CIN', 0.6, -140, -135)],
        'CIN -3.5',
        'Over 50.5',
        { away: 24, home: 30 },
      ),
      game(
        'b',
        'NO',
        'DET',
        [pick('Jahmyr Gibbs', 'DET', 0.78, -320, -330, { fanduel: 140, draftkings: 135 })],
        'DET -7',
        'Over 49.5',
        { away: 20, home: 31 },
      ),
      game(
        'c',
        'BAL',
        'IND',
        [pick('Jonathan Taylor', 'IND', 0.62, -190, -185)],
        'IND +3.5',
        'Over 47.5',
        { away: 24, home: 27 },
      ),
    ],
  };
  const p = buildParlays(board);
  const anytime = p.categories.find((c) => c.key === 'anytime').parlays;
  assert.ok(anytime.length >= 1 && anytime[0].rank === 1);
  assert.ok(anytime.every((x) => new Set(x.legs.map((l) => l.game)).size === x.legs.length));
  assert.ok(anytime[0].ev >= anytime[anytime.length - 1].ev);
  const two = p.categories.find((c) => c.key === 'twoPlus').parlays;
  assert.equal(two[0].legs[0].label, 'Jahmyr Gibbs 2+ TDs');
  assert.equal(two[0].price, 140);
  assert.equal(two[0].legs[0].book, 'FD');
  assert.ok(two[0].ev > 0);
  assert.equal(two[1].price, null);
  assert.ok(two[0].fairPrice > 0 && two[0].minPrice > two[0].fairPrice);
  const sides = p.categories.find((c) => c.key === 'sides').parlays;
  assert.ok(sides.length >= 1 && sides[0].legs.every((l) => l.price === -110));
  assert.equal(p.categories.find((c) => c.key === 'model').parlays[0].legs[0].label, 'A');
});
