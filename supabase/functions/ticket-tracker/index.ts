// Ticket tracker: a silent status post for one live ticket, every 30 minutes, until it is decided.
//
// x-sync-secret = pipeline_config.publish_secret on every call.
//   POST { action: 'run' }          grade, post the update, stop when decided (what the cron job sends)
//   POST { action: 'preview' }      grade and return the message without posting
//   POST { action: 'delete_last' }  delete the tracker's own most recent post (Discord and the feed)
//
// The ticket lives in pipeline_config.ticket_tracker as JSON:
//   { id, title, channel_id, price, sport, stop_after, legs: [{ espn, pick, price }], done, runs }
// Each run reads every leg's game from ESPN's public summary, grades it, and posts one message to
// the channel with Discord's silent flag (SUPPRESS_NOTIFICATIONS) and no mentions, so nobody is
// pinged in Discord, and the feed mirror marks the copy silent so the app neither pushes nor banners
// it. Once a leg loses, every leg has won, or stop_after passes, the final post goes out, the
// ticket is marked done and the cron job unschedules itself (public.ticket_tracker_stop()).
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const API = 'https://discord.com/api/v10';
const SILENT = 1 << 12; // SUPPRESS_NOTIFICATIONS
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

async function cfg(key: string): Promise<string | null> {
  const { data } = await admin.from('pipeline_config').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}
const am = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const ct = (d: Date) =>
  d.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) + ' CT';

type Leg = { espn: string; pick: string; price: number };
type Graded = { leg: Leg; name: string; state: 'won' | 'lost' | 'leading' | 'trailing' | 'tied' | 'pre' | 'unknown'; line: string };

// ESPN answers 403 from the edge runtime to Deno's default User-Agent and to bot-style ones; a
// browser UA gets 200. site.web.api is the same API on a second host, tried if the first refuses.
const ESPN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  Accept: 'application/json',
};
async function summary(sport: string, id: string) {
  let status = 0;
  for (const host of ['site.api.espn.com', 'site.web.api.espn.com']) {
    const r = await fetch(`https://${host}/apis/site/v2/sports/football/${sport}/summary?event=${id}`, { headers: ESPN_HEADERS });
    if (r.ok) return r.json();
    status = r.status;
    await r.body?.cancel();
  }
  throw new Error(`espn ${status}`);
}

async function grade(leg: Leg, sport: string): Promise<Graded> {
  try {
    const s = await summary(sport, leg.espn);
    const comp = s.header?.competitions?.[0];
    const me = comp?.competitors?.find((c: any) => c.team?.abbreviation === leg.pick);
    const them = comp?.competitors?.find((c: any) => c.team?.abbreviation !== leg.pick);
    if (!me || !them) throw new Error('team not in game');
    const name = me.team.location ?? me.team.shortDisplayName ?? leg.pick; // "Oregon", not "Oregon Ducks"
    const st = comp.status?.type ?? {};
    const a = Number(me.score ?? 0), b = Number(them.score ?? 0);
    const score = `${a}-${b} vs ${them.team.abbreviation}`;
    if (st.state === 'pre') {
      return { leg, name, state: 'pre', line: `kicks ${ct(new Date(comp.date))} vs ${them.team.abbreviation}` };
    }
    if (st.completed) return { leg, name, state: a > b ? 'won' : 'lost', line: `Final ${score}` };
    // Over but not completed: postponed, cancelled or suspended. Never graded from a 0-0 score.
    if (st.state === 'post') return { leg, name, state: 'unknown', line: `${st.description ?? 'not completed'} vs ${them.team.abbreviation}` };
    return { leg, name, state: a > b ? 'leading' : a < b ? 'trailing' : 'tied', line: `${score} · ${st.shortDetail ?? 'live'}` };
  } catch (e) {
    return { leg, name: leg.pick, state: 'unknown', line: `score unavailable (${String((e as Error).message ?? e)})` };
  }
}

