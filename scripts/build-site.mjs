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
<meta name="description" content="Retouch fixes the HTML your AI wrote. Open the file, click the text, save. Nothing leaves your machine.">
<meta name="theme-color" content="#0b0b0d">
<meta property="og:title" content="Retouch · fix the HTML your AI wrote">
<meta property="og:description" content="Edit AI-made HTML pages in place, in seconds. Open source, local only.">
<meta property="og:url" content="https://fastretouch.com/">
<meta property="og:image" content="https://fastretouch.com/icons/128.png">
<link rel="icon" href="icons/32.png" type="image/png">
<link rel="canonical" href="https://fastretouch.com/">`;
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
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('site built:', fs.readdirSync(out).join(', '));
