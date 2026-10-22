// The Retouch viewer: a toolbar above the user's local page, which renders in an iframe with its
// real file:// origin so its own CSS, images and scripts load. The content script inside the frame
// handles editing; this file handles the toolbar, the vault lookup and the save.
const params = new URLSearchParams(location.search);
const src = params.get('src') || '';
const $ = (id) => document.getElementById(id);
const els = { bar: $('bar'), frame: $('frame'), title: $('title'), filename: $('filename'), status: $('status'), choose: $('choose'), details: $('details'), report: $('report'), count: $('count'),
  edit: $('edit'), discard: $('discard'), save: $('save'), exit: $('exit'), error: $('error'), colors: $('colors'), theme: $('theme'),
  undoBtn: $('undo-btn'), redoBtn: $('redo-btn'),
  historyBtn: $('history-btn'), historyPop: $('history-pop'),
  banner: $('banner'), bannerText: $('banner-text'), dismiss: $('dismiss'),
  prompt: $('prompt'), promptCount: $('prompt-count'), copyPrompt: $('copy-prompt'), copyLabel: $('copy-label'), promptDone: $('prompt-done'),
  promptTools: $('prompt-tools'), toolPointer: $('tool-pointer'), toolBox: $('tool-box'),
  dock: $('dock'), dockGrip: $('dock-grip'), wholeBtn: $('whole-btn'), wholeDot: $('whole-dot'), wholeBubble: $('whole-bubble'), wholeTa: $('whole-ta'), wholeSave: $('whole-save'), wholeDel: $('whole-del'),
  dockTimeline: $('dock-timeline'), dockTrack: $('dock-track'), dockTrackFill: $('dock-track-fill'), dockSections: $('dock-sections'), dockMarkers: $('dock-markers'),
  dockRight: $('dock-right'), dockCount: $('dock-count'),
  collectorStale: $('collector-stale'), staleReload: $('stale-reload'), staleKeep: $('stale-keep'),
  dropzone: $('dropzone'), dropzoneText: $('dropzone-text'), dropmat: $('dropmat') };

const state = { pendingGrant: null,
  editing: false, count: 0, structural: 0, ready: false, saving: false, lastKnownSource: null, lastBackupId: null, historyCount: 0, pendingCollect: null, log: [],
  canUndo: false, canRedo: false,
  pendingImages: new Map(), pendingTheme: null,
  promptMode: false, promptTool: 'pointer', promptItems: [], wholeRequest: '', activeItemId: null,
  pinPositions: new Map(), docHeight: 1, sections: [], dockPos: null, sortedMarkerIds: [], wholeBubbleOpen: false,
  pendingCapture: null, pendingRectResolve: null
};
const decodedPath = (() => { try { return decodeURIComponent(new URL(src).pathname); } catch (e) { return ''; } })();
const fileName = decodedPath.split('/').pop();
const dirPath = decodedPath.slice(0, decodedPath.lastIndexOf('/')) || '/';
const dirName = dirPath.split('/').pop() || dirPath;

