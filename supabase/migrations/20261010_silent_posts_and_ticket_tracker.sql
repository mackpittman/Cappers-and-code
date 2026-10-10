-- Silent posts and the ticket tracker.
--
-- 1. feed_posts.silent mirrors Discord's SUPPRESS_NOTIFICATIONS flag (1 << 12, "@silent").
--    discord-sync sets it; the push trigger skips silent rows and the app shows them in the Feed
--    without a banner or badge. A silent post alerts no one, in Discord or here.
-- 2. ticket_tracker_stop() lets the ticket-tracker function unschedule its own cron job once the
--    ticket is decided. Service role only.
--
-- The tracker's ticket lives in pipeline_config.ticket_tracker and its job is scheduled by hand
-- (docs/TICKET_TRACKER.md), so neither is created here.

alter table public.feed_posts add column if not exists silent boolean not null default false;

create or replace function public.notify_push_on_feed_post()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  secret text;
  ch_name text;
  ch_capper text;
  has_image boolean := false;
begin
  begin
    -- A post sent @silent in Discord (flag 4096) alerts no one here either.
    if coalesce(new.silent, false) then
      return new;
    end if;
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
$function$;

create or replace function public.ticket_tracker_stop()
returns text
language plpgsql
security definer
set search_path = public, cron
as $$
begin
  if exists (select 1 from cron.job where jobname = 'ticket-tracker') then
    perform cron.unschedule('ticket-tracker');
    return 'unscheduled';
  end if;
  return 'not scheduled';
end;
$$;
revoke all on function public.ticket_tracker_stop() from public, anon, authenticated;
grant execute on function public.ticket_tracker_stop() to service_role;
