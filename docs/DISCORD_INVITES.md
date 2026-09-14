# Invite-only Discord

The server is entered by code. A code is something we hand out; redeeming one mints a **single-use**
Discord invite at that moment, valid 24 hours. A forwarded link is spent the instant someone walks
through it, so a screenshot in a group chat is worth nothing.

Two doors, one mechanism:

- **Members** open `/discord` in the app and tap once. They get a standing invite tied to their
  account, reissued when it lapses. Gated on `is_entitled()`, so a lapsed subscription stops
  producing invites.
- **Anyone handed a code** opens `/join` and types it. This works signed out: the code is the
  credential.

## Handing out codes

All admin actions go through the `discord-invite` function with `x-sync-secret`.

```sql
select net.http_post(
  url := 'https://<project>.supabase.co/functions/v1/discord-invite',
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'x-sync-secret',(select value from public.pipeline_config where key='publish_secret')),
  body := jsonb_build_object('action','mint','count',10,'note','IG promo','days',30)
);
```

`count` up to 100, `days` 0 for no expiry, `max_uses` up to 50 for a shared code (a squad link, a
promo). Default is one use. `action` `list` shows every code and its usage; `revoke` kills one.

## Why the error message never varies

A wrong code, a spent code, an expired code and a revoked code all return the same
`That code is not valid.` Anything more specific tells someone probing codes which guesses were
close. The redeem update is also pinned to the use count it read, so two people submitting the
same last use at once cannot both get an invite.

## The table is not readable

`invite_codes` and `member_invites` have row level security on with **no policies at all**. Only
the service role reaches them, which means only this function does. Codes are never enumerable
through the API.

## Closing the old doors

Minting new codes does not revoke existing invites. In Discord, under Server Settings then Invites,
delete every standing invite. Any link already shared keeps working until you do. If the server has
a vanity URL or is listed in Discovery, turn both off, or the code is decoration.

The bot needs only Create Invite, which it already has. It cannot list or delete existing invites,
because that needs Manage Server, which it deliberately does not have.
