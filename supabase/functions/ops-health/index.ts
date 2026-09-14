// Pipeline health check. Runs from pg_cron inside the database, NOT from the runner, because a
// runner that has died is exactly the thing that never reports its own failure.
//
// Alerts go to the owner as a Discord DM: private, immediate, and no new channel needed.
// POST {} with x-sync-secret, or { dry: true } to see the findings without sending.
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const API = 'https://discord.com/api/v10';
const STATE_KEY = 'ops-alert-state';

/** Thresholds, all overridable from pipeline_config so tuning needs no deploy. */
const DEFAULTS = { boardStaleHours: 30, creditsFloor: 60, runStaleHours: 30, repeatHours: 12 };

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

async function cfg(key: string): Promise<string | null> {
  const { data } = await admin.from('pipeline_config').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}
const hoursSince = (iso: string | null | undefined) =>
  iso ? (Date.now() - Date.parse(iso)) / 3600000 : Infinity;

async function dmOwner(token: string, ownerId: string, content: string) {
  const ch = await fetch(`${API}/users/@me/channels`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: ownerId }),
  });
  const chBody = await ch.json().catch(() => ({}));
  if (!ch.ok) throw new Error(`open DM ${ch.status}: ${JSON.stringify(chBody).slice(0, 160)}`);
  const msg = await fetch(`${API}/channels/${chBody.id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
  if (!msg.ok) throw new Error(`DM ${msg.status}: ${(await msg.text()).slice(0, 160)}`);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const [secret, token, ownerId, tuning] = await Promise.all([
    cfg('publish_secret'),
    cfg('discord_bot_token'),
    cfg('discord_owner_id'),
    cfg('ops_thresholds'),
  ]);
  if (!secret || req.headers.get('x-sync-secret') !== secret)
    return json({ error: 'unauthorized' }, 401);

  const t = { ...DEFAULTS, ...(tuning ? JSON.parse(tuning) : {}) };
  const body = await req.json().catch(() => ({}));

  const { data: board } = await admin
    .from('boards')
    .select('id, generated_at, published_at, data')
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: run } = await admin
    .from('pipeline_state')
    .select('value, updated_at')
    .eq('key', 'last-run-report')
    .maybeSingle();

  const credits = Number(board?.data?.oddsCredits?.remaining ?? NaN);
  const report = String(run?.value?.report ?? '');
  const issues: string[] = [];

  const boardAge = hoursSince(board?.published_at);
  if (boardAge > t.boardStaleHours)
    issues.push(`Board is ${boardAge.toFixed(0)}h old (limit ${t.boardStaleHours}h).`);

  const runAge = hoursSince(run?.updated_at);
  if (runAge > t.runStaleHours)
    issues.push(`No pipeline run for ${runAge.toFixed(0)}h (limit ${t.runStaleHours}h).`);

  if (Number.isFinite(credits) && credits < t.creditsFloor)
    issues.push(`Odds API credits down to ${credits} (floor ${t.creditsFloor}).`);

  // The runner writes its own failures into the report; surface them rather than re-deriving.
  if (/Script errors: (?!no)/i.test(report)) issues.push('Last run reported script errors.');
  if (/push to origin main was rejected|access denied by the git proxy/i.test(report))
    issues.push('Last run could not push to the repo; data is only in Supabase.');
  if (/publish-board: (?!200)/.test(report)) issues.push('Last run failed to publish the board.');

  const fingerprint = issues.slice().sort().join(' | ');
  const { data: prev } = await admin
    .from('pipeline_state')
    .select('value')
    .eq('key', STATE_KEY)
    .maybeSingle();
  const last = (prev?.value ?? {}) as { fingerprint?: string; sent_at?: string };
  // Re-send only when the problem changes, or after repeatHours of the same problem standing.
  const changed = last.fingerprint !== fingerprint;
  const stale = hoursSince(last.sent_at) >= t.repeatHours;
  const shouldSend = issues.length > 0 && (changed || stale);

  if (body.dry) return json({ issues, fingerprint, shouldSend, credits, boardAge, runAge });

  if (shouldSend && token && ownerId) {
    const lines = issues.map((i) => `• ${i}`).join('\n');
    await dmOwner(
      token,
      ownerId,
      `**Cappers & Code · pipeline alert**\n${lines}\n\nBoard ${board?.id ?? '?'} published ${boardAge.toFixed(0)}h ago. Credits ${Number.isFinite(credits) ? credits : '?'}.`,
    );
  }
  // Record the cleared state too, so recovery does not look like a fresh alert later.
  await admin.from('pipeline_state').upsert(
    {
      key: STATE_KEY,
      value: {
        fingerprint,
        sent_at: shouldSend ? new Date().toISOString() : (last.sent_at ?? null),
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );

  return json({ issues, sent: shouldSend, credits });
});
