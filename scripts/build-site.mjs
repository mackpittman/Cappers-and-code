// Renders the public site (landing, /success, /legal/*) to static HTML in dist/, next to the web
// app that `expo export` puts in dist/app. Links are absolute to SITE_BASE_PATH (e.g. /Cappers-and-code
// on GitHub Pages, empty on a custom domain).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  page,
  landing,
  success,
  legalPage,
  esc,
  TERMS,
  PRIVACY,
  REFUNDS,
  RG,
} from '../site/pages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(process.argv[2] ?? 'dist');
const base = (process.env.SITE_BASE_PATH ?? '').replace(/\/+$/, '');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'site/site.config.json'), 'utf8'));
if (!process.env.SUPABASE_ANON_KEY) {
  // The anon key is public (it is in app.json too); read it from there when not in the env.
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  process.env.SUPABASE_ANON_KEY = app.expo.extra.supabaseAnonKey;
  process.env.SUPABASE_URL ??= app.expo.extra.supabaseUrl;
}
const [p, l, s, lp] = [page, landing, success, legalPage];

const absolutize = (html) => html.replaceAll('href="./', `href="${base}/`);
const write = (rel, html) => {
  const f = path.join(dist, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, absolutize(html));
};
const support = cfg.supportEmail;
write('index.html', l(cfg.founderSeasonEnd, cfg.discordInviteUrl));
write(
  'success/index.html',
  s(cfg.discordInviteUrl).replace('<span id="support"></span>', esc(support)),
);
write('legal/terms/index.html', lp('Terms of Service', TERMS, support));
write('legal/privacy/index.html', lp('Privacy Policy', PRIVACY, support));
write('legal/refunds/index.html', lp('Refund Policy', REFUNDS, support));
write('legal/responsible-gambling/index.html', lp('Responsible Gambling', RG, support));
// GitHub Pages serves only this 404 page for unknown paths. App routes (/app/<route>) bounce to the
// app shell with the route in ?p= so client-side routing takes over (see scripts/postbuild-web.mjs).
const bounce = `<script>(function(){var b=${JSON.stringify(base + '/app/')};if(location.pathname.indexOf(b)===0){location.replace(b+'?p='+encodeURIComponent(location.pathname+location.search))}})();</script>`;
const notFound = p(
  'Not found — Cappers & Code',
  '<div class="hero"><h1>404</h1><p class="lead">That page is not on the board. <a href="./">Back to the site</a>.</p></div>',
);
write('404.html', notFound.replace('<body>', `<body>${bounce}`));
// Play-sheet graphics (site/sheets/*.png) are published as-is so Discord embeds can link to them.
const sheets = path.join(root, 'site/sheets');
if (fs.existsSync(sheets))
  for (const f of fs.readdirSync(sheets))
    if (f.endsWith('.png') || f.endsWith('.json')) {
      fs.mkdirSync(path.join(dist, 'sheets'), { recursive: true });
      fs.copyFileSync(path.join(sheets, f), path.join(dist, 'sheets', f));
    }
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
console.log(`site rendered to ${dist} with base "${base || '/'}"`);
