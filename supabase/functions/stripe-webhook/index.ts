// Stripe webhook: verifies the signature, then mirrors subscription state into public.subscriptions.
// Secrets live in pipeline_config (read with the service role); nothing is hard-coded.
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
async function cfg(key: string): Promise<string | null> {
  const { data } = await sb.from('pipeline_config').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}
async function stripe(path: string, secret: string) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${secret}` } });
  return r.json();
}
async function verify(payload: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = parts.find((p) => p[0] === 't')?.[1];
  const sigs = parts.filter((p) => p[0] === 'v1').map((p) => p[1]);
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return sigs.includes(hex);
}
const STATUS: Record<string, string> = { active: 'active', trialing: 'trialing', past_due: 'past_due', unpaid: 'past_due', canceled: 'canceled', incomplete: 'incomplete', incomplete_expired: 'expired', paused: 'canceled' };
const iso = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : null);

async function userIdForCustomer(customerId: string, fallbackUserId?: string | null): Promise<string | null> {
  if (fallbackUserId) {
    await sb.from('profiles').update({ stripe_customer_id: customerId }).eq('id', fallbackUserId).is('stripe_customer_id', null);
    return fallbackUserId;
  }
  const { data } = await sb.from('profiles').select('id').eq('stripe_customer_id', customerId).maybeSingle();
  return data?.id ?? null;
}
/**
 * Billing just changed for this account, so its Discord standing may be stale. discord-access
 * owns the role itself; we only tell it whose to re-check. Deliberately swallows its own errors:
 * a Discord outage must not make us return non-200 and have Stripe retry a payment event we
 * already recorded. The hourly reconcile picks up anything missed here.
 */
async function syncDiscord(userId: string) {
  try {
    const secret = await cfg('publish_secret');
    if (!secret) return;
    const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/discord-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-secret': secret },
      body: JSON.stringify({ action: 'apply', user_id: userId }),
    });
    if (!r.ok) console.error('discord-access apply', r.status, (await r.text()).slice(0, 200));
  } catch (e) {
    console.error('discord-access apply failed', e);
  }
}

async function upsertSubscription(sub: any, userId: string) {
  const item = sub.items?.data?.[0];
  const row = {
    user_id: userId,
    provider: 'stripe',
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
    stripe_subscription_id: sub.id,
    plan: 'monthly',
    status: STATUS[sub.status] ?? 'incomplete',
    current_period_end: iso(item?.current_period_end ?? sub.current_period_end),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  };
  await sb.from('subscriptions').upsert(row, { onConflict: 'stripe_subscription_id' });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const [secret, whsec, founderEnd] = await Promise.all([cfg('stripe_secret_key'), cfg('stripe_webhook_secret'), cfg('founder_season_end')]);
  if (!secret || !whsec) return new Response('stripe not configured', { status: 503 });
  const payload = await req.text();
  if (!(await verify(payload, req.headers.get('stripe-signature'), whsec))) return new Response('bad signature', { status: 400 });
  const event = JSON.parse(payload);
  const { error: dup } = await sb.from('stripe_events').insert({ id: event.id, type: event.type });
  if (dup) return new Response('duplicate', { status: 200 });
  const obj = event.data.object;
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const customerId = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;
        const userId = await userIdForCustomer(customerId, obj.client_reference_id);
        if (!userId) break;
        if (obj.mode === 'subscription' && obj.subscription) {
          const sub = await stripe(`subscriptions/${obj.subscription}`, secret);
          await upsertSubscription(sub, userId);
        } else if (obj.mode === 'payment' && obj.metadata?.plan === 'founder_season') {
          await sb.from('subscriptions').insert({ user_id: userId, provider: 'stripe', stripe_customer_id: customerId, stripe_subscription_id: `pi_${obj.payment_intent}`, plan: 'founder_season', status: 'active', current_period_end: founderEnd ?? '2027-06-30T23:59:59Z' });
        }
        await syncDiscord(userId);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const customerId = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;
        const userId = await userIdForCustomer(customerId, obj.metadata?.user_id);
        if (userId) {
          await upsertSubscription(obj, userId);
          await syncDiscord(userId);
        }
        break;
      }
      case 'invoice.payment_failed': {
        if (obj.subscription) {
          const { data } = await sb.from('subscriptions').update({ status: 'past_due', updated_at: new Date().toISOString() }).eq('stripe_subscription_id', obj.subscription).select('user_id').maybeSingle();
          if (data?.user_id) await syncDiscord(data.user_id);
        }
        break;
      }
      case 'charge.refunded': {
        if (obj.payment_intent) {
          const { data } = await sb.from('subscriptions').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('stripe_subscription_id', `pi_${obj.payment_intent}`).select('user_id').maybeSingle();
          if (data?.user_id) await syncDiscord(data.user_id);
        }
        break;
      }
    }
  } catch (e) {
    console.error('webhook handler error', event.type, e);
    return new Response('handler error', { status: 500 });
  }
  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
});
