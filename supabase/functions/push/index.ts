// Push alerts for the Discord feed. One function, two doors.
//
// Member actions (Authorization: Bearer <the member's JWT>):
//   { action: 'key' }                                  -> { publicKey }  VAPID key for pushManager.subscribe
//   { action: 'subscribe', subscription, user_agent? } -> stores this browser's subscription
//   { action: 'unsubscribe', endpoint }                -> forgets it
//   { action: 'status' }                               -> this member's devices and whether they are entitled
//   { action: 'test' }                                 -> a test alert to this member's own devices
// Pipeline (x-sync-secret = pipeline_config.publish_secret, sent by the feed_posts trigger):
//   { action: 'notify', post }                         -> the post to every entitled subscription
//
// The VAPID key pair is generated on first use and kept in pipeline_config (`vapid_keys`); it
// never leaves the database except as the public half. Deploy with --no-verify-jwt: the trigger
// carries no user token, so the member actions check the JWT here.
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as webpush from 'jsr:@negrel/webpush@0.5.0';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function cfg(key: string): Promise<string | null> {
  const { data } = await admin.from('pipeline_config').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}

/** The VAPID pair, created the first time anything needs it. */
async function vapidKeys(): Promise<CryptoKeyPair> {
  const stored = await cfg('vapid_keys');
  if (stored) return webpush.importVapidKeys(JSON.parse(stored) as webpush.ExportedVapidKeys, { extractable: false });
  const fresh = await webpush.generateVapidKeys({ extractable: true });
  const exported = await webpush.exportVapidKeys(fresh);
  // Two first calls at once must agree on one pair: insert if absent, then read back the winner.
  const { error } = await admin
    .from('pipeline_config')
    .upsert({ key: 'vapid_keys', value: JSON.stringify(exported) }, { onConflict: 'key', ignoreDuplicates: true });
  if (error) throw error;
  const won = (await cfg('vapid_keys')) ?? JSON.stringify(exported);
  return webpush.importVapidKeys(JSON.parse(won) as webpush.ExportedVapidKeys, { extractable: false });
}
async function appServer(): Promise<webpush.ApplicationServer> {
  const contact = (await cfg('support_email')) ?? 'mackpittmanwork@gmail.com';
  return webpush.ApplicationServer.new({ contactInformation: `mailto:${contact}`, vapidKeys: await vapidKeys() });
}

type Target = { id: string; user_id: string; kind: string; endpoint: string; p256dh: string | null; auth: string | null; failures: number };
type Payload = { title: string; body: string; url: string; tag: string; icon?: string };

/** Pushes one payload to one subscription, pruning dead endpoints and counting failures. */
async function send(as: webpush.ApplicationServer, t: Target, payload: Payload, topic: string): Promise<'sent' | 'gone' | 'failed' | 'skipped'> {
  if (t.kind !== 'web' || !t.p256dh || !t.auth) return 'skipped';
  try {
    const sub = as.subscribe({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } });
    await sub.pushTextMessage(JSON.stringify(payload), { ttl: 60 * 60, urgency: webpush.Urgency.High, topic });
    if (t.failures) await admin.from('push_subscriptions').update({ failures: 0, last_error: null }).eq('id', t.id);
    return 'sent';
  } catch (e) {
    const status = e instanceof webpush.PushMessageError ? e.response.status : 0;
    const gone = status === 404 || status === 410; // RFC 8030: expired or unsubscribed
    const transient = status === 0 || status === 429 || status >= 500; // network, rate limit, outage
    if (gone || (!transient && t.failures >= 4)) {
      await admin.from('push_subscriptions').delete().eq('id', t.id);
      return 'gone';
    }
    const last_error = (e instanceof webpush.PushMessageError ? e.toString() : String((e as Error).message || e)).slice(0, 300);
    await admin.from('push_subscriptions').update({ failures: transient ? t.failures : t.failures + 1, last_error }).eq('id', t.id);
    return 'failed';
  }
}
async function fanOut(targets: Target[], payload: Payload, topic: string) {
  const as = await appServer();
  const tally = { sent: 0, gone: 0, failed: 0, skipped: 0 };
  for (let i = 0; i < targets.length; i += 20) {
    const results = await Promise.all(targets.slice(i, i + 20).map((t) => send(as, t, payload, topic)));
    for (const r of results) tally[r]++;
  }
  return tally;
}

