import test from 'node:test';
import assert from 'node:assert/strict';
import {
  innings,
  ra9,
  regress,
  dePark,
  starterShare,
  sideRuns,
  blend,
  marketRuns,
  priceGame,
  grade,
  MARKET_WEIGHT,
} from './mlb-model.mjs';
import { rawFactors, shrink } from './mlb-parks.mjs';

test('innings reads baseball notation, not decimals', () => {
  // 813.1 is 813 and one third. Read as a decimal it is a fifth of an inning out on every start.
  assert.equal(innings('813.1').toFixed(4), (813 + 1 / 3).toFixed(4));
  assert.equal(innings('77.2').toFixed(4), (77 + 2 / 3).toFixed(4));
  assert.equal(innings(6), 6);
  assert.equal(innings(null), null);
  assert.equal(innings('-'), null);
});

test('ra9 counts all runs over real innings', () => {
  assert.equal(ra9(53, '77.2').toFixed(3), ((53 * 9) / (77 + 2 / 3)).toFixed(3));
  assert.equal(ra9(10, 0), null);
});

test('regress pulls a small sample to league and leaves a big one alone', () => {
  // Ten innings of a 1.00 RA9 is noise; it should land close to league.
  assert.ok(regress(1.0, 10, 4.5, 70) > 4.0);
  // Two hundred innings is a real signal; it should stay close to the observation.
  assert.ok(regress(3.0, 200, 4.5, 70) < 3.5);
  // No sample at all is the league rate, not a divide by zero.
  assert.equal(regress(null, 0, 4.5, 70), 4.5);
});

test('dePark removes a home park a season rate already contains', () => {
  // A team in a 1.20 park playing half at home carries a 1.10 inflation.
  assert.equal(dePark(5.5, 1.2).toFixed(4), (5.5 / 1.1).toFixed(4));
  // Neutral park changes nothing.
  assert.equal(dePark(5.5, 1.0), 5.5);
});

test('starterShare is bounded and tracks innings per start', () => {
  assert.equal(starterShare('180.0', 30).toFixed(3), (6 / 9).toFixed(3));
  assert.ok(starterShare('180.0', 30) < 0.78);
  // An opener does not get two thirds of the game.
  assert.ok(starterShare('20.0', 20) < 0.3);
  // No record at all falls back rather than throwing.
  assert.equal(starterShare(null, null), 0.5);
});

test('blend leans on the market by MARKET_WEIGHT', () => {
  const b = blend({ away: 6, home: 2 }, { away: 4, home: 4 });
  assert.equal(b.away.toFixed(4), (4 * MARKET_WEIGHT + 6 * (1 - MARKET_WEIGHT)).toFixed(4));
  // A model twice as far from the market moves the blend twice as far.
  const far = blend({ away: 8, home: 0 }, { away: 4, home: 4 });
  assert.ok(Math.abs(far.away - 4) > Math.abs(b.away - 4));
});

test('marketRuns reproduces the moneyline it was given', () => {
  const m = marketRuns({
    total: 8.5,
    mlAway: 130,
    mlHome: -155,
    overPrice: -110,
    underPrice: -110,
  });
  const priced = priceGame({ away: m.away, home: m.home, total: 8.5 });
  // Solving for the runs and pricing them back must return the same win probability.
  assert.ok(Math.abs(priced.ml.home - m.favWinProb) < 0.005);
  // And the two run means must add to the fair total.
  assert.ok(Math.abs(m.away + m.home - m.fairTotal) < 0.01);
});

test('marketRuns shades the total toward the cheaper side of the juice', () => {
  const overJuiced = marketRuns({
    total: 8,
    mlAway: 100,
    mlHome: -120,
    overPrice: -125,
    underPrice: 100,
  });
  const underJuiced = marketRuns({
    total: 8,
    mlAway: 100,
    mlHome: -120,
    overPrice: 100,
    underPrice: -125,
  });
  assert.ok(overJuiced.fairTotal > 8, 'a short over means the fair total is above the posted line');
  assert.ok(underJuiced.fairTotal < 8, 'a short under means the fair total is below it');
});

test('priceGame probabilities are coherent', () => {
  const p = priceGame({ away: 4.3, home: 4.8, total: 8.5 });
  assert.ok(Math.abs(p.ml.away + p.ml.home - 1) < 1e-6);
  assert.ok(Math.abs(p.total.over + p.total.push + p.total.under - 1) < 1e-6);
  // A half-run line cannot push.
  assert.equal(p.total.push, 0);
  // A team cannot be more likely to win by two than to win at all.
  assert.ok(p.runLine.homeMinus < p.ml.home);
  assert.ok(p.runLine.awayMinus < p.ml.away);
  // Taking the runs is the complement of laying them in the same game.
  assert.ok(Math.abs(p.runLine.homeMinus + p.runLine.awayPlus - 1) < 1e-6);
  assert.ok(Math.abs(p.runLine.awayMinus + p.runLine.homePlus - 1) < 1e-6);
  // The better side is the favourite.
  assert.ok(p.ml.home > p.ml.away);
});

