// The front door. When file access is on, a dropped folder is granted and located in one motion
// (D31): Chrome's own bubble grants it, and Retouch finds where it lives by reading local file://
// directory listings, proving the match by content. Nothing leaves the machine.
const reason = new URLSearchParams(location.search).get('reason');
const body = document.getElementById('body');
const card = document.querySelector('.card');
const BUDGET = { listings: 2500, ms: 5000 };

const dropZone = `
  <div id="drop" class="drop">
    <div class="drop-title">Drop a folder of pages here</div>
    <div class="drop-sub">Retouch opens them and can save straight back</div>
  </div>
  <div id="result" hidden></div>
  <div id="vaults" hidden></div>`;

const el = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// A file:// directory listing answers with ok:false and status 0, but the body is the listing.
async function fetchText(url) {
  return await (await fetch(url)).text();
}
const pageUrl = (dirUrl, relPath) => dirUrl + relPath.split('/').map(encodeURIComponent).join('/');
const viewerUrl = (fileUrl) => 'viewer.html?src=' + encodeURIComponent(fileUrl);
function rowsHtml(pages, dirUrl) {
  return `<ul class="pages">${pages.map((p) => (dirUrl
    ? `<li><a class="row" href="${esc(viewerUrl(pageUrl(dirUrl, p.relPath)))}">${esc(p.relPath)}</a></li>`
    : `<li><span class="row pending">${esc(p.relPath)}</span></li>`)).join('')}</ul>`;
}
function say(html) {
  const result = el('result');
  result.hidden = false;
  result.innerHTML = html;
}

chrome.extension.isAllowedFileSchemeAccess((allowed) => {
  if (!allowed) {
    body.innerHTML = `
      <h1>Let Retouch see local files</h1>
      <p class="muted">Chrome keeps files on your disk hidden from extensions until you allow it. This takes a minute and you only do it once.</p>
      <ol>
        <li>Open <code>chrome://extensions</code> and click <b>Details</b> on Retouch.</li>
        <li>Switch on <b>Allow access to file URLs</b>.</li>
        <li><b>Quit and reopen Chrome.</b> Chrome applies this setting only after a restart.</li>
        <li>Open your HTML file and click the Retouch icon.</li>
      </ol>
      <p><a href="welcome.html">Retouch's setup screen walks you through it →</a></p>`;
    return;
  }
  if (reason === 'not-local') {
    body.innerHTML = `
      <h1>This page isn’t a file on your disk</h1>
      <p class="muted">Retouch saves straight back to local files, so it works only on pages whose address starts with <code>file://</code>.</p>
      <p>Open the HTML file from Finder, or use <b>File → Open File…</b> in Chrome, then click the Retouch icon.</p>
      ${dropZone}`;
  } else {
    body.innerHTML = `
      <h1>Ready to edit</h1>
      <p class="ok">File access is on.</p>
      <p class="muted">Open any local HTML file and click the Retouch icon. Click text to change it, then press Save.</p>
      <p><a id="setup-link" href="welcome.html">Open the setup screen for a practice page →</a></p>
      ${dropZone}`;
  }
  wireDrop();
  showVaults();
});

function wireDrop() {
  const zone = el('drop');
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
  card.addEventListener('dragover', () => zone.classList.add('over'));
  card.addEventListener('dragleave', (e) => { if (!card.contains(e.relatedTarget)) zone.classList.remove('over'); });
  card.addEventListener('drop', onDrop);
}

async function onDrop(e) {
  e.preventDefault();
  el('drop').classList.remove('over');
  const item = Array.from(e.dataTransfer ? e.dataTransfer.items : []).find((i) => i.getAsFileSystemHandle);
  if (!item) { say('<p>Retouch could not read what you dropped. Drop a folder or an .html file from Finder.</p>'); return; }
  try {
    const handle = await item.getAsFileSystemHandle();
    if (!handle) { say('<p>Retouch could not read what you dropped. Drop a folder or an .html file from Finder.</p>'); return; }
    // Requesting here, inside the drop handler, is what makes Chrome's one-click bubble appear.
    if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
      say(`<p>Chrome kept “${esc(handle.name)}” read-only. Drop it again and choose Save changes when Chrome asks.</p>`);
      return;
    }
    if (handle.kind === 'directory') await takeFolder(handle);
    else if (/\.html?$/i.test(handle.name)) await takeFile(handle);
    else say('<p>Retouch edits HTML pages. Drop a folder or an .html file.</p>');
  } catch (err) {
    say(`<p>${esc(err.message || String(err))} Drop the folder again, or open a page from it and click the Retouch icon.</p>`);
  }
}

