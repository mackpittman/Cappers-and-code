import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSides, sideRow } from './sides.mjs';

const game = (id, away, home, spread, proj, ml, kickoff, extra = {}) => ({
  id,
  kickoff,
  away: { abbr: away },
  home: { abbr: home },
  lines: { spread, total: 47.5, ml },
  market: { projected: proj, side: extra.side ?? '', sideConf: extra.sideConf ?? 0, why: 'w' },
  status: { state: 'STATUS_SCHEDULED' },
  live: extra.live ?? null,
});
const now = new Date('2026-10-18T12:00:00Z');

test('the side is the one the projection covers, at the live number when there is one', () => {
  const base = [
    'dal-gb',
    'DAL',
    'GB',
    'GB -1.5',
    { away: 25, home: 27 },
    { away: 100, home: -120 },
    '2026-10-19T00:20:00Z',
  ];
  // At the research number GB -1.5, a 2-point projection covers: the desk's side, at its confidence.
  const atOpen = sideRow(game(...base, { side: 'GB -1.5', sideConf: 3 }));
  assert.equal(atOpen.spread.bet, 'GB -1.5');
  assert.equal(atOpen.spread.conf, 3);
  assert.ok(atOpen.spread.agrees);
  // The live number moved to GB -2.5: the same projection now covers more often on DAL +2.5, and the
  // row says so rather than keeping the desk's stale side; the confidence does not carry over.
  const moved = sideRow(
    game(...base, {
      side: 'GB -1.5',
      sideConf: 3,
      live: { spread: { homePoint: -2.5 }, ml: { away: 110, home: -130 } },
    }),
  );
  assert.equal(moved.spread.bet, 'DAL +2.5');
  assert.ok(moved.spread.prob > 0.5);
  assert.equal(moved.spread.conf, 0);
  assert.equal(moved.spread.agrees, false);
  assert.equal(moved.ml.team, 'GB');
  assert.equal(moved.ml.price, -130);
});

test('a projection that disagrees with the posted favourite takes the dog and flags its moneyline', () => {
  const g = game(
    'ari-lar',
    'ARI',
    'LAR',
    'LAR -12.5',
    { away: 24, home: 27 },
    { away: 500, home: -700 },
    '2026-10-18T20:05:00Z',
  );
  const r = sideRow(g);
  assert.equal(r.spread.bet, 'ARI +12.5');
  assert.ok(r.spread.prob > 0.7);
  assert.equal(r.ml.team, 'LAR');
  assert.ok(r.dog && r.dog.team === 'ARI', 'ARI wins more often than +500 says');
});

test('only the next slate day, ranked by cover probability, with Discord text', () => {
  const b = {
    games: [
      game(
        'a-b',
        'A',
        'B',
        'B -3',
        { away: 20, home: 24 },
        { away: 130, home: -150 },
        '2026-10-18T17:00:00Z',
      ),
      game(
        'c-d',
        'C',
        'D',
        'D -7',
        { away: 24, home: 21 },
        { away: 250, home: -300 },
        '2026-10-18T20:25:00Z',
      ),
      game(
        'e-f',
        'E',
        'F',
        'F -1',
        { away: 20, home: 30 },
        { away: 105, home: -125 },
        '2026-10-20T00:15:00Z',
      ),
    ],
  };
  const s = buildSides(b, now);
  assert.deepEqual(
    s.rows.map((x) => x.game),
    ['c-d', 'a-b'],
  );
  assert.match(s.text, /SPREADS AND MONEYLINES/);
  assert.match(s.text, /C \+7/);
});

test('nothing open, nothing built', () => {
  const g = game(
    'a-b',
    'A',
    'B',
    'B -3',
    { away: 20, home: 24 },
    { away: 130, home: -150 },
    '2026-10-18T17:00:00Z',
  );
  g.status.state = 'STATUS_FINAL';
  assert.equal(buildSides({ games: [g] }, now), null);
});
