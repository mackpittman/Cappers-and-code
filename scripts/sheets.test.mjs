import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSheets, diversify, tickets, impliedJoint, twoPlusLegs, BANDS } from './sheets.mjs';
import { designation, atdLegs } from './parlays.mjs';

const soon = new Date(Date.now() + 6 * 3600000).toISOString();
const player = (name, team, est, price, extra = {}) => ({
  name,
  team,
  pos: 'RB',
  est,
  live: { books: { fanduel: price, draftkings: price - 5 } },
  ...extra,
});
const game = (id, away, home, players, opts = {}) => ({
  id,
  kickoff: soon,
  away: { abbr: away },
  home: { abbr: home },
  status: { state: 'pre' },
  top3: players,
  value: [],
  market: opts.market ?? null,
  live: opts.live ?? null,
  injuryReport: opts.injuryReport ?? { away: [], home: [] },
});

test('a player ruled out is not a leg; a questionable one is a leg with a tag', () => {
  const g = game(
    'a-b',
    'A',
    'B',
    [player('Out Guy', 'A', 0.6, 150), player('Q Guy', 'B', 0.6, 150)],
    {
      injuryReport: {
        away: [{ name: 'Out Guy', status: 'Out' }],
        home: [{ name: 'Q Guy', status: 'Questionable' }],
      },
    },
  );
  assert.equal(designation(g, 'Out Guy'), 'Out');
  assert.equal(designation(g, 'Nobody'), null);
  const legs = atdLegs({ games: [g] });
  assert.deepEqual(
    legs.map((l) => [l.player, l.status]),
    [['Q Guy', 'Questionable']],
  );
});

test('tickets never take two legs from one game', () => {
  const legs = [
    { label: 'x', game: 'g1', prob: 0.5, price: 100 },
    { label: 'y', game: 'g1', prob: 0.5, price: 100 },
    { label: 'z', game: 'g2', prob: 0.5, price: 100 },
  ];
  const t = tickets(legs, [2]);
  assert.equal(t.length, 2); // x+z and y+z, never x+y
  assert.ok(t.every((k) => new Set(k.legs.map((l) => l.game)).size === 2));
});

test('ticket maths: price, model probability, implied probability, EV', () => {
  const legs = [
    { label: 'x', game: 'g1', prob: 0.5, price: 100 },
    { label: 'z', game: 'g2', prob: 0.5, price: 100 },
  ];
  const [t] = tickets(legs, [2]);
  assert.equal(t.price, 300);
  assert.equal(t.prob, 0.25);
  assert.equal(t.implied, 0.25);
  assert.equal(t.ev, 0); // fair coins at fair prices
  assert.equal(impliedJoint(legs), 0.25);
});

test('diversify keeps the best ticket and caps how often a leg repeats', () => {
  const L = (label) => ({ label, game: label });
  const sorted = [
    { legs: [L('a'), L('b')], ev: 3 },
    { legs: [L('a'), L('c')], ev: 2 },
    { legs: [L('d'), L('e')], ev: 1 },
    { legs: [L('b'), L('f')], ev: 0.5 },
  ];
  const once = diversify(sorted, 5, { maxPerLeg: 1 });
  assert.deepEqual(
    once.map((t) => t.legs.map((l) => l.label).join('+')),
    ['a+b', 'd+e'],
  );
  const twice = diversify(sorted, 5, { maxPerLeg: 2 });
  assert.equal(twice.length, 4);
  assert.equal(once[0].rank, 1);
  // Shared-leg rule: with a and b both allowed twice, a+c still cannot follow a+b if the cap on
  // shared legs is zero.
  const distinct = diversify(sorted, 5, { maxPerLeg: 2, maxShared: 0 });
  assert.deepEqual(
    distinct.map((t) => t.legs.map((l) => l.label).join('+')),
    ['a+b', 'd+e'],
  );
  // And a sheet built against another sheet's tickets respects the same rule across them.
  const vs = diversify(sorted, 5, { maxPerLeg: 2, maxShared: 0, against: [sorted[0]] });
  assert.deepEqual(
    vs.map((t) => t.legs.map((l) => l.label).join('+')),
    ['d+e'],
  );
});

test('2+ TD legs come only from players with a real 2+ price', () => {
  const legs = [
    {
      player: 'P',
      label: 'P anytime TD',
      game: 'g',
      prob: 0.6,
      price: -150,
      td2: { price: 320, book: 'FD' },
    },
    { player: 'N', label: 'N anytime TD', game: 'h', prob: 0.6, price: -150, td2: null },
  ];
  const out = twoPlusLegs(legs);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, 'P 2+ TDs');
  assert.equal(out[0].price, 320);
  assert.ok(out[0].prob > 0.2 && out[0].prob < 0.4);
  assert.ok(out[0].bellcow);
});

test('long shots land inside their band, clear the hit-rate floor, and never carry a designation', () => {
  // Eight clean scorers with real edge across eight games, plus one Questionable with the best
  // price on the slate. The Questionable player must not reach either long-shot sheet.
  const games = [];
  for (let i = 0; i < 8; i++)
    games.push(game(`g${i}`, `A${i}`, `B${i}`, [player(`S${i}`, `A${i}`, 0.5, 140)]));
  games.push(
    game('q', 'QA', 'QB', [player('Qman', 'QA', 0.7, 400)], {
      injuryReport: { away: [{ name: 'Qman', status: 'Questionable' }], home: [] },
    }),
  );
  const s = buildSheets({ games, week: 2, season: 2026 });
  const long = s.sheets.filter((x) => x.key.startsWith('long'));
  for (const sheet of long) {
    const b = BANDS[sheet.key];
    for (const t of sheet.tickets) {
      assert.ok(t.price >= b.min && t.price <= b.max, `${sheet.key} ${t.price} outside band`);
      assert.ok(t.prob >= b.minProb, `${sheet.key} ${t.prob} under floor`);
      assert.ok(
        t.legs.every((l) => !l.status),
        `${sheet.key} carried a designation`,
      );
      assert.ok(
        t.legs.every((l) => l.edge > 0),
        `${sheet.key} carried a negative-edge leg`,
      );
    }
  }
  // Qman is playable on the short Anytime sheet, tagged.
  const anytime = s.sheets.find((x) => x.key === 'anytime');
  const q = anytime.tickets.flatMap((t) => t.legs).find((l) => l.player === 'Qman');
  assert.ok(q && q.status === 'Questionable');
});

test('no leg repeats on the Locked In or Anytime sheets', () => {
  const games = [];
  for (let i = 0; i < 8; i++)
    games.push(
      game(`g${i}`, `A${i}`, `B${i}`, [player(`S${i}`, `A${i}`, 0.5, 140)], {
        market: {
          side: `A${i} +3`,
          sideConf: 3,
          total: 'Over 44.5',
          totalConf: 3,
          projected: { away: 27, home: 21 },
          why: '',
        },
      }),
    );
  const s = buildSheets({ games, week: 2, season: 2026 });
  for (const key of ['lockedIn', 'anytime']) {
    const labels = s.sheets
      .find((x) => x.key === key)
      .tickets.flatMap((t) => t.legs.map((l) => l.label));
    assert.equal(new Set(labels).size, labels.length, `${key} reused a leg`);
  }
});
