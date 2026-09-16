// The Retouch viewer: a toolbar above the user's local page, which renders in an iframe with its
// real file:// origin so its own CSS, images and scripts load. The content script inside the frame
// handles editing; this file handles the toolbar, the vault lookup and the save.
const params = new URLSearchParams(location.search);
const src = params.get('src') || '';
const $ = (id) => document.getElementById(id);
const els = { frame: $('frame'), filename: $('filename'), status: $('status'), choose: $('choose'), details: $('details'), count: $('count'),
  edit: $('edit'), discard: $('discard'), save: $('save'), exit: $('exit'), error: $('error'),
  banner: $('banner'), bannerText: $('banner-text'), dismiss: $('dismiss') };

const state = { editing: false, count: 0, structural: 0, ready: false, saving: false, lastKnownSource: null, pendingCollect: null, log: [], pendingImages: new Map() };
const decodedPath = (() => { try { return decodeURIComponent(new URL(src).pathname); } catch (e) { return ''; } })();
const fileName = decodedPath.split('/').pop();
const dirPath = decodedPath.slice(0, decodedPath.lastIndexOf('/')) || '/';
const dirName = dirPath.split('/').pop() || dirPath;

// The subtitle shows the file name. A short confirmation ("Saved at 19:52") replaces it for a few
// seconds. Anything that needs the user's attention goes in the banner, with its actions inline.
let statusTimer = null;
function setStatus(text, kind) {
  const attention = kind === 'error' || kind === 'need-folder';
  clearTimeout(statusTimer);
  state.transient = !attention && !!text;
  if (state.transient) statusTimer = setTimeout(() => { state.transient = false; setStatus(''); render(); }, 3200);
  if (!text) text = fileName;
  if (attention) {
    els.bannerText.textContent = text;
    els.banner.className = 'banner' + (kind === 'error' ? ' error' : '');
    els.banner.hidden = false;
    els.choose.hidden = kind !== 'need-folder';
    els.details.hidden = false;
    els.status.textContent = fileName;
    els.status.className = 'sub';
  } else {
    els.banner.hidden = true;
    if (els.status.textContent !== (text || '')) {
      els.status.textContent = text || '';
      if (els.status.animate) els.status.animate([{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    els.status.className = 'sub' + (kind ? ' ' + kind : '');
  }
  if (text) state.log.push(`${new Date().toISOString()} [${kind || 'info'}] ${text}`);
}
async function diagnostics() {
  const lines = [`Retouch ${chrome.runtime.getManifest().version}`, `file: ${src}`, `folder: ${dirPath}`, `frame ready: ${state.ready}`,
    `source loaded: ${state.lastKnownSource === null ? 'no' : state.lastKnownSource.length + ' chars'}`, `pending: ${state.count} changes, ${state.structural} structural`];
  try {
    const vaults = await RetouchVault.explain(src);
    lines.push(`stored folders: ${vaults.length}`);
    for (const v of vaults) lines.push(`  - “${v.folder}” permission=${v.permission} matchesPath=${v.matchesPath} prefix=${v.rememberedPrefix || 'none'}`);
  } catch (e) { lines.push(`stored folders: error ${e.message}`); }
  lines.push('log:', ...state.log.map((l) => '  ' + l));
  return lines.join('\n');
}
function render() {
  const pending = state.count + state.structural;
  els.edit.textContent = state.editing ? 'Done' : 'Edit';
  els.edit.className = 'btn' + (state.editing ? '' : ' primary');
  els.discard.hidden = !state.editing || pending === 0;
  els.save.hidden = !state.editing;
  els.save.disabled = pending === 0 || state.saving;
  // The number rides on the Save button like an app badge; the words go under the title.
  if (els.count.textContent !== String(pending) && pending > 0 && !els.count.hidden) {
    els.count.style.animation = 'none'; void els.count.offsetWidth; els.count.style.animation = '';
  }
  els.count.hidden = pending === 0;
  els.count.textContent = String(pending);
  els.count.classList.toggle('warn', state.structural > 0);
  els.save.title = state.structural
    ? `${state.count} change${state.count === 1 ? '' : 's'}, ${state.structural} need${state.structural === 1 ? 's' : ''} attention (⌘S)`
    : `Save ${pending} change${pending === 1 ? '' : 's'} (⌘S)`;
  if (!state.transient) {
    const label = state.editing && pending > 0 ? `${pending} change${pending === 1 ? '' : 's'}${state.structural ? ' · one needs attention' : ''}` : fileName;
    if (els.status.textContent !== label) { els.status.textContent = label; els.status.className = 'sub'; }
  }
}
const post = (msg) => els.frame.contentWindow.postMessage(Object.assign({ retouch: true }, msg), '*');

function fail(html) {
  els.frame.hidden = true;
  els.error.hidden = false;
  els.error.innerHTML = html;
}

if (!/^file:\/\//i.test(src)) {
  fail('Retouch only edits local files. Open an HTML file from your disk (its address starts with <code>file://</code>) and click the Retouch icon again.');
} else {
  const name = decodeURIComponent(src.split('/').pop().split('?')[0]);
  els.filename.textContent = name;
  els.filename.title = decodeURIComponent(src);
  els.status.textContent = '';
  document.title = `${name} · Retouch`;

  window.addEventListener('message', (e) => {
    if (e.source !== els.frame.contentWindow) return;
    const m = e.data || {};
    if (!m.retouch) return;
    switch (m.type) {
      case 'ready':
        state.ready = true;
        // The page's own title is the headline; the file name moves to the line beneath.
        if (m.title && m.title.trim()) { els.filename.textContent = m.title.trim(); document.title = `${m.title.trim()} · Retouch`; }
        setStatus('');
        if (state.editing) post({ type: 'edit', on: true });
        else if (params.get('fresh') === '1' && !state.welcomed) { state.welcomed = true; setTimeout(toggleEdit, 400); }
        break;
      case 'changes':
        state.count = m.count; state.structural = m.structural; render();
        break;
      case 'collected':
        if (state.pendingCollect) { state.pendingCollect(m); state.pendingCollect = null; }
        break;
      case 'save-request':
        save();
        break;
      case 'image-picked': {
        // Hold the bytes until Save. Pick a file name now so the page can show it; Save re-checks.
        state.pendingImages.set(m.id, { name: m.name, mime: m.mime, buffer: m.buffer });
        (async () => {
          let name = (m.name || 'image').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
          try {
            const found = await RetouchVault.resolve(src, null);
            if (found) name = await RetouchVault.uniqueName(found.dirHandle, name);
          } catch (e) { /* no folder yet; Save will settle the name */ }
          state.pendingImages.get(m.id).name = name;
          post({ type: 'image-named', id: m.id, name });
        })();
        break;
      }
      case 'fetch-text':
        // The page cannot fetch its own sibling files (file:// origins are opaque); the extension can.
        if (/^file:/i.test(m.url || '')) {
          fetch(m.url, { cache: 'no-store' }).then((r) => r.text())
            .then((text) => post({ type: 'fetch-result', id: m.id, text }))
            .catch(() => post({ type: 'fetch-result', id: m.id, text: null }));
        } else {
          post({ type: 'fetch-result', id: m.id, text: null });
        }
        break;
    }
  });

  els.frame.addEventListener('load', () => {
    post({ type: 'hello' });
    setTimeout(() => {
      if (!state.ready) {
        setStatus('Retouch cannot reach this page. Check that "Allow access to file URLs" is on for Retouch and that Chrome was restarted after switching it on.', 'error');
      }
    }, 1500);
  });
  els.frame.src = src;

  fetch(src, { cache: 'no-store' }).then((r) => r.text()).then((t) => { state.lastKnownSource = t; }).catch(() => {});
}

function collect() {
  return new Promise((resolve, reject) => {
    state.pendingCollect = resolve;
    post({ type: 'collect' });
    setTimeout(() => { if (state.pendingCollect) { state.pendingCollect = null; reject(new Error('The page did not respond. Reload and try again.')); } }, 3000);
  });
}

function toggleEdit() {
  if (state.editing && state.count + state.structural > 0) {
    if (!confirm('Discard your unsaved changes?')) return;
  }
  state.editing = !state.editing;
  post({ type: 'edit', on: state.editing });
  setStatus('');
  render();
}

async function save() {
  if (state.saving || !state.editing) return;
  state.saving = true;
  render();
  setStatus('Saving…');
  try {
    const { changes, structural } = await collect();
    if (structural) throw new Error(`${structural} edited element${structural === 1 ? ' had' : 's had'} no text of ${structural === 1 ? 'its' : 'their'} own in the original file, so Retouch cannot find ${structural === 1 ? 'it' : 'them'} in the source. Discard that edit, or add the text somewhere that already has text.`);
    if (!changes.length) { setStatus('Nothing to save'); return; }

    let found = await RetouchVault.resolve(src, state.lastKnownSource);
    if (!found) found = await RetouchVault.resolve(src, null);
    if (!found) {
      const known = await RetouchVault.explain(src);
      const denied = known.filter((v) => v.matchesPath && v.permission === 'denied');
      const wrong = known.filter((v) => !v.matchesPath);
      if (denied.length) {
        setStatus(`Chrome refused write access to “${denied[0].folder}”. Click Save again and choose “Edit files” when Chrome asks.`, 'need-folder');
      } else if (wrong.length && !known.some((v) => v.matchesPath)) {
        setStatus(`The folder you chose (“${wrong[wrong.length - 1].folder}”) does not contain ${fileName}. This file lives in ${dirPath}. Choose “${dirName}” or any folder above it.`, 'need-folder');
      } else {
        setStatus(`Retouch needs access to the folder that contains ${fileName}. Choose “${dirName}” (${dirPath}) or any folder above it. Retouch remembers it afterwards.`, 'need-folder');
      }
      return;
    }
    const current = await (await found.fileHandle.getFile()).text();
    if (state.lastKnownSource !== null && current !== state.lastKnownSource) {
      throw new Error('The file changed on disk since you opened it. Reload the page to get the new version, then redo your edit.');
    }
    // Replaced images: write the new files next to the page first, settling names against the folder.
    const renames = {};
    for (const c of changes) {
      if (c.kind !== 'attr' || !c.pendingId) continue;
      const img = state.pendingImages.get(c.pendingId);
      if (!img) throw new Error(`The replacement for “${c.before || 'an image'}” is no longer in memory. Choose the image again.`);
      const finalName = await RetouchVault.uniqueName(found.dirHandle, img.name);
      if (finalName !== c.after) {
        for (const other of changes) {
          if (other.afterHtml) other.afterHtml = other.afterHtml.split(`src="${c.after}"`).join(`src="${finalName}"`);
        }
        renames[c.pendingId] = finalName;
        c.after = finalName;
      }
      const fh = await found.dirHandle.getFileHandle(finalName, { create: true });
      const w = await fh.createWritable();
      await w.write(img.buffer);
      await w.close();
    }
    const result = RetouchPatch.apply(current, changes);
    if (!result.ok) throw new Error(result.failures.map(RetouchPatch.describeFailure).join(' '));

    const writable = await found.fileHandle.createWritable();
    await writable.write(result.source);
    await writable.close();
    state.lastKnownSource = result.source;
    for (const c of changes) if (c.pendingId) state.pendingImages.delete(c.pendingId);
    post({ type: 'commit', renames });
    const t = new Date();
    setStatus(`Saved at ${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`, 'ok');
  } catch (e) {
    setStatus(e.message || String(e), 'error');
  } finally {
    state.saving = false;
    render();
  }
}

els.edit.addEventListener('click', toggleEdit);
els.save.addEventListener('click', save);
els.discard.addEventListener('click', () => { post({ type: 'reset' }); state.pendingImages.clear(); setStatus('Changes discarded'); });
els.dismiss.addEventListener('click', () => { els.banner.hidden = true; });
els.exit.addEventListener('click', () => {
  if (state.count + state.structural > 0 && !confirm('Discard your unsaved changes and leave?')) return;
  location.href = src;
});
els.choose.addEventListener('click', async () => {
  try {
    const dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'retouch-vault' });
    if (!RetouchVault.segments(src).slice(0, -1).includes(dir.name)) {
      setStatus(`“${dir.name}” does not contain ${fileName}. This file lives in ${dirPath}. Choose “${dirName}” or any folder above it.`, 'need-folder');
      return;
    }
    await RetouchVault.add(dir);
    setStatus(`Folder “${dir.name}” added`);
    await save();
  } catch (e) {
    if (e && e.name === 'AbortError') els.banner.hidden = false;
    else setStatus(e.message || String(e), 'error');
  }
});
els.details.addEventListener('click', async () => {
  const text = await diagnostics();
  try { await navigator.clipboard.writeText(text); els.details.textContent = 'Copied'; }
  catch (e) { prompt('Copy these details:', text); }
  setTimeout(() => { els.details.textContent = 'Copy Details'; }, 1500);
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
});
window.addEventListener('beforeunload', (e) => {
  if (state.count + state.structural > 0) { e.preventDefault(); e.returnValue = ''; }
});
window.retouchDebug = { collect, state, diagnostics };
render();
