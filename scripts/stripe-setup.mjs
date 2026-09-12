// One-time Stripe setup. Needs STRIPE_SECRET_KEY (sk_test_ or sk_live_), SUPABASE_URL, SUPABASE_ANON_KEY,
// BOARD_PUBLISH_SECRET. Creates the products and prices, registers the webhook endpoint, and stores the
// ids and secrets in pipeline_config (never in the repo). Safe to re-run: existing products are reused.
const key = process.env.STRIPE_SECRET_KEY;
const url = process.env.SUPABASE_URL,
  anon = process.env.SUPABASE_ANON_KEY,
  secret = process.env.BOARD_PUBLISH_SECRET;
if (!key || !url || !anon || !secret) {
  console.error(
    'STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_ANON_KEY and BOARD_PUBLISH_SECRET are required',
  );
  process.exit(1);
}
const stripe = async (path, params, method = 'POST') => {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : new URLSearchParams(params),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error?.message}`);
  return j;
};
const setCfg = async (cfg_key, cfg_value) => {
  const r = await fetch(`${url}/rest/v1/rpc/set_config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ secret, cfg_key, cfg_value }),
  });
  if (!r.ok) throw new Error(`set_config ${cfg_key}: ${r.status} ${await r.text()}`);
};
const findProduct = async (name) =>
  (
    await stripe(
      `products/search?query=${encodeURIComponent(`name:'${name}' AND active:'true'`)}`,
      null,
      'GET',
    )
  ).data[0];
async function ensure(name, description, priceParams) {
  let p = await findProduct(name);
  if (!p)
    p = await stripe('products', { name, description, 'metadata[brand]': 'cappers-and-code' });
  const prices = (await stripe(`prices?product=${p.id}&active=true&limit=10`, null, 'GET')).data;
  let price = prices.find(
    (x) =>
      x.unit_amount === Number(priceParams.unit_amount) &&
      !!x.recurring === !!priceParams['recurring[interval]'],
  );
  if (!price) price = await stripe('prices', { product: p.id, currency: 'usd', ...priceParams });
  return { product: p, price };
}
const monthly = await ensure(
  'Cappers & Code Membership',
  'Daily board, TD board with live prices, prop leans, stacks, and the members-only Discord. Cancel anytime.',
  { unit_amount: '1000', 'recurring[interval]': 'month' },
);
const founder = await ensure(
  'Cappers & Code Founder Season Pass',
  'Founding member access for the football season, grandfathered through the NBA season. First 100 only.',
  { unit_amount: '2000' },
);
const endpointUrl = `${url}/functions/v1/stripe-webhook`;
const existing = (await stripe('webhook_endpoints?limit=50', null, 'GET')).data.find(
  (w) => w.url === endpointUrl,
);
let webhook = existing;
if (!webhook) {
  webhook = await stripe('webhook_endpoints', {
    url: endpointUrl,
    'enabled_events[0]': 'checkout.session.completed',
    'enabled_events[1]': 'customer.subscription.created',
    'enabled_events[2]': 'customer.subscription.updated',
    'enabled_events[3]': 'customer.subscription.deleted',
    'enabled_events[4]': 'invoice.payment_failed',
    'enabled_events[5]': 'charge.refunded',
    description: 'Cappers & Code entitlements',
  });
  await setCfg('stripe_webhook_secret', webhook.secret);
  console.log('webhook created and signing secret stored');
} else
  console.log(
    'webhook already registered; signing secret unchanged (store it manually with set_config if it was lost)',
  );
await setCfg('stripe_secret_key', key);
await setCfg('stripe_price_monthly', monthly.price.id);
await setCfg('stripe_price_founder', founder.price.id);
await setCfg('stripe_mode', key.startsWith('sk_live') ? 'live' : 'test');
console.log(
  JSON.stringify(
    {
      mode: key.startsWith('sk_live') ? 'live' : 'test',
      monthly: monthly.price.id,
      founder: founder.price.id,
      webhook: webhook.id,
    },
    null,
    1,
  ),
);
