// Paywall -> Discord access.
//
// A paid membership should open two doors at once: the app (already handled by is_entitled and
// RLS) and the members' Discord. This function owns the second door. It links a Supabase account
// to a Discord account via OAuth, then grants or revokes the paid role so that role membership is
// a mirror of billing rather than something an operator maintains by hand.
//
// Nothing here trusts the caller's word about who they are:
//   GET  ?code=&state=                          Discord's OAuth redirect; state is a one-shot
//                                               nonce we minted for a signed-in user.
//   POST { action: 'start' }        Bearer      -> authorize URL for that user
//   POST { action: 'me' }           Bearer      -> link + role standing
//   POST { action: 'unlink' }       Bearer      -> drop the role and forget the Discord id
//   POST { action: 'apply', user_id } x-sync    -> reconcile one account (the Stripe webhook)
//   POST { action: 'reconcile', force? } x-sync -> reconcile every linked account (hourly cron)
//   POST { action: 'probe' }        x-sync      -> can the bot actually do this? (no writes)
//
// Secrets (bot token, client secret) are read from pipeline_config with the service role and
// never leave this function.
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const API = 'https://discord.com/api/v10';
const UA = 'CappersAndCode (https://mackpittman.github.io/Cappers-and-code, 1.0)';
const MANAGE_ROLES = 1n << 28n;
const ADMINISTRATOR = 1n << 3n;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

async function cfg(key: string): Promise<string | null> {
  const { data } = await admin.from('pipeline_config').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}
async function cfgAll(keys: string[]): Promise<Record<string, string | null>> {
  const { data } = await admin.from('pipeline_config').select('key, value').in('key', keys);
  const out: Record<string, string | null> = {};
  for (const k of keys) out[k] = data?.find((r: any) => r.key === k)?.value ?? null;
  return out;
}

/** Discord REST with the bot token. `soft` codes come back as null instead of throwing. */
async function bot(
  path: string,
  token: string,
  init: RequestInit = {},
  soft: number[] = [],
): Promise<any> {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': UA,
      ...(init.headers ?? {}),
    },
  });
  if (r.status === 429) {
    const wait = Number(((await r.json().catch(() => ({}))) as any).retry_after ?? 1) * 1000;
    await new Promise((res) => setTimeout(res, Math.min(wait, 5000)));
    return bot(path, token, init, soft);
  }
  if (soft.includes(r.status)) return null;
  if (r.status === 204) return {};
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

async function userFromBearer(req: Request) {
  const auth = req.headers.get('Authorization') ?? '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt) return null;
  const { data, error } = await admin.auth.getUser(jwt);
  return error ? null : (data?.user ?? null);
}