// The status line is a short-lived chip next to the page title. Errors stay until dismissed
// or the next action; successes/confirmations disappear after 3.2 s; nothing is shown at rest.
let statusTimer = null;
// The review / share card (see countSaveForShare); declared here because render() can hide it.
const shareEls = { card: $('share'), title: $('share-title'), review: $('share-review'), post: $('share-post'), later: $('share-later'), close: $('share-close') };
let shareTimer = null;
// Every status and every step of a save goes into the diagnostics log and, mirrored, to the console.
function logLine(line) {
  state.log.push(line);
  console.info('[retouch]', line);
}
function setStatus(text, kind, options) {
  const isError = kind === 'error';
  const isNeedFolder = kind === 'need-folder';
  clearTimeout(statusTimer);
  state.transient = !isError && !isNeedFolder && !!text;
  if (state.transient) {
    const duration = (options && options.duration) || 3200;
    statusTimer = setTimeout(() => {
      state.transient = false;
      setStatus('');
      render();
    }, duration);
  }

  if (isNeedFolder) {
    els.bannerText.textContent = text;
    els.banner.className = 'banner';
    els.banner.hidden = false;
    els.choose.hidden = false;
    els.choose.textContent = state.pendingGrant ? 'Allow saving' : `Choose “${dirName}”…`;
    els.dropzone.hidden = false;
    els.dropzoneText.textContent = `Drop “${dirName}” here`;
    els.dropmat.hidden = false;
    els.details.hidden = true;
    els.report.hidden = true;
  } else if (isError) {
    els.bannerText.textContent = text;
    els.banner.className = 'banner error';
    els.banner.hidden = false;
    els.choose.hidden = true;
    els.dropzone.hidden = true;
    els.dropmat.hidden = true;
    els.details.hidden = false;
    els.report.hidden = false;
  } else {
    els.banner.hidden = true;
    els.dropmat.hidden = true;
  }

  // Errors and folder requests live in the banner (full text, actions); the chip would only repeat them.
  if (text && !isError && !isNeedFolder) {
    els.status.hidden = false;
    els.status.textContent = '';
    if (options && options.actionLabel) {
      els.status.appendChild(document.createTextNode(text + ' · '));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'status-action';
      btn.id = 'status-undo';
      btn.textContent = options.actionLabel;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (options.onAction) options.onAction();
      });
      els.status.appendChild(btn);
    } else {
      els.status.textContent = text;
    }
    if (els.status.animate) els.status.animate([{ opacity: 0, transform: 'translateY(-3px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
    els.status.className = 'status-chip' + (kind ? ' ' + kind : '');
    els.status.title = isError ? 'Click to dismiss' : '';
  } else {
    els.status.hidden = true;
    els.status.textContent = '';
    els.status.className = 'status-chip';
    els.status.title = '';
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
  if (state.promptMode) hideShare();
  els.edit.classList.toggle('active', state.editing);
  els.prompt.classList.toggle('active', state.promptMode);
  els.colors.hidden = !state.editing;
  if (!state.editing) closeTheme();
  els.undoBtn.hidden = !state.editing;
  els.redoBtn.hidden = !state.editing;
  els.undoBtn.disabled = !state.canUndo;
  els.redoBtn.disabled = !state.canRedo;
  els.historyBtn.hidden = !state.editing;
  if (!state.editing) closeHistory();
  els.historyBtn.disabled = state.historyCount === 0;
  els.discard.hidden = !state.editing || pending === 0;
  els.save.hidden = !state.editing;
  els.save.disabled = pending === 0 || state.saving;
  els.copyPrompt.hidden = !state.promptMode;
  els.promptDone.hidden = !state.promptMode;
  els.promptTools.hidden = !state.promptMode;
  els.toolPointer.classList.toggle('active', state.promptTool === 'pointer');
  els.toolBox.classList.toggle('active', state.promptTool === 'box');
  els.dock.hidden = !state.promptMode;
  if (!state.promptMode) closeWholeBubble(true);
  renderPromptCount();
  renderCollector();
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
    const label = state.editing && pending > 0 ? `${pending} change${pending === 1 ? '' : 's'}${state.structural ? ' · one needs attention' : ''}` : '';
    if (label) {
      if (els.status.textContent !== label) {
        els.status.textContent = label;
        els.status.hidden = false;
        els.status.className = 'status-chip' + (state.structural ? ' error' : '');
      }
    } else if (!els.status.classList.contains('error')) {
      els.status.hidden = true;
      els.status.textContent = '';
      els.status.className = 'status-chip';
    }
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
  els.title.textContent = name;
  els.filename.textContent = name;
  els.status.textContent = '';
  els.status.hidden = true;
  document.title = `${name} · Retouch`;

  window.addEventListener('message', (e) => {
    if (e.source !== els.frame.contentWindow) return;
    const m = e.data || {};
    if (!m.retouch) return;
    switch (m.type) {
      case 'ready':
        state.ready = true;
        if (typeof RetouchReach !== 'undefined') RetouchReach.mark('opened');
        // The page's own title is shown left-aligned. If no title, show filename.
        if (m.title && m.title.trim()) {
          els.title.textContent = m.title.trim();
          document.title = `${m.title.trim()} · Retouch`;
        } else {
          els.title.textContent = fileName;
          document.title = `${fileName} · Retouch`;
        }
        els.filename.textContent = fileName;
        if (!state.transient) setStatus('');
        if (state.editing) post({ type: 'edit', on: true });
        else if (params.get('fresh') === '1' && !state.welcomed) { state.welcomed = true; setTimeout(toggleEdit, 400); }
        break;
      case 'changes':
        state.count = m.count; state.structural = m.structural; render();
        break;
      case 'undo-state':
        state.canUndo = !!m.canUndo; state.canRedo = !!m.canRedo; render();
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
      case 'prompt-positions':
        state.pinPositions = new Map((m.positions || []).map((p) => [p.id, p.y]));
        state.docHeight = Math.max(1, m.docHeight || 1);
        state.sections = Array.isArray(m.sections) ? m.sections : [];
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
  updateHistoryButton();
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
  if (!state.editing) state.pendingImages.clear();
  if (state.editing) updateHistoryButton();
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

// ---------- Prompt collector dock: persistence, timeline, copy (B2) ----------
const promptKey = 'prompt:' + src;
function savePromptStore() { RetouchIDB.set(promptKey, { items: state.promptItems, whole: state.wholeRequest }); }
RetouchIDB.get(promptKey).then((v) => {
  if (v) { state.promptItems = v.items || []; state.wholeRequest = v.whole || ''; }
  renderPromptCount();
  renderCollector();
});

function renderPromptCount() {
  const n = state.promptItems.length;
  const whole = (state.wholeRequest || '').trim();
  const total = n + (whole ? 1 : 0);
  els.promptCount.hidden = state.promptMode || total === 0;
  els.promptCount.textContent = String(total);
  els.wholeDot.hidden = !whole;
  els.dockCount.textContent = `${total} ${total === 1 ? 'note' : 'notes'}`;
  els.copyPrompt.disabled = total === 0;
  els.dock.classList.toggle('collapsed', total === 0);
}
function locationTag(item) {
  if (item.kind === 'region') return 'Box';
  const WORDS = {
    h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading',
    p: 'Paragraph', li: 'List item', td: 'Table cell', th: 'Table cell', img: 'Image',
    button: 'Button', a: 'Link', section: 'Section', article: 'Section', header: 'Section', footer: 'Section'
  };
  if (WORDS[item.tag]) return WORDS[item.tag];
  const fallback = (item.tag || 'Block').toLowerCase();
  return fallback.charAt(0).toUpperCase() + fallback.slice(1);
}
function locationTitle(item) {
  if (item.kind === 'region') {
    const near = (item.near || '').trim();
    return near ? `“${near}”` : '';
  }
  if (item.tag === 'img') return `“${(item.alt || item.src || 'image').slice(0, 40)}”`;
  const quoted = (item.selected || item.preview || '').trim();
  if (!quoted) return '';
  const short = quoted.length > 36 ? quoted.slice(0, 36).trimEnd() + '…' : quoted;
  return `“${short}”`;
}
function humanLabel(item) {
  const tag = locationTag(item);
  const title = locationTitle(item);
  if (item.kind === 'region') return title ? `Box near ${title}` : 'Box';
  return title ? `${tag} ${title}` : tag;
}

function sectionForY(y) {
  let match = null;
  for (const s of state.sections) {
    if (s.y <= y + 8) match = s;
    else break;
  }
  return match;
}

function updateDockFlip() {
  if (els.dock.hidden) return;
  const frameRect = els.frame.getBoundingClientRect();
  const dockRect = els.dock.getBoundingClientRect();
  const dockMidY = dockRect.top + dockRect.height / 2;
  const frameMidY = frameRect.top + frameRect.height / 2;
  els.dock.classList.toggle('flip-preview', dockMidY < frameMidY);
}

function clampDockPosition(left, top) {
  const frameRect = els.frame.getBoundingClientRect();
  const barRect = els.bar.getBoundingClientRect();
  const dockRect = els.dock.getBoundingClientRect();
  const minLeft = Math.round(frameRect.left);
  const maxLeft = Math.max(minLeft, Math.round(frameRect.right - dockRect.width));
  const minTop = Math.round(Math.max(frameRect.top, barRect.bottom));
  const maxTop = Math.max(minTop, Math.round(frameRect.bottom - dockRect.height));
  return {
    left: Math.max(minLeft, Math.min(maxLeft, Math.round(left))),
    top: Math.max(minTop, Math.min(maxTop, Math.round(top)))
  };
}

function applyDockPosition(left, top) {
  const clamped = clampDockPosition(left, top);
  const bodyRect = document.body.getBoundingClientRect();
  state.dockPos = clamped;
  els.dock.classList.add('moved');
  els.dock.style.left = `${Math.round(clamped.left - bodyRect.left)}px`;
  els.dock.style.top = `${Math.round(clamped.top - bodyRect.top)}px`;
  els.dock.style.bottom = 'auto';
  els.dock.style.transform = 'none';
  updateDockFlip();
}

function resetDockPosition() {
  state.dockPos = null;
  els.dock.classList.remove('moved', 'flip-preview');
  els.dock.style.left = '';
  els.dock.style.top = '';
  els.dock.style.bottom = '';
  els.dock.style.transform = '';
}

function setActiveMarker(id) {
  state.activeItemId = id;
  updateDockFlip();
  for (const m of els.dockMarkers.querySelectorAll('.dock-marker')) {
    m.classList.toggle('active', m.dataset.id === id);
  }
  const item = id ? state.promptItems.find((i) => i.id === id) : null;
  post({ type: 'prompt-hover', id: item && !item.lost ? item.id : null });
}

function renderCollector() {
  renderPromptCount();
  if (state.dockPos && !els.dock.hidden) {
    applyDockPosition(state.dockPos.left, state.dockPos.top);
  } else {
    updateDockFlip();
  }
  const getY = (item) => {
    if (state.pinPositions.has(item.id)) return state.pinPositions.get(item.id);
    if (item.kind === 'region' && item.box) return item.box.y || 0;
    return 0;
  };
  const sorted = [...state.promptItems].sort((a, b) => (getY(a) - getY(b)) || ((a.number || 0) - (b.number || 0)));
  state.sortedMarkerIds = sorted.map((i) => i.id);
  if (state.activeItemId && !state.sortedMarkerIds.includes(state.activeItemId)) {
    state.activeItemId = null;
  }

  const trackW = els.dockTrack.clientWidth || 440;
  const pad = 13;
  const minGap = 26;
  const minX = pad;
  const maxX = Math.max(pad, trackW - pad);
  const usable = Math.max(0, maxX - minX);
  const docH = Math.max(1, state.docHeight || 1);
  const xs = sorted.map((item) => {
    const r = Math.max(0, Math.min(1, getY(item) / docH));
    return minX + r * usable;
  });
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] < xs[i - 1] + minGap) xs[i] = xs[i - 1] + minGap;
  }
  if (xs.length > 0 && xs[xs.length - 1] > maxX) {
    xs[xs.length - 1] = maxX;
    for (let i = xs.length - 2; i >= 0; i--) {
      if (xs[i] > xs[i + 1] - minGap) xs[i] = Math.max(minX, xs[i + 1] - minGap);
    }
    if (xs.length > 1) {
      const effGap = Math.min(minGap, usable / (xs.length - 1));
      for (let i = 1; i < xs.length; i++) {
        if (xs[i] < xs[i - 1] + effGap) xs[i] = xs[i - 1] + effGap;
      }
    }
  }

  if (xs.length > 0 && trackW > 0) {
    const maxPct = Math.max(0, Math.min(100, (xs[xs.length - 1] / trackW) * 100));
    els.dockTrackFill.style.width = `${maxPct.toFixed(1)}%`;
  } else if ((state.wholeRequest || '').trim()) {
    els.dockTrackFill.style.width = '100%';
  } else {
    els.dockTrackFill.style.width = '0%';
  }

  els.dockSections.textContent = '';
  const secEntries = state.sections.map((sec) => {
    const r = Math.max(0, Math.min(1, (sec.y || 0) / docH));
    const secX = Math.round(minX + r * usable);
    const wrap = document.createElement('div');
    wrap.className = 'dock-section';
    wrap.style.left = `${secX}px`;
    const tick = document.createElement('span');
    tick.className = 'dock-section-tick';
    const labelEl = document.createElement('span');
    labelEl.className = 'dock-section-label';
    labelEl.textContent = sec.label;
    wrap.append(tick, labelEl);
    els.dockSections.appendChild(wrap);
    const w = labelEl.offsetWidth || Math.ceil((sec.label || '').length * 5.8);
    const half = w / 2;
    const center = Math.max(half, Math.min(Math.max(half, trackW - half), secX));
    labelEl.style.left = `${Math.round(center - secX)}px`;
    const markerDist = xs.length ? Math.min(...xs.map((mx) => Math.abs(mx - secX))) : Infinity;
    return {
      sec,
      secX,
      labelEl,
      leftEdge: center - half,
      rightEdge: center + half,
      markerDist
    };
  });
  const keptSecs = [];
  for (const curr of secEntries) {
    while (keptSecs.length > 0) {
      const prev = keptSecs[keptSecs.length - 1];
      if (prev.rightEdge + 8 <= curr.leftEdge) break;
      if (curr.markerDist < prev.markerDist) {
        prev.labelEl.hidden = true;
        keptSecs.pop();
      } else {
        curr.labelEl.hidden = true;
        break;
      }
    }
    if (!curr.labelEl.hidden) keptSecs.push(curr);
  }

  els.dockMarkers.textContent = '';
  sorted.forEach((item, idx) => {
    const marker = document.createElement('div');
    marker.className = 'dock-marker' + (item.lost ? ' lost' : '') + (item.id === state.activeItemId ? ' active' : '');
    marker.dataset.id = item.id;
    marker.dataset.number = String(item.number);
    marker.style.left = `${Math.round(xs[idx])}px`;

    const dot = document.createElement('div');
    dot.className = 'dock-marker-dot';
    dot.textContent = String(item.number);
    marker.appendChild(dot);

    const preview = document.createElement('div');
    preview.className = 'dock-preview';

    const top = document.createElement('div');
    top.className = 'preview-top';
    const numEl = document.createElement('span');
    numEl.className = 'preview-num';
    numEl.textContent = String(item.number);
    const labelEl = document.createElement('span');
    labelEl.className = 'preview-label';
    labelEl.textContent = humanLabel(item);
    top.append(numEl, labelEl);
    const sec = sectionForY(getY(item));
    if (sec && sec.label) {
      const secEl = document.createElement('span');
      secEl.className = 'preview-section';
      secEl.textContent = sec.label;
      top.appendChild(secEl);
    }

    const body = document.createElement('div');
    body.className = 'preview-body';
    body.textContent = item.request || (item.lost ? 'Not on this page any more' : '');

    const foot = document.createElement('div');
    foot.className = 'preview-foot';
    foot.textContent = 'Jump to it →';

    preview.append(top, body, foot);
    marker.appendChild(preview);

    marker.addEventListener('mouseenter', () => {
      setActiveMarker(item.id);
    });
    marker.addEventListener('mouseleave', () => {
      if (state.activeItemId === item.id) setActiveMarker(null);
    });
    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      setActiveMarker(item.id);
      if (!item.lost) post({ type: 'prompt-scroll', id: item.id });
    });

    els.dockMarkers.appendChild(marker);
  });
}

function openWholePage() {
  state.wholeBubbleOpen = true;
  updateDockFlip();
  els.wholeBubble.hidden = false;
  els.wholeBtn.classList.add('active');
  els.wholeTa.value = state.wholeRequest || '';
  setTimeout(() => els.wholeTa.focus(), 0);
}
function closeWholeBubble(discard) {
  if (!state.wholeBubbleOpen && els.wholeBubble.hidden) return;
  state.wholeBubbleOpen = false;
  els.wholeBubble.hidden = true;
  els.wholeBtn.classList.remove('active');
  if (!discard) {
    state.wholeRequest = els.wholeTa.value.trim();
    savePromptStore();
    renderPromptCount();
    renderCollector();
  }
}
function clearWholePage() {
  state.wholeBubbleOpen = false;
  els.wholeBubble.hidden = true;
  els.wholeBtn.classList.remove('active');
  state.wholeRequest = '';
  els.wholeTa.value = '';
  savePromptStore();
  renderPromptCount();
  renderCollector();
}

els.wholeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (state.wholeBubbleOpen) closeWholeBubble(false);
  else openWholePage();
});
els.wholeSave.addEventListener('click', (e) => {
  e.stopPropagation();
  closeWholeBubble(false);
});
els.wholeDel.addEventListener('click', (e) => {
  e.stopPropagation();
  clearWholePage();
});
els.wholeTa.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    closeWholeBubble(false);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeWholeBubble(false);
  }
});
document.addEventListener('mousedown', (e) => {
  if (state.wholeBubbleOpen && !els.wholeBubble.contains(e.target) && !els.wholeBtn.contains(e.target)) {
    closeWholeBubble(false);
  }
});
window.addEventListener('resize', () => {
  if (state.promptMode) renderCollector();
});

