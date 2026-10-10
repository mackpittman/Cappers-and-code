// Renders docs/week-NN-2026-report.md from src/data/research.json and the week's five-leg file:
// the slate at a glance, the slate-wide touchdown board, the desk's edges, best bets and the
// five-leg ticket for every game. Same sections every week, so a reader can compare weeks.
//
//   node scripts/build-week-report.mjs
import path from 'node:path';
import { ROOT, DATA, readJson, impliedProb } from './lib.mjs';

const r = readJson(path.join(ROOT, 'src', 'data', 'research.json'));
const wk = `${r.season}-w${String(r.week).padStart(2, '0')}`;
const five = readJson(path.join(DATA, 'five-leg', `${wk}.json`), null);
const et = (iso) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }) + ' ET';
const pct = (x) => (x == null ? '' : `${Math.round(x * 100)}%`);
const price = (p) => (p == null ? 'verify' : p > 0 ? `+${p}` : String(p));
const label = (g) => `${g.away.abbr}@${g.home.abbr}`;
const lines = [];
lines.push(`# NFL Week ${r.week} ${r.season} — Touchdown Probability & Parlay Report`, '');
lines.push(
  `**Prepared:** ${new Date(r.researchAsOf).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'full', timeStyle: 'short' })} CT.`,
);
lines.push(
  `**Scope:** ${r.games.length} games${r.completed?.length ? ` (${r.completed.map((c) => c.final).join('; ')} already final)` : ''}.`,
);
lines.push(
  `**Method:** one researcher per game from Friday's practice reports, the current DraftKings and FanDuel board and ESPN's depth charts. Win probabilities are the moneyline with the vig removed. Touchdown estimates are the desk's own, from role; they are not the book's number with the hold stripped. Volume projections feed the five-leg tickets (docs/FIVE_LEG_FORMULA.md).`,
  '',
);
lines.push(`> ${r.notes}`, '', '---', '');
lines.push('## 1. Slate at a glance', '');
lines.push(
  '| Kick | Game | Spread | Total | Away ML | Home ML | Away win% | Home win% | Projected | Side | Total lean |',
);
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const g of r.games)
  lines.push(
    `| ${et(g.kickoff)} | ${label(g)} | ${g.lines.spread} | ${g.lines.total} | ${price(g.lines.ml.away)} | ${price(g.lines.ml.home)} | ${pct(g.lines.winProb?.away)} | ${pct(g.lines.winProb?.home)} | ${g.market?.projected ? `${g.market.projected.away}-${g.market.projected.home}` : ''} | ${g.market?.side ? `${g.market.side} (${g.market.sideConf}/5)` : 'Pass'} | ${g.market?.total ? `${g.market.total} (${g.market.totalConf}/5)` : 'Pass'} |`,
  );
lines.push(
  '',
  '## 2. Slate-wide top touchdown scorers',
  '',
  "Ranked by the desk's own estimate, not by price.",
  '',
);
lines.push(
  '| # | Player | Team | Pos | Game | ATD price | Implied | Desk est. | Edge |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
);
const all = r.games.flatMap((g) =>
  [...g.top3, ...g.value].map((p) => ({ ...p, gameLabel: label(g) })),
);
const ranked = all
  .filter((p) => typeof p.est === 'number')
  .sort((a, b) => b.est - a.est)
  .slice(0, 24);
ranked.forEach((p, i) => {
  const imp = p.implied ?? (typeof p.price === 'number' ? impliedProb(p.price) : null);
  lines.push(
    `| ${i + 1} | ${p.name} | ${p.team} | ${p.pos} | ${p.gameLabel} | ${price(p.price)}${p.priceNote ? ` (${p.priceNote})` : ''} | ${pct(imp)} | ${pct(p.est)} | ${imp != null ? `${p.est - imp >= 0 ? '+' : ''}${Math.round((p.est - imp) * 100)}` : ''} |`,
  );
});
lines.push('', '### Where the desk is furthest above the price', '');
const edges = all
  .filter((p) => typeof p.price === 'number' && typeof p.est === 'number')
  .map((p) => ({ ...p, imp: p.implied ?? impliedProb(p.price) }))
  .map((p) => ({ ...p, edge: p.est - p.imp }))
  .sort((a, b) => b.edge - a.edge)
  .slice(0, 10);
