// Stores a pipeline run report in Supabase (pipeline_state, key last-run-report) so ops-health can
// see that a run happened and what it said. Both Routine prompts call this when it exists; their
// fallback is a curl with the report JSON-escaped by hand, which breaks on the first quote.
//
//   node scripts/report-state.mjs report.txt
//   printf '%s' "$REPORT" | node scripts/report-state.mjs
//
// Needs SUPABASE_URL, SUPABASE_ANON_KEY and BOARD_PUBLISH_SECRET from the environment. The secret
// never appears on a command line or in the output.
import fs from 'node:fs';

const { SUPABASE_URL, SUPABASE_ANON_KEY, BOARD_PUBLISH_SECRET } = process.env;
const file = process.argv[2];
const report = (file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8')).trim();
if (!report) {
  console.error('report-state: the report is empty; nothing stored.');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !BOARD_PUBLISH_SECRET) {
  console.error(
    'report-state: SUPABASE_URL, SUPABASE_ANON_KEY or BOARD_PUBLISH_SECRET missing; report not stored.',
  );
  process.exit(0);
}
let r;
try {
  r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_pipeline_state`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      secret: BOARD_PUBLISH_SECRET,
      state_key: 'last-run-report',
      state_value: { at: new Date().toISOString(), report },
    }),
  });
} catch (e) {
  console.error(
    `report-state: request failed (${e?.cause?.code ?? e?.message ?? e}); report not stored.`,
  );
  process.exit(1);
}
console.log(`report-state: ${r.status}`);
if (!r.ok) {
  console.error((await r.text()).slice(0, 200));
  process.exit(1);
}
