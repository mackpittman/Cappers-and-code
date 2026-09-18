// The slip auto-settles from the graded board, and the whole thing rests on matching a bet
// written one way on the board to the same bet written another way on the slip. These cases are
// taken from the real Week 2 board and the real slip rows it has to settle.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLabel,
  indexResults,
  settleItem,
  isSettleable,
  pendingSettlements,
} from '../src/lib/settle.ts';

const r = (game, label, result) => ({ game, gameLabel: game, final: null, type: 'atd', label, bucket: 'x', result });
const item = (o) => ({ id: o.id ?? 'i1', day: '2026-09-17', key: 'k', units: 1, created_at: '', kind: 'atd', status: 'placed', ...o });

test('the board and the slip spell the same touchdown prop differently', () => {
  assert.equal(normalizeLabel('Amon-Ra St. Brown ATD +115'), normalizeLabel('Amon-Ra St. Brown anytime TD'));
  assert.equal(normalizeLabel('Jahmyr Gibbs 2+ TDs'), normalizeLabel('Jahmyr Gibbs 2+ TD'));
});

test('a spread keeps its number while a price is stripped', () => {
  // A two-digit rule would have turned "BUF -10" into "BUF".
  assert.equal(normalizeLabel('BUF -10'), 'buf -10');
  assert.equal(normalizeLabel('BUF -4.5'), 'buf -4.5');
  assert.equal(normalizeLabel('Over 54.5 -110'), 'over 54.5');
});

test('a single pick takes the board verdict', () => {
  const idx = indexResults([r('det-buf', 'Amon-Ra St. Brown ATD +115', 'win'), r('det-buf', 'BUF -4.5', 'win')]);
  assert.equal(settleItem(item({ label: 'Amon-Ra St. Brown anytime TD', game_id: 'det-buf' }), idx), 'won');
  assert.equal(settleItem(item({ label: 'BUF -4.5', game_id: 'det-buf' }), idx), 'won');
});

test('one losing leg sinks a ticket', () => {
  const idx = indexResults([
    r('det-buf', 'Amon-Ra St. Brown ATD', 'win'),
    r('det-buf', 'DJ Moore ATD', 'loss'),
  ]);
  const value = item({
    kind: 'parlay',
    label: 'The value pair',
    game_id: 'det-buf',
    legs: [{ label: 'Amon-Ra St. Brown anytime TD', price: 115 }, { label: 'DJ Moore anytime TD', price: 135 }],
  });
  assert.equal(settleItem(value, idx), 'lost');
});

test('a ticket wins only when every leg lands', () => {
  const idx = indexResults([r('det-buf', 'Gibbs ATD', 'win'), r('det-buf', 'St. Brown ATD', 'win')]);
  const t = item({ kind: 'parlay', game_id: 'det-buf', label: 'Both bell-cows', legs: [{ label: 'Gibbs anytime TD', price: -280 }, { label: 'St. Brown anytime TD', price: 115 }] });
  assert.equal(settleItem(t, idx), 'won');
});

test('an ungraded leg leaves the ticket alone', () => {
  const idx = indexResults([r('det-buf', 'Gibbs ATD', 'win')]);
  const t = item({ kind: 'parlay', game_id: 'det-buf', label: 'x', legs: [{ label: 'Gibbs anytime TD', price: 1 }, { label: 'Someone Else anytime TD', price: 1 }] });
  assert.equal(settleItem(t, idx), null);
});

test('the same label in two games with different outcomes is never guessed', () => {
  // "Over 54.5" can exist in several games; settling one from another would be a fabricated result.
  const idx = indexResults([r('a-b', 'Over 54.5', 'win'), r('c-d', 'Over 54.5', 'loss')]);
  assert.equal(idx.byLabel.get('over 54.5'), null);
  assert.equal(settleItem(item({ label: 'Over 54.5', game_id: 'e-f' }), idx), null);
  // With the game known it still settles correctly.
  assert.equal(settleItem(item({ label: 'Over 54.5', game_id: 'a-b' }), idx), 'win' && 'won');
});

test('a verdict the member already entered is theirs to keep', () => {
  assert.equal(isSettleable(item({ status: 'queued' })), true);
  assert.equal(isSettleable(item({ status: 'placed' })), true);
  for (const s of ['won', 'lost', 'push']) assert.equal(isSettleable(item({ status: s })), false);
  const board = { results: { items: [r('det-buf', 'BUF -4.5', 'loss')] } };
  const rows = [item({ id: 'a', label: 'BUF -4.5', game_id: 'det-buf', status: 'won' })];
  assert.deepEqual(pendingSettlements(rows, board), []);
});

test('an ungraded board settles nothing', () => {
  assert.deepEqual(pendingSettlements([item({ label: 'BUF -4.5', game_id: 'det-buf' })], null), []);
  assert.deepEqual(pendingSettlements([item({ label: 'BUF -4.5', game_id: 'det-buf' })], { results: { items: [] } }), []);
});
