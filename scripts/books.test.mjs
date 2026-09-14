// The book bridge: what we hand each sportsbook, and what we refuse to hand them.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  BOOKS,
  bookByKey,
  deepLink,
  importText,
  normBook,
  searchTerm,
  tapOrder,
} from '../src/lib/books.ts';

const pick = (over) => ({
  id: 'a1',
  day: '2026-09-14',
  key: 'k',
  kind: 'atd',
  label: 'Dallas Goedert anytime TD',
  units: 0.25,
  status: 'queued',
  created_at: '',
  price: 210,
  book: 'FD',
  game_label: 'DAL @ NYG',
  link: 'https://sportsbook.fanduel.com/addToBetslip?marketId=42.4486&selectionId=29165',
  ...over,
});

test('every book is declared with an honest capability note', () => {
  for (const b of BOOKS) {
    assert.ok(b.name && b.short && b.note, `incomplete book: ${b.key}`);
    if (!b.linkable) assert.ok(b.note.length > 20, `${b.key} needs to say what to do instead`);
  }
  assert.equal(bookByKey('nope').key, 'other');
  assert.equal(normBook('FD'), 'fanduel');
  assert.equal(normBook('draftkings'), 'draftkings');
  assert.equal(normBook(null), null);
});

test('a deep link only goes to the book whose price it came from', () => {
  const p = pick();
  assert.ok(deepLink(p, 'fanduel'));
  assert.equal(deepLink(p, 'draftkings'), null, 'never send a FanDuel link to DraftKings');
  assert.equal(deepLink(p, 'courtside'), null);
  assert.equal(deepLink(pick({ link: null }), 'fanduel'), null);
});

test('legs mode is one selection per line, tickets mode keeps parlays together', () => {
  const list = [
    pick(),
    pick({
      id: 'b2',
      kind: 'parlay',
      label: 'Goedert 2+ TD · Taylor ATD',
      price: 3011,
      legs: [
        { label: 'Dallas Goedert 2+ TD', price: 1900, book: 'FD' },
        { label: 'Jonathan Taylor anytime TD', price: -180, book: 'DK' },
      ],
    }),
  ];
  const legs = importText(list, 'legs').split('\n');
  assert.equal(legs.length, 3, 'the parlay contributes its two legs, not its ticket line');
  assert.equal(legs[0], 'Dallas Goedert anytime TD +210');
  assert.equal(legs[2], 'Jonathan Taylor anytime TD -180');
  const tickets = importText(list, 'tickets');
  assert.match(tickets, /2-leg parlay/);
  assert.equal(tickets.split('\n\n').length, 2);
});

test('search terms strip the market so the book search box finds the player', () => {
  assert.equal(searchTerm('Dallas Goedert anytime TD'), 'Dallas Goedert');
  assert.equal(searchTerm('Justin Jefferson 2+ TD'), 'Justin Jefferson');
  assert.equal(searchTerm('Saquon Barkley over 76.5 rush'), 'Saquon Barkley');
  assert.equal(searchTerm('Broncos +2.5'), 'Broncos');
});

test('the tap list groups by game and carries a link only on the first leg', () => {
  const list = [
    pick(),
    pick({ id: 'c3', label: 'Javonte Williams 2+ TD', kind: 'td2', price: 440 }),
    pick({ id: 'd4', game_label: 'DEN @ KC', label: 'Broncos +2.5', kind: 'side', price: -110 }),
  ];
  const secs = tapOrder(list, 'fanduel');
  assert.equal(secs.length, 2);
  const dal = secs.find((s) => s.game === 'DAL @ NYG');
  assert.equal(dal.steps.length, 2);
  assert.ok(dal.steps.every((s) => s.link));
  const den = secs.find((s) => s.game === 'DEN @ KC');
  assert.equal(den.steps[0].search, 'Broncos');
  assert.equal(den.steps[0].price, '-110');
});

test('a parlay in the tap list only links its first leg', () => {
  const secs = tapOrder(
    [
      pick({
        kind: 'parlay',
        legs: [
          { label: 'Leg one', price: 100, book: 'FD' },
          { label: 'Leg two', price: -110, book: 'FD' },
        ],
      }),
    ],
    'fanduel',
  );
  const steps = secs[0].steps;
  assert.equal(steps.length, 2);
  assert.equal(steps.filter((s) => s.link).length, 1);
});
