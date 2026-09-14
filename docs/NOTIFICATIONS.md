# Alert roles

Members opt into the kinds of drops they want. Every pipeline post then pings only that role,
never `@everyone` and never `@here`. Nobody who did not take a role gets a notification.

## The roles

| Key         | Role       | Emoji | What it alerts                             |
| ----------- | ---------- | ----- | ------------------------------------------ |
| `board`     | Board Drop | 🏈    | The slate sheet, before the first kick     |
| `live`      | Live Plays | 🚨    | In-game plays while the games are running  |
| `primetime` | Primetime  | 🌙    | Thursday, Sunday and Monday night cards    |
| `results`   | Results    | 📊    | Every ticket graded against the box scores |
| `free`      | Free Picks | 💵    | The free play of the day                   |

The list lives in one place, `ALERTS` in `supabase/functions/discord-notify/index.ts`. Adding a
row there and rerunning `ensure-roles` is the whole job of adding an alert type.

## One-time setup in Discord

The bot cannot create or hand out roles yet. Two changes in **Server Settings → Roles**:

1. Open the **Bot** role and turn on **Manage Roles**.
2. Drag the **Bot** role above where the alert roles will sit. It currently sits at the bottom,
   and Discord only lets a bot manage roles below its own highest role.

Then run `ensure-roles` (below). It creates any missing role, makes each one mentionable, and
stores the ids in `pipeline_config` as `discord_role_<key>`.

Members pick their roles in **Channels & Roles** at the top of the server list. That is a native
Discord feature and needs no bot. The `post-menu` action also posts an opt-in message into
`#notification` and seeds one reaction per alert, so a reaction-role bot already in the server
(Dyno, carl-bot) can be pointed straight at that message if you would rather use reactions.

## Running it

All three actions go through the `discord-notify` function, authed with the publish secret.
From SQL, with the secret read inside the query so it never appears in a command line:

```sql
select net.http_post(
  url := 'https://<project>.supabase.co/functions/v1/discord-notify',
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'x-sync-secret',(select value from public.pipeline_config where key='publish_secret')),
  body := jsonb_build_object('action','status')   -- or 'ensure-roles', or 'post-menu'
);
```

`status` reports what the bot can do, which roles exist, and what is blocking. Run it first.

## Pinging from a post

`discord-post` takes a `ping` key:

```json
{ "channel_id": "…", "ping": "live", "content": "…" }
```

It prepends the role mention and sets `allowed_mentions` to that one role. An unknown key, or a
role that does not exist yet, posts with no mention rather than failing, so nothing breaks while
setup is pending.

The daily pipeline defaults to `board`. Override it for one-off posts with `DISCORD_PING`:

```
DISCORD_PING=results node scripts/post-discord.mjs
DISCORD_PING= node scripts/post-discord.mjs     # post silently
```

## Channel routing

`pipeline_config` holds a channel per alert type, so a drop can move channels without a code
change: `discord_channel_board`, `discord_channel_live`, `discord_channel_primetime`,
`discord_channel_results`, `discord_channel_free`, plus `discord_notify_channel_id` for the
opt-in message.
