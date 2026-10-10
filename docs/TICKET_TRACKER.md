# Ticket tracker

A silent status post for one live ticket, every 30 minutes, until the ticket is decided.

- **Function:** `supabase/functions/ticket-tracker` (deploy with `--no-verify-jwt`; it checks
  `x-sync-secret` = `pipeline_config.publish_secret` itself).
- **Ticket:** `pipeline_config.ticket_tracker`, one JSON value.
- **Schedule:** pg_cron job `ticket-tracker`.
- **Scores:** ESPN's public summary endpoint, one request per leg per run.

## Nobody gets alerted

Every post goes out with Discord's `SUPPRESS_NOTIFICATIONS` flag (`@silent`) and
`allowed_mentions: { parse: [] }`, so no one in the channel is pinged or notified. discord-sync
mirrors the post into the app's Feed with `feed_posts.silent = true`. The push trigger skips silent
rows, and the app shows them in the Feed with no banner or badge. The same applies to any post a
capper sends `@silent` in Discord.

## Each run

1. The function grades each leg from the ESPN game state:
   - ✅ won
   - ❌ lost
   - 🟢 leading
   - 🔴 trailing
   - 🟡 tied
   - ⏳ not started (shows kick time, CT)
   - ⚠️ score unavailable, or postponed
2. It posts one message: a header with the price, a tally, and legs sorted worst first.
3. The ticket is decided when any leg loses, every leg wins, or `stop_after` passes. On that run
   it posts a final update, sets `done: true`, and unschedules its own job through
   `public.ticket_tracker_stop()`.

A game that ends without completing (postponed, cancelled) is never graded from its score. It
stays ⚠️ until `stop_after`.

ESPN returns 403 from the edge runtime to Deno's default User-Agent, so the function sends a
browser UA and falls back to `site.web.api.espn.com`.

## Track a new ticket

1. Find each leg's ESPN event id from the scoreboard
   (`site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=YYYYMMDD&groups=80&limit=300`,
   or `.../nfl/scoreboard`). `pick` must match the team's ESPN `abbreviation`.
2. Write the ticket:

   ```sql
   insert into public.pipeline_config (key, value) values ('ticket_tracker', $json${
     "id": "cfb-2026-10-10-11leg",
     "title": "CFB 11-leg ML parlay",
     "channel_id": "1184671749506342922",
     "price": 1007,
     "sport": "college-football",
     "stop_after": "2026-10-11T06:00:00Z",
     "legs": [ {"espn": "401856716", "pick": "MIZ", "price": -556} ],
     "done": false,
     "runs": 0
   }$json$)
   on conflict (key) do update set value = excluded.value;
   ```

   - `sport` is the ESPN path segment: `college-football` or `nfl`.
   - Set `stop_after` a few hours after the last kickoff.
   - Prices are American odds.
3. Preview without posting: `POST { "action": "preview" }`.
4. Post now, then schedule every 30 minutes from this minute (here :12 and :42):

   ```sql
   select cron.schedule('ticket-tracker', '12,42 * * * *', $cmd$
     select net.http_post(
       url := 'https://vcduwtgbclkwcxquqicl.supabase.co/functions/v1/ticket-tracker',
       headers := jsonb_build_object('Content-Type','application/json','x-sync-secret',(select value from public.pipeline_config where key='publish_secret')),
       body := '{"action":"run"}'::jsonb,
       timeout_milliseconds := 55000)
   $cmd$);
   ```

One ticket at a time. A new insert replaces the old one.

## Other actions

- `{ "action": "delete_last" }`: deletes the tracker's own most recent post from Discord and the
  Feed. It only ever deletes the id the tracker recorded.
- **Stop early:** `select public.ticket_tracker_stop();`. It is service role only, so run it from
  the SQL editor.
