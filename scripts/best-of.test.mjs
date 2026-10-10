import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBestOf } from './best-of.mjs';

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

test('the five-leg and the Discord text come along', () => {
  const b = buildBestOf(board, now);
  assert.equal(b.plays.find((p) => p.key === 'fiveLeg').price, 610);
  assert.match(b.text, /Cappers & Code · Sunday, Oct 11 · Week 5/);
  assert.match(b.text, /Units, not dollars/);
});

test('nothing left to play gives no block', () => {
  assert.equal(buildBestOf(board, new Date('2026-10-14T00:00:00Z')), null);
});
