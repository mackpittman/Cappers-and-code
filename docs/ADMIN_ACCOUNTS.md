# Provisioning accounts and comps

Testers and founder comps do not go through Stripe. The `admin-users` edge function creates the
account and writes a manual subscription row, which `public.is_entitled()` already accepts because
it counts any row with status `active` or `trialing` whose period has not ended.

Auth is the publish secret in the `x-sync-secret` header, same as the other admin functions.

## Actions

| Action   | Body                                          | What it does                                                              |
| -------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| `create` | `email`, `password`, `display_name?`, `days?` | Creates a confirmed account, fills the profile, and comps `days` if given |
| `comp`   | `email`, `days`                               | Grants or extends a comp on an existing account                           |
| `lookup` | `email`                                       | Reports sign-in state, entitlement and every subscription row             |
| `revoke` | `email`                                       | Marks their subscriptions canceled                                        |

`create` sets `email_confirm`, so no confirmation mail is sent and the account works immediately.
It also stamps `age_confirmed_at` and `rg_ack_at`, which a provisioned tester would otherwise have
to click through before seeing anything.

`comp` extends from whichever is later, now or the existing period end, so comping twice adds time
rather than resetting it. Every comp row is written with `cancel_at_period_end`, so it expires on
its own and never renews.

## Running one

```sql
select net.http_post(
  url := 'https://<project>.supabase.co/functions/v1/admin-users',
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'x-sync-secret',(select value from public.pipeline_config where key='publish_secret')),
  body := jsonb_build_object(
    'action','create', 'email','someone@example.com',
    'password','<password>', 'display_name','Their Name', 'days', 21)
);
```

Read the result from `net._http_response` by the returned request id.

## Checking a comp actually unlocks the app

Entitlement is worth verifying rather than assuming. Acting as the user's own session:

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"<user id>","role":"authenticated"}';
select public.is_member(), jsonb_array_length(public.get_board() -> 'games');
```

`is_member()` true and a non-zero game count means they see the paid board, not the preview.

## Passwords

Never commit a password. Hand it over directly and tell the account holder to change it once they
are in. A sign-in test through `/auth/v1/token?grant_type=password` writes the session token into
`net._http_response`; delete that row afterwards.
