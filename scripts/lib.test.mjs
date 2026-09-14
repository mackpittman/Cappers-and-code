import test from 'node:test';
import assert from 'node:assert/strict';
import { impliedProb, devig, decimalToAmerican, normName, decidePhase } from './lib.mjs';

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
test('props phases: at most open, desig, prekick per event', () => {
  const kick = '2026-09-13T17:00:00Z'; // Sunday 1pm ET
  const tue = new Date('2026-09-08T16:00:00Z');
  assert.equal(decidePhase(kick, {}, tue), 'open');
  assert.equal(decidePhase(kick, { open: 'x' }, tue), null, 'no second opener pull');
  const wed = new Date('2026-09-09T16:00:00Z');
  assert.equal(decidePhase(kick, { open: 'x' }, wed), null);
  const friEarly = new Date('2026-09-11T15:00:00Z');
  assert.equal(decidePhase(kick, { open: 'x' }, friEarly), null, 'designations not out yet');
  const friLate = new Date('2026-09-11T23:30:00Z');
  assert.equal(decidePhase(kick, { open: 'x' }, friLate), 'desig');
  assert.equal(decidePhase(kick, { open: 'x', desig: 'y' }, friLate), null);
  const sunMorning = new Date('2026-09-13T16:30:00Z');
  assert.equal(decidePhase(kick, { open: 'x', desig: 'y' }, sunMorning), 'prekick');
  assert.equal(decidePhase(kick, { open: 'x', desig: 'y', prekick: 'z' }, sunMorning), null);
  const after = new Date('2026-09-13T19:00:00Z');
  assert.equal(decidePhase(kick, {}, after), null, 'never pull a game that already kicked off');
  // Thursday game: opener Tuesday, pre-kick Thursday evening, no designations pull (Friday is after kickoff)
  const thu = '2026-09-11T00:35:00Z';
  assert.equal(decidePhase(thu, {}, tue), 'open');
  assert.equal(decidePhase(thu, { open: 'x' }, new Date('2026-09-10T22:30:00Z')), 'prekick');
  // Regression: a Sunday or Monday run must not spend credits on NEXT week's games. Books have
  // not posted player markets a week out, so those pulls came back empty and cost a credit each.
  const nextWeekSunday = '2026-09-20T17:00:00Z';
  const thisSunday = new Date('2026-09-13T19:00:00Z'); // mid-slate, ~166h before next week
  assert.equal(decidePhase(nextWeekSunday, {}, thisSunday), null, 'no opener a full week out');
  const monday = new Date('2026-09-14T16:32:00Z'); // ~144h out
  assert.equal(decidePhase(nextWeekSunday, {}, monday), null, 'no opener six days out');
  // The Tuesday opener, about 121 hours out, still fires.
  const nextTuesday = new Date('2026-09-15T16:00:00Z');
  assert.equal(decidePhase(nextWeekSunday, {}, nextTuesday), 'open', 'Tuesday opener survives');

  // Far-future event (next week) is not pulled yet
  assert.equal(decidePhase('2026-09-20T17:00:00Z', {}, tue), null);
});
