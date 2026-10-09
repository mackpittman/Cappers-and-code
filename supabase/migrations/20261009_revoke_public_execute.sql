-- Two earlier security-definer functions were revoked from anon and authenticated but not from
-- PUBLIC, which Postgres grants EXECUTE on every new function; anon inherits it. Both return
-- member data (discord_access_targets lists every entitled member's Discord id, admin_emails the
-- operators). Close the gap and make the service-role grant explicit.
revoke all on function public.discord_access_targets() from public, anon, authenticated;
grant execute on function public.discord_access_targets() to service_role;
revoke all on function public.admin_emails() from public, anon, authenticated;
grant execute on function public.admin_emails() to service_role;
