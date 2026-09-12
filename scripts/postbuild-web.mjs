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
// viewport-fit=cover lets the dark shell run under the iPhone notch in standalone mode.
html = html.replace('shrink-to-fit=no"', 'shrink-to-fit=no, viewport-fit=cover"');
fs.writeFileSync(index, html);
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