/** Decoded byte length of a base64url string, or -1 when it is not base64url at all. */
function b64len(s: string): number {
  if (!/^[A-Za-z0-9_-]+=*$/.test(s)) return -1;
  const clean = s.replace(/=+$/, '');
  return Math.floor((clean.length * 3) / 4);
}
/** A topic header collapses several alerts from one channel into the newest one on the device. */
const topicFor = (channelId: string) => `feed-${channelId}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);

function payloadFor(post: Record<string, unknown>, feedUrl: string): Payload {
  const who = String(post.capper || post.author_name || 'Cappers & Code');
  const channel = post.channel_name ? `#${post.channel_name}` : 'the Discord';
  let body = String(post.content ?? '').replace(/\s+/g, ' ').trim();
  if (!body) body = post.has_image ? 'Posted an image.' : 'New post.';
  else if (post.has_image) body = `${body} [image]`;
  if (body.length > 160) body = `${body.slice(0, 157)}...`;
  return { title: `${who} in ${channel}`, body, url: feedUrl, tag: topicFor(String(post.channel_id ?? 'feed')) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const raw = await req.json().catch(() => null);
  const body: Record<string, any> = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const action = String(body.action ?? '');

  try {
    const siteUrl = ((await cfg('site_url')) ?? 'https://cappersandcode.com').replace(/\/+$/, '');
    const feedUrl = `${siteUrl}/app/feed`;
    // ---- pipeline door ----
    if (action === 'notify') {
      const secret = await cfg('publish_secret');
      if (!secret || req.headers.get('x-sync-secret') !== secret) return json({ error: 'unauthorized' }, 401);
      const post = body.post ?? {};
      const { data: targets, error } = await admin.rpc('push_targets');
      if (error) return json({ error: error.message }, 500);
      if (!targets?.length) return json({ sent: 0, targets: 0 });
      const tally = await fanOut(targets as Target[], payloadFor(post, feedUrl), topicFor(String(post.channel_id ?? 'feed')));
      return json({ targets: targets.length, ...tally });
    }

    // ---- member door ----
    const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'sign in first' }, 401);
    const { data: { user }, error: authErr } = await admin.auth.getUser(jwt);
    if (authErr || !user) return json({ error: 'sign in first' }, 401);

    if (action === 'key') {
      return json({ publicKey: await webpush.exportApplicationServerKey(await vapidKeys()) });
    }
    if (action === 'subscribe') {
      const s = body.subscription ?? {};
      const endpoint = String(s.endpoint ?? '');
      const p256dh = String(s.keys?.p256dh ?? '');
      const auth = String(s.keys?.auth ?? '');
      if (!/^https:\/\//.test(endpoint) || endpoint.length > 2048) return json({ error: 'endpoint is not a push endpoint' }, 400);
      const point = b64len(p256dh), secret = b64len(auth);
      if (point !== 65 || !p256dh.startsWith('B') || secret !== 16) return json({ error: 'subscription keys are malformed' }, 400);
      const { error } = await admin.from('push_subscriptions').upsert(
        { user_id: user.id, kind: 'web', endpoint, p256dh, auth, user_agent: String(body.user_agent ?? '').slice(0, 300) || null, last_seen_at: new Date().toISOString(), failures: 0, last_error: null },
        { onConflict: 'endpoint' },
      );
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    if (action === 'unsubscribe') {
      const endpoint = String(body.endpoint ?? '');
      if (!endpoint) return json({ error: 'endpoint required' }, 400);
      const { error } = await admin.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', user.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    if (action === 'status' || action === 'test') {
      const { data: mine, error } = await admin
        .from('push_subscriptions')
        .select('id, user_id, kind, endpoint, p256dh, auth, failures, user_agent, created_at, last_seen_at')
        .eq('user_id', user.id);
      if (error) return json({ error: error.message }, 500);
      const { data: ent } = await admin.rpc('push_is_entitled', { uid: user.id });
      const entitled = ent === true;
      if (action === 'status')
        return json({
          entitled,
          subscriptions: (mine ?? []).map((m) => ({ id: m.id, kind: m.kind, endpoint: m.endpoint, user_agent: m.user_agent, created_at: m.created_at, last_seen_at: m.last_seen_at, failures: m.failures })),
        });
      if (!entitled) return json({ error: 'Test alerts go out once your membership is active.' }, 403);
      if (!mine?.length) return json({ error: 'no device has alerts on for this account' }, 404);
      const tally = await fanOut(mine as Target[], { title: 'Cappers & Code', body: 'Test alert. Discord posts will show up here.', url: feedUrl, tag: 'test' }, 'test');
      return json({ devices: mine.length, ...tally });
    }
    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
