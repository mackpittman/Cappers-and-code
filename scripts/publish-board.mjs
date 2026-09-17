// Publishes data/board.json to Supabase so the app can read it through an entitlement check.
// Needs SUPABASE_URL, SUPABASE_ANON_KEY and BOARD_PUBLISH_SECRET (the value stored in pipeline_config).
import fs from 'node:fs';
import path from 'node:path';
import { DATA, ROOT, readJson } from './lib.mjs';

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const secret = process.env.BOARD_PUBLISH_SECRET;
const board = readJson(path.join(DATA, 'board.json'));
if (!board) {
  console.error('no board.json');
  process.exit(1);
}
if (!url || !anon || !secret) {
  console.error(
    'SUPABASE_URL, SUPABASE_ANON_KEY or BOARD_PUBLISH_SECRET missing; skipping publish.',
  );
  process.exit(0);
}

// The preview is what non-members see: enough to show the model is real, not enough to bet from.
const preview = {
  season: board.season,
  week: board.week,
  generatedAt: board.generatedAt,
  oddsFetchedAt: board.oddsFetchedAt,
  lockedIn: (board.bestBets || []).slice(0, 5).map((b) => ({
    gameLabel: b.gameLabel,
    market: /over|under/i.test(b.bet) ? 'Total' : /ATD/.test(b.bet) ? 'Anytime TD' : 'Side',
    conf: b.conf,
  })),
  tdBoard: (board.slateTop || [])
    .slice(0, 10)
    .map((p) => ({ name: p.name, team: p.team, pos: p.pos })),
  games: (board.games || []).map((g) => ({
    id: g.id,
    away: g.away.abbr,
    home: g.home.abbr,
    kickoff: g.kickoff,
  })),
  record: board.record ? board.record.season_totals : null,
  lastWeek: board.results ? board.results.summary : null,
  memberCount: {
    games: (board.games || []).length,
    picks: (board.games || []).reduce((n, g) => n + g.top3.length + g.value.length, 0),
    stacks:
      (board.games || []).reduce((n, g) => n + g.stacks.length, 0) +
      (board.crossStacks || []).length,
  },
};
// Handoff: a Routine session that cannot push to git can ride named repo files along on the
// preview (HANDOFF_FILES=src/data/research.json,docs/week-02-2026-report.md); the next session with
// git access runs scripts/handoff-pull.mjs to write them back and commit. The following normal
// publish drops the payload again.
// A committed data/handoff.json ({ files: [...], until: ISO }) does the same from a Routine session
// that cannot take environment overrides; it stops attaching once `until` has passed.
const handoffCfg = readJson(path.join(DATA, 'handoff.json'), null);
const handoffList = process.env.HANDOFF_FILES
  ? process.env.HANDOFF_FILES.split(',')
  : handoffCfg?.files && Date.parse(handoffCfg.until || 0) > Date.now()
    ? handoffCfg.files
    : [];
if (handoffList.length) {
  const files = {};
  for (const rel of handoffList.map((x) => String(x).trim()).filter(Boolean)) {
    const abs = path.resolve(ROOT, rel);
    if (!abs.startsWith(ROOT + path.sep) || !fs.existsSync(abs)) {
      console.error(`handoff: skipping ${rel} (missing or outside the repo)`);
      continue;
    }
    files[rel] = fs.readFileSync(abs, 'utf8');
  }
  preview.handoff = { savedAt: new Date().toISOString(), files };
  console.log(`handoff: ${Object.keys(files).length} files attached to the preview`);
}
const res = await fetch(`${url}/rest/v1/rpc/publish_board`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
  body: JSON.stringify({ secret, board, preview }),
});
const text = await res.text();
console.log(`publish: ${res.status} ${text.slice(0, 80)}`);
if (!res.ok) process.exit(1);
