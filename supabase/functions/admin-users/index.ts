// Admin account tools: create a member, comp them a period, or look one up. Used for testers and
// founder comps, where no Stripe subscription exists. Auth: x-sync-secret = publish_secret.
//
// POST { action: 'create',   email, password, display_name?, days? }
// POST { action: 'comp',     email, days }
// POST { action: 'password', email, password }
// POST { action: 'lookup',   email }
// POST { action: 'revoke',   email }
//
// A comp writes a subscriptions row with provider and plan 'manual' and status 'trialing', which is
// what public.is_entitled() already accepts. Nothing here touches Stripe.
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

async function cfg(key: string): Promise<string | null> {
  const { data } = await admin.from('pipeline_config').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}

/** Find a user by email without pulling the whole list into memory twice. */
async function findByEmail(email: string) {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

/**
 * Grant or extend a comp. Extends from whichever is later: now, or the current period end.
 *
 * A comp must never overwrite a paying subscription. The first version selected the newest
 * subscription row and UPDATED it with provider 'manual', plan 'manual', status 'trialing' and
 * cancel_at_period_end true. Run that against a Stripe customer and their billing record is gone:
 * the provider, the plan they actually bought, and the fact that they paid at all. A founder who
 * bought the season pass and was then comped three months would have come out the other side
 * looking like a free trial that is set to cancel.
 *
 * So a row that came from Stripe is extended in place, keeping provider, plan and status exactly
 * as the webhook wrote them. Only a manual row, or no row at all, gets the manual shape.
 */
async function comp(userId: string, days: number) {
  const { data: existing } = await admin
    .from('subscriptions')
    .select('id, provider, plan, status, current_period_end, cancel_at_period_end')
    .eq('user_id', userId)
    .order('current_period_end', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const base =
    existing?.current_period_end && new Date(existing.current_period_end) > new Date()
      ? new Date(existing.current_period_end)
      : new Date();
  const end = new Date(base.getTime() + days * 86400000).toISOString();

  if (existing?.id && existing.provider && existing.provider !== 'manual') {
    // Paid subscription: move the end date out and touch nothing else.
    const { error } = await admin
      .from('subscriptions')
      .update({ current_period_end: end, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) throw new Error(error.message);
    return end;
  }

  const row = {
    user_id: userId,
    provider: 'manual',
    plan: 'manual',
    status: 'trialing',
    current_period_end: end,
    cancel_at_period_end: true,
    updated_at: new Date().toISOString(),
  };
  if (existing?.id) {
    const { error } = await admin.from('subscriptions').update(row).eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.from('subscriptions').insert(row);
    if (error) throw new Error(error.message);
  }
  return end;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const secret = await cfg('publish_secret');
  if (!secret || req.headers.get('x-sync-secret') !== secret)
    return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const action = body.action ?? 'lookup';
  const email = String(body.email ?? '')
    .trim()
    .toLowerCase();
  if (!email) return json({ error: 'email required' }, 400);

  try {
    if (action === 'create') {
      const password = String(body.password ?? '');
      if (password.length < 8) return json({ error: 'password must be 8+ characters' }, 400);
      if (await findByEmail(email))
        return json({ error: 'that email already has an account' }, 409);
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // no confirmation mail: this is a provisioned account
        user_metadata: { display_name: body.display_name ?? null, provisioned: true },
      });
      if (error) return json({ error: error.message }, 502);
      const user = data.user!;
      // The on_auth_user_created trigger writes the profile; fill in the name and the consent
      // timestamps a provisioned tester would otherwise have to click through.
      await admin
        .from('profiles')
        .update({
          display_name: body.display_name ?? null,
          age_confirmed_at: new Date().toISOString(),
          rg_ack_at: new Date().toISOString(),
        })
        .eq('id', user.id);
      const days = Number(body.days ?? 0);
      const until = days > 0 ? await comp(user.id, days) : null;
      return json({ created: user.id, email, comped_until: until });
    }

    const user = await findByEmail(email);
    if (!user) return json({ error: 'no account with that email' }, 404);

    if (action === 'comp') {
      const days = Number(body.days ?? 0);
      if (!(days > 0)) return json({ error: 'days must be a positive number' }, 400);
      return json({ user: user.id, email, comped_until: await comp(user.id, days) });
    }

    if (action === 'revoke') {
      const { error } = await admin
        .from('subscriptions')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
      if (error) return json({ error: error.message }, 502);
      return json({ user: user.id, email, revoked: true });
    }

    if (action === 'password') {
      const password = String(body.password ?? '');
      if (password.length < 8) return json({ error: 'password must be 8+ characters' }, 400);
      // Set through the Auth admin API rather than writing auth.users.encrypted_password by hand:
      // Supabase owns that column's hashing scheme, and a row updated behind its back is a sign-in
      // that fails for reasons nothing in the logs explains.
      const { error } = await admin.auth.admin.updateUserById(user.id, { password });
      if (error) return json({ error: error.message }, 502);
      return json({ user: user.id, email, password_set: true });
    }

    if (action === 'lookup') {
      const { data: subs } = await admin
        .from('subscriptions')
        .select('provider, plan, status, current_period_end, cancel_at_period_end')
        .eq('user_id', user.id)
        .order('current_period_end', { ascending: false, nullsFirst: false });
      const { data: entitled } = await admin.rpc('is_entitled', { uid: user.id });
      return json({
        user: user.id,
        email,
        last_sign_in_at: user.last_sign_in_at,
        confirmed: !!user.email_confirmed_at,
        entitled,
        subscriptions: subs ?? [],
      });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
