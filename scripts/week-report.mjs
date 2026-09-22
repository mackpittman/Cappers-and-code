// Renders the week's research into docs/week-NN-YYYY-report.md.
//
// The first two weeks of this report were typed by hand from the same JSON the app reads, and the
// typing is where the errors came from: implied team points transcribed in the wrong order, a
// de-vigged probability that did not match the moneyline beside it, a price quoted from a different
// book than the one in the data. Everything here is read straight out of src/data/research.json, so
// the document and the board cannot disagree.
//
//   node scripts/week-report.mjs            writes docs/week-NN-YYYY-report.md
//   OUT=- node scripts/week-report.mjs      prints to stdout instead
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson } from './lib.mjs';

const r = readJson(path.join(ROOT, 'src/data/research.json'));
if (!r) {
  console.error('no src/data/research.json');
  process.exit(1);
}

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const price = (p, note) => (p == null ? (note ? `_${note}_` : 'n/a') : `${p > 0 ? '+' : ''}${p}`);
const implied = (a) => (a > 0 ? 100 / (a + 100) : -a / (-a + 100));
const et = (iso, o) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', ...o });
const kick = (iso) =>
  et(iso, {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
    .replace(',', ',')
    .replace(/ /g, ' ') + ' ET';
// A markdown table cell cannot contain a bare pipe or a line break.
const cell = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n+/g, ' ');
// A desk rationale is a paragraph. In a table cell it makes the whole table unreadable, so the
// list views quote only its opening sentence and the full text stays on the game's own section.
const firstSentence = (t) => (String(t).match(/^.*?[a-z0-9)%"][.!?](?=\s|$)/s) ?? [String(t)])[0];
const table = (head, rows) =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((c) => `| ${c.map(cell).join(' | ')} |`),
  ].join('\n');

const games = r.games ?? [];
const gameOf = (id) => games.find((g) => g.id === id);
const label = (g) => `${g.away.abbr}@${g.home.abbr}`;
const out = [];

// ---------- header ----------
out.push(`# NFL Week ${r.week} ${r.season} — Touchdown Probability & Parlay Report`);
out.push('');
out.push(
  `**Prepared:** ${et(r.researchAsOf, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.`,
);
out.push(
  `**Scope:** all ${games.length} Week ${r.week} games, ${kick(games[0]?.kickoff)} through ${kick(games[games.length - 1]?.kickoff)}.`,
);
out.push(
  "**Method:** one researcher per game, working from the previous week's finals, current injury reports, current market lines and posted anytime-touchdown prices where a book had them up. Win probabilities are vig-removed from the moneyline and sum to one. Implied team points are derived from the spread and the total. Touchdown estimates are the desk's own, built from goal-line share, end-zone targets, implied team total and the defence's touchdown-rate weaknesses — they are not the book's number with the hold stripped.",
);
out.push('');
out.push(`> ${r.notes}`);
out.push('');
out.push('---');
out.push('');

// ---------- 1. slate at a glance ----------
out.push(`## 1. Slate at a glance`);
out.push('');
out.push(
  table(
    [
      'Kick',
      'Away',
      'Home',
      'Spread',
      'Total',
      'Away ML',
      'Home ML',
      'Away win%',
      'Home win%',
      'Implied away',
      'Implied home',
    ],
    games.map((g) => [
      kick(g.kickoff),
      g.away.short,
      g.home.short,
      g.lines.spread,
      g.lines.total,
      price(g.lines.ml.away),
      price(g.lines.ml.home),
      pct(g.lines.winProb.away),
      pct(g.lines.winProb.home),
      g.lines.implied.away,
      g.lines.implied.home,
    ]),
  ),
);
out.push('');

// ---------- 2. slate-wide scorers ----------
const scorers = games
  .flatMap((g) => [...(g.top3 ?? []), ...(g.value ?? [])].map((p) => ({ ...p, game: label(g) })))
  .sort((a, b) => b.est - a.est);
out.push('## 2. Slate-wide top touchdown scorers');
out.push('');
out.push("Ranked by the desk's own estimate, not by price.");
out.push('');
out.push(
  table(
    ['#', 'Player', 'Team', 'Pos', 'Game', 'ATD price', 'Implied', 'Desk est.'],
    scorers
      .slice(0, 24)
      .map((p, i) => [
        i + 1,
        p.name,
        p.team,
        p.pos ?? '—',
        p.game,
        price(p.price, p.priceNote),
        p.price == null ? '—' : pct(implied(p.price)),
        pct(p.est),
      ]),
  ),
);
out.push('');
const value = scorers
  .filter((p) => p.price != null && p.est > implied(p.price))
  .sort((a, b) => b.est - implied(b.price) - (a.est - implied(a.price)));
out.push('### Where the desk is furthest above the price');
out.push('');
out.push(
  table(
    ['Player', 'Game', 'Price', 'Implied', 'Desk est.', 'Edge', 'Why'],
    value
      .slice(0, 12)
      .map((p) => [
        `**${p.name}** (${p.team} ${p.pos ?? ''})`.trim(),
        p.game,
        price(p.price),
        pct(implied(p.price)),
        pct(p.est),
        `+${Math.round((p.est - implied(p.price)) * 100)} pts`,
        p.why,
      ]),
  ),
);
out.push('');
out.push(
  'And the other direction — names the market likes more than the desk does, which are the ones to leave out of a stack:',
);
out.push('');
const fades = scorers
  .filter((p) => p.price != null && implied(p.price) - p.est >= 0.05)
  .sort((a, b) => implied(b.price) - b.est - (implied(a.price) - a.est));
out.push(
  table(
    ['Player', 'Game', 'Price', 'Implied', 'Desk est.', 'Gap'],
    fades
      .slice(0, 8)
      .map((p) => [
        `**${p.name}** (${p.team})`,
        p.game,
        price(p.price),
        pct(implied(p.price)),
        pct(p.est),
        `−${Math.round((implied(p.price) - p.est) * 100)} pts`,
      ]),
  ),
);
out.push('');
out.push('---');
out.push('');

// ---------- 3. tickets ----------
out.push('## 3. Tickets');
out.push('');
out.push('### Cross-game stacks');
out.push('');
for (const st of r.crossStacks ?? []) {
  out.push(`- **${st.legs.join(' + ')}** — ${st.why}`);
}
out.push('');
out.push('### Max confidence');
out.push('');
for (const m of r.maxConfidence ?? [])
  out.push(`- **${m.bet}** · ${m.game} · ${m.kind} · ${price(m.price)} — ${firstSentence(m.why)}`);
out.push('');
if ((r.upsetLeans ?? []).length) {
  out.push('### Upset leans');
  out.push('');
  out.push(
    'Underdogs the desk projects to win outright, or takes at a de-vigged 40% or better. A dog we merely like on the spread is not on this list.',
  );
  out.push('');
  out.push(
    table(
      ['Team', 'Moneyline', 'Win prob', 'Why'],
      r.upsetLeans.map((u) => [u.team, price(u.price), pct(u.winProb), firstSentence(u.why)]),
    ),
  );
  out.push('');
}
out.push('### Best bets');
out.push('');
out.push(
  table(
    ['Conf', 'Bet', 'Game'],
    (r.bestBets ?? []).map((b) => [`${b.conf}/5`, b.bet, b.game]),
  ),
);
out.push('');
out.push('---');
out.push('');

// ---------- 4. game by game ----------
out.push('## 4. Game by game');
out.push('');
for (const g of games) {
  out.push(`### ${g.away.name} @ ${g.home.name} — ${kick(g.kickoff)}, ${g.venue}`);
  out.push('');
  out.push(
    `**${g.lines.spread}** · total **${g.lines.total}** · ML ${price(g.lines.ml.away)} / ${price(g.lines.ml.home)} · win prob ${pct(g.lines.winProb.away)} / ${pct(g.lines.winProb.home)} · implied ${g.away.abbr} ${g.lines.implied.away} – ${g.home.abbr} ${g.lines.implied.home}`,
  );
  out.push('');
  for (const [key, heading] of [
    ['offseason', 'Offseason'],
    ['matchup', 'Offence against defence'],
    ['injuries', 'Injuries'],
    ['oddsNotes', 'Odds'],
    ['atdNotes', 'The touchdown board'],
  ]) {
    if (!g.sections?.[key]) continue;
    out.push(`#### ${heading}`);
    out.push('');
    out.push(g.sections[key]);
    out.push('');
  }
  if ((g.atdBoard ?? []).length) {
    out.push('#### Anytime touchdown prices');
    out.push('');
    out.push(
      table(
        ['Player', 'Team', 'Price', 'Implied'],
        g.atdBoard.map((p) => [
          p.name,
          p.team,
          price(p.price, p.priceNote),
          p.price == null ? '—' : pct(implied(p.price)),
        ]),
      ),
    );
    out.push('');
  }
  if ((g.top3 ?? []).length) {
    out.push('#### Top three');
    out.push('');
    g.top3.forEach((p, i) =>
      out.push(
        `${i + 1}. **${p.name}** (${p.team} ${p.pos ?? ''}) — ${price(p.price, p.priceNote)}, implied ${p.price == null ? '—' : pct(implied(p.price))}, desk ${pct(p.est)}. ${p.why}`.replace(
          '  ',
          ' ',
        ),
      ),
    );
    out.push('');
  }
  if ((g.value ?? []).length) {
    out.push('#### Value');
    out.push('');
    for (const p of g.value)
      out.push(
        `- **${p.name}** (${p.team} ${p.pos ?? ''}) — ${price(p.price, p.priceNote)}, desk ${pct(p.est)}. ${p.why}`.replace(
          '  ',
          ' ',
        ),
      );
    out.push('');
  }
  if (g.market) {
    out.push('#### The desk');
    out.push('');
    out.push(
      `**Side:** ${g.market.side} (${g.market.sideConf}/5) · **Total:** ${g.market.total} (${g.market.totalConf}/5) · **Projected:** ${g.away.abbr} ${g.market.projected?.away} – ${g.home.abbr} ${g.market.projected?.home}`,
    );
    out.push('');
    out.push(g.market.why);
    out.push('');
    if ((g.market.propLeans ?? []).length) {
      out.push('Prop leans:');
      out.push('');
      for (const p of g.market.propLeans)
        out.push(
          `- **${p.player}** ${p.side} ${p.line} ${p.market.replace('player_', '').replace(/_/g, ' ')} — ${p.why}`,
        );
      out.push('');
    }
  }
  if ((g.stacks ?? []).length) {
    out.push('#### Stacks');
    out.push('');
    for (const st of g.stacks) out.push(`- ${st.legs.join(' + ')} — ${st.why}`);
    out.push('');
  }
  out.push('---');
  out.push('');
}

const md = out.join('\n').replace(/\n{3,}/g, '\n\n');
const file = path.join(
  ROOT,
  'docs',
  `week-${String(r.week).padStart(2, '0')}-${r.season}-report.md`,
);
if (process.env.OUT === '-') console.log(md);
else {
  fs.writeFileSync(file, md);
  console.log(`wrote ${path.relative(ROOT, file)} (${md.split('\n').length} lines)`);
}
