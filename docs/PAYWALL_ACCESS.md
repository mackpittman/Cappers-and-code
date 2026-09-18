# Paywall access: one payment, two doors

A paid membership has to open the app and the members' Discord at the same time, and close both
again when the money stops. This is how that works and what is still needed to switch it on.

## The chain

1. Someone pays through Stripe Checkout (`stripe-checkout`).
2. Stripe calls `stripe-webhook`. It verifies the signature and writes the subscription into
   `public.subscriptions`.
3. **App access** is immediate. `is_entitled(uid)` reads `subscriptions` and every members-only
   RPC and RLS policy is built on it. Nothing else to do.
4. **Discord access** needs to know which Discord account belongs to that person, so the webhook
   calls `discord-access` with `{ action: 'apply', user_id }`. If they have linked Discord, the
   MEMBERS role goes on right then. If they have not, that is a normal state and nothing fails.
5. The member connects Discord from the Discord tab. `discord-access` runs the OAuth exchange,
   stores the mapping in `discord_links`, and grants the role in the same request. If they are not
   in the server yet, the `guilds.join` scope puts them in with the role already attached.
6. `discord-access-reconcile` runs hourly (`23 * * * *`) and makes Discord match billing: a lapsed
   or refunded membership loses the role, and anyone who linked late picks it up.

Failures never cascade. A Discord outage cannot make the webhook return non-200 and have Stripe
retry a payment event we already recorded; the hourly sweep is the backstop.

## Why OAuth and not invite codes

Invite codes get someone through the door but tell us nothing about who walked in, so membership
and role membership drift apart within a week. Linking the account is what makes a lapse
automatic. The single-use invite flow stays in place as a fallback and as the whole experience
while linking is unconfigured.

One Discord account maps to one membership, enforced by a unique constraint on
`discord_links.discord_user_id`. A second account trying to claim the same Discord id is refused.

## Checking the wiring

```
POST /functions/v1/discord-access   x-sync-secret: <publish_secret>
{ "action": "probe" }
```

Reports every config key, the bot's identity, the roles it can see, whether it can manage roles,
whether it sits above the MEMBERS role, and a `blocked_on` line naming the single thing to fix
next. It writes nothing.

`{ "action": "reconcile", "force": true }` re-checks every linked account against Discord rather
than trusting the recorded state. Use it after fixing permissions.

## Still needed before this can take money

As of the last probe, `blocked_on: "bot lacks Manage Roles"`.

| What | Where | Note |
|---|---|---|
| `stripe_secret_key` | `pipeline_config` | Not set. Without it the webhook returns 503 and no one can subscribe at all. |
| `stripe_webhook_secret` | `pipeline_config` | Not set. From the Stripe dashboard endpoint for `stripe-webhook`. |
| `discord_client_secret` | `pipeline_config` | Not set. Discord Developer Portal, OAuth2 tab. |
| Manage Roles | Discord server settings | The bot's role does not have it. |
| Role hierarchy | Discord server settings | The bot's role sits at position 1, below MEMBERS at position 3. Drag it above MEMBERS or it cannot assign that role even with the permission. |
| OAuth redirect | Discord Developer Portal | Add `https://vcduwtgbclkwcxquqicl.supabase.co/functions/v1/discord-access` to OAuth2 Redirects. It must match exactly. |

Already set: `discord_member_role_id` (MEMBERS, `1185725855062831264`), `discord_redirect_uri`,
`discord_application_id`, `discord_bot_token`, `discord_guild_id`.

Secrets go into `pipeline_config` or the process environment. They are never committed, logged, or
written into any file in this repo.

## Operating it

- A member who wants out: the Discord tab has Disconnect, which drops the role and forgets the id.
- A stuck member: `{ "action": "apply", "user_id": "...", "force": true }`.
- `discord_links.last_error` holds the most recent failure for that account, so a support question
  is one query rather than a log search.