test('a whole-number total pushes, and the push belongs to neither side', () => {
  const half = priceGame({ away: 4, home: 4, total: 8.5 });
  const whole = priceGame({ away: 4, home: 4, total: 8 });
  // Landing on exactly eight is a real and large chunk of the distribution.
  assert.ok(whole.total.push > 0.08, `push was ${whole.total.push}`);
  assert.ok(Math.abs(whole.total.over + whole.total.push + whole.total.under - 1) < 1e-6);
  // The bug: handing the push to the under made the under look like a big favourite on a line the
  // model's own mean sat exactly on. Under 8 must not collect the "exactly 8" mass.
  assert.ok(whole.total.under < 0.5, `under was ${whole.total.under}`);
  // Over 8.5 and over 8 differ by exactly the push, because both exclude a result of eight.
  assert.ok(Math.abs(half.total.over - whole.total.over) < 1e-6);
});

test('grade handles a push as a refund, not a loss', () => {
  // 45% win, 12% push, 43% lose at even money. The stake comes back on the push.
  const g = grade(0.45, 100, 0.12);
  assert.equal(g.ev.toFixed(4), (0.45 * 1 - 0.43).toFixed(4));
  // The number to compare against the price is the chance of winning given a result.
  assert.equal(g.conditional.toFixed(4), (0.45 / 0.88).toFixed(4));
  assert.ok(g.edge > 0, 'a 51.1% conditional at +100 is an edge');
  // Without the push it would read as a losing bet, which is the error this replaces.
  assert.ok(grade(0.45, 100, 0).edge < 0);
});

test('grade agrees with the price when the model does', () => {
  // A true 50% at +100 is a zero-EV bet.
  const g = grade(0.5, 100);
  assert.equal(g.edge, 0);
  assert.equal(g.ev, 0);
  // Fair price of a 60% shot is -150.
  assert.equal(grade(0.6, 100).fair, -150);
  // A real edge is positive EV.
  assert.ok(grade(0.55, 100).ev > 0);
  assert.ok(grade(0.45, 100).ev < 0);
});

test('park factors hold the home roster constant', () => {
  // One team, a hitters park at home and a neutral road slate: the ratio should find it.
  const finals = [];
  for (let i = 0; i < 40; i++)
    finals.push({ venue: 'Hot', homeTeamId: 1, awayTeamId: 2 + (i % 5), runs: 12 });
  for (let i = 0; i < 40; i++)
    finals.push({ venue: 'Away', homeTeamId: 2 + (i % 5), awayTeamId: 1, runs: 8 });
  const f = rawFactors(finals);
  assert.equal(f.get('Hot').raw.toFixed(3), '1.500');
  // Shrinking pulls it back toward neutral but keeps the direction.
  assert.ok(shrink(1.5) > 1 && shrink(1.5) < 1.5);
});

test('sideRuns is multiplicative in every index', () => {
  const base = sideRuns({
    leagueRunsPerTeam: 4.5,
    offenceIndex: 1,
    pitchingIndex: 1,
    parkFactor: 1,
  });
  assert.equal(base, 4.5);
  assert.equal(
    sideRuns({
      leagueRunsPerTeam: 4.5,
      offenceIndex: 1.1,
      pitchingIndex: 1,
      parkFactor: 1,
    }).toFixed(4),
    (4.5 * 1.1).toFixed(4),
  );
});

test('runLineShare reports the market against the model rather than judging it', async () => {
  const { runLineShare } = await import('./mlb-model.mjs');
  // The ARI@COL row that first looked broken. Both numbers are plausible; the market is simply
  // above the model, as it is on almost every game on the board.
  const coors = runLineShare({
    mlFav: -167,
    mlDog: 137,
    favRunLinePrice: -107,
    dogRunLinePrice: -112,
    total: 11,
  });
  assert.ok(coors.market > 0.6 && coors.market < 0.9, `market share ${coors.market}`);
  assert.ok(coors.model > 0.6 && coors.model < 0.9, `model share ${coors.model}`);
  // Roughly 28.5% of games are one-run games, so about 71% of a win is a multi-run win. Both sides
  // of this comparison have to land near that, or the check itself is the thing that is wrong.
  for (const row of [
    { mlFav: -194, mlDog: 159, favRunLinePrice: 120, dogRunLinePrice: -145, total: 6.5 },
    { mlFav: -225, mlDog: 183, favRunLinePrice: -105, dogRunLinePrice: -115, total: 8 },
    { mlFav: -110, mlDog: -109, favRunLinePrice: 153, dogRunLinePrice: -186, total: 8 },
  ]) {
    const r = runLineShare(row);
    assert.ok(r.model > 0.6 && r.model < 0.85, `model share ${r.model}`);
  }
});
