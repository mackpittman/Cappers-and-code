// Posts a message to the members' Discord as the CC Core bot. Replaces the channel-bound webhook so
// the board can move channels by changing pipeline_config.discord_post_channel_id, and no webhook
// URL has to live in any runner. Auth: x-sync-secret must equal pipeline_config.publish_secret.
// Body: { content?: string, embeds?: object[], username?: string, channel_id?: string,
//         mention_users?: string[],
//         ping?: 'board'|'live'|'primetime'|'results'|'free' }
// `ping` prepends the matching opt-in role mention, so only members who asked for that kind of
// drop get alerted. Unknown or unconfigured keys post without a mention rather than failing.
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const API = 'https://discord.com/api/v10';

async function cfg(key: string): Promise<string | null> {
  const { data } = await admin.from('pipeline_config').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const [secret, token, defaultChannel, webhook] = await Promise.all([
    cfg('publish_secret'),
    cfg('discord_bot_token'),
    cfg('discord_post_channel_id'),
    cfg('discord_webhook_url'),
  ]);
  if (!secret || req.headers.get('x-sync-secret') !== secret)
    return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  // Opt-in role ping. Only the role we name is allowed to notify: never @everyone, never @here.
  let content = body.content ?? '';
  let allowed: Record<string, unknown> = { parse: [] };
  if (body.ping) {
    const roleId = await cfg(`discord_role_${String(body.ping).replace(/[^a-z]/g, '')}`);
    if (roleId) {
      content = `<@&${roleId}>\n${content}`;
      allowed = { parse: [], roles: [roleId] };
    }
  }
  // Naming specific users, which is how another bot is handed a message to act on. A mention that
  // is not listed here still renders as text but reaches nobody, so tagging without this is a
  // message that looks right and does nothing.
  if (Array.isArray(body.mention_users) && body.mention_users.length) {
    const users = body.mention_users.map((u: unknown) => String(u)).filter((u) => /^\d{17,20}$/.test(u));
    if (users.length) allowed = { ...allowed, users };
  }
  const payload = { content, embeds: body.embeds ?? [], allowed_mentions: allowed };
  const channel = body.channel_id ?? defaultChannel;

  // Preferred: post as the bot into the configured channel.
  if (token && channel) {
    const r = await fetch(`${API}/channels/${channel}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (r.ok) return json({ via: 'bot', channel, status: r.status });
    const err = await r.text();
    if (!webhook || body.no_fallback)
      return json({ via: 'bot', channel, status: r.status, error: err.slice(0, 300) }, 502);
    // Fall through to the webhook when the bot lacks Send Messages in that channel.
    console.warn(`bot post failed (${r.status}): ${err.slice(0, 200)}; using the webhook`);
  }
  // Fallback: the legacy channel-bound webhook.
  if (!webhook) return json({ error: 'no bot channel and no webhook configured' }, 503);
  const r = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: body.username ?? 'CC Core', ...payload }),
  });
  return json(
    { via: 'webhook', status: r.status, error: r.ok ? undefined : (await r.text()).slice(0, 300) },
    r.ok ? 200 : 502,
  );
});
