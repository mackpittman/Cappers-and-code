// Posts a message to the members' Discord as the CC Core bot. Replaces the channel-bound webhook so
// the board can move channels by changing pipeline_config.discord_post_channel_id, and no webhook
// URL has to live in any runner. Auth: x-sync-secret must equal pipeline_config.publish_secret.
// Body: { content?: string, embeds?: object[], username?: string, channel_id?: string,
//         mention_users?: string[], reply_to?: string,
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

  // Cleaning up after ourselves. Only ever used to remove messages this bot posted; Discord
  // refuses anything else unless the bot holds Manage Messages, which it does not need here.
  if (body.action === 'delete') {
    if (!token) return json({ error: 'no bot token' }, 503);
    const ch = body.channel_id ?? defaultChannel;
    const ids: string[] = Array.isArray(body.message_ids) ? body.message_ids.map(String) : [];
    const out: Record<string, number> = {};
    for (const id of ids) {
      const d = await fetch(`${API}/channels/${ch}/messages/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bot ${token}` },
      });
      out[id] = d.status;
    }
    return json({ deleted: out });
  }
  // Pinning, so an instruction sheet stays at the top of a channel instead of scrolling away.
  // Needs Manage Messages, which the bot does not otherwise require; the status is returned rather
  // than swallowed so a missing permission is visible instead of looking like a silent success.
  if (body.action === 'pin' || body.action === 'unpin') {
    if (!token) return json({ error: 'no bot token' }, 503);
    const ch = body.channel_id ?? defaultChannel;
    const r = await fetch(`${API}/channels/${ch}/pins/${String(body.message_id)}`, {
      method: body.action === 'pin' ? 'PUT' : 'DELETE',
      headers: { Authorization: `Bot ${token}` },
    });
    const detail = r.ok ? null : (await r.text()).slice(0, 300);
    return json({ action: body.action, status: r.status, ok: r.ok, error: detail });
  }
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
  const payload: Record<string, unknown> = {
    content,
    embeds: body.embeds ?? [],
    allowed_mentions: allowed,
  };
  // Replying to an existing message, which is how some bots expect to be handed the thing to act
  // on. fail_if_not_exists false so a deleted target posts as a normal message instead of erroring.
  if (body.reply_to)
    payload.message_reference = { message_id: String(body.reply_to), fail_if_not_exists: false };
  const channel = body.channel_id ?? defaultChannel;

  // Preferred: post as the bot into the configured channel.
  if (token && channel) {
    const r = await fetch(`${API}/channels/${channel}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (r.ok) {
      const sent = await r.json().catch(() => ({}));
      return json({ via: 'bot', channel, status: r.status, message_id: sent?.id ?? null });
    }
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
