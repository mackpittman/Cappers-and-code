// Returns a Stripe Customer Portal URL for the signed-in user (cancel, update card, receipts).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
async function cfg(key: string) { const { data } = await admin.from('pipeline_config').select('value').eq('key', key).maybeSingle(); return data?.value ?? null; }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const { data: { user } } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
    if (!user) return json({ error: 'sign in first' }, 401);
    const [secret, siteUrl] = await Promise.all([cfg('stripe_secret_key'), cfg('site_url')]);
    if (!secret) return json({ error: 'Billing portal is not open yet.' }, 503);
    const { data: profile } = await admin.from('profiles').select('stripe_customer_id').eq('id', user.id).maybeSingle();
    if (!profile?.stripe_customer_id) return json({ error: 'No billing account on this login yet.' }, 404);
    const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ customer: profile.stripe_customer_id, return_url: `${siteUrl}/` }) });
  const j = await r.json();
    if (!r.ok) return json({ error: j.error?.message ?? 'portal error' }, 500);
    return json({ url: j.url });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
