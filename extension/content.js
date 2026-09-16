// Runs inside the file:// page when it is embedded in the Retouch viewer. Inert everywhere else.
// Makes text-bearing elements editable on click and tracks two kinds of change:
//   text     the element's structure is unchanged; each altered run of text is patched exactly
//   element  formatting was added or removed; the whole element is replaced by its new markup
// A selection popover offers bold, italic, code, link, and the page's own classes, colors and fonts
// harvested from its stylesheets. Only talks to the extension's own origin.
(function () {
  if (window === window.top || window.__retouch) return;
  const EXT_ORIGIN = 'chrome-extension://' + chrome.runtime.id;
  const state = { editing: false, edited: new Map(), images: new Map(), hover: null, styled: false, palette: null, pending: new Map(), pop: null, savedRange: null, menu: null, imgPanel: null, imgTarget: null };
  window.__retouch = state;

  const send = (msg) => window.parent.postMessage(Object.assign({ retouch: true }, msg), EXT_ORIGIN);
  const UI = '[data-retouch-ui]';
  const isUi = (node) => { const el = node && (node.nodeType === 1 ? node : node.parentElement); return !!(el && el.closest(UI)); };
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT', 'SELECT', 'BUTTON', 'SVG']);

  // ---------- styles injected into the page ----------
  function ensureStyle() {
    if (state.styled) return;
    state.styled = true;
    const style = document.createElement('style');
    style.id = 'retouch-style';
    style.setAttribute('data-retouch-ui', '');
    const FONT = chrome.runtime.getURL('fonts/Urbanist.woff2');
    style.textContent = `
      @font-face { font-family: RetouchUrbanist; src: url(${FONT}) format('woff2'); font-weight: 300 800; }
      /* Hairline mixed from the element's own text color, so it contrasts on any page background. */
      html.retouch-editing [data-retouch-target], html.retouch-editing [contenteditable="plaintext-only"], [data-retouch-reveal] {
        outline: 1.5px solid transparent; outline-offset: 4px; border-radius: 6px;
        transition: outline-color .18s ease, outline-offset .24s cubic-bezier(.2,.8,.2,1); }
      html.retouch-editing [data-retouch-block][data-retouch-target], html.retouch-editing [data-retouch-block][contenteditable="plaintext-only"], [data-retouch-block][data-retouch-reveal] { outline-offset: 10px; }
      html.retouch-editing [data-retouch-cell][data-retouch-target], html.retouch-editing [data-retouch-cell][contenteditable="plaintext-only"], [data-retouch-cell][data-retouch-reveal] { outline-offset: -3px; border-radius: 4px; }
      html.retouch-editing [data-retouch-target] { outline-color: color-mix(in srgb, currentColor 22%, transparent); cursor: text; }
      /* Only the block being edited right now carries the hairline. Changed blocks show their yellow mark alone. */
      html.retouch-editing [contenteditable="plaintext-only"]:focus { outline-color: color-mix(in srgb, currentColor 55%, transparent); }
      /* Focus mode: while a block is being edited, everything that is not on the path to it fades back. */
      html.retouch-editing body > :not([data-retouch-ui]), html.retouch-editing [data-retouch-path] > * { transition: opacity .38s cubic-bezier(.2,.8,.2,1); }
      html.retouch-focus body > :not([data-retouch-path]):not([contenteditable]):not([data-retouch-ui]),
      html.retouch-focus [data-retouch-path] > :not([data-retouch-path]):not([contenteditable]):not([data-retouch-ui]) { opacity: .42; }
      /* Changes are yellow because yellow means something: a highlighter on changed words, a slim bar beside a changed block. */
      html.retouch-editing [data-retouch-changed] { --retouch-mark: color-mix(in srgb, #f4c05f 78%, currentColor); background: color-mix(in srgb, var(--retouch-mark) 45%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--retouch-mark) 45%, transparent); border-radius: 4px;
        -webkit-box-decoration-break: clone; box-decoration-break: clone; transition: background .2s ease, box-shadow .2s ease; }
      html.retouch-editing [data-retouch-block][data-retouch-changed] { background: none; box-shadow: -20px 0 0 -17px var(--retouch-mark); border-radius: 6px; }
      html.retouch-editing [data-retouch-block][data-retouch-changed] { outline-offset: 10px; }
      html.retouch-editing [data-retouch-empty] { min-height: 1.3em; min-width: 1.5em; }
      html.retouch-editing [data-retouch-empty]:not([contenteditable])::before { content: "\\200B"; }
      html.retouch-editing img[data-retouch-target] { cursor: pointer; }
      html.retouch-editing img[data-retouch-changed] { background: none; box-shadow: 0 0 0 3px color-mix(in srgb, #f4c05f 78%, currentColor); }
      #retouch-img { all: initial; position: fixed; z-index: 2147483647; display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 18px;
        color: #f5f5f7; opacity: 0; transform: translateY(8px) scale(.94); pointer-events: none; min-width: 300px;
        background: linear-gradient(115deg, rgba(154,92,163,.42), rgba(217,179,226,.22) 45%, rgba(244,192,95,.34)), rgba(22,22,25,.72);
        -webkit-backdrop-filter: blur(22px) saturate(170%); backdrop-filter: blur(22px) saturate(170%);
        box-shadow: 0 14px 44px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.16);
        font: 14px/1.2 RetouchUrbanist, -apple-system, BlinkMacSystemFont, system-ui, sans-serif; -webkit-font-smoothing: antialiased;
        transition: opacity .18s ease, transform .32s cubic-bezier(.34,1.4,.44,1); }
      #retouch-img.on { opacity: 1; transform: none; pointer-events: auto; }
      #retouch-img .row { display: flex; align-items: center; gap: 6px; }
      #retouch-img .lbl { color: rgba(255,255,255,.62); font-size: 12px; font-weight: 500; min-width: 56px; }
      #retouch-img button { all: initial; cursor: default; color: #f5f5f7; font: inherit; font-weight: 600; height: 32px; padding: 0 13px; border-radius: 999px; display: inline-flex; align-items: center;
        background: rgba(255,255,255,.1); transition: background .16s ease, transform .22s cubic-bezier(.34,1.4,.44,1); }
      #retouch-img button:hover { background: rgba(255,255,255,.18); } #retouch-img button:active { transform: scale(.94); }
      #retouch-img button.primary { background: #fff; color: #0b0b0d; }
      #retouch-img button.ghost { background: transparent; color: rgba(255,255,255,.7); }
      #retouch-img input[type="text"] { all: initial; font: inherit; font-weight: 500; color: #f5f5f7; background: rgba(255,255,255,.12); border-radius: 999px; padding: 0 14px; height: 32px; flex: 1; transition: box-shadow .16s ease; }
      #retouch-img input[type="text"]:focus { box-shadow: 0 0 0 2px rgba(244,192,95,.8); }
      #retouch-img .meta { color: rgba(255,255,255,.62); font-size: 12px; font-weight: 500; padding: 0 4px; }
      [data-retouch-reveal] { animation: retouch-breathe 1s cubic-bezier(.2,.8,.2,1) both; }
      @keyframes retouch-breathe { 0% { outline-color: transparent; outline-offset: 2px; } 35% { outline-color: color-mix(in srgb, currentColor 40%, transparent); } 100% { outline-color: transparent; } }
      [data-retouch-saved] { animation: retouch-settle 1.4s cubic-bezier(.2,.8,.2,1) both; border-radius: 4px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
      [data-retouch-block][data-retouch-saved] { animation-name: retouch-settle-block; border-radius: 6px; }
      @keyframes retouch-settle { from { background: rgba(244,192,95,.55); box-shadow: 0 0 0 3px rgba(244,192,95,.55); } to { background: transparent; box-shadow: 0 0 0 3px transparent; } }
      @keyframes retouch-settle-block { from { box-shadow: -20px 0 0 -17px color-mix(in srgb, #f4c05f 78%, currentColor); } to { box-shadow: -20px 0 0 -17px transparent; } }
      #retouch-pop { all: initial; position: fixed; z-index: 2147483647; display: flex; flex-direction: column; padding: 5px; border-radius: 20px;
        color: #f5f5f7; opacity: 0; transform: translateY(8px) scale(.94); pointer-events: none;
        background: linear-gradient(115deg, rgba(154,92,163,.42), rgba(217,179,226,.22) 45%, rgba(244,192,95,.34)), rgba(22,22,25,.72);
        -webkit-backdrop-filter: blur(22px) saturate(170%); backdrop-filter: blur(22px) saturate(170%);
        box-shadow: 0 14px 44px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.16);
        font: 14px/1.2 RetouchUrbanist, -apple-system, BlinkMacSystemFont, system-ui, sans-serif; -webkit-font-smoothing: antialiased; letter-spacing: .1px;
        transition: opacity .18s ease, transform .32s cubic-bezier(.34,1.4,.44,1), left .26s cubic-bezier(.2,.8,.2,1), top .26s cubic-bezier(.2,.8,.2,1); }
      #retouch-pop.on { opacity: 1; transform: none; pointer-events: auto; }
      #retouch-pop.jump { transition: opacity .18s ease, transform .32s cubic-bezier(.34,1.4,.44,1); }
      #retouch-pop .row { display: flex; align-items: center; gap: 3px; }
      #retouch-pop .sep { width: 1px; height: 18px; margin: 0 5px; background: rgba(255,255,255,.22); }
      #retouch-pop button { all: initial; cursor: default; color: #f5f5f7; font: inherit; font-weight: 600; height: 32px; min-width: 32px; padding: 0 11px; border-radius: 999px;
        display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: background .16s ease, transform .22s cubic-bezier(.34,1.4,.44,1), color .16s ease; }
      #retouch-pop button:hover { background: rgba(255,255,255,.14); }
      #retouch-pop button:active { transform: scale(.94); }
      #retouch-pop button.active { background: #fff; color: #0b0b0d; }
      #retouch-pop button.b { font-weight: 800; } #retouch-pop button.i { font-style: italic; font-family: Georgia, serif; font-weight: 500; } #retouch-pop button.c { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
      #retouch-pop .menu { display: flex; flex-direction: column; height: 0; opacity: 0; overflow: hidden; min-width: 250px; max-width: 360px; interpolate-size: allow-keywords;
        transition: height .3s cubic-bezier(.2,.8,.2,1), opacity .2s ease, margin-top .3s cubic-bezier(.2,.8,.2,1), padding .3s; margin-top: 0; padding: 0 2px; }
      #retouch-pop .menu.on { height: auto; max-height: 280px; opacity: 1; overflow-y: auto; margin-top: 5px; padding: 6px 4px 4px; border-top: 1px solid rgba(255,255,255,.14);
        scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.28) transparent; }
      #retouch-pop .menu::-webkit-scrollbar { width: 6px; } #retouch-pop .menu::-webkit-scrollbar-thumb { background: rgba(255,255,255,.28); border-radius: 3px; } #retouch-pop .menu::-webkit-scrollbar-track { background: transparent; }
      #retouch-pop .menu.grid.on { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 2px 6px; align-content: start; }
      #retouch-pop .menu.grid .hint { grid-column: 1 / -1; }
      #retouch-pop .menu button { justify-content: flex-start; height: 34px; border-radius: 12px; margin: 1px 0; width: auto; align-self: stretch; }
      #retouch-pop .menu .sw { width: 16px; height: 16px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(255,255,255,.3); flex: none; }
      #retouch-pop .menu .sw.none { background: transparent; box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.4); }
      #retouch-pop .menu .sub { color: rgba(255,255,255,.62); font-size: 12px; font-weight: 500; margin-left: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px; }
      #retouch-pop .menu .hint { color: rgba(255,255,255,.6); font-size: 12px; font-weight: 500; padding: 6px 12px 6px; white-space: normal; line-height: 1.35; }
      #retouch-pop .chip { display: inline-block; background: #fff; color: #1d1d1f; padding: 3px 10px; border-radius: 999px; line-height: 1.3; max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #retouch-pop input { all: initial; font: inherit; font-weight: 500; color: #f5f5f7; background: rgba(255,255,255,.12); border-radius: 999px; padding: 0 14px; height: 32px; width: 250px; transition: box-shadow .16s ease; }
      #retouch-pop input:focus { box-shadow: 0 0 0 2px rgba(244,192,95,.8); }
      @media (prefers-reduced-motion: reduce) { #retouch-pop, #retouch-pop *, [data-retouch-saved] { transition: none !important; animation: none !important; } }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---------- DOM helpers ----------
  const textFilter = {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || SKIP.has(p.tagName) || p.closest(UI)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  };
  function textNodes(root) {
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, textFilter);
    let n;
    while ((n = w.nextNode())) out.push(n);
    return out;
  }
  // Text laid out as slots between the element's (recursive) child elements, plus a skeleton of
  // that structure. Same skeleton means the edit only touched text.
  function slots(el) {
    const texts = [];
    const skel = [];
    (function walk(node) {
      let buf = '';
      for (const child of node.childNodes) {
        if (child.nodeType === 3) buf += child.data;
        else if (child.nodeType === 1 && !child.matches(UI)) {
          texts.push(buf); buf = '';
          skel.push('<' + child.tagName);
          if (!SKIP.has(child.tagName)) walk(child);
          skel.push('>');
        }
      }
      texts.push(buf);
    })(el);
    return { skeleton: skel.join(''), texts };
  }
  function countTags(el) {
    const counts = {};
    for (const d of el.querySelectorAll('*')) {
      if (d.closest(UI)) continue;
      const name = d.tagName.toLowerCase();
      counts[name] = (counts[name] || 0) + 1;
    }
    return counts;
  }
  function isTextBearing(el) {
    if (SKIP.has(el.tagName) || el.matches(UI)) return false;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.data.trim()) return true;
    return false;
  }
  // Elements that legitimately start empty and can take text: cells, paragraphs, headings, list items.
  const EMPTY_OK = new Set(['TD', 'TH', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DT', 'DD', 'BLOCKQUOTE', 'FIGCAPTION', 'CAPTION', 'SUMMARY', 'LABEL', 'SPAN', 'DIV', 'A', 'STRONG', 'EM', 'B', 'I', 'CODE']);
  const isEmptyLeaf = (el) => EMPTY_OK.has(el.tagName) && !el.children.length && !el.textContent.trim() && !el.matches(UI);
  const emptyInSource = (el) => { const rec = state.edited.get(el); return rec ? !!rec.emptyOrigin : !el.textContent.trim(); };
  function pickTarget(node) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    if (isUi(el)) return null;
    while (el && el !== document.body && el !== document.documentElement) {
      if (isTextBearing(el) || isEmptyLeaf(el)) return el;
      el = el.parentElement;
    }
    return null;
  }
  function markEmpties(on) {
    if (!on) { for (const e of document.querySelectorAll('[data-retouch-empty]')) e.removeAttribute('data-retouch-empty'); return; }
    for (const el of document.body.querySelectorAll('td, th, p, li, h1, h2, h3, h4, h5, h6, dd, dt, figcaption, caption')) {
      if (isEmptyLeaf(el)) el.setAttribute('data-retouch-empty', '');
    }
  }
  // The element's markup as it should appear in the file: without our attributes and UI, and with
  // replaced images pointing at their file name rather than the in-memory preview.
  function cleanInnerHtml(el) {
    const clone = el.cloneNode(true);
    cleanClone(clone);
    let html = clone.innerHTML;
    if (/<br>$/.test(html)) html = html.slice(0, -4);   // the browser's placeholder break in an emptied block
    return html;
  }
  function cleanClone(clone) {
    for (const ui of clone.querySelectorAll(UI)) ui.remove();
    for (const node of [clone, ...clone.querySelectorAll('*')]) {
      if (node.tagName === 'IMG' && node.hasAttribute('data-retouch-src')) node.setAttribute('src', node.getAttribute('data-retouch-src'));
      node.removeAttribute('contenteditable');
      for (const a of [...node.attributes]) if (a.name.startsWith('data-retouch-')) node.removeAttribute(a.name);
      if (node.style && node.style.animationDelay) { node.style.animationDelay = ''; }
      if (node.getAttribute('style') === '') node.removeAttribute('style');
      if (node.getAttribute('class') === '') node.removeAttribute('class');
    }
  }
  function cleanOuterHtml(el) {
    const clone = el.cloneNode(true);
    cleanClone(clone);
    return clone.outerHTML;
  }
  // ---------- editing state ----------
  const isBlock = (el) => !/^inline/.test(getComputedStyle(el).display);
  const isCell = (el) => getComputedStyle(el).display === 'table-cell';
  function markShape(el) {
    if (isCell(el)) el.setAttribute('data-retouch-cell', '');
    else if (isBlock(el)) el.setAttribute('data-retouch-block', '');
  }
  function unmarkShape(el) { el.removeAttribute('data-retouch-block'); el.removeAttribute('data-retouch-cell'); }
  function beginEdit(el) {
    if (state.edited.has(el)) return;
    if (el.closest('[contenteditable]')) return;
    if (el.querySelector('[contenteditable]')) return;
    markShape(el);
    const tn = textNodes(el).filter((n) => n.data.trim());
    state.edited.set(el, {
      html: el.innerHTML, slots: slots(el), tagCounts: countTags(el), emptyOrigin: isEmptyLeaf(el),
      firstText: tn.length ? tn[0].data : null, lastText: tn.length ? tn[tn.length - 1].data : null
    });
    el.setAttribute('contenteditable', 'plaintext-only');
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKeydown);
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);
  }
  // Focus mode: mark the path from body to the focused block; CSS fades everything off the path.
  function setFocusPath(el) {
    clearFocusPath();
    let cur = el.parentElement;
    while (cur && cur !== document.documentElement) { cur.setAttribute('data-retouch-path', ''); cur = cur.parentElement; }
    document.documentElement.classList.add('retouch-focus');
  }
  function clearFocusPath() {
    for (const n of document.querySelectorAll('[data-retouch-path]')) n.removeAttribute('data-retouch-path');
    document.documentElement.classList.remove('retouch-focus');
  }
  function onFocus(e) { setFocusPath(e.currentTarget); }
  function onBlur(e) {
    if (e.relatedTarget && isUi(e.relatedTarget)) return;   // moving into the popover keeps the block live
    clearFocusPath();
    const el = e.currentTarget;
    const rec = state.edited.get(el);
    if (!rec) return;
    const d = diffElement(el, rec);
    if (d.kind === 'text' && !d.changes.length) release(el);  // clicked but unchanged: leave no trace
  }
  function release(el) {
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-retouch-changed');
    unmarkShape(el);
    el.removeEventListener('input', onInput);
    el.removeEventListener('keydown', onKeydown);
    el.removeEventListener('focus', onFocus);
    el.removeEventListener('blur', onBlur);
    state.edited.delete(el);
    if (state.hover === el) el.setAttribute('data-retouch-target', '');
    refresh();
  }
  function diffElement(el, rec) {
    if (rec.emptyOrigin) {
      const html = cleanInnerHtml(el);
      return html.trim() ? { kind: 'insert', changes: [] } : { kind: 'text', changes: [] };
    }
    const now = slots(el);
    if (now.skeleton === rec.slots.skeleton && now.texts.length === rec.slots.texts.length) {
      const changes = [];
      rec.slots.texts.forEach((before, i) => { if (before !== now.texts[i]) changes.push({ before, after: now.texts[i] }); });
      return { kind: 'text', changes };
    }
    if (!rec.firstText) return { kind: 'structural' };
    return { kind: 'element' };
  }
  function refresh() {
    let count = 0;
    let structural = 0;
    for (const [el, rec] of state.edited) {
      const d = diffElement(el, rec);
      const changed = d.kind === 'structural' || d.kind === 'element' || d.changes.length > 0;
      el.toggleAttribute('data-retouch-changed', changed);
      if (d.kind === 'structural') structural++;
      else if (d.kind === 'element' || d.kind === 'insert') count++;
      else count += d.changes.length;
    }
    for (const [img, rec] of state.images) {
      const n = (rec.newSrc != null && rec.newSrc !== rec.originalSrc ? 1 : 0) + (rec.newAlt != null && rec.newAlt !== (rec.originalAlt || '') ? 1 : 0);
      img.toggleAttribute('data-retouch-changed', n > 0);
      count += n;
    }
    send({ type: 'changes', count, structural });
  }
  function onInput() { refresh(); positionPopover(); }

  // Changes in document order, each with an anchor: the nearest preceding text of 3+ characters
  // outside any edited element. The patcher uses it to pick the right occurrence.
  function collect() {
    const editedEls = [...state.edited.keys()].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const allText = textNodes(document.body || document.documentElement);
    const insideEdited = (node) => editedEls.some((el) => el.contains(node));
    const anchorNodeBefore = (el) => {
      for (let j = allText.length - 1; j >= 0; j--) {
        const t = allText[j];
        if (!(el.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING)) continue;
        if (insideEdited(t)) continue;
        if (t.data.trim().length >= 3) return t;
      }
      return null;
    };
    const anchorBefore = (el) => { const n = anchorNodeBefore(el); return n ? n.data : ''; };
    const between = (a, b) => (n) => (!a || (a.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) && (b.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING);
    const changes = [];
    let structural = 0;
    for (const el of editedEls) {
      const rec = state.edited.get(el);
      const d = diffElement(el, rec);
      if (d.kind === 'structural') { structural++; continue; }
      const anchor = anchorBefore(el);
      if (d.kind === 'insert') {
        const aNode = anchorNodeBefore(el);
        const inRange = between(aNode, el);
        let skip = 0;
        for (const c of document.body.getElementsByTagName(el.tagName)) if (c !== el && !isUi(c) && inRange(c) && emptyInSource(c)) skip++;
        changes.push({ kind: 'empty', tag: el.tagName.toLowerCase(), skip, afterHtml: cleanInnerHtml(el), anchor });
        continue;
      }
      if (d.kind === 'element') {
        changes.push({ kind: 'element', tag: el.tagName.toLowerCase(), firstText: rec.firstText, lastText: rec.lastText, tagCounts: rec.tagCounts, afterHtml: cleanOuterHtml(el), anchor });
      } else {
        for (const c of d.changes) changes.push({ before: c.before, after: c.after, anchor });
      }
    }
    const imgs = [...state.images.keys()].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    for (const img of imgs) {
      const rec = state.images.get(img);
      const aNode = anchorNodeBefore(img);
      const anchor = aNode ? aNode.data : '';
      const inRange = between(aNode, img);
      const originalSrcOf = (c) => (state.images.get(c) ? state.images.get(c).originalSrc : c.getAttribute('src'));
      if (rec.newSrc != null && rec.newSrc !== rec.originalSrc) {
        let skip = 0;
        for (const c of document.images) if (c !== img && inRange(c) && originalSrcOf(c) === rec.originalSrc) skip++;
        changes.push({ kind: 'attr', tag: 'img', attr: 'src', before: rec.originalSrc, after: rec.newSrc, pendingId: rec.pendingId || null, skip, anchor });
      }
      if (rec.newAlt != null && rec.newAlt !== (rec.originalAlt || '')) {
        const before = rec.originalAlt == null ? null : rec.originalAlt;
        let skip = 0;
        for (const c of document.images) {
          if (c === img || !inRange(c)) continue;
          const r2 = state.images.get(c);
          const alt = r2 ? r2.originalAlt : c.getAttribute('alt');
          if ((before == null && alt == null) || alt === before) skip++;
        }
        changes.push({ kind: 'attr', tag: 'img', attr: 'alt', before, after: rec.newAlt, skip, anchor });
      }
    }
    return { changes, structural };
  }
  function resetImages() {
    for (const [img, rec] of state.images) {
      if (rec.blobUrl) URL.revokeObjectURL(rec.blobUrl);
      if (rec.originalSrc == null) img.removeAttribute('src'); else img.setAttribute('src', rec.originalSrc);
      if (rec.originalAlt == null) img.removeAttribute('alt'); else img.setAttribute('alt', rec.originalAlt);
      img.removeAttribute('data-retouch-src');
      img.removeAttribute('data-retouch-changed');
    }
    state.images.clear();
    hideImagePanel();
  }
  function reset() {
    for (const [el, rec] of state.edited) if (el.innerHTML !== rec.html) el.innerHTML = rec.html;
    resetImages();
    endAll();
  }
  function commit(renames) {
    for (const [img, rec] of state.images) {
      if (rec.pendingId && renames && renames[rec.pendingId]) rec.newSrc = renames[rec.pendingId];
      if (rec.newSrc != null) { img.setAttribute('src', rec.newSrc); rec.originalSrc = rec.newSrc; }
      if (rec.newAlt != null) rec.originalAlt = rec.newAlt;
      if (rec.blobUrl) { URL.revokeObjectURL(rec.blobUrl); rec.blobUrl = null; }
      img.removeAttribute('data-retouch-src');
      rec.pendingId = null;
      if (img.hasAttribute('data-retouch-changed')) { img.setAttribute('data-retouch-saved', ''); setTimeout(() => img.removeAttribute('data-retouch-saved'), 1500); }
    }
    for (const [el] of state.edited) {
      if (el.hasAttribute('data-retouch-changed')) {
        el.setAttribute('data-retouch-saved', '');
        setTimeout(() => el.removeAttribute('data-retouch-saved'), 1500);
      }
    }
    for (const [el, rec] of state.edited) {
      const tn = textNodes(el).filter((n) => n.data.trim());
      rec.html = el.innerHTML; rec.slots = slots(el); rec.tagCounts = countTags(el);
      rec.firstText = tn.length ? tn[0].data : null; rec.lastText = tn.length ? tn[tn.length - 1].data : null;
      rec.emptyOrigin = isEmptyLeaf(el);
      if (!rec.emptyOrigin) el.removeAttribute('data-retouch-empty');
    }
    refresh();
  }
  function endAll() {
    for (const [el] of state.edited) {
      el.removeAttribute('contenteditable');
      el.removeAttribute('data-retouch-changed');
      unmarkShape(el);
      el.removeEventListener('input', onInput);
      el.removeEventListener('keydown', onKeydown);
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', onBlur);
    }
    state.edited.clear();
    clearFocusPath();
    if (state.hover) { state.hover.removeAttribute('data-retouch-target'); state.hover = null; }
    hidePopover();
    hideImagePanel();
    send({ type: 'changes', count: 0, structural: 0 });
  }
  // Wordless cue on entering edit mode: every editable block breathes once, in a quick wave.
  function reveal() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const blocks = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (el) => (isUi(el) || SKIP.has(el.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    let el;
    while ((el = w.nextNode())) if (isTextBearing(el) && !el.closest('[data-retouch-reveal]')) blocks.push(el);
    blocks.forEach((b, i) => {
      b.style.animationDelay = Math.min(i * 22, 600) + 'ms';
      b.setAttribute('data-retouch-reveal', '');
    });
    setTimeout(() => { for (const b of blocks) { b.removeAttribute('data-retouch-reveal'); b.style.animationDelay = ''; if (!b.getAttribute('style')) b.removeAttribute('style'); } }, 1900);
  }
  function setEditing(on) {
    ensureStyle();
    state.editing = on;
    document.documentElement.classList.toggle('retouch-editing', on);
    if (on && !state.palette) harvest().then((p) => { state.palette = p; buildPopover(); });
    markEmpties(on);
    if (on) reveal();
    if (!on) reset();
  }

  // ---------- formatting ----------
  const ALIAS = { strong: ['strong', 'b'], em: ['em', 'i'], code: ['code'], a: ['a'] };
  function editableFor(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    const ed = el && el.closest('[contenteditable]');
    return ed && state.edited.has(ed) ? ed : null;
  }
  function selectionInfo() {
    const sel = document.getSelection();
    let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    let ed = range && editableFor(range.commonAncestorContainer);
    if (!ed && state.savedRange) { range = state.savedRange; ed = editableFor(range.commonAncestorContainer); }
    if (!ed) return null;
    return { sel, range, ed };
  }
  function findWrapper(node, names, ed) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== ed) { if (names.includes(el.tagName.toLowerCase())) return el; el = el.parentElement; }
    return null;
  }
  function restoreSelection(range) {
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function wrapSelection(tag, setup) {
    const info = selectionInfo();
    if (!info || info.range.collapsed) return null;
    const { range, ed } = info;
    const w = document.createElement(tag);
    if (setup) setup(w);
    w.appendChild(range.extractContents());
    range.insertNode(w);
    // Drop wrappers emptied by the extraction.
    for (const e of ed.querySelectorAll('strong,b,em,i,code,a,span')) if (!e.textContent && !e.children.length && !e.matches(UI)) e.remove();
    ed.normalize();
    const r = document.createRange();
    r.selectNodeContents(w);
    restoreSelection(r);
    state.savedRange = r.cloneRange();
    afterFormat(ed);
    return w;
  }
  // Character offsets of a range within the editable, and back. Survives normalize().
  function offsetsOf(range, ed) {
    const pre = document.createRange();
    pre.selectNodeContents(ed);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    return { start, end: start + range.toString().length };
  }
  function rangeFromOffsets(ed, start, end) {
    const r = document.createRange();
    let pos = 0;
    let startSet = false;
    for (const t of textNodes(ed)) {
      const next = pos + t.data.length;
      if (!startSet && start <= next) { r.setStart(t, start - pos); startSet = true; }
      if (startSet && end <= next) { r.setEnd(t, end - pos); return r; }
      pos = next;
    }
    if (!startSet) r.selectNodeContents(ed);
    else r.setEnd(ed, ed.childNodes.length);
    return r;
  }
  function unwrap(el, ed) {
    const span = document.createRange();
    span.selectNodeContents(el);
    const { start, end } = offsetsOf(span, ed);
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    ed.normalize();
    const r = rangeFromOffsets(ed, start, end);
    restoreSelection(r);
    state.savedRange = r.cloneRange();
    afterFormat(ed);
  }
  function afterFormat(ed) { refresh(); ed.focus({ preventScroll: true }); positionPopover(); }
  function toggleTag(tag) {
    const info = selectionInfo();
    if (!info) return;
    const existing = findWrapper(info.range.commonAncestorContainer, ALIAS[tag], info.ed);
    if (existing) unwrap(existing, info.ed);
    else { restoreSelection(info.range); wrapSelection(tag); }
  }
  function setLink(href) {
    const info = selectionInfo();
    if (!info) return;
    const existing = findWrapper(info.range.commonAncestorContainer, ['a'], info.ed);
    if (existing) {
      if (href) existing.setAttribute('href', href); else unwrap(existing, info.ed);
      afterFormat(info.ed);
    } else if (href) {
      restoreSelection(info.range);
      wrapSelection('a', (a) => a.setAttribute('href', href));
    }
  }
  // Edits the style attribute as text so values keep the page's own spelling (#d9dee3 stays
  // #d9dee3; going through el.style would rewrite it as rgb()).
  function styleMap(el) {
    const map = new Map();
    for (const part of (el.getAttribute('style') || '').split(';')) {
      const i = part.indexOf(':');
      if (i > 0) map.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
    }
    return map;
  }
  function setInlineStyle(el, prop, value) {
    const map = styleMap(el);
    if (value) map.set(prop, value); else map.delete(prop);
    const text = [...map].map(([k, v]) => `${k}: ${v}`).join('; ');
    if (text) el.setAttribute('style', text); else el.removeAttribute('style');
  }
  // Inline style from the page's palette. Empty value removes that property from the nearest
  // styled span (unwrapping it when nothing is left). A collapsed selection styles the whole element.
  function applyStyle(prop, value) {
    const info = selectionInfo();
    if (!info) return;
    const { range, ed } = info;
    if (!value) {
      let el = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
      while (el && el !== ed.parentElement) {
        if (el.nodeType === 1 && styleMap(el).has(prop)) {
          setInlineStyle(el, prop, '');
          if (el !== ed && el.tagName === 'SPAN' && !el.getAttribute('style') && !el.className) unwrap(el, ed); else afterFormat(ed);
          return;
        }
        el = el.parentElement;
      }
      return;
    }
    if (range.collapsed) { setInlineStyle(ed, prop, value); afterFormat(ed); return; }
    const existing = findWrapper(range.commonAncestorContainer, ['span'], ed);
    if (existing && existing.textContent === range.toString()) { setInlineStyle(existing, prop, value); afterFormat(ed); return; }
    restoreSelection(range);
    wrapSelection('span', (s) => setInlineStyle(s, prop, value));
  }
  function applyClass(name, inlineSafe) {
    const info = selectionInfo();
    if (!info) return;
    const { range, ed } = info;
    if (!inlineSafe || range.collapsed) { ed.classList.toggle(name); afterFormat(ed); return; }
    const existing = findWrapper(range.commonAncestorContainer, ['span'], ed);
    if (existing && existing.classList.contains(name)) {
      existing.classList.remove(name);
      if (!existing.className && !existing.getAttribute('style')) unwrap(existing, ed); else afterFormat(ed);
      return;
    }
    restoreSelection(range);
    wrapSelection('span', (s) => s.classList.add(name));
  }

  // ---------- harvesting the page's own styles ----------
  const INLINE_PROPS = new Set(['color', 'background', 'background-color', 'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'text-decoration', 'text-decoration-line', 'text-decoration-color', 'text-decoration-style', 'text-transform', 'letter-spacing', 'word-spacing', 'opacity',
    'text-shadow', 'border-bottom', 'border-radius', 'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom', 'white-space', 'font-stretch', 'line-height']);
  const COLOR_PROPS = ['color', 'background-color', 'border-color', 'border-top-color', 'border-bottom-color', 'border-left-color', 'border-right-color', 'outline-color', 'text-decoration-color'];
  function fetchViaViewer(url) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      state.pending.set(id, resolve);
      send({ type: 'fetch-text', id, url });
      setTimeout(() => { if (state.pending.has(id)) { state.pending.delete(id); resolve(null); } }, 4000);
    });
  }
  function collectRules(list, out) {
    for (const r of list) {
      if (r.type === CSSRule.STYLE_RULE) out.push(r);
      else if (r.cssRules) collectRules(r.cssRules, out);
    }
  }
  async function harvest() {
    const rules = [];
    const rawTexts = [];
    for (const sheet of document.styleSheets) {
      if (sheet.ownerNode && sheet.ownerNode.matches && sheet.ownerNode.matches(UI)) continue;
      let list = null;
      try { list = sheet.cssRules; } catch (e) { list = null; }
      if (sheet.ownerNode && sheet.ownerNode.tagName === 'STYLE') rawTexts.push(sheet.ownerNode.textContent);
      else if (sheet.href && /^file:/i.test(sheet.href)) {
        const text = await fetchViaViewer(sheet.href);
        if (text) {
          rawTexts.push(text);
          if (!list) { try { const s = new CSSStyleSheet(); s.replaceSync(text); list = s.cssRules; } catch (e) { /* unparsable */ } }
        }
      }
      if (list) collectRules(list, rules);
    }
    const probe = document.createElement('span');
    // The CSS object model normalizes colors to rgb(); recover the page's own spelling from the raw text.
    const spelling = new Map();
    for (const raw of rawTexts) {
      for (const tok of raw.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi) || []) {
        probe.style.color = '';
        probe.style.color = tok;
        if (probe.style.color && !spelling.has(probe.style.color)) spelling.set(probe.style.color, tok);
      }
    }
    const bodyFontPx = parseFloat(getComputedStyle(document.body || document.documentElement).fontSize) || 16;
    const D = self.RetouchDescribe;
    const classDecls = new Map();
    const colors = new Map();
    const fonts = new Map();
    for (const r of rules) {
      const props = Array.from(r.style);
      if (!props.length) continue;
      for (const sel of r.selectorText.split(',')) {
        const m = /^(?:[a-z][a-z0-9]*)?\.([A-Za-z_][\w-]*)$/i.exec(sel.trim());
        if (!m) continue;
        const decl = classDecls.get(m[1]) || {};
        for (const p of props) decl[p] = r.style.getPropertyValue(p);
        classDecls.set(m[1], decl);
      }
      for (const p of COLOR_PROPS) {
        const v = r.style.getPropertyValue(p);
        if (!v) continue;
        for (const tok of v.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b[a-z]{3,20}\b/gi) || []) {
          if (/^(transparent|inherit|initial|currentcolor|unset|none|auto)$/i.test(tok)) continue;
          probe.style.color = '';
          probe.style.color = tok;
          const css = probe.style.color;
          if (!css || /rgba\([^)]*,\s*0\)$/.test(css)) continue;
          const e = colors.get(css) || { value: spelling.get(css) || tok, css, name: D.colorName(css), uses: 0 };
          e.uses++;
          colors.set(css, e);
        }
      }
      const ff = r.style.getPropertyValue('font-family');
      if (ff) {
        const f = D.fontLabel(ff);
        const e = fonts.get(ff) || { value: ff, label: f.label, kind: f.kind, uses: 0 };
        e.uses++;
        fonts.set(ff, e);
      }
    }
    const classes = new Map();
    for (const [name, decl] of classDecls) {
      const props = Object.keys(decl);
      const inlineSafe = props.every((p) => INLINE_PROPS.has(p) || p.startsWith('font-') || p.startsWith('text-decoration'));
      const d = D.describeRule(decl, { bodyFontPx });
      classes.set(name, { name, label: D.humanize(name), inlineSafe, summary: d.summary, preview: d.preview });
    }
    // Two values that share a name ("Gray" for #52606d and #6e6e73) collapse into the more used one.
    const byName = new Map();
    for (const c of [...colors.values()].sort((a, b) => b.uses - a.uses)) if (!byName.has(c.name)) byName.set(c.name, c);
    return {
      classes: [...classes.values()].sort((a, b) => a.name.localeCompare(b.name)),
      colors: [...byName.values()],
      fonts: [...fonts.values()].sort((a, b) => b.uses - a.uses)
    };
  }

  // ---------- popover ----------
  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else e.setAttribute(k, v); }
    for (const c of children || []) e.appendChild(c);
    return e;
  }
  function buildPopover() {
    if (state.pop) state.pop.remove();
    const pop = el('div', { id: 'retouch-pop', 'data-retouch-ui': '' });
    const row = el('div', { class: 'row' });
    const btn = (label, cls, title, onClick) => { const b = el('button', { class: cls || '', title, text: label }); b.addEventListener('click', onClick); return b; };
    row.appendChild(btn('B', 'b', 'Bold (⌘B)', () => toggleTag('strong')));
    row.appendChild(btn('I', 'i', 'Italic (⌘I)', () => toggleTag('em')));
    row.appendChild(btn('</>', 'c', 'Code', () => toggleTag('code')));
    row.appendChild(btn('Link', '', 'Link (⌘K)', () => openMenu('link')));
    const p = state.palette || { classes: [], colors: [], fonts: [] };
    if (p.classes.length || p.colors.length || p.fonts.length) row.appendChild(el('div', { class: 'sep' }));
    if (p.classes.length) row.appendChild(btn('Styles ▾', '', 'Classes defined by this page', () => openMenu('styles')));
    if (p.colors.length) row.appendChild(btn('Color ▾', '', 'Colors used by this page', () => openMenu('colors')));
    if (p.fonts.length) row.appendChild(btn('Font ▾', '', 'Fonts used by this page', () => openMenu('fonts')));
    pop.appendChild(row);
    const menu = el('div', { class: 'menu' });
    pop.appendChild(menu);
    pop.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
    document.body.appendChild(pop);
    state.pop = pop;
    state.menu = menu;
  }
  function openMenu(kind) {
    const menu = state.menu;
    if (menu.dataset.kind === kind && menu.classList.contains('on')) { menu.classList.remove('on'); menu.dataset.kind = ''; positionPopover(); return; }
    menu.textContent = '';
    menu.dataset.kind = kind;
    menu.classList.toggle('grid', kind === 'colors' || kind === 'fonts');
    const p = state.palette || { classes: [], colors: [], fonts: [] };
    const item = (children, onClick, title) => { const b = el('button', { title: title || '' }, children); b.addEventListener('click', () => { onClick(); menu.classList.remove('on'); positionPopover(); }); menu.appendChild(b); };
    if (kind === 'link') {
      const info = selectionInfo();
      const existing = info && findWrapper(info.range.commonAncestorContainer, ['a'], info.ed);
      const input = el('input', { type: 'url', placeholder: 'https://', value: existing ? existing.getAttribute('href') || '' : '' });
      const row = el('div', { class: 'row' }, [input]);
      row.appendChild(el('span', { text: ' ' }));
      const apply = el('button', { text: existing ? 'Update' : 'Add link' });
      apply.addEventListener('click', () => { setLink(input.value.trim()); menu.classList.remove('on'); });
      row.appendChild(apply);
      if (existing) { const rm = el('button', { text: 'Remove' }); rm.addEventListener('click', () => { setLink(''); menu.classList.remove('on'); }); row.appendChild(rm); }
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply.click(); } if (e.key === 'Escape') { menu.classList.remove('on'); } });
      menu.appendChild(row);
      menu.classList.add('on');
      positionPopover();
      setTimeout(() => input.focus(), 0);
      return;
    }
    if (kind === 'styles') {
      menu.appendChild(el('div', { class: 'hint', text: 'Styles this page already uses. Select text to style just that text.' }));
      for (const c of p.classes) {
        const name = el('span', { class: 'chip', text: c.label });
        if (c.preview) name.setAttribute('style', c.preview + '; font-size: 13px');
        item([name, el('span', { class: 'sub', text: c.summary })], () => applyClass(c.name, c.inlineSafe), '.' + c.name);
      }
    }
    if (kind === 'colors') {
      item([el('span', { class: 'sw none' }), el('span', { text: 'Default' })], () => applyStyle('color', ''), 'Remove the color');
      for (const c of p.colors) { const sw = el('span', { class: 'sw' }); sw.style.background = c.css; item([sw, el('span', { text: c.name })], () => applyStyle('color', c.value), c.value); }
    }
    if (kind === 'fonts') {
      item([el('span', { text: 'Default' })], () => applyStyle('font-family', ''), 'Remove the font');
      for (const f of p.fonts) { const lab = el('span', { text: f.label }); lab.style.fontFamily = f.value; item([lab], () => applyStyle('font-family', f.value), f.value); }
    }
    menu.classList.add('on');
    positionPopover();
  }
  function positionPopover() {
    const pop = state.pop;
    if (!pop) return;
    const info = selectionInfo();
    const sel = document.getSelection();
    const live = sel && sel.rangeCount && editableFor(sel.getRangeAt(0).commonAncestorContainer);
    const menuOpen = state.menu && state.menu.classList.contains('on');
    if (!state.editing || !info || (!menuOpen && (!live || sel.isCollapsed))) { hidePopover(); return; }
    const rect = info.range.getBoundingClientRect();
    const appearing = !pop.classList.contains('on');
    if (appearing) pop.classList.add('jump');
    pop.classList.add('on');
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let x = rect.left + rect.width / 2 - w / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    let y = rect.top - h - 10;
    if (y < 8) y = rect.bottom + 10;
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
    if (appearing) requestAnimationFrame(() => requestAnimationFrame(() => pop.classList.remove('jump')));
    for (const [tag, names] of Object.entries(ALIAS)) {
      const b = pop.querySelector(tag === 'strong' ? '.b' : tag === 'em' ? '.i' : tag === 'code' ? '.c' : null);
      if (b) b.classList.toggle('active', !!findWrapper(info.range.commonAncestorContainer, names, info.ed));
    }
  }
  function hidePopover() {
    if (!state.pop) return;
    state.pop.classList.remove('on');
    if (state.menu) { state.menu.classList.remove('on'); state.menu.dataset.kind = ''; }
  }
  document.addEventListener('selectionchange', () => {
    if (!state.editing) return;
    const sel = document.getSelection();
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      if (editableFor(r.commonAncestorContainer)) state.savedRange = r.cloneRange();
    }
    if (!state.pop) buildPopover();
    positionPopover();
  });
  window.addEventListener('scroll', () => { if (state.pop && state.pop.classList.contains('on')) positionPopover(); positionImagePanel(); }, true);

  // ---------- images ----------
  function buildImagePanel() {
    if (state.imgPanel) return state.imgPanel;
    const panel = el('div', { id: 'retouch-img', 'data-retouch-ui': '' });
    const file = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    const replace = el('button', { class: 'primary', text: 'Replace image…' });
    const restore = el('button', { class: 'ghost', text: 'Restore' });
    const meta = el('span', { class: 'meta' });
    const alt = el('input', { type: 'text', placeholder: 'Describe the image' });
    const apply = el('button', { text: 'Apply' });
    panel.appendChild(el('div', { class: 'row' }, [replace, restore, meta]));
    panel.appendChild(el('div', { class: 'row' }, [el('span', { class: 'lbl', text: 'Alt text' }), alt, apply]));
    panel.appendChild(file);
    replace.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      const img = state.imgTarget;
      if (!f || !img) return;
      const buffer = await f.arrayBuffer();
      const id = Math.random().toString(36).slice(2);
      const rec = imageRecord(img);
      const named = await new Promise((resolve) => {
        state.pending.set(id, resolve);
        send({ type: 'image-picked', id, name: f.name, mime: f.type, buffer });
        setTimeout(() => { if (state.pending.has(id)) { state.pending.delete(id); resolve(null); } }, 4000);
      });
      if (!named) { meta.textContent = 'Could not hand the image to Retouch. Try again.'; return; }
      if (rec.blobUrl) URL.revokeObjectURL(rec.blobUrl);
      rec.blobUrl = URL.createObjectURL(new Blob([buffer], { type: f.type }));
      rec.newSrc = named;
      rec.pendingId = id;
      img.setAttribute('data-retouch-src', named);
      img.src = rec.blobUrl;
      meta.textContent = `${named} · saved next to the page when you press Save`;
      restore.style.display = '';
      file.value = '';
      refresh();
      positionImagePanel();
    });
    restore.addEventListener('click', () => {
      const img = state.imgTarget;
      const rec = img && state.images.get(img);
      if (!rec) return;
      if (rec.blobUrl) URL.revokeObjectURL(rec.blobUrl);
      if (rec.originalSrc == null) img.removeAttribute('src'); else img.setAttribute('src', rec.originalSrc);
      if (rec.originalAlt == null) img.removeAttribute('alt'); else img.setAttribute('alt', rec.originalAlt);
      img.removeAttribute('data-retouch-src');
      state.images.delete(img);
      img.removeAttribute('data-retouch-changed');
      meta.textContent = '';
      alt.value = img.getAttribute('alt') || '';
      refresh();
    });
    const applyAlt = () => {
      const img = state.imgTarget;
      if (!img) return;
      const rec = imageRecord(img);
      rec.newAlt = alt.value;
      img.setAttribute('alt', alt.value);
      restore.style.display = '';
      refresh();
    };
    apply.addEventListener('click', applyAlt);
    alt.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyAlt(); } if (e.key === 'Escape') hideImagePanel(); });
    panel.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
    document.body.appendChild(panel);
    state.imgPanel = panel;
    panel._alt = alt; panel._meta = meta; panel._restore = restore;
    return panel;
  }
  function imageRecord(img) {
    let rec = state.images.get(img);
    if (!rec) { rec = { originalSrc: img.getAttribute('src'), originalAlt: img.getAttribute('alt'), newSrc: null, newAlt: null, blobUrl: null, pendingId: null }; state.images.set(img, rec); }
    return rec;
  }
  function openImagePanel(img) {
    const panel = buildImagePanel();
    state.imgTarget = img;
    const rec = state.images.get(img);
    panel._alt.value = img.getAttribute('alt') || '';
    panel._meta.textContent = rec && rec.newSrc ? `${rec.newSrc} · saved next to the page when you press Save` : (img.getAttribute('src') || '').split('/').pop().slice(0, 48);
    panel._restore.style.display = rec ? '' : 'none';
    hidePopover();
    panel.classList.add('on');
    positionImagePanel();
  }
  function positionImagePanel() {
    const panel = state.imgPanel;
    if (!panel || !state.imgTarget || !panel.classList.contains('on')) return;
    const rect = state.imgTarget.getBoundingClientRect();
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    let x = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8));
    let y = rect.bottom + 10;
    if (y + h > window.innerHeight - 8) y = Math.max(8, rect.top - h - 10);
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
  }
  function hideImagePanel() {
    if (state.imgPanel) state.imgPanel.classList.remove('on');
    state.imgTarget = null;
  }

  // ---------- events ----------
  function onKeydown(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); toggleTag('strong'); return; }
      if (k === 'i') { e.preventDefault(); toggleTag('em'); return; }
      if (k === 'k') { e.preventDefault(); if (!state.pop) buildPopover(); openMenu('link'); return; }
    }
    if (e.key === 'Escape') { e.preventDefault(); if (state.menu && state.menu.classList.contains('on')) hidePopover(); else e.currentTarget.blur(); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
  }
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); send({ type: 'save-request' }); }
  }, true);
  document.addEventListener('mousedown', (e) => {
    if (!state.editing || isUi(e.target)) return;
    if (state.menu && state.menu.classList.contains('on')) hidePopover();
    if (e.target.tagName === 'IMG') { e.preventDefault(); openImagePanel(e.target); return; }
    if (state.imgPanel && state.imgPanel.classList.contains('on')) hideImagePanel();
    const t = pickTarget(e.target);
    if (t) beginEdit(t);
  }, true);
  document.addEventListener('click', (e) => {
    if (!state.editing || isUi(e.target)) return;
    if (e.target.closest && e.target.closest('a, button, input, label, summary')) e.preventDefault();
  }, true);
  document.addEventListener('mouseover', (e) => {
    if (!state.editing || isUi(e.target)) return;
    const t = e.target.tagName === 'IMG' ? e.target : pickTarget(e.target);
    if (t === state.hover) return;
    if (state.hover) { state.hover.removeAttribute('data-retouch-target'); if (!state.hover.hasAttribute('contenteditable')) unmarkShape(state.hover); }
    state.hover = t;
    if (t) { t.setAttribute('data-retouch-target', ''); markShape(t); }
  }, true);

  window.addEventListener('message', (e) => {
    if (e.origin !== EXT_ORIGIN || e.source !== window.parent) return;
    const m = e.data || {};
    if (!m.retouch) return;
    switch (m.type) {
      case 'hello': send({ type: 'ready', href: location.href, title: document.title }); break;
      case 'edit': setEditing(!!m.on); break;
      case 'collect': send(Object.assign({ type: 'collected' }, collect())); break;
      case 'reset': reset(); break;
      case 'commit': commit(m.renames || null); break;
      case 'fetch-result': { const r = state.pending.get(m.id); if (r) { state.pending.delete(m.id); r(m.text || null); } break; }
      case 'image-named': { const r = state.pending.get(m.id); if (r) { state.pending.delete(m.id); r(m.name || null); } break; }
    }
  });
  window.__retouchDebug = { toggleTag, setLink, applyStyle, applyClass, harvest, collect, state };
  send({ type: 'ready', href: location.href, title: document.title });
})();
