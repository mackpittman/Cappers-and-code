// Posts the daily board digest to Discord as brand-aligned embeds.
//
// Everything that goes out is trimmed to Discord's embed limits first — see discord-limits.mjs.
// The digest went silent for a day because the LOCKED IN embed grew past 4096 characters as the
// week's best-bet list got longer, and the only signal was a 400 naming embeds[0].
// Requires DISCORD_WEBHOOK_URL (create a webhook on #daily-board, name it "CC Core", avatar brand/discord/server-icon.png).
// Optional: DISCORD_MAX_BETS (default 8), DISCORD_MAX_TD (default 8), DISCORD_DRY_RUN=1 prints the payload instead of posting.
// The full digest goes out at most once per UTC day. That is enforced here, in code, because the
// Routine that runs this script has posted the digest twice on hand-fired days: it does a standard
// pass before it reads the override message, and a prompt line saying "once per day" did not stop
// it. DISCORD_FORCE=1 posts a second digest on purpose; parlay-only posts are never gated.
import path from 'node:path';
import { fitItems, fitEmbeds, validate } from './discord-limits.mjs';
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
        ? p.price != null
          ? `${am(p.price)} ${p.legs[0].book} · fair ${am(p.fairPrice)} · ${pct(p.prob)} model`
          : `fair ${am(p.fairPrice)}, play ${am(p.minPrice)} or better`
        : p.price != null
          ? `${am(p.price)} · ${pct(p.prob)} model`
          : '';
    return `**${c.title}** · ${legs}${tail ? `\n${tail}` : ''}`;
  });

// DISCORD_PARLAYS_ONLY=1 posts just the parlay board (used when the digest already went out today).
const parlaysOnly = process.env.DISCORD_PARLAYS_ONLY === '1';
const force = process.env.DISCORD_FORCE === '1';
const DIGEST_KEY = 'discord-digest';
const today = new Date().toISOString().slice(0, 10);
// The once-a-day record lives in pipeline_state next to the odds pulls, so every session that can
// post can also see what already went out. Without the state credentials the guard cannot run and
// says so rather than silently posting.
const stateReady = !!(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_ANON_KEY &&
  process.env.BOARD_PUBLISH_SECRET
);
async function stateRpc(fn, body) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ secret: process.env.BOARD_PUBLISH_SECRET, ...body }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
if (!parlaysOnly && !force && process.env.DISCORD_DRY_RUN !== '1') {
  if (!stateReady) {
    console.error(
      'discord: cannot check whether the digest already went out today (state credentials missing); not posting. Set DISCORD_FORCE=1 to post anyway.',
    );
    process.exit(0);
  }
  const prior = await stateRpc('get_pipeline_state', { state_key: DIGEST_KEY }).catch(() => null);
  if (prior?.value?.date === today) {
    console.log(
      `discord: digest already posted today at ${prior.value.at} (message ${prior.value.message_id ?? '?'}); skipping. DISCORD_FORCE=1 overrides.`,
    );
    process.exit(0);
  }
}
async function recordDigest(messageId) {
  if (parlaysOnly || !stateReady) return;
  await stateRpc('set_pipeline_state', {
    state_key: DIGEST_KEY,
    state_value: {
      date: today,
      at: new Date().toISOString(),
      message_id: messageId ?? null,
      week: board.week,
    },
  }).catch((e) => console.error(`discord: could not record the digest post: ${e.message}`));
}
// Which opt-in role this drop alerts. DISCORD_PING overrides for one-off posts (a live card,
// a results card); empty string posts silently. Members who never took the role get no ping.
const ping = process.env.DISCORD_PING ?? 'board';
const payload = parlaysOnly
  ? {
      username: 'CC Core',
      ping,
      content: `**PARLAY BOARD · NFL WEEK ${board.week}**\nRanked one to five per category in the app. FanDuel and DraftKings prices.`,
      embeds: [
        {
          title: 'PARLAY BOARD',
          description: `${fitItems(parlayLines, 3900) || 'No parlays qualified.'}\nUnits, not dollars. Model probabilities, not guarantees.`,
          color: GREEN,
          footer: { text: 'Cappers & Code · @cappersandcode' },
        },
      ],
    }
  : {
      username: 'CC Core',
      ping,
      content: `**TODAY'S EDGE · NFL WEEK ${board.week}**\nAI Models. Human Insight. One Edge.`,
      embeds: [
        {
          title: 'LOCKED IN',
          description: fitItems(bets, 2600) || 'No confidence 3+ plays posted yet.',
          color: GREEN,
          thumbnail: undefined,
        },
        { title: 'TD BOARD', description: fitItems(td, 1200, (n) => `\n_+${n} more in the app._`) || 'No TD board yet.', color: GREEN },
        ...(parlayLines.length
          ? [
              {
                title: 'PARLAY BOARD',
                description: `${fitItems(parlayLines, 1200)}\nFull top-five per category in the app.`,
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
// Last line of defence: clamp to the total budget, then refuse to send something Discord will
// reject. A loud failure here is worth more than a 400 that names an array index.
payload.embeds = fitEmbeds(payload.embeds);
const problems = validate(payload);
if (problems.length) {
  console.error(`discord: payload would be rejected:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

// Preferred route: the discord-post edge function posts as the CC Core bot into the configured channel
// (pipeline_config.discord_post_channel_id) and needs only the publish secret. The webhook is the fallback.
const fnUrl = process.env.SUPABASE_URL;
const fnSecret = process.env.BOARD_PUBLISH_SECRET;
if (process.env.DISCORD_DRY_RUN === '1' || (!url && !(fnUrl && fnSecret))) {
  console.log(JSON.stringify(payload, null, 1));
  if (!url && !(fnUrl && fnSecret))
    console.error(
      'Neither SUPABASE_URL+BOARD_PUBLISH_SECRET nor DISCORD_WEBHOOK_URL set; printed payload only.',
    );
  process.exit(0);
}
if (fnUrl && fnSecret) {
  const res = await fetch(`${fnUrl}/functions/v1/discord-post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sync-secret': fnSecret },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  console.log(`discord (bot): ${res.status} ${text.slice(0, 120)}`);
  if (res.ok) {
    let id = null;
    try {
      id = JSON.parse(text)?.message_id ?? null;
    } catch {
      /* the function may answer with plain text */
    }
    await recordDigest(id);
    process.exit(0);
  }
  if (!url) process.exit(1);
  console.error('bot post failed; trying the webhook');
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
await recordDigest(null);
