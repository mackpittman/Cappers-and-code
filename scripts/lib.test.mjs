import test from 'node:test';
import assert from 'node:assert/strict';
import { impliedProb, devig, decimalToAmerican, normName } from './lib.mjs';

test('implied probability from American odds', () => {
  assert.ok(Math.abs(impliedProb(-150) - 0.6) < 1e-9);
  assert.ok(Math.abs(impliedProb(150) - 0.4) < 1e-9);
  assert.equal(impliedProb(null), null);
});
test('devig sums to one', () => {
  const d = devig(-175, 145);
  assert.ok(Math.abs(d.a + d.b - 1) < 1e-9);
  assert.ok(d.a > 0.6 && d.a < 0.63);
});
test('decimal to american', () => {
  assert.equal(decimalToAmerican(2.5), 150);
  assert.equal(decimalToAmerican(1.5), -200);
});
test('name normalization matches feeds', () => {
  assert.equal(normName("Ja'Marr Chase"), normName('Jamarr Chase'));
  assert.equal(normName('Brian Thomas Jr.'), normName('Brian Thomas'));
  assert.equal(normName('Kenneth Walker III'), 'kenneth walker');
});
