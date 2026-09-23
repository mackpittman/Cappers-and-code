import test from 'node:test';
import assert from 'node:assert/strict';
import { outcomes, priceTicket, checkIndependence } from './mlb-parlay.mjs';

test('outcome probabilities always sum to one', () => {
  const legs = [
    { key: 'a', game: 'X', prob: 0.55, push: 0.1, price: -110 },
    { key: 'b', game: 'Y', prob: 0.52, push: 0.1, price: -105 },
  ];
  const s = outcomes(legs).reduce((t, x) => t + x.p, 0);
  assert.ok(Math.abs(s - 1) < 1e-9);
});

test('a push voids the leg rather than losing the ticket', () => {
  // One leg, 50% win, 20% push, 30% lose at even money. A naive pricer says 50% to return.
  const t = priceTicket([{ key: 'a', game: 'X', prob: 0.5, push: 0.2, price: 100 }], 100);
  // The stake comes back on a push, so something is returned 70% of the time.
  assert.equal(t.modelAnyReturn.toFixed(4), '0.7000');
  assert.equal(t.modelWinAll.toFixed(4), '0.5000');
  // Expected return: 50% x $200 + 20% x $100 = $120.
  assert.equal(t.expectedReturn.toFixed(2), '120.00');
  assert.equal(t.ev.toFixed(4), '0.2000');
});

test('two pushable legs reduce the ticket about a fifth of the time', () => {
  const legs = [
    { key: 'a', game: 'X', prob: 0.55, push: 0.1, price: -110 },
    { key: 'b', game: 'Y', prob: 0.55, push: 0.1, price: -110 },
  ];
  const t = priceTicket(legs, 100);
  // Both legs clean is 0.55 x 0.55; anything that returns is more than that.
  assert.ok(Math.abs(t.modelWinAll - 0.3025) < 1e-9);
  assert.ok(t.modelAnyReturn > t.modelWinAll);
  // The posted price is still the all-win price.
  assert.equal(t.decimal.toFixed(3), (1.909090909 * 1.909090909).toFixed(3));
});

test('a ticket with no pushes prices the same as the textbook parlay', () => {
  const legs = [
    { key: 'a', game: 'X', prob: 0.6, price: 100 },
    { key: 'b', game: 'Y', prob: 0.6, price: 100 },
  ];
  const t = priceTicket(legs, 100);
  assert.equal(t.decimal, 4);
  assert.equal(t.modelWinAll.toFixed(4), '0.3600');
  assert.equal(t.expectedReturn.toFixed(2), '144.00');
  assert.equal(t.payout.toFixed(2), '400.00');
});

test('same-game legs are caught before they are multiplied', () => {
  const clash = checkIndependence([
    { key: 'COL ML', game: 'ARI@COL' },
    { key: 'Under 11', game: 'ARI@COL' },
  ]);
  assert.equal(clash.length, 1);
  assert.equal(
    checkIndependence([
      { key: 'a', game: 'X' },
      { key: 'b', game: 'Y' },
    ]).length,
    0,
  );
});
