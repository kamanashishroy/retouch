// The public homepage at fastretouch.com: slide navigation and the marketing pitch.
// IS_EXT is always false here (this file never ships inside the extension); the branches below are
// a leftover safety net from when this page also ran as the extension's own tour.
const IS_EXT = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
const EXT_ID = IS_EXT ? chrome.runtime.id : null;
const REPO_URL = 'https://github.com/kamanashishroy/retouch';
const STORE_URL = 'https://chromewebstore.google.com/detail/retouch-fix-the-html-your/ckcjhaefngkggppffpbhmokbopcaloeh';
if (!IS_EXT) document.body.classList.add('web');
for (const a of document.querySelectorAll('.repo-link')) a.href = REPO_URL;
for (const a of document.querySelectorAll('.releases-link')) a.href = REPO_URL + '/releases/latest';
for (const a of document.querySelectorAll('.store-link')) a.href = STORE_URL;
const slides = [...document.querySelectorAll('.slide')];
const deck = document.querySelector('.deck');
const dots = document.querySelector('.dots');

slides.forEach((s, i) => {
  const a = document.createElement('a');
  a.href = '#' + s.id;
  a.dataset.title = s.dataset.title;
  a.setAttribute('aria-label', s.dataset.title);
  dots.appendChild(a);
});
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    // A slide counts as current when most of it is on screen, or when it fills most of the screen
    // (a slide taller than two viewports, like the compare table on a phone, never reaches half of itself).
    if (e.intersectionRatio > .5 || (e.rootBounds && e.intersectionRect.height > e.rootBounds.height * .5)) {
      e.target.classList.add('in');
      const i = slides.indexOf(e.target);
      [...dots.children].forEach((d, j) => d.classList.toggle('on', i === j));
      history.replaceState(null, '', '#' + e.target.id);
    }
  }
}, { root: deck, threshold: Array.from({ length: 21 }, (_, i) => i / 20) });
slides.forEach((s) => io.observe(s));

function go(delta) {
  const cur = slides.findIndex((s) => s.classList.contains('in') && [...dots.children][slides.indexOf(s)].classList.contains('on'));
  const next = Math.max(0, Math.min(slides.length - 1, (cur === -1 ? 0 : cur) + delta));
  slides[next].scrollIntoView({ behavior: 'smooth' });
}
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(1); }
  if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
});

// Setup state
const accessState = document.getElementById('access-state');
function checkAccess() {
  if (!IS_EXT) return;
  chrome.extension.isAllowedFileSchemeAccess((ok) => {
    accessState.textContent = ok ? 'On. Retouch can see your files.' : 'Off. Switch it on, then restart Chrome.';
    accessState.className = 'state ' + (ok ? 'ok' : 'warn');
    document.getElementById('step-access').classList.toggle('done', ok);
    document.getElementById('step-restart').classList.toggle('done', ok);
  });
}
checkAccess();
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkAccess(); });
document.getElementById('open-details').addEventListener('click', () => {
  if (IS_EXT) chrome.tabs.create({ url: `chrome://extensions/?id=${EXT_ID}` });
});

// Practice page: written into Downloads/Retouch through the downloads API (permission asked on click),
// then opened in the editor. The download gives us the absolute path, which a folder handle never would.
const practiceState = document.getElementById('practice-state');
async function makePractice() {
  if (!IS_EXT) { window.open(STORE_URL, '_blank'); return; }
  practiceState.textContent = '';
  practiceState.className = 'state';
  const allowed = await new Promise((r) => chrome.extension.isAllowedFileSchemeAccess(r));
  if (!allowed) {
    practiceState.textContent = 'Do steps 1 and 2 first: Retouch cannot open local files yet.';
    practiceState.className = 'state warn';
    document.getElementById('setup').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const granted = await chrome.permissions.request({ permissions: ['downloads'] });
  if (!granted) {
    practiceState.textContent = 'Without that permission Retouch cannot place the file. You can still open any HTML file of your own.';
    practiceState.className = 'state warn';
    return;
  }
  try {
    // Download the bundled file by its own URL rather than a blob: if Chrome or another extension
    // drops our filename suggestion, the fallback name is still "practice.html", not a random id.
    const url = chrome.runtime.getURL('practice.html');
    const wanted = { filename: 'Retouch/retouch-practice.html', conflictAction: 'uniquify' };
    // Belt and braces: restate the name when Chrome asks listeners where the file should go.
    const ours = new Set([url]);
    const onName = (item, suggest) => { if (ours.has(item.url)) suggest(wanted); };
    chrome.downloads.onDeterminingFilename.addListener(onName);
    let id;
    try {
      id = await chrome.downloads.download(Object.assign({ url, saveAs: false }, wanted));
    } catch (e) {
      // Some Chrome builds refuse to download an extension's own URL; fall back to a blob copy.
      const html = await (await fetch(url)).text();
      const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      ours.add(blobUrl);
      id = await chrome.downloads.download(Object.assign({ url: blobUrl, saveAs: false }, wanted));
    }
    const item = await new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = async () => {
        const [d] = await chrome.downloads.search({ id });
        if (d && d.state === 'complete' && d.filename) return resolve(d);
        if (d && d.state === 'interrupted') return reject(new Error('The download was interrupted.'));
        if (Date.now() - started > 15000) return reject(new Error('Chrome did not finish writing the file.'));
        setTimeout(poll, 150);
      };
      poll();
    });
    chrome.downloads.onDeterminingFilename.removeListener(onName);
    const fileUrl = 'file://' + item.filename.split('/').map(encodeURIComponent).join('/').replace(/^\/?/, '/');
    const inDownloads = /\/Downloads\/Retouch\//.test(item.filename);
    practiceState.textContent = inDownloads
      ? `Saved to ${item.filename.replace(/^.*\/Downloads\//, 'Downloads/')}. Opening…`
      : `Chrome asked where to save, so the practice page is at ${item.filename}. Opening… (To skip that dialog next time, turn off “Ask where to save each file” in Chrome's download settings.)`;
    practiceState.className = 'state ok';
    document.getElementById('step-practice').classList.add('done');
    await chrome.tabs.create({ url: `${chrome.runtime.getURL('viewer.html')}?src=${encodeURIComponent(fileUrl)}&fresh=1` });
  } catch (e) {
    practiceState.textContent = (e && e.message) || String(e);
    practiceState.className = 'state warn';
  }
}
for (const id of ['make-practice', 'cta-top', 'cta-hero', 'cta-bottom']) document.getElementById(id).addEventListener('click', makePractice);
