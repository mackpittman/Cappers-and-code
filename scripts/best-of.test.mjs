import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBestOf, buildMaxFive } from './best-of.mjs';

const now = new Date('2026-10-10T16:00:00Z'); // Saturday morning
const game = (id, kickoff) => ({
  id,
  kickoff,
  away: { abbr: id.split('-')[0].toUpperCase() },
  home: { abbr: id.split('-')[1].toUpperCase() },
});
const board = {
  week: 5,
  games: [
    game('chi-gb', '2026-10-11T17:00Z'),
    game('bal-atl', '2026-10-12T00:20Z'),
    game('buf-lar', '2026-10-13T00:15Z'),
  ],
  topTen: {
    categories: [
      {
        key: 'sides',
        plays: [
          {
            game: 'buf-lar',
            gameLabel: 'BUF@LAR',
            kickoff: '2026-10-13T00:15Z',
            bet: 'BUF -3',
            price: -110,
            prob: 0.6,
            implied: 0.524,
            edge: 0.08,
            conf: 4,
          },
          {
            game: 'chi-gb',
            gameLabel: 'CHI@GB',
            kickoff: '2026-10-11T17:00Z',
            bet: 'GB -3.5',
            price: -110,
            prob: 0.57,
            implied: 0.524,
            edge: 0.05,
            conf: 3,
          },
        ],
      },
      {
        key: 'totals',
        plays: [
          {
            game: 'bal-atl',
            gameLabel: 'BAL@ATL',
            kickoff: '2026-10-12T00:20Z',
            bet: 'Under 47.5',
            price: -110,
            prob: 0.56,
            edge: 0.04,
            conf: 2,
          },
        ],
      },
      {
        key: 'moneyline',
        plays: [
          {
            game: 'chi-gb',
            gameLabel: 'CHI@GB',
            kickoff: '2026-10-11T17:00Z',
            bet: 'GB ML',
            price: -175,
            prob: 0.68,
            implied: 0.62,
            edge: 0.06,
          },
          {
            game: 'bal-atl',
            gameLabel: 'BAL@ATL',
            kickoff: '2026-10-12T00:20Z',
            bet: 'ATL ML',
            price: 130,
            prob: 0.5,
            implied: 0.42,
            edge: 0.08,
          },
        ],
      },
      {
        key: 'atd',
        plays: [
          {
            game: 'chi-gb',
            gameLabel: 'CHI@GB',
            kickoff: '2026-10-11T17:00Z',
            bet: 'Josh Jacobs anytime TD',
            price: -150,
            prob: 0.58,
            implied: 0.6,
            edge: -0.02,
          },
        ],
      },
      { key: 'value', plays: [] },
      { key: 'td2', plays: [] },
    ],
  },
  fiveLeg: {
    tickets: [
      {
        game: 'chi-gb',
        gameLabel: 'CHI@GB',
        kickoff: '2026-10-11T17:00Z',
        price: 610,
        joint: 0.21,
        bookJoint: 0.14,
        short: false,
        legs: [{ label: 'A 3+ receptions', price: -200, book: 'fanduel' }],
      },
    ],
  },
  lottos: [],
};

test('takes the next day of games in US Eastern, Sunday night included, Monday not', () => {
  const b = buildBestOf(board, now);
  assert.equal(b.day, '2026-10-11');
  assert.equal(b.games, 2);
  assert.ok(!b.plays.some((p) => p.game === 'buf-lar'), 'the Monday game is left for Monday');
  assert.equal(b.plays.find((p) => p.key === 'side').bet, 'GB -3.5');
});

test('a total under confidence 3 stays off the lead block; the dog needs a real edge', () => {
  const b = buildBestOf(board, now);
  assert.ok(!b.plays.some((p) => p.key === 'total'));
  assert.equal(b.plays.find((p) => p.key === 'dog').bet, 'ATL ML');
  assert.equal(b.plays.find((p) => p.key === 'moneyline').bet, 'GB ML');
});

