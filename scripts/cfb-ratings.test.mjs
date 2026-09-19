import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normCdf,
  winProbFromMargin,
  coverProb,
  rateTeams,
  projectGame,
  edgeVsMarket,
  impliedPoints,
  formResiduals,
  applyResiduals,
  breakEven,
  HFA,
} from './cfb-ratings.mjs';

test('normal CDF matches the table', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 0.001);
  assert.ok(Math.abs(normCdf(-1.645) - 0.05) < 0.001);
  assert.ok(Math.abs(winProbFromMargin(0) - 0.5) < 1e-6);
  // A three-touchdown college favourite is not a coin flip but is not a lock either.
  assert.ok(winProbFromMargin(21) > 0.9 && winProbFromMargin(21) < 0.95);
});

test('cover probability is symmetric about the number', () => {
  assert.ok(Math.abs(coverProb(7, 7) - 0.5) < 1e-6);
  assert.ok(coverProb(10, 7) > 0.5 && coverProb(4, 7) < 0.5);
});

test('ratings recover the strengths they were generated from', () => {
  // Three teams, no noise, no shrinkage: A scores 10 above average and concedes 10 below it.
  const games = [
    { home: 'A', away: 'B', homePts: 38, awayPts: 14, neutral: true },
    { home: 'B', away: 'C', homePts: 24, awayPts: 24, neutral: true },
    { home: 'C', away: 'A', homePts: 14, awayPts: 38, neutral: true },
    { home: 'A', away: 'C', homePts: 38, awayPts: 14, neutral: true },
    { home: 'B', away: 'A', homePts: 14, awayPts: 38, neutral: true },
    { home: 'C', away: 'B', homePts: 24, awayPts: 24, neutral: true },
  ];
  const m = rateTeams(games, { shrink: 0, cap: 99 });
  // The 24-point gap is split between A's rating and its opponents': what has to come back is the
  // difference, which is what a projection uses.
  assert.ok(m.teams.A.net > 12, `A should rate far above average, got ${m.teams.A.net}`);
  assert.ok(m.teams.B.net < 0 && m.teams.C.net < 0);
  const p = projectGame(m, { home: 'A', away: 'B', neutral: true });
  assert.ok(Math.abs(p.margin - 24) < 1.5, `A over B by about 24, got ${p.margin}`);
});

const ROUND_ROBIN = [
  { home: 'A', away: 'B', homePts: 38, awayPts: 14, neutral: true },
  { home: 'B', away: 'C', homePts: 24, awayPts: 24, neutral: true },
  { home: 'C', away: 'A', homePts: 14, awayPts: 38, neutral: true },
  { home: 'A', away: 'C', homePts: 38, awayPts: 14, neutral: true },
  { home: 'B', away: 'A', homePts: 14, awayPts: 38, neutral: true },
  { home: 'C', away: 'B', homePts: 24, awayPts: 24, neutral: true },
];

test('shrinkage pulls a small sample toward the average', () => {
  const hard = rateTeams(ROUND_ROBIN, { shrink: 4, cap: 99 });
  const none = rateTeams(ROUND_ROBIN, { shrink: 0, cap: 99 });
  assert.ok(Math.abs(hard.teams.A.net) < Math.abs(none.teams.A.net));
  assert.ok(
    projectGame(hard, { home: 'A', away: 'B', neutral: true }).margin <
      projectGame(none, { home: 'A', away: 'B', neutral: true }).margin,
  );
});

test('the point cap keeps one blowout from owning a rating', () => {
  const blowout = [
    ...ROUND_ROBIN,
    { home: 'A', away: 'B', homePts: 84, awayPts: 0, neutral: true },
  ];
  const capped = rateTeams(blowout, { shrink: 0, cap: 52 });
  const raw = rateTeams(blowout, { shrink: 0, cap: 99 });
  assert.ok(capped.teams.A.off < raw.teams.A.off);
  // And the cap is what keeps the projection anywhere near the six honest results.
  assert.ok(
    projectGame(capped, { home: 'A', away: 'B', neutral: true }).margin <
      projectGame(raw, { home: 'A', away: 'B', neutral: true }).margin,
  );
});

