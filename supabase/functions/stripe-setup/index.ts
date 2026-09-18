// One-shot Stripe wiring, run server side.
//
// The same job as scripts/stripe-setup.mjs, but it reads the secret key out of pipeline_config
// instead of taking it as an argument. That matters: an operator can paste the key straight into
// the database once and never hand it to a shell, a log, a chat window, or anyone's context. This
// function creates the products and prices, registers the webhook endpoint, and writes the
// resulting ids back. It returns ids only, never a secret.
//
//   POST { action: 'setup' }   x-sync-secret   -> create/reuse everything, store the ids
//   POST { action: 'status' }  x-sync-secret   -> what is configured, without touching Stripe
//
// Safe to re-run: existing products, prices and endpoints are reused rather than duplicated.
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

async function cfgAll(keys: string[]): Promise<Record<string, string | null>> {
  const { data } = await admin.from('pipeline_config').select('key, value').in('key', keys);
  const out: Record<string, string | null> = {};
  for (const k of keys) out[k] = data?.find((r: any) => r.key === k)?.value ?? null;
  return out;
}
const setCfg = (key: string, value: string) =>
  admin.from('pipeline_config').upsert({ key, value }, { onConflict: 'key' });

/** Stripe's API is form-encoded, including for nested params like enabled_events[0]. */
async function stripe(
  path: string,
  secret: string,
  params: Record<string, string> | null = null,
  method: 'GET' | 'POST' | 'DELETE' = 'POST',
): Promise<any> {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error?.message ?? r.status}`);
  return j;
}

async function ensureProduct(
  secret: string,
  name: string,
  description: string,
  price: { unit_amount: string; recurring?: string },
) {
  const found = await stripe(
    `products/search?query=${encodeURIComponent(`name:'${name}' AND active:'true'`)}`,
    secret,
    null,
    'GET',
  );
  const product =
    found.data[0] ??
    (await stripe('products', secret, { name, description, 'metadata[brand]': 'cappers-and-code' }));

  const prices = await stripe(`prices?product=${product.id}&active=true&limit=10`, secret, null, 'GET');
  const wanted = Number(price.unit_amount);
  const existing = prices.data.find(
    (p: any) => p.unit_amount === wanted && !!p.recurring === !!price.recurring,
  );
  if (existing) return { product, price: existing, created: false };

  const params: Record<string, string> = {
    product: product.id,
    currency: 'usd',
    unit_amount: price.unit_amount,
  };
  if (price.recurring) params['recurring[interval]'] = price.recurring;
  return { product, price: await stripe('prices', secret, params), created: true };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const c = await cfgAll([
    'publish_secret',
    'stripe_secret_key',
    'stripe_webhook_secret',
    'stripe_price_monthly',
    'stripe_price_founder',
    'stripe_mode',
  ]);
  if (!c.publish_secret || req.headers.get('x-sync-secret') !== c.publish_secret)
    return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const action = body.action ?? 'status';

  const status = {
    stripe_secret_key: !!c.stripe_secret_key,
    stripe_webhook_secret: !!c.stripe_webhook_secret,
    stripe_price_monthly: c.stripe_price_monthly,
    stripe_price_founder: c.stripe_price_founder,
    mode: c.stripe_mode,
  };
  if (action === 'status') return json(status);
  if (action !== 'setup' && action !== 'selftest' && action !== 'taxcodes')
    return json({ error: `unknown action: ${action}` }, 400);

  const secret = c.stripe_secret_key;
  if (!secret)
    return json(
      {
        error: 'stripe_secret_key is not set in pipeline_config',
        how: "insert into pipeline_config (key, value) values ('stripe_secret_key', 'sk_live_...') on conflict (key) do update set value = excluded.value;",
      },
      503,
    );

  // Managed Payments requires every product to carry a tax code. Rather than guess one, list the
  // eligible codes from Stripe and pick from the real set.
  if (action === 'taxcodes') {
    const all = await stripe('tax_codes?limit=100', secret, null, 'GET');
    const q = String(body.q ?? 'software').toLowerCase();
    return json({
      matches: all.data
        .filter((t: any) => `${t.name} ${t.description}`.toLowerCase().includes(q))
        .map((t: any) => ({ id: t.id, name: t.name, description: String(t.description).slice(0, 150) })),
    });
  }

  if (action === 'selftest') {
    const out: Record<string, unknown> = { mode: /^(sk|rk)_live_/.test(secret) ? 'live' : 'test' };
    let customerId: string | null = null;
    try {
      const cust = await stripe('customers', secret, {
        email: 'selftest@cappersandcode.invalid',
        'metadata[selftest]': '1',
      });
      customerId = cust.id;
      out.create_customer = 'ok';
    } catch (e) {
      out.create_customer = String((e as Error).message);
      return json({ ok: false, ...out }, 502);
    }
    try {
      const site = (await cfgAll(['site_url'])).site_url ?? 'https://example.com';
      const session = await stripe('checkout/sessions', secret, {
        customer: customerId!,
        mode: 'payment',
        'line_items[0][price]': c.stripe_price_founder ?? '',
        'line_items[0][quantity]': '1',
        success_url: `${site}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${site}/?canceled=1`,
      });
      out.create_checkout_session = 'ok';
      out.session_url_host = new URL(session.url).host;
      // Leave nothing behind that a stray click could pay for.
      await stripe(`checkout/sessions/${session.id}/expire`, secret, {});
      out.expire_session = 'ok';
    } catch (e) {
      out.create_checkout_session = String((e as Error).message);
    }
    try {
      await stripe(`customers/${customerId}`, secret, null, 'DELETE');
      out.cleanup = 'ok';
    } catch (e) {
      out.cleanup = String((e as Error).message);
    }
    return json({ ok: out.create_checkout_session === 'ok', ...out });
  }

  try {
    // Stripe issues a restricted key (rk_) rather than a standard secret key (sk_) whenever the
    // key is scoped to a permission set, so both prefixes are valid here. What decides live vs
    // test is the _live_ / _test_ segment, not the prefix.
    const live = /^(sk|rk)_live_/.test(secret);
    const monthly = await ensureProduct(
      secret,
      'Cappers & Code Membership',
      'Daily board, TD board with live prices, prop leans, stacks, and the members-only Discord. Cancel anytime.',
      { unit_amount: '1000', recurring: 'month' },
    );
    const founder = await ensureProduct(
      secret,
      'Cappers & Code Founder Season Pass',
      'Founding member access for the football season, grandfathered through the NBA season. First 100 only.',
      { unit_amount: '2000' },
    );

    const endpointUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/stripe-webhook`;
    const events = [
      'checkout.session.completed',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.payment_failed',
      'charge.refunded',
    ];
    const existingHooks = await stripe('webhook_endpoints?limit=100', secret, null, 'GET');
    let hook = existingHooks.data.find((w: any) => w.url === endpointUrl);
    let hookNote = 'reused';

    // Stripe returns a signing secret only when the endpoint is created. If an endpoint exists but
    // we never stored its secret, it can never verify a delivery, so replace it with a fresh one.
    if (hook && !c.stripe_webhook_secret) {
      await stripe(`webhook_endpoints/${hook.id}`, secret, null, 'DELETE');
      hook = null;
      hookNote = 'recreated (its signing secret was not stored)';
    }
    if (!hook) {
      const params: Record<string, string> = { url: endpointUrl, description: 'Cappers & Code entitlements' };
      events.forEach((e, i) => (params[`enabled_events[${i}]`] = e));
      hook = await stripe('webhook_endpoints', secret, params);
      await setCfg('stripe_webhook_secret', hook.secret);
      if (hookNote === 'reused') hookNote = 'created';
    }

    await setCfg('stripe_price_monthly', monthly.price.id);
    await setCfg('stripe_price_founder', founder.price.id);
    await setCfg('stripe_mode', live ? 'live' : 'test');

    return json({
      ok: true,
      mode: live ? 'live' : 'test',
      key_type: secret.startsWith('rk_') ? 'restricted' : 'standard',
      live_warning: live ? null : 'This is a TEST key. No real money can be taken until a live key is stored.',
      monthly: { product: monthly.product.id, price: monthly.price.id, amount: '$10.00/month', created: monthly.created },
      founder: { product: founder.product.id, price: founder.price.id, amount: '$20.00 once', created: founder.created },
      webhook: { id: hook.id, url: endpointUrl, events, status: hookNote },
    });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 502);
  }
});
