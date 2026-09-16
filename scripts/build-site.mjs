// Builds the public site for fastretouch.com from the extension's own tour. One source, two homes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'extension');
const out = path.join(root, 'site');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

let html = fs.readFileSync(path.join(ext, 'welcome.html'), 'utf8');
const meta = `
<meta name="description" content="Retouch is a free, open-source Chrome extension that fixes the HTML your AI wrote. Open the file, click the text, save. Nothing leaves your machine.">
<meta name="theme-color" content="#0b0b0d">
<meta name="robots" content="index,follow">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Retouch">
<meta property="og:title" content="Retouch · fix the HTML your AI wrote">
<meta property="og:description" content="A Chrome extension that edits AI-made HTML pages in place, in seconds. Free, open source, local only.">
<meta property="og:url" content="https://fastretouch.com/">
<meta property="og:image" content="https://fastretouch.com/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Fix the HTML your AI wrote. Retouch, a Chrome extension.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@doubts">
<meta name="twitter:creator" content="@doubts">
<meta name="twitter:title" content="Retouch · fix the HTML your AI wrote">
<meta name="twitter:description" content="A Chrome extension that edits AI-made HTML pages in place, in seconds. Free, open source, local only.">
<meta name="twitter:image" content="https://fastretouch.com/og.png">
<link rel="icon" href="icons/32.png" type="image/png">
<link rel="apple-touch-icon" href="icons/128.png">
<link rel="canonical" href="https://fastretouch.com/">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Retouch","applicationCategory":"BrowserApplication","operatingSystem":"Chrome, Edge, Brave, Arc","url":"https://fastretouch.com/","downloadUrl":"https://github.com/kamanashishroy/retouch/releases/latest","softwareVersion":"0.2.0","license":"https://opensource.org/licenses/MIT","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},"author":{"@type":"Person","name":"Kamanashish Roy","url":"https://fastretouch.com/about.html"},"description":"A Chrome extension that fixes the HTML your AI wrote: click the text, change it, save the file in place."}
</script>`;
html = html.replace('<title>Retouch</title>', '<title>Retouch · fix the HTML your AI wrote</title>' + meta);
fs.writeFileSync(path.join(out, 'index.html'), html);
for (const f of ['welcome.css', 'welcome.js', 'practice.html']) fs.copyFileSync(path.join(ext, f), path.join(out, f));
for (const dir of ['icons', 'fonts']) {
  fs.mkdirSync(path.join(out, dir), { recursive: true });
  for (const f of fs.readdirSync(path.join(ext, dir))) fs.copyFileSync(path.join(ext, dir, f), path.join(out, dir, f));
}
// Extra site-only pages (about, etc.) live in site-src/ and ship as they are.
const extra = path.join(root, 'site-src');
if (fs.existsSync(extra)) for (const f of fs.readdirSync(extra)) fs.copyFileSync(path.join(extra, f), path.join(out, f));
fs.writeFileSync(path.join(out, 'CNAME'), 'fastretouch.com\n');
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://fastretouch.com/sitemap.xml\n');
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://fastretouch.com/</loc><lastmod>${today}</lastmod></url>\n  <url><loc>https://fastretouch.com/about.html</loc><lastmod>${today}</lastmod></url>\n  <url><loc>https://fastretouch.com/privacy.html</loc><lastmod>${today}</lastmod></url>\n</urlset>\n`);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('site built:', fs.readdirSync(out).join(', '));
