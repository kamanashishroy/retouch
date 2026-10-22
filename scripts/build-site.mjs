// Builds the public site for fastretouch.com from site-src/homepage.html, the marketing pitch.
// The extension's own extension/welcome.html (post-install setup) is a separate page and never ships here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Replacement table for extension files shipped to site/editor/.
// If an expected string is not found, the build fails immediately.
export const REPLACEMENTS = {
  'content.js': [
    {
      target: "'chrome-extension://' + chrome.runtime.id",
      replacement: "location.origin"
    },
    {
      target: "chrome.runtime.getURL('fonts/Urbanist.woff2')",
      replacement: "location.origin + '/fonts/Urbanist.woff2'"
    }
  ],
  'viewer.js': [
    {
      // In the demo, closing Retouch would load the raw draft into the window (and first offer to throw the
      // visitor's fixes away). Nothing to leave to here: the world answers instead.
      target: "  if (state.count + state.structural > 0 && !confirm('Discard your unsaved changes and leave?')) return;\n  location.href = src;",
      replacement: "  window.dispatchEvent(new CustomEvent('retouch-demo-exit'));"
    },
    {
      target: "Retouch ${chrome.runtime.getManifest().version}",
      replacement: "Retouch ${typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().version : 'site'}"
    },
    {
      target: "const src = params.get('src') || '';",
      replacement: "const src = params.get('src') || (location.origin + '/draft.html?embed=1');"
    },
    {
      target: "if (!/^file:\\/\\//i.test(src)) {",
      replacement: "if (!/^file:\\/\\//i.test(src) && !/embed=1/.test(src)) {"
    },
    {
      // The review / share card is for people who installed Retouch, not for visitors trying the demo.
      target: "    countSaveForShare();\n",
      replacement: ""
    },
    {
      target: "post({ type: 'commit', renames });",
      replacement: "post({ type: 'commit', renames }); els.frame.src = src;"
    },
    {
      target: "if (/^file:/i.test(m.url || '')) {",
      replacement: "if (/^file:/i.test(m.url || '') || (m.url && m.url.startsWith(location.origin))) {"
    },
    {
      target: `  els.frame.addEventListener('load', () => {
    post({ type: 'hello' });
    setTimeout(() => {
      if (!state.ready) {
        setStatus('Retouch cannot reach this page. Check that "Allow access to file URLs" is on for Retouch and that Chrome was restarted after switching it on.', 'error');
      }
    }, 1500);
  });
  els.frame.src = src;`,
      replacement: `  function showDemoError() {
    if (!state.ready) {
      if (els.frame) els.frame.style.display = 'none';
      if (els.banner) els.banner.hidden = true;
      let panel = document.getElementById('demo-error-panel');
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'demo-error-panel';
        panel.className = 'demo-error-panel';
        panel.innerHTML = '<img class="demo-error-mark" src="icons/icon.svg" alt="" width="48" height="48">' +
          '<h2 class="demo-error-title">The demo didn\\'t load.</h2>' +
          '<p class="demo-error-msg">Reload the page to try again.</p>' +
          '<button id="demo-reload-btn" class="btn primary">Reload</button>';
        const rBtn = panel.querySelector('#demo-reload-btn');
        rBtn.onclick = () => { try { sessionStorage.removeItem('retouch_demo_healed'); } catch(e){} location.reload(); };
        const win = document.querySelector('.window');
        if (win) win.appendChild(panel);
        else document.body.appendChild(panel);
      }
      panel.hidden = false;
    }
  }
  let failTimeout = setTimeout(showDemoError, 6000);
  els.frame.addEventListener('load', () => {
    post({ type: 'hello' });
  });
  els.frame.src = src;`
    }
  ]
};

