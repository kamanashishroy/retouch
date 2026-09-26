// The Retouch viewer: a toolbar above the user's local page, which renders in an iframe with its
// real file:// origin so its own CSS, images and scripts load. The content script inside the frame
// handles editing; this file handles the toolbar, the vault lookup and the save.
const params = new URLSearchParams(location.search);
const src = params.get('src') || '';
const $ = (id) => document.getElementById(id);
const els = { frame: $('frame'), filename: $('filename'), status: $('status'), choose: $('choose'), details: $('details'), count: $('count'),
  edit: $('edit'), discard: $('discard'), save: $('save'), exit: $('exit'), error: $('error'), colors: $('colors'), theme: $('theme'),
  banner: $('banner'), bannerText: $('banner-text'), dismiss: $('dismiss'),
  prompt: $('prompt'), promptCount: $('prompt-count'), copyPrompt: $('copy-prompt'), copyLabel: $('copy-label'), copyCount: $('copy-count'), promptDone: $('prompt-done'), collectorHead: $('collector-head'),
  promptTools: $('prompt-tools'), toolPointer: $('tool-pointer'), toolBox: $('tool-box'),
  collector: $('collector'), collectorHandle: $('collector-handle'), collectorClose: $('collector-close'), collectorBody: $('collector-body'), collectorList: $('collector-list'),
  collectorStale: $('collector-stale'), staleReload: $('stale-reload'), staleKeep: $('stale-keep'),
  dropzone: $('dropzone'), dropzoneText: $('dropzone-text'), dropmat: $('dropmat') };

const state = { pendingGrant: null,
  editing: false, count: 0, structural: 0, ready: false, saving: false, lastKnownSource: null, pendingCollect: null, log: [],
  pendingImages: new Map(), pendingTheme: null,
  promptMode: false, promptTool: 'pointer', promptItems: [], wholeRequest: '', collectorCollapsed: false, activeItemId: null, wholeTa: null,
  pendingCapture: null, pendingRectResolve: null
};
const decodedPath = (() => { try { return decodeURIComponent(new URL(src).pathname); } catch (e) { return ''; } })();
const fileName = decodedPath.split('/').pop();
const dirPath = decodedPath.slice(0, decodedPath.lastIndexOf('/')) || '/';
const dirName = dirPath.split('/').pop() || dirPath;

