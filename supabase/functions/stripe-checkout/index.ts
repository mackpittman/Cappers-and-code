// Creates a Stripe Checkout Session for the signed-in user. Body: { plan: 'monthly' | 'founder_season' }.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
async function cfg(key: string) { const { data } = await admin.from('pipeline_config').select('value').eq('key', key).maybeSingle(); return data?.value ?? null; }
async function stripe(path: string, secret: string, params: Record<string, string>) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? `stripe ${r.status}`);
  return j;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'sign in first' }, 401);
    const { data: { user }, error } = await admin.auth.getUser(jwt);
    if (error || !user) return json({ error: 'sign in first' }, 401);
    const body = await req.json().catch(() => ({}));
    const plan = body.plan === 'founder_season' ? 'founder_season' : 'monthly';
    const [secret, priceMonthly, priceFounder, siteUrl] = await Promise.all([cfg('stripe_secret_key'), cfg('stripe_price_monthly'), cfg('stripe_price_founder'), cfg('site_url')]);
    if (!secret) return json({ error: 'Checkout is not open yet. Founders are being added by hand until then.' }, 503);
    const price = plan === 'founder_season' ? priceFounder : priceMonthly;
    if (!price) return json({ error: `No price configured for ${plan}` }, 503);
    const { data: profile } = await admin.from('profiles').select('stripe_customer_id, email').eq('id', user.id).maybeSingle();
    let customer = profile?.stripe_customer_id ?? null;
    if (!customer) {
      const c = await stripe('customers', secret, { email: user.email ?? profile?.email ?? '', 'metadata[user_id]': user.id });
      customer = c.id;
      await admin.from('profiles').update({ stripe_customer_id: customer }).eq('id', user.id);
    }
    const params: Record<string, string> = {
      customer: customer!,
      client_reference_id: user.id,
      mode: plan === 'founder_season' ? 'payment' : 'subscription',
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/?canceled=1`,
      allow_promotion_codes: 'true',
      'metadata[user_id]': user.id,
      'metadata[plan]': plan,
    };
    if (plan === 'monthly') params['subscription_data[metadata][user_id]'] = user.id;
    const session = await stripe('checkout/sessions', secret, params);
    return json({ url: session.url, id: session.id });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
