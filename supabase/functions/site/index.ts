// The public site and the web app are static files on GitHub Pages (see scripts/build-site.mjs and
// .github/workflows/deploy-web.yml). Supabase rewrites HTML responses to text/plain on the default
// domain, so this function only forwards old links to the live site. `site_url` in pipeline_config
// is the public base and moves to the custom domain later.
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const FALLBACK = 'https://mackpittman.github.io/Cappers-and-code';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const idx = url.pathname.indexOf('/site');
  const path = idx >= 0 ? url.pathname.slice(idx + 5) : url.pathname;
  if (path === '/health')
    return new Response(JSON.stringify({ ok: true, ts: new Date().toISOString() }), {
      headers: { 'Content-Type': 'application/json' },
    });
  const { data } = await admin
    .from('pipeline_config')
    .select('value')
    .eq('key', 'site_url')
    .maybeSingle();
  const base = (data?.value ?? FALLBACK).replace(/\/+$/, '');
  return Response.redirect(`${base}${path}${url.search}`, 302);
});