test('a likely scorer at a price the model does not beat stays off; a loved total gets in', () => {
  const b2 = structuredClone(board);
  b2.topTen.categories
    .find((c) => c.key === 'totals')
    .plays.push({
      game: 'chi-gb',
      gameLabel: 'CHI@GB',
      kickoff: '2026-10-11T17:00Z',
      bet: 'Under 41.5',
      price: -110,
      prob: 0.66,
      edge: 0.14,
      conf: 2,
    });
  const b = buildBestOf(b2, now);
  assert.ok(!b.plays.some((p) => p.key === 'atd'), 'Jacobs at -150 is 58% against a 60% price');
  assert.equal(b.plays.find((p) => p.key === 'total').bet, 'Under 41.5');
});

test('the five-leg and the Discord text come along', () => {
  const b = buildBestOf(board, now);
  assert.equal(b.plays.find((p) => p.key === 'fiveLeg').price, 610);
  assert.match(b.text, /Cappers & Code · Sunday, Oct 11 · Week 5/);
  assert.match(b.text, /Units, not dollars/);
});

test('nothing left to play gives no block', () => {
  assert.equal(buildBestOf(board, new Date('2026-10-14T00:00:00Z')), null);
});

test('max-five: full tickets on the day, best joint first, pulled and short ones left off', () => {
  const sun = new Date('2026-10-11T16:30:00Z');
  const g = (id, kickoff, extra = {}) => ({ ...game(id, kickoff), ...extra });
  const t = (id, kickoff, joint, extra = {}) => ({
    game: id,
    gameLabel: id.toUpperCase(),
    kickoff,
    price: 550,
    joint,
    bookJoint: 0.15,
    short: false,
    pulled: null,
    check: null,
    legs: [{ label: `${id} leg`, price: -220, book: 'fanduel', p: 0.74 }],
    ...extra,
  });
  const ids = ['a-b', 'c-d', 'e-f', 'g-h', 'i-j', 'k-l', 'm-n', 'o-p'];
  const b = {
    week: 5,
    games: [
      g('q-r', '2026-10-11T13:30Z', { status: { state: 'STATUS_FINAL' } }),
      ...ids.map((id) => g(id, '2026-10-11T17:00Z')),
      g('s-t', '2026-10-13T00:15Z'),
    ],
    fiveLeg: {
      checkedAt: '2026-10-11T16:20Z',
      tickets: [
        t('q-r', '2026-10-11T13:30Z', 0.4), // final: gone
        t('a-b', '2026-10-11T17:00Z', 0.25, { pulled: 'rain' }),
        t('c-d', '2026-10-11T17:00Z', 0.3, { short: true }),
        t('e-f', '2026-10-11T17:00Z', 0.2),
        t('g-h', '2026-10-11T17:00Z', 0.22),
        t('i-j', '2026-10-11T17:00Z', 0.21),
        t('k-l', '2026-10-11T17:00Z', 0.19),
        t('m-n', '2026-10-11T17:00Z', 0.18),
        t('o-p', '2026-10-11T17:00Z', 0.17),
        t('s-t', '2026-10-13T00:15Z', 0.5), // Monday: another day
      ],
    },
  };
  const m = buildMaxFive(b, sun);
  assert.deepEqual(
    m.tickets.map((x) => x.game),
    ['g-h', 'i-j', 'e-f', 'k-l', 'm-n'],
  );
  assert.deepEqual(
    m.tickets.map((x) => x.rank),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(m.pulled, [{ game: 'a-b', gameLabel: 'A-B', reason: 'rain' }]);
  assert.match(m.text, /Max-confidence five-legs, no TDs/);
  assert.ok(!/touchdown|anytime/i.test(m.text));
});

test('max-five: a game under way stays on until it is final', () => {
  const b = {
    week: 5,
    games: [game('a-b', '2026-10-11T17:00Z'), game('c-d', '2026-10-11T20:25Z')],
    fiveLeg: {
      tickets: [
        {
          game: 'a-b',
          gameLabel: 'A@B',
          kickoff: '2026-10-11T17:00Z',
          price: 500,
          joint: 0.2,
          bookJoint: 0.15,
          short: false,
          legs: [],
        },
        {
          game: 'c-d',
          gameLabel: 'C@D',
          kickoff: '2026-10-11T20:25Z',
          price: 500,
          joint: 0.21,
          bookJoint: 0.15,
          short: false,
          legs: [],
        },
      ],
    },
  };
  const m = buildMaxFive(b, new Date('2026-10-11T18:00:00Z'));
  assert.deepEqual(
    m.tickets.map((x) => x.game),
    ['c-d', 'a-b'],
  );
});
