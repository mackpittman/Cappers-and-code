import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverFromBoard } from './recover-odds.mjs';

const board = {
  generatedAt: '2026-09-13T13:02:16Z',
  oddsFetchedAt: '2026-09-13T13:02:00Z',
  oddsCredits: { remaining: 417, used: 83 },
  games: [
    {
      id: 'no-det',
      kickoff: '2026-09-13T17:00:00Z',
      away: { abbr: 'NO' },
      home: { abbr: 'DET' },
      pulls: { open: '2026-09-10T19:11:55Z', prekick: '2026-09-13T13:01:50Z' },
      top3: [
        {
          name: 'Jahmyr Gibbs',
          live: {
            books: { fanduel: -290, draftkings: -290 },
            best: -290,
            bestBook: 'fanduel',
            consensus: -300,
            fetchedAt: '2026-09-13T13:01:50Z',
          },
        },
      ],
      value: [],
      liveBoard: [{ name: 'Chris Olave', best: 155, bestBook: 'draftkings', consensus: 155 }],
    },
  ],
};
test('rebuilds the odds snapshot from the published board and keeps the pull log', () => {
  const local = {
    fetchedAt: '2026-09-10T19:11:55Z',
    events: [
      {
        id: 'abc123',
        home: 'DET',
        away: 'NO',
        markets: {},
        pulls: { open: '2026-09-10T19:11:55Z' },
      },
    ],
  };
  const { events, usage, pulled, rows } = recoverFromBoard(board, local);
  assert.equal(events[0].id, 'abc123');
  assert.equal(events[0].markets.player_anytime_td.phase, 'prekick');
  assert.deepEqual(events[0].markets.player_anytime_td.players['jahmyr gibbs'].books, {
    fanduel: -290,
    draftkings: -290,
  });
  assert.ok(events[0].markets.player_anytime_td.players['chris olave']);
  assert.equal(events[0].pulls.prekick, '2026-09-13T13:01:50Z');
  assert.deepEqual(usage, { remaining: 417, used: 83 });
  assert.equal(pulled.length, 1);
  assert.equal(rows.length, 2);
});
test('does nothing when local odds are already current', () => {
  assert.equal(
    recoverFromBoard(board, { fetchedAt: '2026-09-13T13:02:00Z', events: [] }).events,
    null,
  );
});