export const FAQS = [
  {
    q: "Does Retouch upload my file?",
    a: "No. It works entirely on your computer. There's no account and no server."
  },
  {
    q: "Does it work on websites?",
    a: "It edits HTML files saved on your computer, the ones that open with a file:// address. It doesn't change live websites."
  },
  {
    q: "Will it mess up my HTML?",
    a: "No. It rewrites only the text you changed, byte for byte. Comments, spacing and scripts stay exactly as they were."
  },
  {
    q: "Can it change the layout?",
    a: "Not by itself. Use Prompt mode to point at what should move, and hand that to your AI."
  },
  {
    q: "Which AI tools does it work with?",
    a: "Any of them. If it gave you an HTML file (ChatGPT, Claude, Gemini, Copilot, v0, Lovable, Bolt), Retouch can edit it."
  },
  {
    q: "Which browsers?",
    a: "Chrome, and browsers built on it, like Edge, Brave and Arc."
  },
  {
    q: "Is it free?",
    a: "Yes. Free and open source."
  }
];

function applyReplacements(filename, content) {
  const rules = REPLACEMENTS[filename];
  if (!rules) return content;
  let result = content;
  for (const rule of rules) {
    if (!result.includes(rule.target)) {
      throw new Error(`Build failed: replacement target not found in ${filename}:\n  ${rule.target}`);
    }
    result = result.replace(rule.target, rule.replacement);
  }
  return result;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'extension');
const siteSrc = path.join(root, 'site-src');
const out = path.join(root, 'site');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// Read extension manifest version
const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
const softwareVersion = manifest.version || '0.3.0';

// Structured data
const appSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Retouch",
  "applicationCategory": "BrowserApplication",
  "operatingSystem": "Chrome, Edge, Brave, Arc",
  "url": "https://fastretouch.com/",
  "installUrl": "https://chromewebstore.google.com/detail/retouch-fix-the-html-your/ckcjhaefngkggppffpbhmokbopcaloeh",
  "downloadUrl": "https://github.com/kamanashishroy/retouch/releases/latest",
  "softwareVersion": softwareVersion,
  "license": "https://opensource.org/licenses/MIT",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
  "author": { "@type": "Person", "name": "Kamanashish Roy", "url": "https://fastretouch.com/about.html" },
  "description": "A Chrome extension that fixes the HTML your AI wrote: click the text, change it, save the file in place."
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": FAQS.map(item => ({
    "@type": "Question",
    "name": item.q,
    "acceptedAnswer": {
      "@type": "Answer",
      "text": item.a
    }
  }))
};

let html = fs.readFileSync(path.join(siteSrc, 'homepage.html'), 'utf8');
const meta = `
<meta name="description" content="Retouch is a free, open-source Chrome extension that fixes the HTML your AI wrote. Open the file, click the text, save. Nothing leaves your machine.">
<meta name="theme-color" content="#f3efe6">
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
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="icon" href="favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="apple-touch-icon.png" sizes="180x180">
<link rel="canonical" href="https://fastretouch.com/">
<link rel="preload" href="fonts/Urbanist.woff2" as="font" type="font/woff2" crossorigin>
<script type="application/ld+json">
${JSON.stringify(appSchema)}
</script>
<script type="application/ld+json">
${JSON.stringify(faqSchema)}
</script>`;
html = html.replace('<title>Retouch</title>', '<title>Retouch · fix the HTML your AI wrote</title>' + meta);

// Build FAQ items into homepage HTML
const faqHtml = FAQS.map(item => `        <details class="faq-item">
          <summary>${item.q}</summary>
          <p>${item.a}</p>
        </details>`).join('\n');
html = html.replace('<!-- FAQ_ITEMS -->', faqHtml);

fs.writeFileSync(path.join(out, 'index.html'), html);

// Build shell.html from site-src/shell.html and extension/viewer.html body
const viewerHtml = fs.readFileSync(path.join(ext, 'viewer.html'), 'utf8');
const bodyMatch = viewerHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
if (!bodyMatch) {
  throw new Error('Build failed: <body> not found in extension/viewer.html');
}
const viewerBody = bodyMatch[1].replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').trim();

