-- grant_manual_access(user_email, days) is SECURITY DEFINER, does no secret or admin check, and
-- inserts an active 'manual' subscription for any profile email. PUBLIC, anon and authenticated
-- could execute it, so anyone holding the public anon key that ships in app.json could comp
-- themselves through /rest/v1/rpc/grant_manual_access. Admin comps go through the admin-users edge
-- function with the service role (docs/ADMIN_ACCOUNTS.md) and the SQL editor runs as postgres, so
-- nothing user-facing calls this. Close it to service_role.
revoke all on function public.grant_manual_access(text, integer) from public, anon, authenticated;
grant execute on function public.grant_manual_access(text, integer) to service_role;
