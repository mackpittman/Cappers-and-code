// Pulls files a Routine session attached to the board preview (publish-board.mjs HANDOFF_FILES)
// and writes them back into the repo so they can be committed from a session with git access.
// Reads only the public preview: SUPABASE_URL / SUPABASE_ANON_KEY from the environment, or the
// public values in app.json. Refuses paths outside the repository.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const extra = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo?.extra || {};
const url = process.env.SUPABASE_URL || extra.supabaseUrl;
const anon = process.env.SUPABASE_ANON_KEY || extra.supabaseAnonKey;
if (!url || !anon) {
  console.error('SUPABASE_URL / SUPABASE_ANON_KEY missing and app.json has no public values');
  process.exit(1);
}
export function safeTarget(rel) {
  const abs = path.resolve(ROOT, rel);
  return abs.startsWith(ROOT + path.sep) && !path.isAbsolute(rel) ? abs : null;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await fetch(`${url}/rest/v1/rpc/get_board_preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
    body: '{}',
  });
  if (!r.ok) {
    console.error(`get_board_preview: ${r.status} ${(await r.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const preview = await r.json();
  const files = preview?.handoff?.files || {};
  const names = Object.keys(files);
  if (!names.length) {
    console.log('handoff: nothing attached to the current preview');
    process.exit(0);
  }
  let n = 0;
  for (const rel of names) {
    const abs = safeTarget(rel);
    if (!abs) {
      console.error(`handoff: refusing ${rel}`);
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, files[rel]);
    n++;
    console.log(`handoff: wrote ${rel} (${files[rel].length} bytes)`);
  }
  console.log(`handoff: ${n} files from ${preview.handoff.savedAt}`);
}