// The subtitle shows the file name. A short confirmation ("Saved at 19:52") replaces it for a few
// seconds. Anything that needs the user's attention goes in the banner, with its actions inline.
let statusTimer = null;
// Every status and every step of a save goes into the diagnostics log and, mirrored, to the console.
function logLine(line) {
  state.log.push(line);
  console.info('[retouch]', line);
}
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
    els.choose.textContent = state.pendingGrant ? 'Allow saving' : `Choose “${dirName}”…`;
    els.dropzone.hidden = kind !== 'need-folder';
    els.dropzoneText.textContent = `Drop “${dirName}” here`;
    els.dropmat.hidden = kind !== 'need-folder';
    els.details.hidden = kind !== 'error';
    els.status.textContent = fileName;
    els.status.className = 'sub';
  } else {
    els.banner.hidden = true;
    els.dropmat.hidden = true;
    if (els.status.textContent !== (text || '')) {
      els.status.textContent = text || '';
      if (els.status.animate) els.status.animate([{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    els.status.className = 'sub' + (kind ? ' ' + kind : '');
  }
  if (text) logLine(`${new Date().toISOString()} [${kind || 'info'}] ${text}`);
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
  els.edit.classList.toggle('active', state.editing);
  els.prompt.classList.toggle('active', state.promptMode);
  els.colors.hidden = !state.editing;
  if (!state.editing) closeTheme();
  els.discard.hidden = !state.editing || pending === 0;
  els.save.hidden = !state.editing;
  els.save.disabled = pending === 0 || state.saving;
  els.copyPrompt.hidden = !state.promptMode;
  els.promptDone.hidden = !state.promptMode;
  els.promptTools.hidden = !state.promptMode;
  els.toolPointer.classList.toggle('active', state.promptTool === 'pointer');
  els.toolBox.classList.toggle('active', state.promptTool === 'box');
  renderPromptCount();
  els.collector.hidden = !state.promptMode;
  els.collector.classList.toggle('collapsed', state.collectorCollapsed);
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
      case 'theme':
        if (state.pendingTheme) { state.pendingTheme(m.items || []); state.pendingTheme = null; }
        break;
      case 'collected':
        if (state.pendingCollect) { state.pendingCollect(m); state.pendingCollect = null; }
        break;
      case 'prompt-changed':
        state.promptItems = m.items || [];
        savePromptStore();
        renderPromptCount();
        renderCollector();
        break;
      case 'prompt-region-saved':
        // Only the id is kept — the box is re-measured fresh from content.js right before capture
        // (see requestRegionRect below), since the user may scroll between saving the note and
        // right-clicking to capture it, and a coordinate computed now would go stale.
        state.pendingCapture = { id: m.id };
        break;
      case 'region-rect':
        if (state.pendingRectResolve) { state.pendingRectResolve(m.rect); state.pendingRectResolve = null; }
        break;
      case 'prompt-whole':
        openWholePage();
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
  if (state.promptMode) { state.promptMode = false; post({ type: 'prompt', on: false }); }
  state.editing = !state.editing;
  post({ type: 'edit', on: state.editing });
  setStatus('');
  render();
}

async function togglePrompt() {
  if (state.promptMode) {
    state.promptMode = false;
    post({ type: 'prompt', on: false });
    render();
    return;
  }
  if (state.editing && state.count + state.structural > 0) {
    const n = state.count + state.structural;
    if (!confirm(`Save your ${n} edit${n === 1 ? '' : 's'} first? The prompt should describe the file as it is on disk.`)) return;
    await save();
    if (state.count + state.structural > 0) return;
  }
  if (state.editing) { state.editing = false; post({ type: 'edit', on: false }); }
  state.promptMode = true;
  post({ type: 'prompt', on: true });
  post({ type: 'prompt-restore', items: state.promptItems });
  checkStale();
  render();
}

// ---------- Prompt collector: persistence, rendering, copy (D-prompt-collector) ----------
const promptKey = 'prompt:' + src;
function savePromptStore() { RetouchIDB.set(promptKey, { items: state.promptItems, whole: state.wholeRequest }); }
RetouchIDB.get(promptKey).then((v) => {
  if (v) { state.promptItems = v.items || []; state.wholeRequest = v.whole || ''; }
  renderPromptCount();
  renderCollector();
});

// The count rides the primary action while collecting (like Save's badge in Edit mode) and sits
// inside the Prompt segment when idle, so saved requests are visible before the mode is entered.
function renderPromptCount() {
  const n = state.promptItems.length;
  const whole = (state.wholeRequest || '').trim();
  els.promptCount.hidden = state.promptMode || n === 0;
  els.promptCount.textContent = String(n);
  els.copyCount.hidden = n === 0;
  els.copyCount.textContent = String(n);
  els.copyPrompt.disabled = n === 0 && !whole;
  if (els.collectorHead) els.collectorHead.textContent = n ? `Notes for your AI · ${n}` : 'Notes for your AI';
}
function locationTag(item) {
  if (item.kind === 'region') return 'REGION';
  const WORDS = {
    h1: 'HEADING', h2: 'HEADING', h3: 'HEADING', h4: 'HEADING', h5: 'HEADING', h6: 'HEADING',
    p: 'PARAGRAPH', li: 'LIST ITEM', td: 'TABLE CELL', th: 'TABLE CELL', img: 'IMAGE',
    button: 'BUTTON', a: 'LINK', section: 'SECTION', article: 'SECTION', header: 'SECTION', footer: 'SECTION'
  };
  return WORDS[item.tag] || (item.tag || 'BLOCK').toUpperCase();
}
function locationTitle(item) {
  if (item.kind === 'region') return `${Math.round(item.box.width)}×${Math.round(item.box.height)}px`;
  if (item.tag === 'img') return `“${(item.alt || item.src || 'image').slice(0, 50)}”`;
  const quoted = (item.selected || item.preview || '').slice(0, 50);
  return quoted ? `“${quoted}”` : '';
}
function renderCollector() {
  els.collectorList.textContent = '';
  if (!state.promptItems.length && !state.wholeRequest) {
    const p = document.createElement('div');
    p.className = 'collector-empty';
    p.textContent = 'Click anything on the page to add it to your prompt.';
    els.collectorList.appendChild(p);
  }
  for (const item of state.promptItems) {
    const row = document.createElement('div');
    row.className = 'collector-row' + (item.lost ? ' lost' : '') + (item.id === state.activeItemId ? ' active' : '');
    
    const head = document.createElement('div');
    head.className = 'row-head';

    const info = document.createElement('div');
    info.className = 'row-info';

    const tag = document.createElement('span');
    tag.className = 'row-tag';
    tag.textContent = locationTag(item);
    info.appendChild(tag);

    const title = locationTitle(item);
    if (title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'row-title';
      titleEl.textContent = title;
      info.appendChild(titleEl);
    }
    head.appendChild(info);

    const delBtn = document.createElement('button');
    delBtn.className = 'row-del';
    delBtn.type = 'button';
    delBtn.title = 'Delete this request';
    delBtn.ariaLabel = 'Delete this request';
    delBtn.innerHTML = '<svg viewBox="0 0 12 12" width="13" height="13" aria-hidden="true"><path d="M2.5 3.5h7M4.5 3.5V2a1 1 0 011-1h1a1 1 0 011 1v1.5M3.5 3.5v6.5a1 1 0 001 1h3a1 1 0 001-1v-6.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      post({ type: 'prompt-remove', id: item.id });
    });
    head.appendChild(delBtn);
    row.appendChild(head);

    const reqTa = document.createElement('textarea');
    reqTa.className = 'req-input';
    reqTa.placeholder = 'What should change here?';
    reqTa.value = item.request || '';
    reqTa.addEventListener('click', (e) => e.stopPropagation());
    reqTa.addEventListener('input', () => {
      item.request = reqTa.value;
    });
    const commitEdit = () => {
      const val = reqTa.value.trim();
      post({ type: 'prompt-update', id: item.id, request: val });
    };
    reqTa.addEventListener('blur', commitEdit);
    reqTa.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); reqTa.blur(); }
    });
    row.appendChild(reqTa);

    if (item.lost) {
      const note = document.createElement('span');
      note.className = 'lost-note';
      note.textContent = 'Not on this page any more';
      row.appendChild(note);
    }

    row.addEventListener('mouseenter', () => { if (!item.lost) post({ type: 'prompt-hover', id: item.id }); });
    row.addEventListener('mouseleave', () => { post({ type: 'prompt-hover', id: null }); });

    row.addEventListener('click', (e) => {
      if (item.lost || e.target === reqTa || e.target === delBtn || delBtn.contains(e.target)) return;
      state.activeItemId = item.id;
      renderCollector();
      post({ type: 'prompt-scroll', id: item.id });
    });
    els.collectorList.appendChild(row);
  }

  // Whole page row
  const wholeRow = document.createElement('div');
  wholeRow.className = 'collector-row whole';

  const wholeHead = document.createElement('div');
  wholeHead.className = 'row-head';

  const wholeInfo = document.createElement('div');
  wholeInfo.className = 'row-info';
  const wholeTag = document.createElement('span');
  wholeTag.className = 'row-tag';
  wholeTag.textContent = 'WHOLE PAGE';
  wholeInfo.appendChild(wholeTag);
  wholeHead.appendChild(wholeInfo);

  if (state.wholeRequest) {
    const wholeDel = document.createElement('button');
    wholeDel.className = 'row-del';
    wholeDel.type = 'button';
    wholeDel.title = 'Clear whole page request';
    wholeDel.ariaLabel = 'Clear whole page request';
    wholeDel.innerHTML = '<svg viewBox="0 0 12 12" width="13" height="13" aria-hidden="true"><path d="M2.5 3.5h7M4.5 3.5V2a1 1 0 011-1h1a1 1 0 011 1v1.5M3.5 3.5v6.5a1 1 0 001 1h3a1 1 0 001-1v-6.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
    wholeDel.addEventListener('click', (e) => {
      e.stopPropagation();
      state.wholeRequest = '';
      savePromptStore();
      renderCollector();
      renderPromptCount();
    });
    wholeHead.appendChild(wholeDel);
  }
  wholeRow.appendChild(wholeHead);

  const wholeTa = document.createElement('textarea');
  wholeTa.className = 'req-input';
  wholeTa.placeholder = 'What should change across the whole page?';
  wholeTa.value = state.wholeRequest || '';
  wholeTa.addEventListener('input', () => { state.wholeRequest = wholeTa.value; renderPromptCount(); });
  wholeTa.addEventListener('blur', () => { state.wholeRequest = wholeTa.value.trim(); savePromptStore(); });
  wholeRow.appendChild(wholeTa);
  els.collectorList.appendChild(wholeRow);
  state.wholeTa = wholeTa;
}
function openWholePage() {
  state.collectorCollapsed = false;
  render();
  if (state.wholeTa) { state.wholeTa.scrollIntoView({ block: 'nearest' }); state.wholeTa.focus(); }
}

