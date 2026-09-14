// Notification roles for the members' Discord. Members opt in to a role per drop type; every
// pipeline post then pings only the people who asked for that kind of alert.
//
// Actions (POST { action }):
//   status       - what the bot can do in the guild, which roles exist, what is blocking setup
//   ensure-roles - create any missing notification roles and store their ids in pipeline_config
//   post-menu    - post the opt-in message into the notification channel
//
// Auth: x-sync-secret must equal pipeline_config.publish_secret.
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const API = 'https://discord.com/api/v10';
const MANAGE_ROLES = 1n << 28n;
const ADMINISTRATOR = 1n << 3n;

/** The alert types members can subscribe to. Keep this list short; every role is a ping. */
export const ALERTS = [
  {
    key: 'board',
    role: 'Board Drop',
    emoji: '🏈',
    color: 0xb6ff00,
    blurb: 'The slate sheet: best bets, touchdown board, teasers. Posted before the first kick.',
  },
  {
    key: 'live',
    role: 'Live Plays',
    emoji: '🚨',
    color: 0xff4d4d,
    blurb: 'In-game plays while the games are running. Time sensitive.',
  },
  {
    key: 'primetime',
    role: 'Primetime',
    emoji: '🌙',
    color: 0x7c5cff,
    blurb: 'Thursday, Sunday and Monday night cards, posted the afternoon of the game.',
  },
  {
    key: 'results',
    role: 'Results',
    emoji: '📊',
    color: 0x39d98a,
    blurb: 'Every ticket graded against the box scores, with the unit count.',
  },
  {
    key: 'free',
    role: 'Free Picks',
    emoji: '💵',
    color: 0xffc53d,
    blurb: 'The free play of the day.',
  },
] as const;
export type AlertKey = (typeof ALERTS)[number]['key'];

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

async function cfg(key: string): Promise<string | null> {
  const { data } = await admin.from('pipeline_config').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}
async function setCfg(key: string, value: string) {
  await admin.from('pipeline_config').upsert({ key, value }, { onConflict: 'key' });
}

async function discord(token: string, path: string, init: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep the raw text */
  }
  return { ok: r.ok, status: r.status, body };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const [secret, token, guildId] = await Promise.all([
    cfg('publish_secret'),
    cfg('discord_bot_token'),
    cfg('discord_guild_id'),
  ]);
  if (!secret || req.headers.get('x-sync-secret') !== secret)
    return json({ error: 'unauthorized' }, 401);
  if (!token) return json({ error: 'no discord_bot_token in pipeline_config' }, 503);
  if (!guildId) return json({ error: 'no discord_guild_id in pipeline_config' }, 503);

  const body = await req.json().catch(() => ({}));
  const action = body.action ?? 'status';

  // What roles exist right now, and what can this bot actually do?
  const rolesRes = await discord(token, `/guilds/${guildId}/roles`);
  if (!rolesRes.ok) return json({ error: 'cannot read roles', detail: rolesRes.body }, 502);
  const roles = rolesRes.body as Array<{
    id: string;
    name: string;
    position: number;
    managed: boolean;
    mentionable: boolean;
  }>;
  const meRes = await discord(token, `/guilds/${guildId}/members/@me`);
  const myRoleIds: string[] = meRes.ok ? ((meRes.body as any).roles ?? []) : [];
  const myRoles = roles.filter((r) => myRoleIds.includes(r.id));
  const myTop = myRoles.reduce((n, r) => Math.max(n, r.position), 0);
  const perms = myRoles.reduce((p, r) => p | BigInt((r as any).permissions ?? 0), 0n);
  const canManageRoles = (perms & MANAGE_ROLES) !== 0n || (perms & ADMINISTRATOR) !== 0n;

  const found = (name: string) => roles.find((r) => r.name === name && !r.managed) ?? null;
  const state = ALERTS.map((a) => {
    const r = found(a.role);
    return {
      key: a.key,
      role: a.role,
      emoji: a.emoji,
      id: r?.id ?? null,
      mentionable: r?.mentionable ?? null,
    };
  });

  if (action === 'status') {
    return json({
      guild: guildId,
      botTopRolePosition: myTop,
      canManageRoles,
      roles: state,
      blocking: canManageRoles
        ? state.filter((s) => !s.id).length
          ? 'roles missing; run ensure-roles'
          : null
        : "the bot's role needs Manage Roles, and must sit above the roles it creates",
    });
  }

  if (action === 'ensure-roles') {
    if (!canManageRoles)
      return json(
        {
          error: 'missing Manage Roles',
          fix: "In Server Settings > Roles, give the bot's role Manage Roles and drag it above the notification roles.",
          roles: state,
        },
        403,
      );
    const out: Record<string, string> = {};
    for (const a of ALERTS) {
      const existing = found(a.role);
      if (existing) {
        out[a.key] = existing.id;
        if (!existing.mentionable)
          await discord(token, `/guilds/${guildId}/roles/${existing.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ mentionable: true }),
          });
      } else {
        const made = await discord(token, `/guilds/${guildId}/roles`, {
          method: 'POST',
          body: JSON.stringify({
            name: a.role,
            color: a.color,
            mentionable: true,
            hoist: false,
            permissions: '0',
          }),
        });
        if (!made.ok) return json({ error: `create ${a.role} failed`, detail: made.body }, 502);
        out[a.key] = (made.body as { id: string }).id;
      }
      await setCfg(`discord_role_${a.key}`, out[a.key]);
    }
    return json({ created: out });
  }

  if (action === 'post-menu') {
    const channel = body.channel_id ?? (await cfg('discord_notify_channel_id'));
    if (!channel) return json({ error: 'no notification channel configured' }, 503);
    const lines = ALERTS.map((a) => {
      const id = state.find((s) => s.key === a.key)?.id;
      return `${a.emoji} **${a.role}** ${id ? `<@&${id}>` : ''}\n${a.blurb}`;
    }).join('\n\n');
    const post = await discord(token, `/channels/${channel}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content:
          '**Turn on the alerts you actually want.**\nPick your roles in **Channels & Roles** at the top of the server list, or react below. You only get pinged for what you choose.\n\n' +
          lines +
          '\n\nNo role means no ping. Change it any time.',
        allowed_mentions: { parse: [] },
      }),
    });
    if (!post.ok) return json({ error: 'post failed', detail: post.body }, 502);
    const messageId = (post.body as { id: string }).id;
    // Seed one reaction per alert so a reaction-role bot can be pointed straight at this message.
    const reactions: Record<string, boolean> = {};
    for (const a of ALERTS) {
      const r = await discord(
        token,
        `/channels/${channel}/messages/${messageId}/reactions/${encodeURIComponent(a.emoji)}/@me`,
        { method: 'PUT' },
      );
      reactions[a.emoji] = r.ok;
    }
    return json({ posted: messageId, channel, reactions });
  }

  return json({ error: `unknown action: ${action}` }, 400);
});
