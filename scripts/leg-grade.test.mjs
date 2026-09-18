// The ladder form and the sportsbook form disagree at the boundary, which is the whole reason
// this is a separate module. Cases are taken from the real Week 2 tickets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatLeg, gradeStatLeg } from './leg-grade.mjs';

const grade = (label, actual) => gradeStatLeg(parseStatLeg(label), actual);

test('a ladder leg includes its number', () => {
  // Courtside "9+ receptions" means at least nine, so nine is a winner.
  assert.equal(grade('Amon-Ra St. Brown 9+ receptions', 9), 'win');
  assert.equal(grade('Amon-Ra St. Brown 9+ receptions', 8), 'loss');
  assert.equal(grade('Amon-Ra St. Brown 100+ receiving yards', 142), 'win');
  assert.equal(grade('Jahmyr Gibbs 30+ receiving yards', 30), 'win');
});

test('a sportsbook leg does not include its number', () => {
  // FanDuel "over 7.5 receptions" needs eight. This is the case a shared rule would get wrong.
  assert.equal(grade('Amon-Ra St. Brown over 7.5 receptions', 9), 'win');
  assert.equal(grade('Amon-Ra St. Brown over 7.5 receptions', 7), 'loss');
  // Allen threw for exactly 248 against a 248.5 line on Thursday: a loss by half a yard.
  assert.equal(grade('Josh Allen over 248.5 passing yards', 248), 'loss');
  assert.equal(grade('Jared Goff over 266.5 passing yards', 327), 'win');
});

test('landing exactly on a whole-number line is a push, not a win', () => {
  assert.equal(grade('James Cook over 78 rushing yards', 78), 'push');
  assert.equal(grade('James Cook over 78 rushing yards', 79), 'win');
});

test('every market spelling in the real tickets resolves', () => {
  for (const [label, key] of [
    ['DJ Moore over 62.5 receiving yards', 'player_reception_yds'],
    ['Dalton Kincaid 5+ receptions', 'player_receptions'],
    ['Jahmyr Gibbs over 87.5 rushing yards', 'player_rush_yds'],
    ['Josh Allen over 31.5 rushing yards', 'player_rush_yds'],
    ['Jared Goff over 266.5 passing yards', 'player_pass_yds'],
  ])
    assert.equal(parseStatLeg(label)?.market, key, label);
});

test('the player name survives punctuation and suffixes', () => {
  assert.equal(parseStatLeg('Amon-Ra St. Brown 100+ receiving yards').player, 'Amon-Ra St. Brown');
  assert.equal(parseStatLeg('James Cook III over 78.5 rushing yards').player, 'James Cook III');
});

test('what is not a stat leg is left for the rest of the grader', () => {
  // Sides and totals are graded from the score, not a box score line.
  for (const l of ['BUF -4.5', 'DET +4.5', 'Over 54.5', 'Josh Allen anytime TD', 'Jahmyr Gibbs 2+ TDs'])
    assert.equal(parseStatLeg(l), null, l);
  // An unknown market must not be guessed at.
  assert.equal(parseStatLeg('Josh Allen over 1.5 interceptions'), null);
});

test('a leg naming two players is refused rather than guessed', () => {
  // "St. Brown or Moore 125+" cannot be attributed to one box score line; settling it either way
  // would be inventing a result.
  assert.equal(parseStatLeg('St. Brown or Moore 125+ receiving yards'), null);
});

test('a missing stat grades nothing', () => {
  assert.equal(gradeStatLeg(parseStatLeg('DJ Moore 80+ receiving yards'), null), null);
  assert.equal(gradeStatLeg(null, 100), null);
});
