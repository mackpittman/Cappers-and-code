# Push alerts for the Discord feed

A member turns alerts on once, in Settings. From then on every post that lands in the members'
Discord reaches their phone within a minute of being posted, app open or closed. Inside the app a
new post also badges the Feed tab and drops a banner on whatever screen they are on.

## How it moves

```
Discord  ->  discord-sync (every minute)  ->  feed_posts INSERT
                                              |
                                              v  trigger feed_posts_push (pg_net, publish secret)
                                           push edge function  { action: 'notify', post }
                                              |
                                              v  push_targets(): every subscription whose owner is entitled
                                           Web Push (VAPID)  ->  the device's push service  ->  sw.js  ->  notification
```

- `supabase/migrations/20261009_push_alerts.sql`: the `push_subscriptions` table, `push_targets()`
  and the trigger. The trigger skips posts already older than fifteen minutes (a channel being
  switched on backfills history; that is not news) and swallows every error, so an alert can never
  block the mirror.
- `supabase/functions/push/index.ts`: one function, two doors. Member actions (`key`, `subscribe`,
  `unsubscribe`, `status`, `test`) check the member's JWT. `notify` checks `x-sync-secret`. The
  VAPID key pair is generated on first use and kept in `pipeline_config` as `vapid_keys`; only the
  public half ever leaves the database. Dead endpoints (404/410) are deleted on sight; a push
  service that is rate limiting or down (429, 5xx, no answer) costs the device nothing; any other
  failure five times running drops the device.
- `public/sw.js`: the service worker. Shows the alert and, on tap, focuses the app on the Feed.
  No caching, so a deploy is live on the next load.
- `src/lib/push.ts`: permission, subscription and server registration on the web build.
- `src/lib/feedAlerts.tsx`: the in-app half. Realtime insert on `feed_posts` -> badge count,
  banner, and a local notification when the tab is hidden.

Alerts collapse per channel on the device (`topic`/`tag` is the channel id), so five quick posts
from one capper show as the newest one, not five.

## One-time setup

Run from the project root, signed in to the Supabase CLI (`supabase login`):

```
supabase db push --project-ref vcduwtgbclkwcxquqicl           # applies the migration
supabase functions deploy push --no-verify-jwt --project-ref vcduwtgbclkwcxquqicl
```

Or paste the migration into the SQL editor and deploy the function from the dashboard; it must be
deployed **without JWT verification** because the trigger's call carries the publish secret, not a
user token (the function verifies the user's JWT itself for the member actions).

Optional: `support_email` in `pipeline_config` is the VAPID contact; it defaults to the founder's
address. `site_url` (already set for Stripe) is where a tapped alert opens.

Nothing else to configure. The first member who turns alerts on creates the key pair.

## Turning it on as a member

Settings -> Alerts -> **Turn on Discord alerts**. The browser asks for permission once.

- **iPhone and iPad**: Safari only delivers push to a web app on the Home Screen (Share -> Add to
  Home Screen), on iOS 16.4 or later. Settings says so when it detects Safari in the browser.
- **Android**: works in Chrome directly and from the Home Screen.
- **Desktop**: works in Chrome, Edge and Firefox.

**Send a test alert** pushes to every device on the account (entitled accounts only), so a member
can prove it before the first real drop. **Turn off** unsubscribes this device; signing out does
the same for the browser it happens in.

Alerts go out to entitled members only (`push_targets()` checks `is_entitled` at send time), so a
lapsed membership stops receiving them without anyone touching the table. A member can turn them
on before paying; they start with the membership.

## Checking it

- `POST /functions/v1/push` with the member's JWT and `{ "action": "status" }` lists their devices.
- A `notify` that reaches nobody returns `{ sent: 0, targets: 0 }`; one that reaches people returns
  the tally `{ targets, sent, gone, failed, skipped }`. The pg_net response is in `net._http_response`.
- `push_subscriptions.last_error` holds the last delivery failure per device.

## Not covered yet

- The App Store build: `push_subscriptions.kind` already allows `expo` for Expo push tokens; the
  function skips them until the native channel is wired.
- Per-channel preferences: every enabled feed channel alerts. The next step is a channel list in
  Settings, stored on the subscription row.
- Bursts: the trigger fires per post, so five posts in one sync are five fan-outs. Devices collapse
  them per channel; if the sync ever lands dozens of posts a minute, move the trigger to a
  statement-level outbox drained once.
