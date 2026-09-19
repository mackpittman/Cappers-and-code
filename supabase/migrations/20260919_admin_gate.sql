-- Who may see the operator controls in the app.
--
-- The Settings screen carries the board source, a GitHub token field, the Odds API key field and
-- the credit balance. None of that belongs in front of a paying member: it is build plumbing, it
-- invites them to paste their own API key into our app, and the credit balance is our operating
-- cost. Until now the screen had no gate at all, so every member saw all of it.
--
-- Admins are listed in pipeline_config rather than hardcoded in the client bundle, for two reasons:
-- a bundled list ships to every browser and reveals who the operators are, and changing it would
-- mean a rebuild and a redeploy. Matching is on the email in auth.users, case-insensitively,
-- because that is the identity a magic-link sign-in actually establishes.

create or replace function public.admin_emails()
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  -- pipeline_config.value is text; a comma-separated list keeps it editable from the SQL editor.
  select coalesce(
    (select array_agg(lower(btrim(e))) from unnest(string_to_array(value, ',')) e
       where btrim(e) <> ''),
    '{}'::text[]
  )
  from public.pipeline_config where key = 'admin_emails';
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and lower(u.email) = any (public.admin_emails())
  );
$$;

-- admin_emails() is deliberately NOT granted: the list of operators is not a thing the client
-- needs, only the yes/no answer about itself.
revoke all on function public.admin_emails() from anon, authenticated;
grant execute on function public.is_admin() to authenticated;
