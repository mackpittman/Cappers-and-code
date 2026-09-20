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

test('a scorer whose estimate demands too much of his team is off every parlay pool', () => {
  // Home projected for 17 points, about 2.2 touchdowns. A 55% scorer would need to take 30% of
  // them; a 35% scorer needs 18% and stays.
  const g = {
    id: 'lo',
    kickoff: new Date(Date.now() + 6 * 3600000).toISOString(),
    away: { abbr: 'A' },
    home: { abbr: 'H' },
    status: { state: 'pre' },
    top3: [
      { name: 'Hog', team: 'H', pos: 'TE', est: 0.55, live: { books: { fanduel: 195 } } },
      { name: 'Fair', team: 'H', pos: 'WR', est: 0.35, live: { books: { fanduel: 280 } } },
    ],
    value: [],
    market: {
      side: 'A -3',
      sideConf: 3,
      total: 'Under 41.5',
      totalConf: 3,
      projected: { away: 24, home: 17 },
      why: '',
    },
    injuryReport: { away: [], home: [] },
  };
  const other = {
    ...g,
    id: 'hi',
    away: { abbr: 'B' },
    home: { abbr: 'C' },
    top3: [
      { name: 'Elsewhere', team: 'C', pos: 'RB', est: 0.5, live: { books: { fanduel: 150 } } },
    ],
    market: { ...g.market, projected: { away: 20, home: 27 } },
  };
  const s = buildSheets({ games: [g, other], week: 2, season: 2026 });
  const names = s.sheets.flatMap((x) => x.tickets.flatMap((t) => t.legs.map((l) => l.player)));
  assert.ok(!names.includes('Hog'), 'Hog demanded 30% of team TDs and should be out');
  assert.ok(names.includes('Fair'), 'Fair needs 18% and should stay');
});

test('teaser legs move six points and know when they cross 3 and 7', () => {
  const soonIso = new Date(Date.now() + 6 * 3600000).toISOString();
  // Two games: one carries the side (home projected to win by ten, laying 8.5), one the total
  // (projected 38, under 41.5). Team codes are two letters because that is what parseSide reads.
  const board = {
    games: [
      {
        id: 's',
        kickoff: soonIso,
        away: { abbr: 'AA' },
        home: { abbr: 'HH' },
        status: { state: 'pre' },
        top3: [],
        value: [],
        market: {
          side: 'HH -8.5',
          sideConf: 3,
          total: 'Over 44.5',
          totalConf: 1,
          projected: { away: 17, home: 27 },
          why: '',
        },
      },
      {
        id: 't',
        kickoff: soonIso,
        away: { abbr: 'BB' },
        home: { abbr: 'CC' },
        status: { state: 'pre' },
        top3: [],
        value: [],
        market: {
          side: 'CC -3',
          sideConf: 1,
          total: 'Under 41.5',
          totalConf: 3,
          projected: { away: 17, home: 21 },
          why: '',
        },
      },
    ],
    week: 2,
    season: 2026,
  };
  const s = buildSheets(board);
  const side = s.teaser.legs.find((l) => l.type === 'tease-side');
  const total = s.teaser.legs.find((l) => l.type === 'tease-total');
  assert.equal(side.label, 'HH -2.5'); // -8.5 teased six points
  assert.equal(side.keys, 2); // crosses both 7 and 3: the classic
  assert.ok(side.prob > 0.7);
  assert.equal(total.label, 'Under 47.5 BB@CC');
  assert.ok(total.prob > 0.7);
  assert.equal(s.teaser.conservative, +Math.pow(0.7, 2).toFixed(3));
});

test('the share ceiling is looser for backs than for pass-catchers', () => {
  // Same 55% estimate on a team projected for 20 points (about 2.6 touchdowns) demands 26% of
  // them. That is over the line for a tight end and inside it for a running back.
  const mk = (pos) => ({
    id: 'g' + pos,
    kickoff: new Date(Date.now() + 6 * 3600000).toISOString(),
    away: { abbr: 'A' + pos },
    home: { abbr: 'H' + pos },
    status: { state: 'pre' },
    top3: [{ name: 'P' + pos, team: 'H' + pos, pos, est: 0.55, live: { books: { fanduel: 150 } } }],
    value: [],
    market: {
      side: `H${pos} -3`,
      sideConf: 3,
      total: 'Under 41.5',
      totalConf: 3,
      projected: { away: 17, home: 20 },
      why: '',
    },
    injuryReport: { away: [], home: [] },
  });
  // A third, clean scorer in a third game, so whoever survives the ceiling has a partner: an
  // anytime ticket needs two legs from two games, and a pool of one builds nothing.
  const partner = mk('WR');
  partner.top3[0].est = 0.35;
  partner.top3[0].live = { books: { fanduel: 280 } }; // 35% against 26% implied: a real leg
  const s = buildSheets({ games: [mk('TE'), mk('RB'), partner], week: 2, season: 2026 });
  const names = new Set(
    s.sheets.flatMap((x) => x.tickets.flatMap((t) => t.legs.map((l) => l.player))),
  );
  assert.ok(!names.has('PTE'), 'a tight end needing 25% of team TDs is over the line');
  assert.ok(names.has('PRB'), 'a back needing 25% is inside it');
});
