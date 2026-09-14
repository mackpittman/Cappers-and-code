# Pipeline alerts

The check runs **inside the database** on `pg_cron`, not on the runner. A runner that has died is
exactly the thing that never reports its own failure, so an alert that depends on it is worthless.

Job `ops-health-hourly` fires at seven past every hour and calls the `ops-health` edge function,
reading the publish secret inside the query so it never appears in a command line.

## What it watches

| Check            | Default                | Source                           |
| ---------------- | ---------------------- | -------------------------------- |
| Board staleness  | 30 hours since publish | `boards.published_at`            |
| No pipeline run  | 30 hours               | `pipeline_state.last-run-report` |
| Odds API credits | under 60               | the board's own credit ledger    |
| Script errors    | any                    | the runner's own report text     |
| Repo push failed | any                    | the runner's own report text     |
| Publish failed   | any non-200            | the runner's own report text     |

Thresholds live in `pipeline_config.ops_thresholds` as JSON, so tuning needs no deploy:
`{"boardStaleHours":30,"creditsFloor":60,"runStaleHours":30,"repeatHours":12}`.

## Where alerts go

A Discord DM to the owner (`pipeline_config.discord_owner_id`). Private, immediate, and it needs
no new channel and no extra bot permission.

## Why it does not spam

Findings are fingerprinted. The same standing problem re-sends only after `repeatHours`; a changed
problem sends immediately. The cleared state is recorded too, so a recovery followed by a new fault
reads as a new alert rather than a repeat.

## Checking it by hand

```sql
select net.http_post(
  url := 'https://<project>.supabase.co/functions/v1/ops-health',
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'x-sync-secret',(select value from public.pipeline_config where key='publish_secret')),
  body := jsonb_build_object('dry', true)   -- findings only, sends nothing
);
```

Drop `dry` to send for real. `select * from cron.job` shows the schedule.
