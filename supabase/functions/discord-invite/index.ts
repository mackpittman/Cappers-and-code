// Discord entry control. The server is invite-only; a person needs a code from us, and redeeming
// a code mints a SINGLE-USE Discord invite at that moment. A leaked link is spent after one join.
//
// Admin (x-sync-secret = publish_secret):
//   { action: 'mint',   count?, note?, days?, max_uses? }  -> new codes
//   { action: 'list',   limit? }                            -> codes and their usage
//   { action: 'revoke', code }                              -> kill a code
// Public:
//   { action: 'redeem', code }                              -> a one-time Discord invite URL
// Member (Authorization: Bearer <user access token>):
//   { action: 'me' }                                        -> that member's standing invite
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const API = 'https://discord.com/api/v10';
/** Single-use, and short-lived so a screenshot goes stale. */
const INVITE_MAX_AGE = 24 * 3600;

// Called from the browser on another origin; see discord-access for why this is required.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function cfg(key: string): Promise<string | null> {
  const { data } = await admin.from('pipeline_config').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}

// No I, O, 0 or 1: these get read aloud and typed by hand.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codeOf = (n = 6) =>
  'CC-' +
  Array.from({ length: n }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

/** Mint a fresh single-use invite to the welcome channel. */
async function mintDiscordInvite(token: string, channelId: string) {
  const r = await fetch(`${API}/channels/${channelId}/invites`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      max_age: INVITE_MAX_AGE,
      max_uses: 1,
      unique: true,
      temporary: false,
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`discord ${r.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return {
    url: `https://discord.gg/${body.code}`,
    expires_at: new Date(Date.now() + INVITE_MAX_AGE * 1000).toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const [secret, token, channelId] = await Promise.all([
    cfg('publish_secret'),
    cfg('discord_bot_token'),
    cfg('discord_invite_channel_id'),
  ]);
  if (!token) return json({ error: 'no discord_bot_token configured' }, 503);
  if (!channelId) return json({ error: 'no discord_invite_channel_id configured' }, 503);

  const body = await req.json().catch(() => ({}));
  const action = body.action ?? 'redeem';
  const isAdmin = !!secret && req.headers.get('x-sync-secret') === secret;

  try {
    if (action === 'mint' || action === 'list' || action === 'revoke') {
      if (!isAdmin) return json({ error: 'unauthorized' }, 401);

      if (action === 'mint') {
        const count = Math.min(Math.max(Number(body.count ?? 1), 1), 100);
        const days = Number(body.days ?? 30);
        const maxUses = Math.min(Math.max(Number(body.max_uses ?? 1), 1), 50);
        const rows = Array.from({ length: count }, () => ({
          code: codeOf(),
          note: body.note ?? null,
          max_uses: maxUses,
          expires_at: days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null,
        }));
        const { error } = await admin.from('invite_codes').insert(rows);
        if (error) return json({ error: error.message }, 502);
        return json({ codes: rows.map((r) => r.code), expires_in_days: days, max_uses: maxUses });
      }

      if (action === 'revoke') {
        const { error } = await admin
          .from('invite_codes')
          .update({ revoked: true })
          .eq('code', String(body.code ?? '').toUpperCase());
        if (error) return json({ error: error.message }, 502);
        return json({ revoked: body.code });
      }

      const { data, error } = await admin
        .from('invite_codes')
        .select('code, note, uses, max_uses, expires_at, last_used_at, revoked, created_at')
        .order('created_at', { ascending: false })
        .limit(Math.min(Number(body.limit ?? 50), 200));
      if (error) return json({ error: error.message }, 502);
      return json({ codes: data });
    }

    if (action === 'me') {
      const auth = req.headers.get('Authorization') ?? '';
      const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!jwt) return json({ error: 'sign in first' }, 401);
      const { data: got, error: authErr } = await admin.auth.getUser(jwt);
      const user = got?.user;
      if (authErr || !user) return json({ error: 'sign in first' }, 401);
      const { data: entitled } = await admin.rpc('is_entitled', { uid: user.id });
      if (!entitled) return json({ error: 'members only' }, 403);

      const { data: existing } = await admin
        .from('member_invites')
        .select('discord_invite, expires_at')
        .eq('user_id', user.id)
        .maybeSingle();
      // Reuse while it has real life left; an invite about to expire is worse than useless.
      if (existing && new Date(existing.expires_at).getTime() - Date.now() > 10 * 60 * 1000)
        return json({
          url: existing.discord_invite,
          expires_at: existing.expires_at,
          reused: true,
        });

      const inv = await mintDiscordInvite(token, channelId);
      await admin.from('member_invites').upsert(
        {
          user_id: user.id,
          discord_invite: inv.url,
          expires_at: inv.expires_at,
          refreshed_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
      return json({ url: inv.url, expires_at: inv.expires_at, reused: false });
    }

    if (action === 'redeem') {
      const code = String(body.code ?? '')
        .trim()
        .toUpperCase();
      if (!code) return json({ error: 'enter your code' }, 400);
      const { data: row } = await admin
        .from('invite_codes')
        .select('*')
        .eq('code', code)
        .maybeSingle();
      // Same message for wrong, spent, expired and revoked: do not help anyone probe codes.
      const dead =
        !row ||
        row.revoked ||
        row.uses >= row.max_uses ||
        (row.expires_at && new Date(row.expires_at) < new Date());
      if (dead) return json({ error: 'That code is not valid.' }, 404);

      const inv = await mintDiscordInvite(token, channelId);
      const { error } = await admin
        .from('invite_codes')
        .update({
          uses: row.uses + 1,
          last_discord_invite: inv.url,
          last_used_at: new Date().toISOString(),
        })
        .eq('code', code)
        .eq('uses', row.uses); // lose the race rather than hand out two invites for one use
      if (error) return json({ error: 'That code is not valid.' }, 404);
      return json({
        url: inv.url,
        expires_at: inv.expires_at,
        uses_left: row.max_uses - row.uses - 1,
      });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
