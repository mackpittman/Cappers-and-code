// A touchdown model built from role rather than from the book's price.
//
// The simulator fits each scorer's touchdown share to his own anytime price, which is right when the
// market has seen what you have seen and wrong when it has not. This is the other view: each team's
// expected touchdowns are split pass/rush from its tendency, and each share is allocated from who
// the quarterback actually throws to in the red zone — his own history, blended with this season's
// usage — and who takes the carries inside the five. Poisson thinning gives closed forms:
//   P(at least one) = 1 - exp(-mu q),   P(at least two) = 1 - exp(-mu q)(1 + mu q)
// where mu is the team's expected touchdowns and q the player's share of them.
//
//   node scripts/td-role-model.mjs data/td-roles-atl-gb.json
import fs from 'node:fs';
import { impliedFromAmerican } from './parlays.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/td-role-model.mjs <roles.json>');
  process.exit(1);
}
const R = JSON.parse(fs.readFileSync(file, 'utf8'));

export function anytime(mu, q) {
  return 1 - Math.exp(-mu * q);
}
export function twoPlus(mu, q) {
  const x = mu * q;
  return 1 - Math.exp(-x) * (1 + x);
}
export function threePlus(mu, q) {
  const x = mu * q;
  return 1 - Math.exp(-x) * (1 + x + (x * x) / 2);
}
const fair = (p) => (p >= 0.5 ? Math.round(-100 * (p / (1 - p))) : Math.round(100 * ((1 - p) / p)));
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const sign = (a) => (a == null ? '  —  ' : `${a > 0 ? '+' : ''}${a}`);

const rows = [];
for (const [team, t] of Object.entries(R.teams)) {
  const mu = t.expectedTd;
  const passShares = t.pass.shares,
    rushShares = t.rush.shares;
  const sumP = Object.values(passShares).reduce((a, b) => a + b, 0);
  const sumR = Object.values(rushShares).reduce((a, b) => a + b, 0);
  if (Math.abs(sumP - 1) > 0.01 || Math.abs(sumR - 1) > 0.01)
    console.error(
      `${team}: pass shares sum ${sumP.toFixed(2)}, rush shares sum ${sumR.toFixed(2)} — must be 1`,
    );
  const names = new Set([...Object.keys(passShares), ...Object.keys(rushShares)]);
  for (const n of names) {
    const q = (passShares[n] ?? 0) * t.pass.fraction + (rushShares[n] ?? 0) * t.rush.fraction;
    const price = R.prices?.[n] ?? {};
    rows.push({
      team,
      name: n,
      share: q,
      expTd: mu * q,
      p1: anytime(mu, q),
      p2: twoPlus(mu, q),
      p3: threePlus(mu, q),
      book1: price[1] ?? null,
      book2: price[2] ?? null,
      book3: price[3] ?? null,
    });
  }
}
rows.sort((a, b) => b.p1 - a.p1);
console.log(
  `Role model — ${Object.entries(R.teams)
    .map(([t, v]) => `${t} ${v.expectedTd} TD (${Math.round(v.pass.fraction * 100)}% pass)`)
    .join(', ')}\n`,
);
console.log(
  '  team  player                share   E[TD]   P(1+)   book    impl   edge |  P(2+)   book    impl   edge',
);
for (const r of rows) {
  const i1 = r.book1 != null ? impliedFromAmerican(r.book1) : null;
  const i2 = r.book2 != null ? impliedFromAmerican(r.book2) : null;
  const e1 = i1 != null ? r.p1 - i1 : null,
    e2 = i2 != null ? r.p2 - i2 : null;
  const ed = (e) =>
    e == null ? '   —  ' : `${e >= 0 ? '+' : ''}${(e * 100).toFixed(1)}`.padStart(6);
  console.log(
    `  ${r.team.padEnd(4)}  ${r.name.padEnd(20)} ${pct(r.share).padStart(6)}  ${r.expTd.toFixed(2).padStart(5)}  ${pct(r.p1).padStart(6)}  ${sign(r.book1).padStart(6)}  ${i1 != null ? pct(i1).padStart(6) : '   —  '} ${ed(e1)} |  ${pct(r.p2).padStart(6)}  ${sign(r.book2).padStart(6)}  ${i2 != null ? pct(i2).padStart(6) : '   —  '} ${ed(e2)}`,
  );
}
fs.writeFileSync(
  file.replace(/\.json$/, '-out.json'),
  JSON.stringify({ builtAt: new Date().toISOString(), rows }, null, 1),
);