const nonce = () =>
  [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Where Discord sends the browser back. Must match a redirect registered on the Discord app.
 * Built from SUPABASE_URL rather than req.url: behind the edge runtime the incoming URL has
 * already been stripped of the /functions/v1 prefix and arrives as http, so echoing it back
 * produces an address Discord will reject.
 */
function redirectUri(configured: string | null): string {
  if (configured) return configured;
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1/discord-access`;
}

// ---------------------------------------------------------------- role mechanics

type RoleOutcome = { ok: boolean; joined?: boolean; already?: boolean; error?: string };

/** Put the member in the guild if needed, then make sure they hold the paid role. */
async function grantRole(
  token: string,
  guildId: string,
  roleId: string,
  discordUserId: string,
  oauthToken?: string | null,
): Promise<RoleOutcome> {
  const member = await bot(`/guilds/${guildId}/members/${discordUserId}`, token, {}, [404]);
  if (!member) {
    if (!oauthToken) return { ok: false, error: 'not in the server and no fresh OAuth token to add them with' };
    // guilds.join lets us drop them straight in with the role already attached.
    await bot(`/guilds/${guildId}/members/${discordUserId}`, token, {
      method: 'PUT',
      body: JSON.stringify({ access_token: oauthToken, roles: [roleId] }),
    });
    return { ok: true, joined: true };
  }
  if ((member.roles ?? []).includes(roleId)) return { ok: true, already: true };
  await bot(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, token, { method: 'PUT' });
  return { ok: true };
}

async function revokeRole(
  token: string,
  guildId: string,
  roleId: string,
  discordUserId: string,
): Promise<RoleOutcome> {
  // 404 covers both "left the server" and "role already gone"; either way we are where we want to be.
  await bot(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, token, { method: 'DELETE' }, [404]);
  return { ok: true };
}

/**
 * Bring one account's Discord standing in line with its billing. Idempotent, and it records the
 * outcome so the hourly sweep can skip accounts that are already where they belong.
 */
async function applyOne(
  token: string,
  guildId: string,
  roleId: string,
  row: { user_id: string; discord_user_id: string; entitled?: boolean; role_granted_at?: string | null },
  opts: { oauthToken?: string | null; force?: boolean } = {},
): Promise<{ user_id: string; action: string; ok: boolean; error?: string }> {
  const { data: entitled } = row.entitled === undefined
    ? await admin.rpc('is_entitled', { uid: row.user_id })
    : { data: row.entitled };
  const holds = !!row.role_granted_at;
  const want = !!entitled;
  if (want === holds && !opts.force) return { user_id: row.user_id, action: 'none', ok: true };

  const now = new Date().toISOString();
  try {
    const res = want
      ? await grantRole(token, guildId, roleId, row.discord_user_id, opts.oauthToken)
      : await revokeRole(token, guildId, roleId, row.discord_user_id);
    if (!res.ok) throw new Error(res.error ?? 'unknown');
    const patch: Record<string, unknown> = {
      role_granted_at: want ? now : null,
      role_revoked_at: want ? null : now,
      last_error: null,
      last_synced_at: now,
      updated_at: now,
    };
    if (res.joined) patch.guild_joined_at = now;
    await admin.from('discord_links').update(patch).eq('user_id', row.user_id);
    return { user_id: row.user_id, action: want ? 'granted' : 'revoked', ok: true };
  } catch (e) {
    const msg = String((e as Error).message ?? e).slice(0, 400);
    await admin
      .from('discord_links')
      .update({ last_error: msg, last_synced_at: now, updated_at: now })
      .eq('user_id', row.user_id);
    return { user_id: row.user_id, action: want ? 'grant' : 'revoke', ok: false, error: msg };
  }
}

// ---------------------------------------------------------------- handler

Deno.serve(async (req) => {
  const c = await cfgAll([
    'publish_secret',
    'discord_bot_token',
    'discord_application_id',
    'discord_client_secret',
    'discord_guild_id',
    'discord_member_role_id',
    'discord_redirect_uri',
    'site_url',
  ]);
  const token = c.discord_bot_token;
  const guildId = c.discord_guild_id;
  const roleId = c.discord_member_role_id;
  const site = c.site_url ?? 'https://mackpittman.github.io/Cappers-and-code';

  // ---- OAuth callback: a browser, not an API client.
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const back = (status: string, to?: string | null) =>
      Response.redirect(`${to || site}${(to || site).includes('?') ? '&' : '?'}discord=${status}`, 302);
    if (!code || !state) return back('error');

    const { data: st } = await admin
      .from('discord_link_states')
      .select('state, user_id, redirect_to, expires_at, used_at')
      .eq('state', state)
      .maybeSingle();
    if (!st || st.used_at || new Date(st.expires_at) < new Date()) return back('expired', st?.redirect_to);
    // Burn the nonce before doing anything else so a replayed callback cannot land twice.
    await admin.from('discord_link_states').update({ used_at: new Date().toISOString() }).eq('state', state);

    if (!c.discord_application_id || !c.discord_client_secret) return back('unconfigured', st.redirect_to);
    try {
      const tokenRes = await fetch(`${API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: new URLSearchParams({
          client_id: c.discord_application_id,
          client_secret: c.discord_client_secret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri(c.discord_redirect_uri),
        }),
      });
      const tok = await tokenRes.json();
      if (!tokenRes.ok || !tok.access_token) throw new Error(`oauth ${tokenRes.status}`);

      const who = await fetch(`${API}/users/@me`, {
        headers: { Authorization: `Bearer ${tok.access_token}`, 'User-Agent': UA },
      }).then((r) => r.json());
      if (!who?.id) throw new Error('identify failed');

      // One Discord account per membership. If this Discord id is already tied to someone else,
      // stop: otherwise one subscription could keep several people in the server.
      const { data: clash } = await admin
        .from('discord_links')
        .select('user_id')
        .eq('discord_user_id', who.id)
        .maybeSingle();
      if (clash && clash.user_id !== st.user_id) return back('taken', st.redirect_to);

      const now = new Date().toISOString();
      const { error: upErr } = await admin.from('discord_links').upsert(
        {
          user_id: st.user_id,
          discord_user_id: who.id,
          discord_username: who.global_name ?? who.username ?? null,
          linked_at: now,
          updated_at: now,
        },
        { onConflict: 'user_id' },
      );
      if (upErr) throw new Error(upErr.message);

      if (token && guildId && roleId) {
        const { data: link } = await admin
          .from('discord_links')
          .select('user_id, discord_user_id, role_granted_at')
          .eq('user_id', st.user_id)
          .maybeSingle();
        const res = await applyOne(token, guildId, roleId, link as any, {
          oauthToken: tok.access_token,
          force: true,
        });
        return back(res.ok ? 'linked' : 'linked_no_role', st.redirect_to);
      }
      return back('linked_unconfigured', st.redirect_to);
    } catch (_e) {
      return back('error', st.redirect_to);
    }
  }

  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const body = await req.json().catch(() => ({}));
  const action = body.action ?? 'me';
  const isAdmin = !!c.publish_secret && req.headers.get('x-sync-secret') === c.publish_secret;

  try {
    // ---- diagnostics: tells an operator exactly which piece is missing.
    if (action === 'probe') {
      if (!isAdmin) return json({ error: 'unauthorized' }, 401);
      const report: any = {
        config: {
          discord_bot_token: !!token,
          discord_application_id: !!c.discord_application_id,
          discord_client_secret: !!c.discord_client_secret,
          discord_guild_id: !!guildId,
          discord_member_role_id: !!roleId,
        },
        redirect_uri: redirectUri(c.discord_redirect_uri),
      };
      if (!token || !guildId) return json({ ...report, ready: false, blocked_on: 'bot token or guild id' });
      const me = await bot('/users/@me', token);
      report.bot = { id: me.id, username: me.username };
      const roles = await bot(`/guilds/${guildId}/roles`, token);
      const botMember = await bot(`/guilds/${guildId}/members/${me.id}`, token, {}, [404]);
      if (!botMember) return json({ ...report, ready: false, blocked_on: 'bot is not in the guild' });
      // @everyone carries the guild's own id and is NOT listed in a member's roles array, but its
      // permissions apply to every member including the bot. Leaving it out of the union made this
      // check read false while the bot could in fact manage roles, so fold it in.
      const everyone = roles.find((r: any) => r.id === guildId);
      const mine = roles.filter((r: any) => (botMember.roles ?? []).includes(r.id));
      const perms = [...mine, ...(everyone ? [everyone] : [])].reduce(
        (a: bigint, r: any) => a | BigInt(r.permissions ?? '0'),
        0n,
      );
      // Hierarchy comes only from the bot's own roles; @everyone always sits at the bottom.
      const botTop = Math.max(0, ...mine.map((r: any) => r.position));
      const everyonePerms = BigInt(everyone?.permissions ?? '0');
      report.everyone_can_manage_roles =
        (everyonePerms & MANAGE_ROLES) !== 0n || (everyonePerms & ADMINISTRATOR) !== 0n;
      if (report.everyone_can_manage_roles)
        report.warning =
          'SECURITY: @everyone holds Manage Roles, so every member of the server can edit roles and channel permissions. Turn it off on @everyone and grant it to the bot role instead.';
      const target = roles.find((r: any) => r.id === roleId);
      report.bot_top_role_position = botTop;
      report.can_manage_roles = (perms & MANAGE_ROLES) !== 0n || (perms & ADMINISTRATOR) !== 0n;
      report.member_role = target ? { id: target.id, name: target.name, position: target.position } : null;
      report.above_member_role = target ? botTop > target.position : null;
      report.roles_available = roles
        .filter((r: any) => !r.managed && r.name !== '@everyone')
        .map((r: any) => ({ id: r.id, name: r.name, position: r.position }));
      report.ready =
        !!roleId && !!target && report.can_manage_roles === true && report.above_member_role === true &&
        !!c.discord_client_secret && !!c.discord_application_id;
      if (!report.ready) {
        report.blocked_on = !roleId
          ? 'discord_member_role_id not set'
          : !target
            ? 'discord_member_role_id does not match a role in the guild'
            : !report.can_manage_roles
              ? 'bot lacks Manage Roles'
              : !report.above_member_role
                ? 'bot role sits below the member role'
                : !c.discord_client_secret
                  ? 'discord_client_secret not set'
                  : 'discord_application_id not set';
      }
      return json(report);
    }

    // ---- member actions
    if (action === 'start' || action === 'me' || action === 'unlink') {
      const user = await userFromBearer(req);
      if (!user) return json({ error: 'sign in first' }, 401);

      if (action === 'start') {
        if (!c.discord_application_id || !c.discord_client_secret)
          return json({ error: 'Discord linking is not configured yet.' }, 503);
        const state = nonce();
        const { error } = await admin.from('discord_link_states').insert({
          state,
          user_id: user.id,
          redirect_to: typeof body.redirect_to === 'string' ? body.redirect_to.slice(0, 500) : null,
        });
        if (error) return json({ error: error.message }, 502);
        const u = new URL(`${API.replace('/api/v10', '')}/oauth2/authorize`);
        u.searchParams.set('client_id', c.discord_application_id);
        u.searchParams.set('response_type', 'code');
        u.searchParams.set('scope', 'identify guilds.join');
        u.searchParams.set('redirect_uri', redirectUri(c.discord_redirect_uri));
        u.searchParams.set('state', state);
        u.searchParams.set('prompt', 'consent');
        return json({ url: u.toString() });
      }

      const { data: link } = await admin
        .from('discord_links')
        .select('discord_user_id, discord_username, linked_at, role_granted_at, last_error')
        .eq('user_id', user.id)
        .maybeSingle();

      if (action === 'unlink') {
        if (link?.discord_user_id && token && guildId && roleId)
          await revokeRole(token, guildId, roleId, link.discord_user_id).catch(() => {});
        await admin.from('discord_links').delete().eq('user_id', user.id);
        return json({ linked: false });
      }

      const { data: entitled } = await admin.rpc('is_entitled', { uid: user.id });
      return json({
        linked: !!link?.discord_user_id,
        discord_username: link?.discord_username ?? null,
        linked_at: link?.linked_at ?? null,
        role_granted: !!link?.role_granted_at,
        entitled: !!entitled,
        configured: !!c.discord_application_id && !!c.discord_client_secret && !!roleId,
        last_error: link?.last_error ?? null,
      });
    }

    // ---- admin actions
    if (!isAdmin) return json({ error: 'unauthorized' }, 401);
    if (!token || !guildId || !roleId)
      return json({ error: 'discord guild, bot token or member role not configured' }, 503);

    if (action === 'apply') {
      const userId = String(body.user_id ?? '');
      if (!userId) return json({ error: 'user_id required' }, 400);
      const { data: link } = await admin
        .from('discord_links')
        .select('user_id, discord_user_id, role_granted_at')
        .eq('user_id', userId)
        .maybeSingle();
      // Not linked yet is a normal state, not a failure: they subscribed before connecting Discord,
      // and the callback will grant the role the moment they do.
      if (!link?.discord_user_id) return json({ applied: false, reason: 'no discord link yet' });
      const res = await applyOne(token, guildId, roleId, link as any, { force: !!body.force });
      return json({ applied: true, ...res });
    }

    if (action === 'reconcile') {
      const { data: targets, error } = await admin.rpc('discord_access_targets');
      if (error) return json({ error: error.message }, 502);
      const out = { checked: 0, granted: 0, revoked: 0, unchanged: 0, failed: [] as any[] };
      for (const t of targets ?? []) {
        out.checked++;
        const res = await applyOne(token, guildId, roleId, t as any, { force: !!body.force });
        if (!res.ok) out.failed.push(res);
        else if (res.action === 'granted') out.granted++;
        else if (res.action === 'revoked') out.revoked++;
        else out.unchanged++;
      }
      // Housekeeping: spent and stale OAuth nonces are of no further use.
      await admin.from('discord_link_states').delete().lt('expires_at', new Date().toISOString());
      return json(out);
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