let shellHtml = fs.readFileSync(path.join(siteSrc, 'shell.html'), 'utf8');
const MARKER = '<!-- RETOUCH_VIEWER_TEMPLATE -->';
if (!shellHtml.includes(MARKER)) {
  throw new Error(`Build failed: template marker not found in shell.html: ${MARKER}`);
}
shellHtml = shellHtml.replace(MARKER, viewerBody);
fs.writeFileSync(path.join(out, 'shell.html'), shellHtml);

for (const f of ['homepage.css', 'homepage.js']) fs.copyFileSync(path.join(siteSrc, f), path.join(out, f));
fs.copyFileSync(path.join(ext, 'practice.html'), path.join(out, 'practice.html'));
for (const dir of ['icons', 'fonts']) {
  fs.mkdirSync(path.join(out, dir), { recursive: true });
  for (const f of fs.readdirSync(path.join(ext, dir))) fs.copyFileSync(path.join(ext, dir, f), path.join(out, dir, f));
}

// Copy editor files into site/editor/
const editorOut = path.join(out, 'editor');
fs.mkdirSync(editorOut, { recursive: true });
const editorFiles = [
  'viewer.css',
  'viewer.js',
  'idb.js',
  'history.js',
  'describe.js',
  'patch.js',
  'prompt.js',
  'content.js',
  'early.js'
];
for (const f of editorFiles) {
  let content = fs.readFileSync(path.join(ext, f), 'utf8');
  content = applyReplacements(f, content);
  fs.writeFileSync(path.join(editorOut, f), content);
}
fs.copyFileSync(path.join(siteSrc, 'editor', 'demo-vault.js'), path.join(editorOut, 'demo-vault.js'));
for (const dir of ['icons', 'fonts']) {
  fs.mkdirSync(path.join(editorOut, dir), { recursive: true });
  for (const f of fs.readdirSync(path.join(ext, dir))) fs.copyFileSync(path.join(ext, dir, f), path.join(editorOut, dir, f));
}

// Overwrite icon.svg with bird mark on paper tile in site/icons and site/editor/icons
const birdIconSvg = fs.readFileSync(path.join(siteSrc, 'brand', 'icon.svg'), 'utf8');
fs.writeFileSync(path.join(out, 'icons', 'icon.svg'), birdIconSvg);
fs.writeFileSync(path.join(editorOut, 'icons', 'icon.svg'), birdIconSvg);

// Overwrite PNG icon sizes if present in site-src/icons
const siteSrcIcons = path.join(siteSrc, 'icons');
if (fs.existsSync(siteSrcIcons)) {
  for (const f of fs.readdirSync(siteSrcIcons)) {
    if (f.endsWith('.png')) {
      fs.copyFileSync(path.join(siteSrcIcons, f), path.join(out, 'icons', f));
      fs.copyFileSync(path.join(siteSrcIcons, f), path.join(editorOut, 'icons', f));
    }
  }
}

// Extra site-only pages (about, privacy, brand, draft, etc.) live in site-src/ and ship as they are.
const skip = new Set(['homepage.html', 'homepage.css', 'homepage.js', 'shell.html', 'editor', 'sw.js']);
for (const f of fs.readdirSync(siteSrc)) { if (!skip.has(f)) fs.cpSync(path.join(siteSrc, f), path.join(out, f), { recursive: true }); }

// Build versioned sw.js
let sw = fs.readFileSync(path.join(siteSrc, 'sw.js'), 'utf8');
const today = new Date().toISOString().slice(0, 10);
const swVersion = `${softwareVersion}-${today.replace(/-/g, '')}`;
sw = sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${swVersion}';`);
fs.writeFileSync(path.join(out, 'sw.js'), sw);
fs.writeFileSync(path.join(out, 'CNAME'), 'fastretouch.com\n');
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://fastretouch.com/sitemap.xml\n');
fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://fastretouch.com/</loc><lastmod>${today}</lastmod></url>\n  <url><loc>https://fastretouch.com/about.html</loc><lastmod>${today}</lastmod></url>\n  <url><loc>https://fastretouch.com/privacy.html</loc><lastmod>${today}</lastmod></url>\n</urlset>\n`);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('site built:', fs.readdirSync(out).join(', '));
