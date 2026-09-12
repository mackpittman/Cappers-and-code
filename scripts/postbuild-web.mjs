// Runs after `expo export --platform web`. Expo's single-page export does not use app/+html.tsx,
// so the PWA tags are injected here, and 404.html is a copy of index.html so client-side routes
// survive a hard refresh on static hosts such as GitHub Pages.
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2] ?? 'dist');
const index = path.join(dist, 'index.html');
if (!fs.existsSync(index)) throw new Error(`no ${index}; run expo export first`);
let html = fs.readFileSync(index, 'utf8');
const tags = `
    <meta name="description" content="AI Models. Human Insight. One Edge. The daily NFL board for members." />
    <meta name="theme-color" content="#050608" />
    <meta name="color-scheme" content="dark" />
    <link rel="manifest" href="manifest.json" />
    <link rel="apple-touch-icon" href="icons/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Cappers & Code" />
    <style>html,body{background:#050608;color:#F5F7F2}</style>
`;
if (!html.includes('rel="manifest"')) html = html.replace('</head>', `${tags}</head>`);
// Deep links: a static host without SPA rewrites sends /app/<route> to the site's 404 page, which
// bounces here as /app/?p=<route>. Restore the route before the bundle boots (the bundle is deferred).
const restore = `<script>(function(){var p=new URLSearchParams(location.search).get('p');if(p&&p.indexOf('/')===0){history.replaceState(null,'',p)}})();</script>`;
if (!html.includes("get('p')"))
  html = html.replace('<div id="root"></div>', `${restore}<div id="root"></div>`);
// viewport-fit=cover lets the dark shell run under the iPhone notch in standalone mode.
html = html.replace('shrink-to-fit=no"', 'shrink-to-fit=no, viewport-fit=cover"');
fs.writeFileSync(index, html);
// When the app is opened from a different path than the asset host (WEB_APP_URL), the manifest
// must point at that path or "Add to Home Screen" would open the raw storage file.
const appUrl = (process.env.WEB_APP_URL ?? '').replace(/\/+$/, '');
const manifestPath = path.join(dist, 'manifest.json');
if (appUrl && fs.existsSync(manifestPath)) {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const assetBase = (process.env.EXPO_WEB_BASE_URL ?? '').replace(/\/+$/, '');
  m.start_url = `${appUrl}/`;
  m.scope = `${appUrl}/`;
  m.icons = m.icons.map((i) => ({
    ...i,
    src: i.src.startsWith(assetBase) ? i.src : `${assetBase}/${i.src}`,
  }));
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2));
  html = html
    .replace('href="manifest.json"', `href="${assetBase}/manifest.json"`)
    .replace('href="icons/apple-touch-icon.png"', `href="${assetBase}/icons/apple-touch-icon.png"`);
  fs.writeFileSync(index, html);
}
fs.writeFileSync(path.join(dist, '404.html'), html);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
for (const f of [
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
]) {
  if (!fs.existsSync(path.join(dist, f))) throw new Error(`public/${f} was not copied into dist`);
}
const size = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .reduce(
      (n, e) =>
        n +
        (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size),
      0,
    );
console.log(`web build ready: ${dist} (${(size(dist) / 1e6).toFixed(1)} MB)`);
