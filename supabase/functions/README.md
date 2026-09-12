# Edge functions

Deployed to the `cappers-and-code` Supabase project. Secrets are never in this repo: Stripe keys and the publish secret live in `pipeline_config` and are read with the service role inside the functions.

| Function          | JWT                    | Purpose                                                                                       |
| ----------------- | ---------------------- | --------------------------------------------------------------------------------------------- | --------------------- |
| `stripe-webhook`  | off (Stripe signature) | Mirrors Checkout / subscription / refund events into `subscriptions`.                         |
| `stripe-checkout` | on                     | Creates a Checkout Session for the signed-in user (`{ plan: 'monthly'                         | 'founder_season' }`). |
| `stripe-portal`   | on                     | Returns a Customer Portal link for the signed-in user.                                        |
| `site`            | off (public pages)     | Landing page with web sign-in and checkout, `/success`, and the legal pages under `/legal/*`. |

Deploy with the Supabase CLI (`supabase functions deploy <name> --project-ref vcduwtgbclkwcxquqicl`) or through the Supabase MCP `deploy_edge_function` tool. `stripe-webhook` and `site` must be deployed with `--no-verify-jwt`.
