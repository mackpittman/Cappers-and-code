# Cappers & Code — Road to fully functional

Ordered checkpoints from today's state (research model, daily pipeline, branded app build, Discord digest) to a paid product: a $10 membership that unlocks the app board and the members-only Discord.

Each checkpoint lists what gets built, who does it, what it needs from Mack, and the test that marks it done. Checkpoints 1 to 4 are sequential; 5 to 7 can run in parallel once 2 is done.

## Architecture in one paragraph

Supabase holds accounts and entitlements. Stripe takes the money on the web (Checkout + Customer Portal) and tells Supabase through a webhook. The board moves from a private GitHub file to a Supabase endpoint that only serves entitled users, which also fixes the phone-needs-a-token problem. A Discord bot grants the Member role to linked, entitled accounts and removes it when a subscription lapses. The app signs users in with Supabase, shows a branded paywall to everyone else, and sends them to web checkout. App Store in-app purchase comes later, only if the app is sold inside the store.

## Checkpoint 0 — Decisions (Mack, 15 minutes)

| Decision | Recommendation |
|---|---|
| Price | $10/month recurring. Keep the brand's founder offer as a second product: $20 for the football season, first 100 only, grandfathered through NBA. |
| Free tier | Discord free channels (#welcome, #general, #model-talk) and a locked app that shows yesterday's Locked In list as a teaser. Everything else is Member-only. |
| Where money is taken | Web (Stripe Checkout) first. App links out to it. In-app purchase deferred to Checkpoint 8. |
| Sports scope on the paywall page | NFL now; CFB and NBA as "coming" per the brand bio. |
| Domain | Needed for checkout, legal pages, and Discord return links. Suggest cappersandcode.com or .co. |
| Supabase project | A new project named cappers-and-code (do not reuse the golf projects). |
| Legal entity for Stripe | Which name, address, and bank account Stripe should pay out to. |

Done when: answers are in this file.

## Checkpoint 1 — Accounts and entitled board (Claude) — BACKEND DONE 2026-09-12, app in test

- Supabase project: tables `profiles`, `subscriptions` (stripe ids, status, current_period_end, plan), `discord_links`, `entitlements` view; row-level security so a user can only read their own rows.
- Auth: email one-time code plus Sign in with Apple. Age and responsible-gambling acknowledgement stored on the profile at signup.
- Board delivery: pipeline uploads `board.json` to a private Supabase bucket; Edge Function `board` returns it only for an active entitlement; a `board-preview` function returns the teaser for everyone.
- Routine updated to upload after each run (service key lives in the Routine, never in the repo).
- App: Supabase client, sign-in screen, board fetched from the `board` function with the session token; unauthenticated or unentitled users see the paywall screen.

Status: Supabase project `cappers-and-code` (Roomrush org, free tier) holds the schema, the publish function and the gated readers; the pipeline publishes after every run; the app signs in with an email code and shows the paywall to non-members.
Sign-in is email + password (no email delivery needed). Needs from Mack: in Supabase → Authentication → Providers → Email, turn **Confirm email** off until custom SMTP exists (free plan cannot edit email templates without it). Later: Resend SMTP with the brand domain, then re-enable confirmation and the email-code flow. Apple Developer account for Sign in with Apple.
Done when: a test user with a manually set entitlement sees the live board on the phone with no token pasted anywhere; a user without it sees the paywall.

## Checkpoint 2 — Stripe (Claude builds, Mack activates)

- Products: Membership $10/month; Founder Season Pass $20 one-time with entitlement through a fixed date; coupon support.
- Edge Functions: `checkout` (creates a Checkout Session for the signed-in user), `portal` (Customer Portal link), `stripe-webhook` (checkout completed, invoice paid, subscription updated and deleted, charge refunded) writing `subscriptions` and entitlements.
- Customer Portal configured for cancel, update card, and receipts. Automatic tax on if selling outside one state.
- Test mode end to end with Stripe test cards, including failed payment and cancel-at-period-end.

Needs from Mack: Stripe account activated with the business details, and a confirmation from Stripe support that "sports betting analysis membership" is an accepted information-service business on the account.
Done when: test card checkout unlocks the board within 10 seconds; cancel locks it at period end; refund locks it immediately.

## Checkpoint 3 — Paywall and membership UX in the app (Claude)

- Branded Welcome, Sign in, and Paywall screens (near-black, CC lockup, one green CTA, the offer, what members get, disclaimers).
- Locked state: teaser board with blur, "Unlock the Edge" button that opens web checkout in the browser and returns to the app through the `cappers://` scheme.
- Settings: membership status, Manage subscription (portal), Sign out, Link Discord.
- Free preview refreshes daily so the teaser is never stale.

Done when: install fresh, sign up, hit paywall, pay with a test card in the browser, return to the app, board unlocked; sign out and back in keeps access.

## Checkpoint 4 — Discord gating (Claude, needs the bot token)

- CC Core bot in the server (token from the Developer Portal, permissions link from the earlier message).
- Server setup from the blueprint: icon, banner, emoji, categories, channels, roles, permissions, welcome and rules posts pinned.
- Members-only permissions on THE EDGE and THE CODE categories; free channels stay open.
- Link flow: "Link Discord" in the app or on the success page starts Discord OAuth; the `discord-link` function stores the Discord user id and the bot assigns Member (or Founder).
- Nightly reconciliation removes roles for lapsed subscriptions and re-adds on renewal.

Needs from Mack: bot token and the bot authorized into the server.
Done when: a test account pays, links, and gets the Member role in under a minute; cancelling removes it on the nightly run.

## Checkpoint 5 — Web landing and checkout page (Claude, needs the domain)

- One-page site on brand: hero with the Core Robot, "AI Models. Human Insight. One Edge.", what you get (daily board, TD board, props, Discord), the $10 CTA and founder offer, FAQ, responsible-gambling and no-guarantee language, footer with @cappersandcode.
- Sign up and pay without the app; success page with "Open the app" and "Join the Discord" buttons.
- Hosted on Vercel or Netlify with the domain; legal pages linked.

Needs from Mack: domain pointed at the host.
Done when: someone with only the link can pay and land in Discord with the Member role.

## Checkpoint 6 — Legal and compliance (Claude drafts, Mack approves)

- Terms of Service, Privacy Policy, Refund Policy, Responsible Gambling page, "not financial advice / no guaranteed results" disclosure, 21+ (or 18+ by jurisdiction) notice at signup and on the site.
- Stripe descriptor and receipt text.
- Data retention: what is stored (email, Discord id, subscription state), nothing about bets placed.

Done when: pages are live and linked from the app Settings, the paywall, checkout, and the Discord #rules post.

## Checkpoint 7 — Weekly research automation (Claude)

The model currently holds Week 1. The season needs a Tuesday refresh.

- Weekly Routine (Tuesday 9am ET): fan out research per game as done for Week 1, write the new `research.json`, run the pipeline, post a "New week is live" digest to Discord, and open a review summary for Mack.
- Results tracking: grade last week's Locked In and TD Board against final scores and box scores (ESPN, free), store a running record in `data/results/`, show it in the app and in #wins. Real record only, never claimed percentages.

Done when: Week 2 board appears on Tuesday without anyone touching it, and Week 1 has a graded record in the app.

## Checkpoint 8 — App distribution (Claude configures, Mack owns the accounts)

- EAS project, build profiles, TestFlight internal group, Google Play internal track.
- App Store notes: gambling-related content requires a 17+ rating; because purchases happen on the web and the app only signs existing members in, no in-app purchase is required for the first submission. If Apple asks for IAP, add Checkpoint 8b: StoreKit subscription mirrored into `subscriptions` through App Store Server Notifications.

Needs from Mack: Apple Developer Program and Google Play Console memberships, Expo account.
Done when: TestFlight build installs and the full paywall loop works on a real phone.

## Checkpoint 9 — Ops hardening (Claude)

- Rotate the Odds API key and the Discord webhook (both passed through chat); move all secrets into GitHub Actions secrets and Supabase secrets; retire the Routine-embedded values.
- Failure alerts to #ops: pipeline errors, credits below 60, board older than 30 hours.
- Backups: nightly export of `data/` and Supabase tables.
- Upgrade the Odds API plan when the season demands more than 500 credits (20K credits is $30/month).

Done when: a full week runs with no manual action and every failure mode has posted an alert in a test.

## Checkpoint 10 — Launch

- Founders offer window: first 100, announcement in #announcements and Instagram pinned sequence from the brand's social system.
- Support: a support email in the app and on the site; refund handling through the Stripe portal.
- Dashboard: Stripe for MRR and churn; Supabase count of active entitlements; Discord member count.

Done when: first 10 paying members are in Discord with the role and using the app, and the daily digest has posted seven days in a row.

## Still open from earlier work

- CC Core bot token (unlocks Checkpoint 4).
- `ODDS_API_KEY` as a GitHub Actions secret (optional second scheduler).
- Phone install today: `pnpm install && pnpm start` in this repo with Expo Go, plus a read-only GitHub token in Settings until Checkpoint 1 replaces it.