els.dockGrip.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const startRect = els.dock.getBoundingClientRect();
  const startX = e.clientX;
  const startY = e.clientY;
  const initLeft = startRect.left;
  const initTop = startRect.top;
  els.dock.classList.add('dragging');
  els.frame.style.pointerEvents = 'none';

  const onMove = (me) => {
    const dx = me.clientX - startX;
    const dy = me.clientY - startY;
    applyDockPosition(initLeft + dx, initTop + dy);
  };
  const onUp = () => {
    els.dock.classList.remove('dragging');
    els.frame.style.pointerEvents = '';
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
  };
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
});
els.dockGrip.addEventListener('dblclick', (e) => {
  e.preventDefault();
  e.stopPropagation();
  resetDockPosition();
});
els.dockGrip.addEventListener('keydown', (e) => {
  const step = 16;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();
    const rect = els.dock.getBoundingClientRect();
    const baseLeft = state.dockPos ? state.dockPos.left : rect.left;
    const baseTop = state.dockPos ? state.dockPos.top : rect.top;
    const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
    const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
    applyDockPosition(baseLeft + dx, baseTop + dy);
  } else if (e.key === 'Home') {
    e.preventDefault();
    e.stopPropagation();
    resetDockPosition();
  }
});

els.dock.addEventListener('keydown', (e) => {
  if (e.target === els.wholeTa || e.target === els.dockGrip) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const ids = state.sortedMarkerIds;
    if (!ids.length) return;
    e.preventDefault();
    const cur = ids.indexOf(state.activeItemId);
    let nextIdx;
    if (e.key === 'ArrowRight') {
      nextIdx = cur === -1 ? 0 : (cur + 1) % ids.length;
    } else {
      nextIdx = cur === -1 ? ids.length - 1 : (cur - 1 + ids.length) % ids.length;
    }
    setActiveMarker(ids[nextIdx]);
  } else if (e.key === 'Enter') {
    if (state.activeItemId && (e.target === els.dock || e.target.closest('.dock-marker'))) {
      e.preventDefault();
      const item = state.promptItems.find((i) => i.id === state.activeItemId);
      if (item && !item.lost) post({ type: 'prompt-scroll', id: item.id });
    }
  } else if (e.key === 'Escape') {
    if (state.activeItemId) {
      e.preventDefault();
      setActiveMarker(null);
    }
  }
});

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
  els.frame.src = src;
});
els.staleKeep.addEventListener('click', () => {
  hideStale();
  if (state.promptMode) post({ type: 'prompt-restore', items: state.promptItems });
});
window.addEventListener('focus', () => { if (state.promptMode) checkStale(); });

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
let copyTimer = null;
els.copyPrompt.addEventListener('click', async () => {
  const text = RetouchPrompt.compile({ src, items: state.promptItems, whole: state.wholeRequest, source: state.lastKnownSource });
  try {
    await navigator.clipboard.writeText(text);
    clearTimeout(copyTimer);
    els.copyLabel.textContent = 'Copied ✓';
    copyTimer = setTimeout(() => { els.copyLabel.textContent = 'Copy for AI'; }, 2000);
  } catch (e) {
    let wrap = document.getElementById('collector-copy-fallback');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'collector-copy-fallback';
      wrap.className = 'whole-bubble';
      wrap.style.right = '0';
      wrap.style.left = 'auto';
      const ta = document.createElement('textarea');
      ta.className = 'collector-copy-text';
      ta.readOnly = true;
      wrap.appendChild(ta);
      els.dock.appendChild(wrap);
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
    const now = Date.now();
    const changeCount = changes.length;
    const summary = `${changeCount} change${changeCount === 1 ? '' : 's'}`;
    try {
      state.lastBackupId = await RetouchHistory.push(src, { savedAt: now, bytes: current, summary });
      await updateHistoryButton();
    } catch (e) {
      state.lastBackupId = null;
      logLine(`${new Date().toISOString()} [history] push backup failed: ${e.message}`);
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
    state.pendingImages.clear();
    post({ type: 'commit', renames });
    state.canUndo = false;
    state.canRedo = false;
    render();
    const t = new Date(now);
    const timeStr = `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;
    if (state.lastBackupId) {
      setStatus(`Saved at ${timeStr}`, 'ok', {
        actionLabel: 'Undo',
        duration: 8000,
        onAction: () => restoreVersion(state.lastBackupId)
      });
    } else {
      setStatus(`Saved at ${timeStr}`, 'ok');
    }
    countSaveForShare();
    if (typeof RetouchReach !== 'undefined') RetouchReach.mark('saved');
  } catch (e) {
    setStatus(e.message || String(e), 'error');
  } finally {
    state.saving = false;
    render();
  }
}

function formatHistoryDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return `Today ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (isYesterday) return `Yesterday ${time}`;

  const day = d.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getMonth()];
  return `${day} ${month} ${time}`;
}

async function updateHistoryButton() {
  if (!els.historyBtn) return;
  try {
    const list = await RetouchHistory.list(src);
    state.historyCount = list.length;
    els.historyBtn.disabled = list.length === 0;
  } catch (e) {
    state.historyCount = 0;
    els.historyBtn.disabled = true;
  }
}

function closeHistory() {
  if (els.historyPop) els.historyPop.hidden = true;
}

async function buildHistory() {
  els.historyPop.textContent = '';
  const list = await RetouchHistory.list(src);
  if (!list.length) {
    closeHistory();
    return;
  }
  for (const item of list) {
    const row = document.createElement('div');
    row.className = 'history-row';
    const label = document.createElement('span');
    label.className = 'history-label';
    label.textContent = `${formatHistoryDate(item.savedAt)} · ${item.summary || 'Saved'}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn small history-restore';
    btn.textContent = 'Restore';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      closeHistory();
      await restoreVersion(item.id);
    });
    row.append(label, btn);
    els.historyPop.appendChild(row);
  }
}

async function toggleHistory() {
  if (!els.historyPop.hidden) {
    closeHistory();
    return;
  }
  closeTheme();
  els.historyPop.hidden = false;
  await buildHistory();
}

async function restoreVersion(id) {
  if (state.count + state.structural > 0 && !confirm('Restoring replaces the page and discards your unsaved changes. Continue?')) return;
  try {
    let found = await RetouchVault.resolve(src, state.lastKnownSource);
    if (!found) found = await RetouchVault.resolve(src, null);
    if (!found) {
      setStatus(`To restore, Retouch needs access to this file's folder, ${dirPath}. Choose “${dirName}” or a folder above it; Retouch remembers it.`, 'need-folder');
      return;
    }
    const current = await (await found.fileHandle.getFile()).text();
    if (state.lastKnownSource !== null && current !== state.lastKnownSource) {
      setStatus('The file changed after you saved, so Retouch won’t undo over it. Use History to pick a version.', 'error');
      return;
    }
    const targetBytes = await RetouchHistory.get(src, id);
    if (targetBytes === null || targetBytes === undefined) {
      throw new Error('Version could not be found in history.');
    }
    const list = await RetouchHistory.list(src);
    const meta = list.find((e) => e.id === id);
    const targetDate = meta ? new Date(meta.savedAt) : new Date();
    const timeStr = `${targetDate.getHours()}:${String(targetDate.getMinutes()).padStart(2, '0')}`;

    try {
      await RetouchHistory.push(src, {
        savedAt: Date.now(),
        bytes: current,
        summary: 'Before restore'
      });
      await updateHistoryButton();
    } catch (e) {
      logLine(`${new Date().toISOString()} [history] push before restore failed: ${e.message}`);
    }

    const writable = await found.fileHandle.createWritable();
    await writable.write(targetBytes);
    await writable.close();
    state.lastKnownSource = targetBytes;
    state.lastBackupId = null;
    state.pendingImages.clear();

    state.count = 0;
    state.structural = 0;
    state.editing = true;
    render();
    els.frame.src = src;

    setStatus(`Restored the version from ${timeStr}`, 'ok');
  } catch (e) {
    setStatus(e.message || String(e), 'error');
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
  const isLocked = item.source !== 'inline' || !!item.overriddenBy;
  const row = document.createElement(isLocked ? 'div' : 'button');
  row.className = 'row' + (isLocked ? ' locked' : '');
  row.style.position = 'relative';
  if (!isLocked) row.type = 'button';
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = item.value;
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = nameOf(item.value);
  const tag = document.createElement('span');
  tag.className = 'tag';
  row.title = `${item.property}: ${item.value}`;
  row.dataset.property = item.property;
  row.append(swatch, label, tag);
  if (item.source !== 'inline') {
    const file = (item.href || '').split('/').pop() || 'another file';
    tag.textContent = `lives in ${decodeURIComponent(file)}`;
    row.title = `${item.property}: ${item.value} — Retouch cannot edit a separate CSS file yet.`;
    return row;
  }
  if (item.overriddenBy) {
    const isDark = /dark/i.test(item.overriddenBy);
    let shortSel = item.overriddenBy.trim();
    if (shortSel.length > 18) shortSel = shortSel.slice(0, 17) + '…';
    tag.textContent = isDark ? 'set by dark theme' : `set by ${shortSel}`;
    const cause = isDark ? 'dark theme' : item.overriddenBy;
    row.title = `The page’s ${cause} is setting this colour right now, so Retouch won’t change the base colour you can’t see. Switch the page back to its normal theme to edit it, or use Prompt mode to ask your AI to change the dark theme.`;
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
    if (source === 'inline' && rows.length > 0 && rows.every((i) => i.overriddenBy)) {
      const p = document.createElement('p');
      p.className = 'empty';
      const isDark = rows.some((i) => /dark/i.test(i.overriddenBy));
      const firstOverride = rows.find((i) => i.overriddenBy)?.overriddenBy || '';
      let shortSel = firstOverride.trim();
      if (shortSel.length > 18) shortSel = shortSel.slice(0, 17) + '…';
      const cause = isDark ? 'dark theme' : shortSel;
      p.textContent = `The page’s ${cause} is setting these colours right now, so Retouch won’t change the base colours you can’t see. Switch the page back to its normal theme to edit them, or use Prompt mode to ask your AI to change the dark theme.`;
      els.theme.appendChild(p);
    }
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
els.colors.addEventListener('click', (e) => { e.stopPropagation(); closeHistory(); toggleTheme(); });
els.historyBtn.addEventListener('click', (e) => { e.stopPropagation(); closeTheme(); toggleHistory(); });
document.addEventListener('click', (e) => {
  if (!els.theme.hidden && !els.theme.contains(e.target)) closeTheme();
  if (!els.historyPop.hidden && !els.historyPop.contains(e.target) && e.target !== els.historyBtn && !els.historyBtn.contains(e.target)) closeHistory();
});
els.undoBtn.addEventListener('click', () => post({ type: 'undo' }));
els.redoBtn.addEventListener('click', () => post({ type: 'redo' }));
els.discard.addEventListener('click', () => { post({ type: 'reset' }); state.pendingImages.clear(); closeTheme(); closeHistory(); state.canUndo = false; state.canRedo = false; setStatus('Changes discarded'); render(); });
els.dismiss.addEventListener('click', () => {
  els.banner.hidden = true;
  els.dropmat.hidden = true;
  if (els.status.classList.contains('error')) setStatus('');
});
els.status.addEventListener('click', (e) => {
  if (e.target && e.target.classList.contains('status-action')) return;
  if (els.status.classList.contains('error')) {
    setStatus('');
    els.banner.hidden = true;
    els.dropmat.hidden = true;
  }
});
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
// After the third successful save, a card asks for a store review or a post on X; "Not now" or
// ignoring it brings it back once at the 25th save, × never. Both are plain links the user clicks:
// nothing is sent, and nothing from the page goes into them. The count lives in the viewer's own
// localStorage, so it needs no storage permission; if that is unavailable the card never shows.
const SHARE_KEY = 'retouch:share';
const STORE_REVIEWS = 'https://chromewebstore.google.com/detail/retouch-fix-the-html-your/ckcjhaefngkggppffpbhmokbopcaloeh/reviews';
const SHARE_TEXT = 'Fixed the HTML page my AI made in seconds: clicked, typed, and Retouch saved it straight to the file. No re-prompting.';
const SHARE_POST = `https://x.com/intent/post?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent('https://fastretouch.com')}&via=doubts`;
function readShare() {
  try { return JSON.parse(localStorage.getItem(SHARE_KEY)) || { saves: 0, ask: 'first' }; }
  catch (e) { return null; }
}
function writeShare(s) { try { localStorage.setItem(SHARE_KEY, JSON.stringify(s)); } catch (e) { /* card just won't come back */ } }
function countSaveForShare() {
  const s = readShare();
  if (!s) return;
  s.saves++;
  const due = (s.ask === 'first' && s.saves >= 3) || (s.ask === 'again' && s.saves >= 25);
  if (due) s.ask = s.ask === 'first' ? 'again' : 'never';
  writeShare(s);
  if (due) setTimeout(() => showShare(s.saves), 1200);
}
function showShare(saves) {
  if (state.promptMode) return;
  shareEls.title.textContent = `That's ${saves} saves without re-prompting your AI.`;
  shareEls.review.href = STORE_REVIEWS;
  shareEls.post.href = SHARE_POST;
  shareEls.card.hidden = false;
  logLine(`${new Date().toISOString()} [info] share card shown at save ${saves}`);
  armShareTimer();
}
// It leaves on its own after 20 s, but not while the pointer or keyboard focus is on it.
function armShareTimer() {
  clearTimeout(shareTimer);
  shareTimer = setTimeout(hideShare, 20000);
}
function hideShare() {
  clearTimeout(shareTimer);
  shareEls.card.hidden = true;
}
function neverShare() {
  const s = readShare();
  if (s) { s.ask = 'never'; writeShare(s); }
  hideShare();
}
shareEls.card.addEventListener('pointerenter', () => clearTimeout(shareTimer));
shareEls.card.addEventListener('pointerleave', armShareTimer);
shareEls.card.addEventListener('focusin', () => clearTimeout(shareTimer));
shareEls.card.addEventListener('focusout', armShareTimer);
shareEls.review.addEventListener('click', neverShare);
shareEls.post.addEventListener('click', neverShare);
shareEls.later.addEventListener('click', hideShare);
shareEls.close.addEventListener('click', neverShare);

// Feedback from the one moment it matters most: a failed save. A mailto the user reviews and sends
// themselves, with the error and version only (no page contents, no file path), so nothing leaves
// the machine unless they choose to send it.
els.report.addEventListener('click', () => {
  const version = (chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest().version : '';
  const body = `What I was doing:\n\n\nWhat Retouch said:\n${els.bannerText.textContent}\n\nRetouch ${version} · ${navigator.userAgent}`;
  window.open(`mailto:hello@fastretouch.com?subject=${encodeURIComponent('Retouch ' + version + ': save problem')}&body=${encodeURIComponent(body)}`);
});
els.details.addEventListener('click', async () => {
  const text = await diagnostics();
  try { await navigator.clipboard.writeText(text); els.details.textContent = 'Copied'; }
  catch (e) { prompt('Copy these details:', text); }
  setTimeout(() => { els.details.textContent = 'Copy Details'; }, 1500);
});
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (state.editing && mod && !e.altKey) {
    const k = e.key.toLowerCase();
    if (!e.shiftKey && k === 'z') {
      e.preventDefault();
      post({ type: 'undo' });
      return;
    }
    if ((e.shiftKey && k === 'z') || (!e.shiftKey && k === 'y')) {
      e.preventDefault();
      post({ type: 'redo' });
      return;
    }
  }
  if (e.key === 'Escape') {
    if (!els.theme.hidden) closeTheme();
    if (state.activeItemId) setActiveMarker(null);
    if (state.wholeBubbleOpen) closeWholeBubble(false);
  }
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
window.RetouchVault = RetouchVault;
window.RetouchHistory = RetouchHistory;
window.retouchDebug = { collect, state, diagnostics, requestTheme, setStatus, updateHistoryButton };
render();
