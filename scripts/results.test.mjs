// Guards the results ledger: every price is real American odds, every payout is the arithmetic
// payout, and the numbers printed on the results graphic match the ledger they claim to summarize.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ledger = JSON.parse(readFileSync(new URL('../site/sheets/results.json', import.meta.url)));
const card = readFileSync(new URL('../site/sheets/w01-results.html', import.meta.url), 'utf8');

const dec = (a) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
const toWin = (a) => dec(a) - 1;
const net = (i) =>
  i.result === 'win' ? i.units * toWin(i.price) : i.result === 'loss' ? -i.units : 0;
const items = ledger.days.flatMap((d) => d.groups.flatMap((g) => g.items));

test('american odds convert to the payout a book actually pays', () => {
  assert.equal(toWin(100), 1);
  assert.equal(toWin(1400), 14); // +1400 pays 14 to 1: one unit wins fourteen
  assert.equal(toWin(-110).toFixed(4), '0.9091');
  assert.equal(toWin(-200), 0.5);
});

test('every ledger row is a legal ticket', () => {
  for (const i of items) {
    assert.ok(Number.isFinite(i.price) && Math.abs(i.price) >= 100, `bad price: ${i.label}`);
    assert.ok(i.units > 0 && i.units <= 5, `bad stake: ${i.label}`);
    assert.ok(['win', 'loss', 'push', 'pending'].includes(i.result), `bad result: ${i.label}`);
  }
});

test('net units are stake times payout, and scale linearly with stake', () => {
  for (const i of items) {
    if (i.result === 'win')
      assert.equal(+net(i).toFixed(6), +(i.units * toWin(i.price)).toFixed(6));
    if (i.result === 'loss') assert.equal(net(i), -i.units);
    if (i.result !== 'win' && i.result !== 'loss') assert.equal(net(i), 0);
  }
  const flat = items.filter((i) => i.result === 'win').reduce((a, i) => a + toWin(i.price), 0);
  const quarter = items
    .filter((i) => i.result === 'win')
    .reduce((a, i) => a + 0.25 * toWin(i.price), 0);
  assert.equal(+quarter.toFixed(6), +(flat * 0.25).toFixed(6));
});

test('the results graphic prints the same totals as the ledger', () => {
  const day = ledger.days[0];
  const flat = day.groups.flatMap((g) => g.items);
  let units = 0,
    staked = 0,
    wins = 0,
    losses = 0,
    pending = 0;
  for (const i of flat) {
    units += net(i);
    if (i.result === 'win') wins++;
    else if (i.result === 'loss') losses++;
    else if (i.result === 'pending') pending++;
    if (i.result !== 'pending') staked += i.units;
  }
  const roi = Math.round((units / staked) * 100);
  assert.match(card, new RegExp(`\\+${units.toFixed(2)}`), 'net units on the card');
  assert.match(card, new RegExp(`>${roi}%<`), 'ROI on the card');
  assert.match(card, new RegExp(`>${wins}-${losses}<`), 'record on the card');
  assert.match(card, new RegExp(`>${pending}<`), 'live count on the card');
  assert.match(card, new RegExp(staked.toFixed(2)), 'units risked on the card');
  for (const unit of [3, 10, 25, 100]) {
    const dollars = Math.round(units * unit).toLocaleString('en-US');
    assert.match(card, new RegExp(`\\+\\$${dollars.replace(/,/g, ',')}`), `${unit} dollar units`);
  }
});