async function takeFolder(handle) {
  await RetouchVault.add(handle);
  const pages = await RetouchVault.listHtml(handle);
  say(`<h2>${esc(handle.name)}</h2>
    <p id="where" class="muted">Finding where “${esc(handle.name)}” lives…</p>
    ${rowsHtml(pages, null)}`);
  if (!pages.length) {
    el('where').textContent = `“${handle.name}” holds no HTML pages. Drop the folder that has the pages you want to edit.`;
    return;
  }
  const probe = pages[0];
  const found = await RetouchVault.walk(handle, probe.relPath.split('/'));
  const text = found ? await (await found.fileHandle.getFile()).text() : null;
  const names = [];
  for await (const name of handle.keys()) {
    if (!name.startsWith('.')) names.push(name);
    if (names.length >= 200) break;
  }
  const hit = text === null ? null : await RetouchLocate.findEntry({
    kind: 'directory', name: handle.name, entryNames: names, fetchText, budget: BUDGET,
    verify: async (dirUrl) => { try { return (await fetchText(pageUrl(dirUrl, probe.relPath))) === text; } catch (err) { return false; } },
    roots: await RetouchLocate.homeRoots(fetchText)
  });
  if (!hit) {
    // The handle is stored either way, so opening a page from this folder still resolves by name.
    el('where').textContent = `Retouch can save into “${handle.name}” now, but could not find where it lives on disk. `
      + 'Open any page from it and click the Retouch icon; Retouch connects them from there.';
    return;
  }
  await RetouchVault.add(handle, hit.segments);
  el('where').innerHTML = `<span class="path">/${esc(hit.segments.join('/'))}</span>`;
  el('result').querySelector('.pages').outerHTML = rowsHtml(pages, hit.url);
  showVaults();
}

async function takeFile(handle) {
  say(`<h2>${esc(handle.name)}</h2><p id="where" class="muted">Finding where “${esc(handle.name)}” lives…</p>`);
  const text = await (await handle.getFile()).text();
  const hit = await RetouchLocate.findEntry({
    kind: 'file', name: handle.name, fetchText, budget: BUDGET,
    verify: async (url) => { try { return (await fetchText(url)) === text; } catch (err) { return false; } },
    roots: await RetouchLocate.homeRoots(fetchText)
  });
  if (!hit) {
    el('where').textContent = `Retouch could not find where “${handle.name}” lives on disk. `
      + 'Open it in Chrome from Finder, then click the Retouch icon.';
    return;
  }
  location.href = viewerUrl(hit.url);
}

async function showVaults() {
  const box = el('vaults');
  if (!box) return;
  const vaults = (await RetouchVault.list()).filter((v) => v.prefix && v.prefix.length);
  box.hidden = !vaults.length;
  if (!vaults.length) { box.innerHTML = ''; return; }
  box.innerHTML = '<h2>Your folders</h2>' + vaults.map((v, i) => `
    <div class="folder">
      <button class="row folder-open" data-i="${i}">
        <span class="info">${esc(v.handle.name)}<span class="path">/${esc(v.prefix.join('/'))}</span></span>
        <span class="chevron">›</span>
      </button>
      <div class="folder-pages" data-pages="${i}" hidden></div>
    </div>`).join('');
  box.querySelectorAll('.folder-open').forEach((btn) => {
    const target = box.querySelector(`[data-pages="${btn.dataset.i}"]`);
    btn.addEventListener('click', () => openVault(vaults[Number(btn.dataset.i)], target));
  });
}

async function openVault(v, target) {
  const btn = target.previousElementSibling;
  if (!target.hidden) {
    target.hidden = true;
    if (btn) btn.classList.remove('open');
    return;
  }
  target.hidden = false;
  if (btn) btn.classList.add('open');
  target.innerHTML = '<p class="muted">Opening…</p>';
  // The click is the gesture Chrome wants, so a stored handle can be re-granted right here.
  if ((await RetouchVault.ensurePermission(v.handle)) !== 'granted') {
    target.innerHTML = `<p class="muted">Chrome has not given Retouch access to “${esc(v.handle.name)}” yet. Click the folder again and choose Edit files.</p>`;
    return;
  }
  const pages = await RetouchVault.listHtml(v.handle);
  const dirUrl = 'file:///' + v.prefix.map(encodeURIComponent).join('/') + '/';
  target.innerHTML = pages.length ? rowsHtml(pages, dirUrl) : '<p class="muted">No HTML pages in this folder.</p>';
}
