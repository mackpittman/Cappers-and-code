// Mirrors the members' Discord channels into public.feed_posts once a minute (pg_cron -> pg_net -> here).
// Auth: the caller must send x-sync-secret equal to pipeline_config.publish_secret. The bot token lives
// in pipeline_config.discord_bot_token and never leaves this function.
//   POST /discord-sync            sync every enabled channel of every guild the bot is in
//   POST /discord-sync?probe=1    report the bot identity, guilds and readable text channels (no writes)
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const API = 'https://discord.com/api/v10';
const TEXT_TYPES = new Set([0, 5]); // guild text, announcement
const KEEP_MESSAGE_TYPES = new Set([0, 19, 20, 21]); // default, reply, slash command, thread starter

async function cfg(key: string): Promise<string | null> {
  const { data } = await admin.from('pipeline_config').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}
async function discord(path: string, token: string) {
  const r = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bot ${token}`, 'User-Agent': 'CappersAndCode (https://mackpittman.github.io/Cappers-and-code, 1.0)' },
  });
  if (r.status === 429) {
    const wait = Number((await r.json()).retry_after ?? 1) * 1000;
    await new Promise((res) => setTimeout(res, wait));
    return discord(path, token);
  }
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(body).slice(0, 160)}`);
  return body;
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

async function copyAttachment(channelId: string, messageId: string, a: any): Promise<any> {
  const meta = { name: a.filename, type: a.content_type ?? null, width: a.width ?? null, height: a.height ?? null, size: a.size ?? null };
  try {
    const r = await fetch(a.url);
    if (!r.ok) throw new Error(`cdn ${r.status}`);
    const path = `${channelId}/${messageId}/${a.filename}`;
    const { error } = await admin.storage
      .from('feed')
      .upload(path, await r.arrayBuffer(), { contentType: a.content_type ?? 'application/octet-stream', upsert: true });
    if (error) throw error;
    const { data } = admin.storage.from('feed').getPublicUrl(path);
    return { ...meta, url: data.publicUrl };
  } catch (e) {
    return { ...meta, url: a.url, copyError: String((e as Error).message ?? e) };
  }
}
const avatarUrl = (u: any) => (u?.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const [secret, token] = await Promise.all([cfg('publish_secret'), cfg('discord_bot_token')]);
  if (!secret || req.headers.get('x-sync-secret') !== secret) return json({ error: 'unauthorized' }, 401);
  if (!token) return json({ error: 'discord_bot_token not configured' }, 503);
  const probe = new URL(req.url).searchParams.get('probe') === '1';
  try {
    const me = await discord('/users/@me', token);
    const guilds = await discord('/users/@me/guilds', token);
    const report: any = { bot: { id: me.id, username: me.username }, guilds: [] as any[], synced: 0, channels: 0, errors: [] as string[] };
    for (const g of guilds) {
      let channels: any[] = [];
      try {
        channels = (await discord(`/guilds/${g.id}/channels`, token)).filter((c: any) => TEXT_TYPES.has(c.type));
      } catch (e) {
        report.errors.push(String((e as Error).message));
        continue;
      }
      report.guilds.push({ id: g.id, name: g.name, channels: channels.map((c: any) => ({ id: c.id, name: c.name })) });
      if (probe) continue;
      for (const c of channels) {
        // Register the channel (keeps an operator's enabled/capper settings), then pull what is new.
        const { data: existing } = await admin.from('feed_channels').select('enabled,last_message_id').eq('channel_id', c.id).maybeSingle();
        if (!existing) await admin.from('feed_channels').insert({ channel_id: c.id, guild_id: g.id, guild_name: g.name, name: c.name });
        else await admin.from('feed_channels').update({ name: c.name, guild_name: g.name, updated_at: new Date().toISOString() }).eq('channel_id', c.id);
        if (existing && !existing.enabled) continue;
        report.channels++;
        let messages: any[] = [];
        try {
          const q = existing?.last_message_id ? `?limit=100&after=${existing.last_message_id}` : '?limit=50';
          messages = await discord(`/channels/${c.id}/messages${q}`, token);
        } catch (e) {
          report.errors.push(`#${c.name}: ${String((e as Error).message)}`);
          continue;
        }
        if (!messages.length) continue;
        const rows = [];
        for (const m of messages.filter((m: any) => KEEP_MESSAGE_TYPES.has(m.type))) {
          const attachments = [];
          for (const a of m.attachments ?? []) attachments.push(await copyAttachment(c.id, m.id, a));
          rows.push({
            id: m.id,
            channel_id: c.id,
            guild_id: g.id,
            author_id: m.author.id,
            author_name: m.member?.nick ?? m.author.global_name ?? m.author.username,
            author_avatar: avatarUrl(m.author),
            content: m.content ?? '',
            attachments,
            embeds: (m.embeds ?? []).map((e: any) => ({ title: e.title ?? null, description: e.description ?? null, url: e.url ?? null, image: e.image?.url ?? e.thumbnail?.url ?? null })),
            posted_at: m.timestamp,
            edited_at: m.edited_timestamp ?? null,
            synced_at: new Date().toISOString(),
          });
        }
        if (rows.length) {
          const { error } = await admin.from('feed_posts').upsert(rows, { onConflict: 'id' });
          if (error) report.errors.push(`#${c.name} upsert: ${error.message}`);
          else report.synced += rows.length;
        }
        // Discord ids are snowflakes: the largest id is the newest message, whether or not we kept it.
        const newest = messages.map((m: any) => BigInt(m.id)).reduce((a, b) => (a > b ? a : b)).toString();
        await admin.from('feed_channels').update({ last_message_id: newest, updated_at: new Date().toISOString() }).eq('channel_id', c.id);
      }
    }
    return json(report);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
