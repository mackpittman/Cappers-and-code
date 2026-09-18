-- Paywall -> Discord access. discord_links already maps one Supabase account to one Discord
-- account; these columns record what we actually did on the guild so the reconciler is idempotent
-- and an operator can see why a grant failed without reading function logs.
alter table public.discord_links
  add column if not exists guild_joined_at  timestamptz,
  add column if not exists role_granted_at  timestamptz,
  add column if not exists role_revoked_at  timestamptz,
  add column if not exists last_error       text,
  add column if not exists last_synced_at   timestamptz,
  add column if not exists updated_at       timestamptz not null default now();

-- OAuth state nonces. Discord redirects the browser back to us with ?state=; we mint the state
-- here against the signed-in user so a callback cannot be replayed or bound to someone else.
create table if not exists public.discord_link_states (
  state       text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  redirect_to text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '15 minutes',
  used_at     timestamptz
);
create index if not exists discord_link_states_expiry on public.discord_link_states (expires_at);

-- Service role only: the edge function is the sole reader/writer. No policies, RLS on, which
-- denies every anon/authenticated request while leaving the service role unaffected.
alter table public.discord_link_states enable row level security;

-- One place that answers "should this account hold the paid role right now".
create or replace function public.discord_access_targets()
returns table (user_id uuid, discord_user_id text, entitled boolean, role_granted_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select l.user_id, l.discord_user_id, public.is_entitled(l.user_id), l.role_granted_at
  from public.discord_links l
  where l.discord_user_id is not null;
$$;

revoke all on function public.discord_access_targets() from anon, authenticated;

-- Hourly: make Discord role membership match billing.
select cron.schedule(
  'discord-access-reconcile',
  '23 * * * *',
  $job$
  select net.http_post(
    url := 'https://vcduwtgbclkwcxquqicl.supabase.co/functions/v1/discord-access',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-sync-secret',(select value from public.pipeline_config where key='publish_secret')),
    body := '{"action":"reconcile"}'::jsonb,
    timeout_milliseconds := 55000);
  $job$
);
