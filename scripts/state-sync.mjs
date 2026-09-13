// Keeps the pipeline's raw state in Supabase so a lost git push never costs odds credits twice.
//   node scripts/state-sync.mjs push   after publish: upload odds pulls, credit ledger, graded results
//   node scripts/state-sync.mjs pull   after clone: restore those files when the copy in Supabase is newer
// Needs SUPABASE_URL, SUPABASE_ANON_KEY, BOARD_PUBLISH_SECRET (never written to disk).
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './lib.mjs';

const mode = process.argv[2];
const { SUPABASE_URL, SUPABASE_ANON_KEY, BOARD_PUBLISH_SECRET } = process.env;
if (!['push', 'pull'].includes(mode)) {
  console.error('usage: state-sync.mjs push|pull');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !BOARD_PUBLISH_SECRET) {
  console.error(
    'SUPABASE_URL, SUPABASE_ANON_KEY or BOARD_PUBLISH_SECRET missing; state-sync skipped.',
  );
  process.exit(0);
}
const KEY = 'data-files';
const FILES = () => {
  const list = ['odds/latest.json', 'odds/credits.jsonl', 'odds/history.jsonl'];
  const results = path.join(DATA, 'results');
  if (fs.existsSync(results))
    for (const f of fs.readdirSync(results)) if (f.endsWith('.json')) list.push(`results/${f}`);
  return list;
};
const headers = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};
async function rpc(fn, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const localOddsAt = () => {
  try {
    return (
      JSON.parse(fs.readFileSync(path.join(DATA, 'odds/latest.json'), 'utf8')).fetchedAt ?? null
    );
  } catch {
    return null;
  }
};

if (mode === 'push') {
  const files = {};
  for (const rel of FILES()) {
    const f = path.join(DATA, rel);
    if (fs.existsSync(f)) files[rel] = fs.readFileSync(f, 'utf8');
  }
  const value = { savedAt: new Date().toISOString(), oddsFetchedAt: localOddsAt(), files };
  await rpc('set_pipeline_state', {
    secret: BOARD_PUBLISH_SECRET,
    state_key: KEY,
    state_value: value,
  });
  console.log(
    `state push: ${Object.keys(files).length} files, odds ${value.oddsFetchedAt ?? 'none'}`,
  );
} else {
  const remote = await rpc('get_pipeline_state', { secret: BOARD_PUBLISH_SECRET, state_key: KEY });
  if (!remote?.value?.files) {
    console.log('state pull: nothing stored yet');
    process.exit(0);
  }
  const local = localOddsAt();
  const theirs = remote.value.oddsFetchedAt;
  const newer = !local || (theirs && Date.parse(theirs) > Date.parse(local));
  if (!newer) {
    console.log(
      `state pull: local odds ${local} are current (remote ${theirs ?? 'none'}); nothing restored`,
    );
    process.exit(0);
  }
  let n = 0;
  for (const [rel, content] of Object.entries(remote.value.files)) {
    const f = path.join(DATA, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
    n++;
  }
  console.log(
    `state pull: restored ${n} files from ${remote.value.savedAt} (odds ${theirs}); the last run's push had not reached main`,
  );
}