function hideStale() { els.collectorStale.hidden = true; }
async function checkStale() {
  if (!state.promptItems.length && !state.wholeRequest) { hideStale(); return; }
  try {
    const fresh = await fetch(src, { cache: 'no-store' }).then((r) => r.text());
    els.collectorStale.hidden = state.lastKnownSource === null || fresh === state.lastKnownSource;
  } catch (e) { /* offline or removed; leave the banner as it was */ }
}
els.staleReload.addEventListener('click', async () => {
  try { state.lastKnownSource = await fetch(src, { cache: 'no-store' }).then((r) => r.text()); } catch (e) { /* keep the old copy */ }
  state.promptItems = [];
  state.wholeRequest = '';
  state.activeItemId = null;
  savePromptStore();
  renderPromptCount();
  renderCollector();
  hideStale();
  if (state.promptMode) post({ type: 'prompt-restore', items: [] });
});
els.staleKeep.addEventListener('click', () => {
  hideStale();
  if (state.promptMode) post({ type: 'prompt-restore', items: state.promptItems });
});
window.addEventListener('focus', () => { if (state.promptMode) checkStale(); });

els.collectorHandle.addEventListener('click', () => { state.collectorCollapsed = !state.collectorCollapsed; render(); });
if (els.collectorClose) els.collectorClose.addEventListener('click', () => { state.collectorCollapsed = true; render(); });
els.prompt.addEventListener('click', togglePrompt);
els.promptDone.addEventListener('click', togglePrompt);
els.toolPointer.addEventListener('click', () => {
  if (state.promptTool === 'pointer') return;
  state.promptTool = 'pointer';
  render();
  post({ type: 'prompt-tool', tool: 'pointer' });
});
els.toolBox.addEventListener('click', () => {
  if (state.promptTool === 'box') return;
  state.promptTool = 'box';
  render();
  post({ type: 'prompt-tool', tool: 'box' });
});
els.copyPrompt.addEventListener('click', async () => {
  const text = RetouchPrompt.compile({ src, items: state.promptItems, whole: state.wholeRequest, source: state.lastKnownSource });
  try {
    await navigator.clipboard.writeText(text);
    els.copyLabel.textContent = 'Copied! Paste it into ChatGPT, Claude, or your AI editor.';
    setTimeout(() => { els.copyLabel.textContent = 'Copy instructions for AI'; }, 2000);
  } catch (e) {
    let wrap = document.getElementById('collector-copy-fallback');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'collector-copy-fallback';
      const msg = document.createElement('div');
      msg.className = 'collector-empty';
      msg.textContent = 'Copy did not work here. Select the text below and copy it.';
      const ta = document.createElement('textarea');
      ta.className = 'collector-copy-text';
      ta.readOnly = true;
      wrap.append(msg, ta);
      els.collectorBody.prepend(wrap);
    }
    wrap.querySelector('textarea').value = text;
  }
});

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
    logLine(`${new Date().toISOString()} [save] ${changes.length} change(s); folder ${found ? `“${found.vault.handle.name}” (${found.relPath})` : 'not resolved'}`);
    if (!found) {
      const known = await RetouchVault.explain(src);
      const denied = known.filter((v) => v.matchesPath && v.permission === 'denied');
      const wrong = known.filter((v) => !v.matchesPath);
      if (denied.length) {
        setStatus(`Chrome refused write access to “${denied[0].folder}”. Click Save again and choose “Edit files” when Chrome asks.`, 'need-folder');
      } else if (wrong.length && !known.some((v) => v.matchesPath)) {
        setStatus(`This file lives in ${dirPath}, which Retouch cannot write to yet. Choose “${dirName}” or a folder above it; Retouch remembers it.`, 'need-folder');
      } else {
        setStatus(`To save, Retouch needs access to this file's folder, ${dirPath}. Choose “${dirName}” or a folder above it; Retouch remembers it.`, 'need-folder');
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


// ---------- Colors panel: the page's own CSS variables (D29) ----------
// Phase 1 edits custom properties the page declares in its own <style> blocks. Properties from a
// linked stylesheet are listed so the user can see them, but greyed: the patcher only rewrites the
// HTML file. The value is picked with the browser's own colour input, because the property already
// exists and only its value moves.
function requestTheme() {
  return new Promise((resolve) => {
    state.pendingTheme = resolve;
    post({ type: 'theme' });
    setTimeout(() => { if (state.pendingTheme) { state.pendingTheme([]); state.pendingTheme = null; } }, 3000);
  });
}

// describe.js reads rgb() only, and the page writes colors however it likes, so every value goes
// through a scratch element first to get the browser's own rgb() spelling.
const probe = document.createElement('span');
const toRgb = (value) => { probe.style.color = ''; probe.style.color = value; return probe.style.color || ''; };
const hexOf = (value) => {
  const c = RetouchDescribe.parseColor(toRgb(value));
  if (!c) return '#000000';
  const two = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + two(c.r) + two(c.g) + two(c.b);
};
const nameOf = (value) => { const rgb = toRgb(value); return rgb ? RetouchDescribe.colorName(rgb) : value; };
// "dark" reads better than the query it comes from; anything else keeps its own words, shortened.
function mediaTag(media) {
  if (!media) return '';
  if (/prefers-color-scheme\s*:\s*dark/i.test(media)) return 'dark';
  if (/prefers-color-scheme\s*:\s*light/i.test(media)) return 'light';
  const t = media.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > 18 ? t.slice(0, 17) + '…' : t;
}

function themeRow(item) {
  const row = document.createElement(item.source === 'inline' ? 'button' : 'div');
  row.className = 'row' + (item.source === 'inline' ? '' : ' locked');
  row.style.position = 'relative';
  if (item.source === 'inline') row.type = 'button';
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = item.value;
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = nameOf(item.value);
  const tag = document.createElement('span');
  tag.className = 'tag';
  row.title = `${item.property}: ${item.value}`;
  row.append(swatch, label, tag);
  if (item.source !== 'inline') {
    const file = (item.href || '').split('/').pop() || 'another file';
    tag.textContent = `lives in ${decodeURIComponent(file)}`;
    row.title = `${item.property}: ${item.value} — Retouch cannot edit a separate CSS file yet.`;
    return row;
  }
  tag.textContent = mediaTag(item.media);

  const input = document.createElement('input');
  input.type = 'color';
  input.value = hexOf(item.value);
  input.tabIndex = -1;
  row.appendChild(input);
  const reset = document.createElement('span');
  reset.className = 'reset';
  reset.textContent = 'Reset';
  reset.hidden = true;
  reset.setAttribute('role', 'button');

  const show = (value, changed) => {
    swatch.style.background = value;
    label.textContent = nameOf(value);
    tag.textContent = changed ? 'changed' : mediaTag(item.media);
    reset.hidden = !changed;
    row.title = `${item.property}: ${value}`;
  };
  input.addEventListener('input', () => {
    show(input.value, input.value.toLowerCase() !== hexOf(item.value).toLowerCase());
    post({ type: 'themePreview', property: item.property, value: input.value, before: item.value, media: item.media, skip: item.skip || 0, except: item.except || [] });
  });
  reset.addEventListener('click', (e) => {
    e.stopPropagation();
    input.value = hexOf(item.value);
    show(item.value, false);
    post({ type: 'themePreview', property: item.property, value: null, media: item.media });
  });
  row.addEventListener('click', (e) => { if (e.target !== input && e.target !== reset) input.click(); });
  row.insertBefore(reset, input);
  return row;
}

function buildTheme(items) {
  els.theme.textContent = '';
  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'This page does not define its colors as variables. Ask your AI to move the colors into :root variables, then Retouch can change them here.';
    els.theme.appendChild(p);
    return;
  }
  // A property redefined inside a media block needs the plain value's preview to stand aside there.
  for (const item of items) {
    item.except = items.filter((o) => o.property === item.property && o.media && o.media !== item.media).map((o) => o.media).filter((q, i, a) => a.indexOf(q) === i);
  }
  const groups = [['inline', 'In this page'], ['linked', 'In a linked file']];
  for (const [source, title] of groups) {
    const rows = items.filter((i) => i.source === source);
    if (!rows.length) continue;
    const h = document.createElement('div');
    h.className = 'group';
    h.textContent = title;
    els.theme.appendChild(h);
    for (const item of rows) els.theme.appendChild(themeRow(item));
  }
}

function closeTheme() { els.theme.hidden = true; }
async function toggleTheme() {
  if (!els.theme.hidden) { closeTheme(); return; }
  els.theme.hidden = false;
  els.theme.textContent = '';
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = 'Reading the page\u2019s colors\u2026';
  els.theme.appendChild(p);
  buildTheme(await requestTheme());
}

els.edit.addEventListener('click', toggleEdit);
els.save.addEventListener('click', save);
els.colors.addEventListener('click', (e) => { e.stopPropagation(); toggleTheme(); });
document.addEventListener('click', (e) => { if (!els.theme.hidden && !els.theme.contains(e.target)) closeTheme(); });
els.discard.addEventListener('click', () => { post({ type: 'reset' }); state.pendingImages.clear(); closeTheme(); setStatus('Changes discarded'); });
els.dismiss.addEventListener('click', () => { els.banner.hidden = true; els.dropmat.hidden = true; });
els.exit.addEventListener('click', () => {
  if (state.count + state.structural > 0 && !confirm('Discard your unsaved changes and leave?')) return;
  location.href = src;
});
// The picker cannot be opened at an arbitrary path, so it starts in the well-known folder that holds
// the file (Documents, Downloads, ...) and remembers the last pick per project folder, not globally.
function startFolder() {
  const m = /^(?:\/[A-Za-z]:)?\/(?:Users|home)\/[^/]+\/(Documents|Downloads|Desktop|Pictures|Music|Movies|Videos)(?:\/|$)/.exec(dirPath);
  const map = { Documents: 'documents', Downloads: 'downloads', Desktop: 'desktop', Pictures: 'pictures', Music: 'music', Movies: 'videos', Videos: 'videos' };
  return m ? map[m[1]] : 'documents';
}
function pickerId() {
  let h = 0;
  for (const ch of dirPath) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 'retouch-' + h.toString(36);
}
els.choose.addEventListener('click', async () => {
  try {
    if (state.pendingGrant) {
      // The folder was dropped but Chrome did not grant writing then; a click is a sure user gesture.
      const handle = state.pendingGrant;
      const p = await RetouchVault.ensurePermission(handle);
      if (p !== 'granted') { setStatus(`Chrome still refuses saving into “${handle.name}”. Click Allow saving and choose Save changes when Chrome asks.`, 'need-folder'); return; }
      state.pendingGrant = null;
      els.banner.hidden = true;
      els.dropmat.hidden = true;
      await save();
      return;
    }
    const dir = await window.showDirectoryPicker({ mode: 'readwrite', id: pickerId(), startIn: startFolder() });
    if (!RetouchVault.segments(src).slice(0, -1).includes(dir.name)) {
      setStatus(`“${dir.name}” is not the folder. This file lives in ${dirPath}. Choose “${dirName}” or a folder above it.`, 'need-folder');
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
// Dropping the folder onto the viewer grants access in one motion (D31). The path is already known
// from the file's URL, so nothing has to be searched for: the drop only has to be the right folder.
function droppingFolder() {
  return !els.banner.hidden && !els.choose.hidden;
}
document.addEventListener('dragover', (e) => {
  if (!droppingFolder()) return;
  e.preventDefault();
  els.banner.classList.add('dropping');
  els.dropmat.classList.add('dropping');
});
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) { els.banner.classList.remove('dropping'); els.dropmat.classList.remove('dropping'); } });
document.addEventListener('drop', async (e) => {
  if (!droppingFolder()) return;
  e.preventDefault();
  els.banner.classList.remove('dropping');
  els.dropmat.classList.remove('dropping');
  const item = Array.from(e.dataTransfer ? e.dataTransfer.items : []).find((i) => i.getAsFileSystemHandle);
  if (!item) { setStatus(`Retouch could not read what you dropped. Click “Choose “${dirName}”…” instead.`, 'need-folder'); return; }
  try {
    const handle = await item.getAsFileSystemHandle();
    if (!handle || handle.kind !== 'directory') {
      setStatus(`Drop the folder that holds this file, “${dirName}”, not a single file.`, 'need-folder');
      return;
    }
    // The folder's name may appear more than once in the path; the walk decides which occurrence it is.
    // Reading is granted on drop, so this check needs no permission.
    const segs = RetouchVault.segments(src);
    let at = -1;
    for (let i = segs.length - 2; i >= 0; i--) {
      if (segs[i] === handle.name && (await RetouchVault.walk(handle, segs.slice(i + 1)))) { at = i; break; }
    }
    if (at < 0) {
      setStatus(`“${handle.name}” is not the folder. This file lives in ${dirPath}. Drop “${dirName}” or a folder above it.`, 'need-folder');
      return;
    }
    await RetouchVault.add(handle, segs.slice(0, at + 1));
    // Asking here, inside the drop handler, is what makes Chrome's one-click bubble appear.
    const active = navigator.userActivation ? navigator.userActivation.isActive : 'n/a';
    const granted = await handle.requestPermission({ mode: 'readwrite' });
    logLine(`${new Date().toISOString()} [drop] folder “${handle.name}” requestPermission => ${granted}, user activation at drop: ${active}, frame focused: ${document.activeElement === els.frame}`);
    if (granted !== 'granted') {
      state.pendingGrant = handle;
      setStatus(`Retouch has “${handle.name}” now, but Chrome has not allowed saving into it yet.`, 'need-folder');
      return;
    }
    els.banner.hidden = true;
    els.dropmat.hidden = true;
    setStatus(`Folder “${handle.name}” added`);
    await save();
  } catch (err) {
    setStatus(err.message || String(err), 'error');
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
  if (e.key === 'Escape' && !els.theme.hidden) closeTheme();
});
window.addEventListener('beforeunload', (e) => {
  if (state.count + state.structural > 0) { e.preventDefault(); e.returnValue = ''; }
});
// Asks content.js for the pending region's current on-screen position (viewport-relative, already
// accounting for scroll) — never reused from save time, since the user may have scrolled since.
function requestRegionRect(id) {
  return new Promise((resolve) => {
    state.pendingRectResolve = resolve;
    post({ type: 'get-region-rect', id });
    setTimeout(() => { if (state.pendingRectResolve === resolve) { state.pendingRectResolve = null; resolve(null); } }, 2000);
  });
}
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'get-pending-capture') {
      (async () => {
        if (!state.pendingCapture) { sendResponse({ pending: null }); return; }
        const rect = await requestRegionRect(state.pendingCapture.id);
        if (!rect) { sendResponse({ pending: null }); return; }
        const frameRect = els.frame.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        sendResponse({
          pending: {
            id: state.pendingCapture.id,
            box: {
              x: Math.round((frameRect.left + rect.left) * dpr),
              y: Math.round((frameRect.top + rect.top) * dpr),
              width: Math.round(rect.width * dpr),
              height: Math.round(rect.height * dpr)
            }
          }
        });
      })();
      return true;
    }
    if (msg.type === 'capture-no-pending') {
      setStatus('No region note pending capture. Draw a box first.');
      return;
    }
    if (msg.type === 'capture-failed') {
      setStatus('Screenshot capture failed. Note kept as text.', 'error');
      return;
    }
    if (msg.type === 'capture-result' && msg.dataUrl) {
      const box = msg.box;
      const id = msg.id;
      state.pendingCapture = null;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, box.width);
        canvas.height = Math.max(1, box.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
        canvas.toBlob(async (blob) => {
          if (!blob) return;
          try {
            const screenshotPath = await RetouchVault.writeScreenshot(src, blob);
            if (screenshotPath) {
              setStatus(`Screenshot saved to ${screenshotPath}`);
              post({ type: 'prompt-update-screenshot', id, screenshotPath });
            }
          } catch (e) {
            console.warn('[retouch] Screenshot write error:', e);
          }
        }, 'image/png');
      };
      img.src = msg.dataUrl;
    }
  });
}
window.retouchDebug = { collect, state, diagnostics, requestTheme };
render();
