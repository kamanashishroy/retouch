// The tour: slide navigation, live setup state, and the one-click practice page.
// The same file is the website at fastretouch.com; without extension APIs it runs in web mode.
const IS_EXT = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
const EXT_ID = IS_EXT ? chrome.runtime.id : null;
const REPO_URL = 'https://github.com/kamanashishroy/retouch';
if (!IS_EXT) document.body.classList.add('web');
for (const a of document.querySelectorAll('.repo-link')) a.href = REPO_URL;
for (const a of document.querySelectorAll('.releases-link')) a.href = REPO_URL + '/releases/latest';
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
    if (e.intersectionRatio > .5) {
      e.target.classList.add('in');
      const i = slides.indexOf(e.target);
      [...dots.children].forEach((d, j) => d.classList.toggle('on', i === j));
      history.replaceState(null, '', '#' + e.target.id);
    }
  }
}, { root: deck, threshold: [.5] });
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
  if (!IS_EXT) { window.open(REPO_URL + '/releases/latest', '_blank'); return; }
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
    const html = await (await fetch(chrome.runtime.getURL('practice.html'))).text();
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const id = await chrome.downloads.download({ url, filename: 'Retouch/retouch-practice.html', conflictAction: 'uniquify', saveAs: false });
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
    URL.revokeObjectURL(url);
    const fileUrl = 'file://' + item.filename.split('/').map(encodeURIComponent).join('/').replace(/^\/?/, '/');
    practiceState.textContent = `Saved to ${item.filename.replace(/^.*\/Downloads\//, 'Downloads/')}. Opening…`;
    practiceState.className = 'state ok';
    document.getElementById('step-practice').classList.add('done');
    await chrome.tabs.create({ url: `${chrome.runtime.getURL('viewer.html')}?src=${encodeURIComponent(fileUrl)}&fresh=1` });
  } catch (e) {
    practiceState.textContent = (e && e.message) || String(e);
    practiceState.className = 'state warn';
  }
}
for (const id of ['make-practice', 'cta-top', 'cta-bottom']) document.getElementById(id).addEventListener('click', makePractice);
