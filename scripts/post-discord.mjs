// Posts the daily board digest to Discord as brand-aligned embeds.
// Requires DISCORD_WEBHOOK_URL (create a webhook on #daily-board, name it "CC Core", avatar brand/discord/server-icon.png).
// Optional: DISCORD_MAX_BETS (default 8), DISCORD_MAX_TD (default 8), DISCORD_DRY_RUN=1 prints the payload instead of posting.
import path from 'node:path';
import { DATA, ROOT, readJson, impliedProb } from './lib.mjs';

const url = process.env.DISCORD_WEBHOOK_URL;
const board = readJson(path.join(DATA, 'board.json'));
const tokens = readJson(path.join(ROOT, 'brand', 'tokens.json'));
if (!board) {
  console.error('no board.json');
  process.exit(1);
}
const GREEN = tokens?.discord?.embedColor ?? 11992832;
const am = (n) => (n == null ? '—' : n > 0 ? `+${n}` : `${n}`);
const pct = (p) => (p == null ? '—' : `${Math.round(p * 100)}%`);
const maxBets = Number(process.env.DISCORD_MAX_BETS ?? 8);
const maxTd = Number(process.env.DISCORD_MAX_TD ?? 8);
const games = Object.fromEntries(board.games.map((g) => [g.id, g]));
const label = (id) => (games[id] ? `${games[id].away.abbr}@${games[id].home.abbr}` : id);

const bets = (board.bestBets || [])
  .slice(0, maxBets)
  .map(
    (b) =>
      `**${b.bet}** · ${label(b.game)} · ${'▮'.repeat(b.conf)}${'▯'.repeat(5 - b.conf)}\n${b.why}`,
  );
const td = (board.slateTop || []).slice(0, maxTd).map((p, i) => {
  const price = p.live
    ? `${am(p.live.consensus)} (best ${am(p.live.best)})`
    : `${am(p.price)} research`;
  const edge = p.edge != null ? `${p.edge >= 0 ? '+' : ''}${Math.round(p.edge * 100)}` : '—';
  return `\`${String(i + 1).padStart(2)}\` **${p.name}** ${p.team} · ${price} · est ${pct(p.est)} · edge ${edge}`;
});
const rec = board.record?.season_totals?.lockedIn;
const recLine =
  rec && rec.wins + rec.losses > 0
    ? `Locked In record: **${rec.wins}-${rec.losses}${rec.pushes ? `-${rec.pushes}` : ''}** this season (graded from final box scores, nothing else).`
    : 'Record starts when the first games go final. Real results only.';
const fresh = `Prices ${board.oddsFetchedAt ? new Date(board.oddsFetchedAt).toUTCString().replace(' GMT', ' UTC') : 'research only'} · lines ${board.linesSource || 'research'}`;

// Parlay board: the number one ticket in each category (built by scripts/parlays.mjs, FD/DK prices).
const parlayLines = (board.parlays?.categories || [])
  .filter((c) => c.parlays.length)
  .map((c) => {
    const p = c.parlays[0];
    const legs = p.legs
      .map((l) => `${l.label}${l.price != null ? ` (${am(l.price)} ${l.book})` : ''}`)
      .join(' + ');
    const tail =
      c.key === 'twoPlus'
        ? `fair ${am(p.fairPrice)}, play ${am(p.minPrice)} or better`
        : p.price != null
          ? `${am(p.price)} · ${pct(p.prob)} model`
          : '';
    return `**${c.title}** · ${legs}${tail ? `\n${tail}` : ''}`;
  });

// DISCORD_PARLAYS_ONLY=1 posts just the parlay board (used when the digest already went out today).
const parlaysOnly = process.env.DISCORD_PARLAYS_ONLY === '1';
const payload = parlaysOnly
  ? {
      username: 'CC Core',
      content: `**PARLAY BOARD · NFL WEEK ${board.week}**\nRanked one to five per category in the app. FanDuel and DraftKings prices.`,
      embeds: [
        {
          title: 'PARLAY BOARD',
          description: `${parlayLines.join('\n\n') || 'No parlays qualified.'}\nUnits, not dollars. Model probabilities, not guarantees.`,
          color: GREEN,
          footer: { text: 'Cappers & Code · @cappersandcode' },
        },
      ],
    }
  : {
      username: 'CC Core',
      content: `**TODAY'S EDGE · NFL WEEK ${board.week}**\nAI Models. Human Insight. One Edge.`,
      embeds: [
        {
          title: 'LOCKED IN',
          description: bets.join('\n\n') || 'No confidence 3+ plays posted yet.',
          color: GREEN,
          thumbnail: undefined,
        },
        { title: 'TD BOARD', description: td.join('\n') || 'No TD board yet.', color: GREEN },
        ...(parlayLines.length
          ? [
              {
                title: 'PARLAY BOARD',
                description: `${parlayLines.join('\n\n')}\nFull top-five per category in the app.`,
                color: GREEN,
              },
            ]
          : []),
        {
          title: 'TRUST THE CODE',
          description: `${recLine}\n${fresh}\nUnits, not dollars. Real data, real wins, no fluff.`,
          color: GREEN,
          footer: { text: `Cappers & Code · @cappersandcode` },
        },
      ],
    };
if (process.env.DISCORD_DRY_RUN === '1' || !url) {
  console.log(JSON.stringify(payload, null, 1));
  if (!url) console.error('DISCORD_WEBHOOK_URL not set; printed payload only.');
  process.exit(0);
}
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
console.log(`discord: ${res.status}`);
if (!res.ok) {
  console.error(await res.text());
  process.exit(1);
}
