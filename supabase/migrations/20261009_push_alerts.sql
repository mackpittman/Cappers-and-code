-- Push alerts for the Discord feed.
--
-- A member turns alerts on from Settings; the browser's push subscription is stored here through
-- the `push` edge function (the user's JWT is checked there, writes use the service role). Every
-- new row in feed_posts (the Discord mirror) is handed to the same function by the trigger below,
-- and the function pushes it to every subscription whose owner is entitled right now.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'web' check (kind in ('web', 'expo')),
  endpoint text not null unique,
  p256dh text,
  auth text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  failures integer not null default 0,
  last_error text
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;

-- A member may read their own rows (Settings shows which devices have alerts on). Every write
-- goes through the push function with the service role.
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

-- The sender's list: every subscription whose owner is entitled at send time, so a lapsed
-- membership stops getting alerts without anyone touching the table.
create or replace function public.push_targets()
returns table (id uuid, user_id uuid, kind text, endpoint text, p256dh text, auth text, failures integer)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.user_id, s.kind, s.endpoint, s.p256dh, s.auth, s.failures
  from public.push_subscriptions s
  where public.is_entitled(s.user_id);
$$;
-- Postgres grants EXECUTE on a new function to PUBLIC; naming only anon and authenticated leaves
-- that grant in place, and anon inherits it. Revoke from public too, and grant service_role
-- explicitly so the function does not depend on bootstrap default privileges.
revoke all on function public.push_targets() from public, anon, authenticated;
grant execute on function public.push_targets() to service_role;

-- One member's entitlement, for the status screen (the service role has no auth.uid()).
create or replace function public.push_is_entitled(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_entitled(uid);
$$;
revoke all on function public.push_is_entitled(uuid) from public, anon, authenticated;
grant execute on function public.push_is_entitled(uuid) to service_role;

-- Every new Discord post goes to the push function. A post that is already older than fifteen
-- minutes when it lands here is a backfill, not news, and is skipped. Nothing in here may fail
-- the insert: the mirror matters more than the alert, so every error is swallowed.
create or replace function public.notify_push_on_feed_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  secret text;
  ch_name text;
  ch_capper text;
  has_image boolean := false;
begin
  begin
    if new.posted_at < now() - interval '15 minutes' then
      return new;
    end if;
    select value into secret from public.pipeline_config where key = 'publish_secret';
    if secret is null then
      return new;
    end if;
    select c.name, c.capper into ch_name, ch_capper
      from public.feed_channels c where c.channel_id = new.channel_id;
    begin
      select exists (
        select 1 from jsonb_array_elements(coalesce(to_jsonb(new.attachments), '[]'::jsonb)) a
        where a ->> 'type' like 'image/%'
      ) into has_image;
    exception when others then
      has_image := false;
    end;
    perform net.http_post(
      url := 'https://vcduwtgbclkwcxquqicl.supabase.co/functions/v1/push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', secret),
      body := jsonb_build_object(
        'action', 'notify',
        'post', jsonb_build_object(
          'id', new.id,
          'channel_id', new.channel_id,
          'channel_name', ch_name,
          'capper', ch_capper,
          'author_name', new.author_name,
          'content', new.content,
          'posted_at', new.posted_at,
          'has_image', has_image)),
      timeout_milliseconds := 20000);
  exception when others then
    null;
  end;
  return new;
end
$$;
drop trigger if exists feed_posts_push on public.feed_posts;
create trigger feed_posts_push
  after insert on public.feed_posts
  for each row execute function public.notify_push_on_feed_post();
