import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLUSTER,
  runDist,
  marginDist,
  atLeast,
  winProb,
  solveRuns,
  impliedProb,
  noVig,
  payout,
  priceRunLine,
  priceParlay,
} from './mlb-runline.mjs';

const sum = (a) => a.reduce((s, x) => s + x, 0);

test('a run distribution is a distribution with the mean it was given', () => {
  const d = runDist(4.25);
  assert.ok(Math.abs(sum(d) - 1) < 1e-9);
  const mean = d.reduce((s, p, k) => s + p * k, 0);
  assert.ok(Math.abs(mean - 4.25) < 1e-6);
});

test('clustering is calibrated to the real rate of one-run games', () => {
  // The check the model exists for: an average game, both sides 4.25 runs. Roughly 28-29% of major
  // league games finish one run apart once extra innings are counted, and extra innings almost
  // always end by one. Poisson (a very high shape) puts that near 36%, which is why it is not used.
  const oneRun = (d) => (d.get(1) ?? 0) + (d.get(-1) ?? 0) + (d.get(0) ?? 0) * 0.7;
  const fitted = oneRun(marginDist(4.25, 4.25, CLUSTER));
  const poisson = oneRun(marginDist(4.25, 4.25, 1e6));
  assert.ok(
    fitted > 0.275 && fitted < 0.3,
    `one-run finals ${(fitted * 100).toFixed(1)}%, want 28-29%`,
  );
  assert.ok(poisson > 0.34, `Poisson should overshoot, got ${(poisson * 100).toFixed(1)}%`);
});

test('an even game is an even game', () => {
  const d = marginDist(4, 4);
  assert.ok(Math.abs(winProb(d) - 0.5) < 1e-6);
  assert.ok(Math.abs(atLeast(d, 2) - atLeast(new Map([...d].map(([k, p]) => [-k, p])), 2)) < 1e-9);
});

test('splitting a total reproduces the win probability it was solved from', () => {
  for (const [total, p] of [
    [8, 0.729],
    [7.5, 0.644],
    [8.5, 0.5],
  ]) {
    const { fav, dog } = solveRuns(total, p);
    assert.ok(Math.abs(fav + dog - total) < 1e-3);
    assert.ok(Math.abs(winProb(marginDist(fav, dog)) - p) < 1e-3);
  }
});

test('odds conversions', () => {
  assert.ok(Math.abs(impliedProb(-137) - 0.5781) < 0.001);
  assert.ok(Math.abs(impliedProb(144) - 0.4098) < 0.001);
  assert.ok(Math.abs(payout(-137) - 0.7299) < 0.001);
  assert.equal(payout(100), 1);
  // Vig comes out of a two-way market.
  assert.ok(noVig(-320, 253) < impliedProb(-320));
});

test('a coin-flip team is a bad bet at -1.5 and a heavy favourite is not', () => {
  const flip = priceRunLine({ total: 8, favML: -112, dogML: -108, price: 144 });
  const heavy = priceRunLine({ total: 8, favML: -320, dogML: 253, price: -137 });
  // Winning half your games is not the same as winning half of them by two.
  assert.ok(flip.cover < 0.36, `coin flip covers ${flip.cover}`);
  assert.ok(heavy.cover > 0.5, `heavy favourite covers ${heavy.cover}`);
  // Both lose to the price, but the coin flip loses by far more.
  assert.ok(flip.ev < heavy.ev - 0.1);
});

test('a longer line is harder to cover than a shorter one', () => {
  const a = priceRunLine({ total: 8, favML: -320, dogML: 253, price: -137, line: 1.5 });
  const b = priceRunLine({ total: 8, favML: -320, dogML: 253, price: -137, line: 2.5 });
  assert.ok(b.cover < a.cover);
});

test('a parlay multiplies both sides of the ledger', () => {
  const legs = [
    { cover: 0.5, price: 100 },
    { cover: 0.5, price: 100 },
  ];
  const p = priceParlay(legs);
  assert.equal(p.prob, 0.25);
  assert.equal(p.decimal, 4);
  assert.equal(p.american, 300);
  assert.equal(p.ev, 0); // a fair coin at a fair price is a push in expectation
});