const ICON: Record<Graded['state'], string> = { won: '✅', lost: '❌', leading: '🟢', trailing: '🔴', tied: '🟡', pre: '⏳', unknown: '⚠️' };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const [secret, token, raw] = await Promise.all([cfg('publish_secret'), cfg('discord_bot_token'), cfg('ticket_tracker')]);
  if (!secret || req.headers.get('x-sync-secret') !== secret) return json({ error: 'unauthorized' }, 401);
  if (!token) return json({ error: 'discord_bot_token not configured' }, 503);
  if (!raw) return json({ error: 'no ticket_tracker in pipeline_config' }, 404);
  const t = JSON.parse(raw);
  const action = String(((await req.json().catch(() => ({}))) ?? {}).action ?? 'run');
  const discord = (path: string, init: RequestInit = {}) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'CappersAndCode (https://cappersandcode.com, 1.0)' },
    });
  if (action === 'delete_last') {
    // Only ever the tracker's own most recent post, by the id it recorded.
    if (!t.lastMessageId) return json({ error: 'no tracker post recorded' }, 404);
    const d = await discord(`/channels/${t.channel_id}/messages/${t.lastMessageId}`, { method: 'DELETE' });
    if (!d.ok && d.status !== 404) return json({ error: `discord ${d.status}`, detail: await d.text() }, 502);
    await admin.from('feed_posts').delete().eq('id', t.lastMessageId);
    await admin.from('pipeline_config').upsert({ key: 'ticket_tracker', value: JSON.stringify({ ...t, lastMessageId: null }) }, { onConflict: 'key' });
    return json({ deleted: t.lastMessageId });
  }
  if (t.done && action === 'run') return json({ done: true, note: 'ticket already decided; nothing posted' });

  const graded = await Promise.all((t.legs as Leg[]).map((l) => grade(l, t.sport ?? 'college-football')));
  const n = (s: Graded['state']) => graded.filter((g) => g.state === s).length;
  const lost = graded.filter((g) => g.state === 'lost');
  const allWon = n('won') === graded.length;
  // stop_after is a hard cap so a postponed leg or an ESPN outage cannot keep the job posting forever.
  const expired = t.stop_after ? Date.now() > Date.parse(t.stop_after) : false;
  const decided = lost.length > 0 || allWon || expired;
  const runs = Number(t.runs ?? 0) + 1;

  const head = `**${t.title} · ${am(t.price)}**`;
  const status = allWon
    ? `✅ **CASHED.** All ${graded.length} legs won.`
    : lost.length
      ? `❌ **Ticket lost** on ${lost.map((g) => g.name).join(', ')}. ${n('won')} of ${graded.length} legs had won.`
      : expired
        ? `⚠️ **Tracker stopped** at its time cap with ${n('won')} of ${graded.length} legs won. Grade the rest by hand.`
        : [`${n('won')} won`, n('leading') && `${n('leading')} leading`, n('tied') && `${n('tied')} tied`, n('trailing') && `${n('trailing')} trailing`, n('pre') && `${n('pre')} to play`, n('unknown') && `${n('unknown')} unknown`].filter(Boolean).join(' · ');
  const order: Graded['state'][] = ['lost', 'trailing', 'tied', 'leading', 'unknown', 'pre', 'won'];
  const rows = [...graded]
    .sort((x, y) => order.indexOf(x.state) - order.indexOf(y.state))
    .map((g) => `${ICON[g.state]} ${g.name} ML ${am(g.leg.price)} · ${g.line}`);
  const foot = decided ? `_Final update · ${ct(new Date())}_` : `_Update ${runs} · ${ct(new Date())} · next in 30 min_`;
  const content = [head, status, '', ...rows, '', foot].join('\n').slice(0, 1990);

  if (action === 'preview') return json({ decided, content });
  const post = await discord(`/channels/${t.channel_id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, flags: SILENT, allowed_mentions: { parse: [] } }),
  });
  const body = await post.json().catch(() => null);
  if (!post.ok) return json({ error: `discord ${post.status}`, detail: body }, 502);

  const next = { ...t, runs, lastRunAt: new Date().toISOString(), lastMessageId: body?.id ?? null, done: decided };
  await admin.from('pipeline_config').upsert({ key: 'ticket_tracker', value: JSON.stringify(next) }, { onConflict: 'key' });
  let stopped: unknown = null;
  if (decided) {
    const r = await admin.rpc('ticket_tracker_stop');
    stopped = r.error?.message ?? r.data;
  }
  return json({ posted: body?.id ?? null, runs, decided, stopped, summary: status });
});
