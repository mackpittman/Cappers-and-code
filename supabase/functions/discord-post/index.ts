// Posts a message to the members' Discord as the CC Core bot. Replaces the channel-bound webhook so
// the board can move channels by changing pipeline_config.discord_post_channel_id, and no webhook
// URL has to live in any runner. Auth: x-sync-secret must equal pipeline_config.publish_secret.
// Body: { content?: string, embeds?: object[], username?: string, channel_id?: string }
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
  const payload = { content: body.content ?? '', embeds: body.embeds ?? [] };
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