test('home field shows up in the projection and nowhere else', () => {
  const games = [
    { home: 'A', away: 'B', homePts: 24, awayPts: 24, neutral: true },
    { home: 'B', away: 'A', homePts: 24, awayPts: 24, neutral: true },
  ];
  const m = rateTeams(games, { shrink: 0, cap: 99 });
  const away = projectGame(m, { home: 'A', away: 'B', neutral: true });
  const home = projectGame(m, { home: 'A', away: 'B', neutral: false });
  assert.ok(Math.abs(away.margin) < 0.5);
  assert.ok(Math.abs(home.margin - HFA) < 0.5);
});

test('a market line decomposes into the two team totals it implies', () => {
  // Home laying 7 in a game totalled 50 means 28.5 and 21.5.
  assert.deepEqual(impliedPoints(-7, 50), { homePts: 28.5, awayPts: 21.5 });
  assert.deepEqual(impliedPoints(3, 44), { homePts: 20.5, awayPts: 23.5 });
  assert.equal(impliedPoints(null, 50), null);
});

test('form residuals measure performance against the number, shrunk', () => {
  // Home was a 7-point favourite in a 50-point game (28.5 expected) and scored 38.5 twice.
  const games = [
    { home: 'A', away: 'B', homePts: 38.5, awayPts: 21.5, spreadHome: -7, total: 50 },
    { home: 'A', away: 'C', homePts: 38.5, awayPts: 21.5, spreadHome: -7, total: 50 },
  ];
  const r = formResiduals(games, 4);
  assert.equal(r.A.rawOff, 10);
  assert.equal(r.A.rawDef, 0);
  assert.equal(r.A.games, 2);
  assert.equal(r.A.offResid, 3.33); // 10 * 2/(2+4)
  assert.equal(r.B.rawOff, 0);
});

test('residuals land on the market fit without disturbing anything else', () => {
  const model = {
    mu: 26,
    hfa: 2.4,
    sigma: 16,
    teams: { A: { off: 5, def: 2, net: 7, games: 2, sos: 0 } },
  };
  const out = applyResiduals(model, { A: { games: 2, offResid: 3, defResid: -1 } });
  assert.equal(out.teams.A.off, 8);
  assert.equal(out.teams.A.def, 1);
  assert.equal(out.teams.A.net, 9);
  assert.equal(out.mu, 26);
  // Weight zero leaves the market fit exactly as it was.
  assert.equal(
    applyResiduals(model, { A: { games: 2, offResid: 3, defResid: -1 } }, 0).teams.A.off,
    5,
  );
});

test('edge against the market keeps the home-spread convention straight', () => {
  const proj = { margin: 10, total: 55 };
  // Market has home laying 7; the model has them by 10, so the edge is three points on the home side.
  const e = edgeVsMarket(proj, { spreadHome: -7, total: 50 });
  assert.equal(e.spreadEdge, 3);
  assert.equal(e.side, 'home');
  assert.equal(e.totalEdge, 5);
  assert.ok(e.sideCoverProb > 0.5);
  // Market has home laying 14; the model has them by 10, so the road side is the value.
  const f = edgeVsMarket(proj, { spreadHome: -14, total: 50 });
  assert.equal(f.spreadEdge, -4);
  assert.equal(f.side, 'away');
  assert.ok(f.sideCoverProb > 0.5);
});

test('break-even rate from an American price', () => {
  assert.ok(Math.abs(breakEven(-110) - 0.5238) < 0.001);
  assert.ok(Math.abs(breakEven(100) - 0.5) < 1e-9);
  assert.ok(Math.abs(breakEven(1100) - 0.0833) < 0.001);
});