lines.push(
  '| Player | Game | Price | Implied | Desk est. | Edge | Why |',
  '| --- | --- | --- | --- | --- | --- | --- |',
);
for (const p of edges)
  lines.push(
    `| **${p.name}** (${p.team} ${p.pos}) | ${p.gameLabel} | ${price(p.price)} | ${pct(p.imp)} | ${pct(p.est)} | +${Math.round(p.edge * 100)} pts | ${String(p.why).replace(/\|/g, '/')} |`,
  );
lines.push('', '## 3. Best bets', '');
lines.push('| Game | Bet | Conf | Why |', '| --- | --- | --- | --- |');
for (const b of r.bestBets) {
  const g = r.games.find((x) => x.id === b.game);
  lines.push(
    `| ${g ? label(g) : b.game} | ${b.bet} | ${b.conf}/5 | ${String(b.why).replace(/\|/g, '/').slice(0, 400)} |`,
  );
}
if (r.crossStacks?.length) {
  lines.push('', '## 4. Cross-game stacks', '');
  for (const s of r.crossStacks) lines.push(`- **${s.legs.join(' + ')}** — ${s.why}`);
}
if (r.upsetLeans?.length) {
  lines.push('', '## 5. Upset leans', '');
  for (const u of r.upsetLeans)
    lines.push(`- **${u.team} ${price(u.price)}** (${pct(u.winProb)}) — ${u.why}`);
}
if (five?.games?.length) {
  lines.push(
    '',
    '## 6. Five-leg tickets (no touchdowns)',
    '',
    'One per game from the volume projections, docs/FIVE_LEG_FORMULA.md. Joint is the shrunk model number; book is what the price implies.',
    '',
  );
  lines.push('| Game | Price | Joint | Book | Legs |', '| --- | --- | --- | --- | --- |');
  for (const fg of five.games) {
    const t = fg.ticket || fg.fallback;
    if (!t) continue;
    lines.push(
      `| ${fg.game}${fg.ticket ? '' : ' (short of target)'} | ${price(t.price)} | ${pct(t.joint)} | ${pct(t.bookJoint)} | ${t.legs.map((l) => `${l.label} ${price(l.price)}`).join('; ')} |`,
    );
  }
}
lines.push('', '## 7. Game by game', '');
for (const g of r.games) {
  lines.push(`### ${g.away.short} at ${g.home.short} — ${et(g.kickoff)}`, '');
  lines.push(`${g.lines.spread}, total ${g.lines.total}. ${g.market?.why ?? ''}`, '');
  lines.push(
    `**Max-confidence scorers:** ${g.top3.map((p) => `${p.name} ${price(p.price)} (${pct(p.est)})`).join(' · ')}`,
    '',
  );
  lines.push(
    `**Value:** ${g.value.map((p) => `${p.name} ${price(p.price)} (${pct(p.est)})`).join(' · ')}`,
    '',
  );
  if (g.market?.propLeans?.length)
    lines.push(
      `**Prop leans:** ${g.market.propLeans.map((l) => `${l.player} ${l.side} ${l.line} ${l.market.replace('player_', '').replace('_', ' ')}`).join(' · ')}`,
      '',
    );
}
const out = path.join(
  ROOT,
  'docs',
  `week-${String(r.week).padStart(2, '0')}-${r.season}-report.md`,
);
import('node:fs').then((fs) => {
  fs.writeFileSync(out, lines.join('\n') + '\n');
  console.log(`wrote ${path.relative(ROOT, out)} (${lines.length} lines)`);
});
