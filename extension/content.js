// Runs inside the file:// page when it is embedded in the Retouch viewer. Inert everywhere else.
// Makes text-bearing elements editable on click and tracks two kinds of change:
//   text     the element's structure is unchanged; each altered run of text is patched exactly
//   element  formatting was added or removed; the whole element is replaced by its new markup
// A selection popover offers bold, italic, code, link, and the page's own classes, colors and fonts
// harvested from its stylesheets. Only talks to the extension's own origin.
(function () {
  if (window === window.top || window.__retouch) return;
  const EXT_ORIGIN = 'chrome-extension://' + chrome.runtime.id;
  const state = {
    editing: false, edited: new Map(), images: new Map(), theme: new Map(), hover: null, styled: false, palette: null,
    pending: new Map(), pop: null, savedRange: null, menu: null, imgPanel: null, imgTarget: null,
    promptMode: false, promptTool: 'pointer', promptHover: null, pins: new Map(), pinTargets: new Map(), pinSeq: 0, overlay: null, activeCard: null, rafQueued: false
  };
  window.__retouch = state;

  const send = (msg) => window.parent.postMessage(Object.assign({ retouch: true }, msg), EXT_ORIGIN);
  const UI = '[data-retouch-ui]';
  const isUi = (node) => { const el = node && (node.nodeType === 1 ? node : node.parentElement); return !!(el && el.closest(UI)); };
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT', 'SELECT', 'BUTTON', 'SVG']);

  const rt = globalThis.__retouchRuntime || {
    setOwnership() {},
    busy() {},
    ignore(fn) { fn(); },
    entry() {},
    entries() {},
    seed() {},
    textEntry() {}
  };

  rt.setOwnership((node) => {
    if (isUi(node)) return true;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el) return false;
    if (state.edited.has(el)) return true;
    const ed = el.closest('[contenteditable]');
    if (ed && state.edited.has(ed)) return true;
    for (const tracked of state.edited.keys()) {
      if (tracked.contains(el)) return true;
    }
    return false;
  });

  const BUSY_EVENTS = ['keydown', 'beforeinput', 'input', 'mousedown', 'click', 'paste', 'cut', 'drop', 'change', 'focusout', 'submit'];
  for (const evt of BUSY_EVENTS) {
    document.addEventListener(evt, () => rt.busy(), true);
  }

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
      html.retouch-editing [data-retouch-cliptext][data-retouch-target] { outline-color: color-mix(in srgb, color-mix(in srgb, #f4c05f 78%, #000) 40%, transparent); }
      /* Only the block being edited right now carries the hairline. Changed blocks show their yellow mark alone. */
      html.retouch-editing [contenteditable="plaintext-only"]:focus { outline-color: color-mix(in srgb, currentColor 55%, transparent); }
      html.retouch-editing [data-retouch-cliptext][contenteditable="plaintext-only"]:focus { outline-color: color-mix(in srgb, color-mix(in srgb, #f4c05f 78%, #000) 75%, transparent); caret-color: color-mix(in srgb, #f4c05f 78%, #000); }
      /* Focus mode: while a block is being edited, everything that is not on the path to it fades back. */
      html.retouch-editing body > :not([data-retouch-ui]), html.retouch-editing [data-retouch-path] > * { transition: opacity .38s cubic-bezier(.2,.8,.2,1); }
      html.retouch-focus body > :not([data-retouch-path]):not([contenteditable]):not([data-retouch-ui]),
      html.retouch-focus [data-retouch-path] > :not([data-retouch-path]):not([contenteditable]):not([data-retouch-ui]) { opacity: .42; }
      /* Changes are yellow because yellow means something: a highlighter on changed words, a slim bar beside a changed block. */
      html.retouch-editing [data-retouch-changed] { --retouch-mark: color-mix(in srgb, #f4c05f 78%, currentColor); border-radius: 4px;
        -webkit-box-decoration-break: clone; box-decoration-break: clone; transition: background .2s ease, box-shadow .2s ease; }
      html.retouch-editing [data-retouch-changed]:not([data-retouch-cliptext]):not([data-retouch-block]) { background: color-mix(in srgb, var(--retouch-mark) 45%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--retouch-mark) 45%, transparent); }
      html.retouch-editing [data-retouch-cliptext][data-retouch-changed] { --retouch-mark: color-mix(in srgb, #f4c05f 78%, #000); box-shadow: 0 2px 0 0 var(--retouch-mark); border-radius: 0; }
      html.retouch-editing [data-retouch-block][data-retouch-changed]:not([data-retouch-cliptext]) { background: none; box-shadow: -20px 0 0 -17px var(--retouch-mark); border-radius: 6px; }
      html.retouch-editing [data-retouch-block][data-retouch-cliptext][data-retouch-changed] { box-shadow: -20px 0 0 -17px var(--retouch-mark); border-radius: 6px; }
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
      [data-retouch-cliptext][data-retouch-saved] { animation-name: retouch-settle-cliptext; border-radius: 0; }
      [data-retouch-block][data-retouch-saved] { animation-name: retouch-settle-block; border-radius: 6px; }
      @keyframes retouch-settle { from { background: rgba(244,192,95,.55); box-shadow: 0 0 0 3px rgba(244,192,95,.55); } to { background: transparent; box-shadow: 0 0 0 3px transparent; } }
      @keyframes retouch-settle-cliptext { from { box-shadow: 0 2px 0 0 color-mix(in srgb, #f4c05f 78%, #000); } to { box-shadow: 0 2px 0 0 transparent; } }
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
      #retouch-pop button:disabled { opacity: .35; cursor: default; }
      #retouch-pop button:disabled:hover { background: transparent; }
      #retouch-pop button.b { font-weight: 800; } #retouch-pop button.i { font-style: italic; font-family: Georgia, serif; font-weight: 500; } #retouch-pop button.c { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
      #retouch-pop button.u { text-decoration: underline; font-weight: 600; } #retouch-pop button.s { text-decoration: line-through; font-weight: 600; }
      #retouch-pop .menu .adv-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 4px 6px; width: 100%; box-sizing: border-box; }
      #retouch-pop .adv-pill { display: flex; align-items: center; gap: 2px; background: rgba(0,0,0,.18); padding: 2px 4px; border-radius: 999px; }
      #retouch-pop .menu .adv-pill button { height: 26px; min-width: 26px; padding: 0 6px; border-radius: 999px; font-size: 12px; margin: 0; width: auto; flex: none; justify-content: center; align-self: center; }
      #retouch-pop .menu .adv-pill button svg { display: block; pointer-events: none; }
      #retouch-pop .adv-field { display: flex; align-items: center; gap: 3px; background: rgba(0,0,0,.22); padding: 2px 8px; border-radius: 999px; height: 30px; box-sizing: border-box; }
      #retouch-pop input.adv-num-input { all: initial; font: inherit; font-family: inherit; font-size: 12px; font-weight: 600; color: #ffffff; background: rgba(255,255,255,.2); border-radius: 999px; padding: 0 6px; height: 22px; width: 34px; text-align: center; box-sizing: border-box; transition: box-shadow .16s ease, background .16s ease; }
      #retouch-pop input.adv-num-input::placeholder, #retouch-pop input::placeholder { color: rgba(255,255,255,.75); opacity: 1; }
      #retouch-pop input.adv-num-input:focus { box-shadow: 0 0 0 2px rgba(244,192,95,.9); background: rgba(255,255,255,.28); }
      #retouch-pop .adv-unit { color: rgba(255,255,255,.75); font-size: 11px; margin-right: 1px; font-weight: 500; }
      #retouch-pop .adv-icon { color: rgba(255,255,255,.88); display: inline-flex; align-items: center; margin-right: 1px; }
      #retouch-pop .menu { display: flex; flex-direction: column; height: 0; opacity: 0; overflow: hidden; min-width: 250px; width: 100%; box-sizing: border-box; interpolate-size: allow-keywords;
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
      /* ---------- Prompt mode: pointing, pins and the request card ---------- */
      html.retouch-prompt, html.retouch-prompt * { cursor: crosshair !important; }
      html.retouch-prompt [data-retouch-prompt-hover] {
        outline: 2px solid color-mix(in srgb, color-mix(in srgb, #f4c05f 78%, currentColor) 60%, transparent);
        outline-offset: 4px; border-radius: 2px;
      }
      #retouch-prompt-overlay { position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; cursor: auto; }
      .retouch-pin {
        all: initial; position: absolute; width: 20px; height: 20px; border-radius: 50%; cursor: pointer;
        display: flex; align-items: center; justify-content: center; color: #fff;
        font: 700 11px/1 RetouchUrbanist, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        box-shadow: 0 2px 8px rgba(0,0,0,.35); transition: transform .18s cubic-bezier(.34,1.4,.44,1);
      }
      .retouch-pin:hover { transform: scale(1.14); }
      #retouch-card {
        all: initial; position: absolute; width: 340px; padding: 16px; border-radius: 20px; box-sizing: border-box;
        color: #ffffff; cursor: auto; z-index: 2147483647;
        background: linear-gradient(135deg, #6b4d8c 0%, #b88082 50%, #f4c05f 100%);
        box-shadow: 0 20px 40px rgba(0,0,0,.35);
        font: 14px/1.35 RetouchUrbanist, -apple-system, BlinkMacSystemFont, system-ui, sans-serif; -webkit-font-smoothing: antialiased;
      }
      #retouch-card .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
      #retouch-card .head-text { font-size: 14px; font-weight: 500; color: #ffffff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
      #retouch-card .head-actions { display: flex; align-items: center; gap: 6px; flex: none; }
      #retouch-card .card-act {
        all: initial; cursor: pointer; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
        color: #ffffff; opacity: .85; transition: opacity .16s ease, transform .16s ease;
      }
      #retouch-card .card-act:hover { opacity: 1; transform: scale(1.12); }
      #retouch-card .ta-box { background: #ffffff; border-radius: 14px; padding: 12px 14px; box-shadow: inset 0 1px 2px rgba(0,0,0,.04); }
      #retouch-card textarea {
        all: initial; box-sizing: border-box; display: block; width: 100%; min-height: 80px; resize: vertical;
        font: inherit; font-size: 15px; color: #0f172a; background: transparent; border: none; outline: none; line-height: 1.45;
      }
      #retouch-card textarea::placeholder { color: #94a3b8; }
      #retouch-card .region-hint { font-size: 11px; line-height: 1.35; color: rgba(255,255,255,.85); margin-top: 8px; font-style: italic; }
      @media (prefers-color-scheme: dark) {
        #retouch-card .ta-box { background: #0f172a; box-shadow: inset 0 1px 2px rgba(0,0,0,.3); }
        #retouch-card textarea { color: #f8fafc; }
        #retouch-card textarea::placeholder { color: #64748b; }
      }
      html.retouch-prompt-box, html.retouch-prompt-box * { cursor: crosshair !important; user-select: none !important; -webkit-user-select: none !important; }
      .retouch-box-drag { position: absolute; border: 1.5px dashed #f4c05f; background: rgba(244,192,95,.12); pointer-events: none; z-index: 2147483647; }
      .retouch-region-box { position: absolute; box-sizing: border-box; border: 2px solid #f4c05f; border-radius: 4px; background: rgba(244,192,95,.08); pointer-events: auto; z-index: 2147483647; }
      .retouch-region-pin { position: absolute; top: -10px; right: -10px; width: 20px; height: 20px; border-radius: 50%; background: #f4c05f; color: #0b0b0d; font-weight: 700; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,.3); }
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
  // The nearest preceding text of 3+ characters outside `exclude`, preferring text that is unique in
  // the document. Shared by collect() (element/text/empty/attr changes) and the Prompt collector (pins).
  function anchorNodeBefore(el, exclude, pool) {
    const allText = pool || textNodes(document.body || document.documentElement);
    if (!allText._counts) {
      const counts = new Map();
      for (let i = 0; i < allText.length; i++) {
        const t = allText[i];
        if (exclude && exclude.some((e) => e.contains(t))) continue;
        if (rt.textEntry && rt.textEntry(t)) continue;
        const s = t.data.trim();
        if (s.length >= 3) {
          counts.set(s, (counts.get(s) || 0) + 1);
        }
      }
      allText._counts = counts;
    }
    const counts = allText._counts;
    let fallback = null;
    for (let j = allText.length - 1; j >= 0; j--) {
      const t = allText[j];
      if (!(el.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING)) continue;
      if (exclude && exclude.some((e) => e.contains(t))) continue;
      if (rt.textEntry && rt.textEntry(t)) continue;
      const s = t.data.trim();
      if (s.length >= 3) {
        if (!fallback) fallback = t;
        if (counts.get(s) === 1) return t;
      }
    }
    return fallback;
  }
  function anchorBefore(el, exclude, pool) { const n = anchorNodeBefore(el, exclude, pool); return n ? n.data : ''; }
  // { tag, firstText, lastText, anchor } for any element, the same shape collect() builds for element
  // changes. Used by the Prompt collector to pin a block without putting it into the editing session.
  function elementRecord(el) {
    const fv = fileView(el);
    const tn = textNodes(fv).filter((n) => n.data.trim());
    return {
      tag: el.tagName.toLowerCase(),
      firstText: tn.length ? tn[0].data : null,
      lastText: tn.length ? tn[tn.length - 1].data : null,
      anchor: anchorBefore(el, [...state.edited.keys()])
    };
  }
  // Text laid out as slots between the element's (recursive) child elements, plus a skeleton of
  // that structure. Same skeleton means the edit only touched text.
  function slots(el) {
    const texts = [];
    const skel = [];
    (function walk(node) {
      if (node.nodeType === 1 && !node.matches(UI)) {
        const st = node.getAttribute('style');
        const cl = node.getAttribute('class');
        if (st) skel.push('[style=' + st + ']');
        if (cl) skel.push('[class=' + cl + ']');
      }
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
  function listUnitFor(t) {
    if (!t || t.tagName !== 'LI') return t;
    const parent = t.parentElement;
    if (!parent || (parent.tagName !== 'UL' && parent.tagName !== 'OL')) return t;
    const onlyLis = Array.from(parent.children).every((c) => c.tagName === 'LI');
    const noNested = !parent.querySelector('ul, ol') && !parent.closest('li') && !parent.parentElement.closest('ul, ol');
    if (onlyLis && noNested) return parent;
    return t;
  }
  function markEmpties(on) {
    if (!on) { for (const e of document.querySelectorAll('[data-retouch-empty]')) e.removeAttribute('data-retouch-empty'); return; }
    for (const el of document.body.querySelectorAll('td, th, p, li, h1, h2, h3, h4, h5, h6, dd, dt, figcaption, caption')) {
      if (isEmptyLeaf(el)) el.setAttribute('data-retouch-empty', '');
    }
  }
  // The element's markup as it should appear in the file: without our attributes and UI, and with
  // replaced images pointing at their file name rather than the in-memory preview.
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
  const classTokens = (str) => (str ? str.trim().split(/\s+/).filter(Boolean) : []);

  function restoreRuntimeAttrs(live, clone) {
    function walk(liveNode, cloneNode) {
      if (liveNode.nodeType === 1 && cloneNode.nodeType === 1) {
        const entriesMap = (rt.entries && rt.entries(liveNode)) ? new Map(rt.entries(liveNode)) : null;
        if (entriesMap && entriesMap.size > 0) {
          for (const [name, entry] of entriesMap) {
            const { original, last } = entry;
            const current = liveNode.getAttribute(name);
            if (name === 'class') {
              const origTokens = classTokens(original);
              const lastTokens = classTokens(last);
              const addedSet = new Set(lastTokens.filter((t) => !origTokens.includes(t)));
              const removedList = origTokens.filter((t) => !lastTokens.includes(t));
              const currTokens = classTokens(current);
              const kept = currTokens.filter((t) => !addedSet.has(t));
              for (const t of removedList) {
                if (!kept.includes(t)) kept.push(t);
              }
              if (kept.length > 0) {
                cloneNode.setAttribute('class', kept.join(' '));
              } else if (original != null) {
                cloneNode.setAttribute('class', '');
              } else {
                cloneNode.removeAttribute('class');
              }
            } else {
              if (current === last) {
                if (original == null) {
                  cloneNode.removeAttribute(name);
                } else {
                  cloneNode.setAttribute(name, original);
                }
              }
            }
          }
        }
      }
      const liveKids = liveNode.childNodes;
      const cloneKids = cloneNode.childNodes;
      const len = Math.min(liveKids.length, cloneKids.length);
      for (let i = 0; i < len; i++) {
        walk(liveKids[i], cloneKids[i]);
      }
    }
    walk(live, clone);
  }

  function originalAttributes(el) {
    const result = [];
    const entriesMap = (rt.entries && rt.entries(el)) ? new Map(rt.entries(el)) : new Map();
    const seen = new Set();

    for (const attr of el.attributes) {
      const name = attr.name;
      if (name.startsWith('data-retouch-') || name === 'contenteditable') continue;
      seen.add(name);
      const entry = entriesMap.get(name) || (rt.entry ? rt.entry(el, name) : undefined);
      if (!entry) {
        result.push([name, attr.value]);
        continue;
      }
      const { original, last } = entry;
      const current = attr.value;
      if (name === 'class') {
        const origTokens = classTokens(original);
        const lastTokens = classTokens(last);
        const addedSet = new Set(lastTokens.filter((t) => !origTokens.includes(t)));
        const removedList = origTokens.filter((t) => !lastTokens.includes(t));
        const currTokens = classTokens(current);
        const kept = currTokens.filter((t) => !addedSet.has(t));
        for (const t of removedList) {
          if (!kept.includes(t)) kept.push(t);
        }
        if (kept.length > 0) {
          result.push([name, kept.join(' ')]);
        } else if (original != null) {
          result.push([name, '']);
        }
      } else {
        if (current === last) {
          if (original != null) {
            result.push([name, original]);
          }
        } else {
          result.push([name, current]);
        }
      }
    }

    for (const [name, entry] of entriesMap) {
      if (seen.has(name)) continue;
      if (name.startsWith('data-retouch-') || name === 'contenteditable') continue;
      const { original, last } = entry;
      const current = el.getAttribute(name);
      if (name === 'class') {
        const origTokens = classTokens(original);
        const lastTokens = classTokens(last);
        const addedSet = new Set(lastTokens.filter((t) => !origTokens.includes(t)));
        const removedList = origTokens.filter((t) => !lastTokens.includes(t));
        const kept = removedList;
        if (kept.length > 0) {
          result.push([name, kept.join(' ')]);
        } else if (original != null) {
          result.push([name, '']);
        }
      } else {
        if (current === last && original != null) {
          result.push([name, original]);
        }
      }
    }

    return result;
  }

  function fileView(el) {
    const clone = el.cloneNode(true);
    restoreRuntimeAttrs(el, clone);

    function walk(liveNode, cloneNode) {
      if (liveNode.nodeType === 1) {
        const pEntry = rt.textEntry ? rt.textEntry(liveNode) : undefined;
        if (pEntry && !pEntry.restructured && pEntry.original != null) {
          if (liveNode.textContent === pEntry.last) {
            cloneNode.textContent = pEntry.original;
            return;
          }
        }
        const liveKids = liveNode.childNodes;
        const cloneKids = cloneNode.childNodes;
        const len = Math.min(liveKids.length, cloneKids.length);
        for (let i = 0; i < len; i++) {
          walk(liveKids[i], cloneKids[i]);
        }
      } else if (liveNode.nodeType === 3) {
        const tEntry = rt.textEntry ? rt.textEntry(liveNode) : undefined;
        if (tEntry && !tEntry.restructured && tEntry.original != null) {
          if (liveNode.data === tEntry.last) {
            cloneNode.data = tEntry.original;
          }
        }
      }
    }

    walk(el, clone);
    cleanClone(clone);
    return clone;
  }

  function cleanOuterHtml(el) {
    const fv = fileView(el);
    cleanClone(fv);
    return fv.outerHTML;
  }

  function cleanInnerHtml(el) {
    const fv = fileView(el);
    cleanClone(fv);
    let html = fv.innerHTML;
    if (/<br>$/.test(html)) html = html.slice(0, -4);   // the browser's placeholder break in an emptied block
    return html;
  }

  // ---------- editing state ----------
  let createdListItems = new WeakSet();
  const isListItemEmpty = (li) => !li.textContent.replace(/\u200B/g, '').trim() && !li.querySelector('img');
  function pruneEmptyCreatedItems(root) {
    if (!root || (root.tagName !== 'UL' && root.tagName !== 'OL')) return;
    rt.busy();
    let removed = false;
    for (const li of [...root.querySelectorAll('li')]) {
      if (createdListItems.has(li) && isListItemEmpty(li)) {
        li.remove();
        removed = true;
      }
    }
    if (removed) refresh();
  }
  function copyAttributesAndSeed(srcEl, destEl) {
    const origMap = new Map(originalAttributes(srcEl));
    const names = new Set(origMap.keys());
    for (const attr of srcEl.attributes) {
      if (attr.name.startsWith('data-retouch-') || attr.name === 'contenteditable') continue;
      names.add(attr.name);
    }
    for (const name of names) {
      const liveVal = srcEl.hasAttribute(name) ? srcEl.getAttribute(name) : null;
      const origVal = origMap.has(name) ? origMap.get(name) : null;
      if (liveVal !== null) destEl.setAttribute(name, liveVal);
      if (rt.seed) rt.seed(destEl, name, origVal, liveVal);
    }
  }
  const isBlock = (el) => !/^inline/.test(getComputedStyle(el).display);
  const isCell = (el) => getComputedStyle(el).display === 'table-cell';
  function isClipText(el) {
    const cs = getComputedStyle(el);
    const clip = (cs.backgroundClip || '') + ' ' + (cs.webkitBackgroundClip || cs.getPropertyValue('-webkit-background-clip') || '');
    if (/\btext\b/.test(clip)) return true;
    const isTransparent = cs.color === 'transparent' || /,\s*0\s*\)$|\/\s*0\s*\)$/.test(cs.color);
    return isTransparent && Boolean(cs.backgroundImage && cs.backgroundImage !== 'none');
  }
  function markShape(el) {
    if (isCell(el)) el.setAttribute('data-retouch-cell', '');
    else if (isBlock(el)) el.setAttribute('data-retouch-block', '');
    if (isClipText(el)) el.setAttribute('data-retouch-cliptext', '');
  }
  function unmarkShape(el) {
    el.removeAttribute('data-retouch-block');
    el.removeAttribute('data-retouch-cell');
    el.removeAttribute('data-retouch-cliptext');
  }
  // ---------- undo & redo while editing (U1) ----------
  const undoStack = [];
  const redoStack = [];
  let activeTyping = null;
  let typingTimer = null;
  let isExecutingCommand = false;

  function sendUndoState() {
    send({
      type: 'undo-state',
      canUndo: undoStack.length > 0 || !!activeTyping,
      canRedo: redoStack.length > 0
    });
  }

  const activeBlobUrls = new Set();
  function cleanupBlobUrls() {
    for (const url of activeBlobUrls) {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
    activeBlobUrls.clear();
  }

  function takeSnapshot(el) {
    if (!el || el.nodeType !== 1) return null;
    const rec = state.edited.get(el);
    const fv = fileView(el);
    return {
      parent: el.parentNode,
      nextSibling: el.nextSibling,
      liveOuterHtml: el.outerHTML,
      editedRecord: rec ? {
        html: rec.html,
        tag: rec.tag,
        slots: { skeleton: rec.slots.skeleton, texts: [...rec.slots.texts] },
        tagCounts: Object.assign({}, rec.tagCounts),
        firstText: rec.firstText,
        lastText: rec.lastText,
        emptyOrigin: rec.emptyOrigin,
        fileClone: rec.fileClone ? rec.fileClone.cloneNode(true) : null,
        absorbed: rec.absorbed ? rec.absorbed.map((a) => Object.assign({}, a, { commentsBefore: a.commentsBefore ? [...a.commentsBefore] : [] })) : []
      } : null,
      fileViewClone: fv ? fv.cloneNode(true) : null
    };
  }

  function takeImageSnapshot(img) {
    if (!img || img.nodeType !== 1) return null;
    const rec = state.images.get(img);
    return {
      src: img.getAttribute('src'),
      alt: img.getAttribute('alt'),
      retouchSrc: img.getAttribute('data-retouch-src'),
      changed: img.hasAttribute('data-retouch-changed'),
      imageRecord: rec ? {
        originalSrc: rec.originalSrc,
        originalAlt: rec.originalAlt,
        newSrc: rec.newSrc,
        newAlt: rec.newAlt,
        blobUrl: rec.blobUrl,
        pendingId: rec.pendingId
      } : null
    };
  }

  function restoreImageSnapshot(img, snapshot) {
    if (!img || !snapshot) return;
    rt.busy();
    rt.ignore(() => {
      if (snapshot.src == null) {
        img.removeAttribute('src');
      } else {
        img.setAttribute('src', snapshot.src);
        img.src = (snapshot.imageRecord && snapshot.imageRecord.blobUrl) ? snapshot.imageRecord.blobUrl : snapshot.src;
      }

      if (snapshot.alt == null) {
        img.removeAttribute('alt');
      } else {
        img.setAttribute('alt', snapshot.alt);
      }

      if (snapshot.retouchSrc == null) {
        img.removeAttribute('data-retouch-src');
      } else {
        img.setAttribute('data-retouch-src', snapshot.retouchSrc);
      }

      img.toggleAttribute('data-retouch-changed', !!snapshot.changed);
    });

    if (snapshot.imageRecord) {
      state.images.set(img, {
        originalSrc: snapshot.imageRecord.originalSrc,
        originalAlt: snapshot.imageRecord.originalAlt,
        newSrc: snapshot.imageRecord.newSrc,
        newAlt: snapshot.imageRecord.newAlt,
        blobUrl: snapshot.imageRecord.blobUrl,
        pendingId: snapshot.imageRecord.pendingId
      });
    } else {
      state.images.delete(img);
    }

    if (state.imgPanel && state.imgTarget === img) {
      const rec = state.images.get(img);
      if (state.imgPanel._alt) state.imgPanel._alt.value = img.getAttribute('alt') || '';
      if (state.imgPanel._restore) state.imgPanel._restore.style.display = rec ? '' : 'none';
      if (state.imgPanel._meta) {
        const pic = img.closest('picture');
        const hasSources = pic && pic.querySelector('source');
        const picWarn = hasSources ? ' · picture has responsive <source> variants Retouch won\'t update' : '';
        state.imgPanel._meta.textContent = (rec && rec.newSrc ? `${rec.newSrc} · saved next to the page when you press Save` : (img.getAttribute('src') || '').split('/').pop().slice(0, 48)) + picWarn;
      }
    }

    refresh();
  }

  function undoJoin(step) {
    step.listNode = restoreSnapshot(step.listNode, step.listBefore);

    rt.ignore(() => {
      const p = step.paragraph.node;
      p.innerHTML = step.paragraph.html;

      const parent = step.paragraph.parent;
      let nextRef = (step.paragraph.nextSibling && step.paragraph.nextSibling.parentNode === parent)
        ? step.paragraph.nextSibling
        : (step.listNode && step.listNode.parentNode === parent ? step.listNode.nextSibling : null);

      if (step.comments && step.comments.length) {
        for (const c of step.comments) {
          parent.insertBefore(c, nextRef);
        }
      }
      parent.insertBefore(p, nextRef);

      if (step.paragraph.fileViewClone) {
        reseedFromSnapshot(p, step.paragraph.fileViewClone);
      }
    });

    refresh();
    if (state.menu && state.menu.dataset.kind === 'advanced') {
      openMenu('advanced', true);
    } else {
      positionPopover();
    }
  }

  function redoJoin(step) {
    step.listNode = restoreSnapshot(step.listNode, step.listAfter);

    rt.ignore(() => {
      step.paragraph.node.remove();
      if (step.comments && step.comments.length) {
        for (const c of step.comments) {
          c.remove();
        }
      }
    });

    refresh();
    if (state.menu && state.menu.dataset.kind === 'advanced') {
      openMenu('advanced', true);
    } else {
      positionPopover();
    }
  }

  function reseedFromSnapshot(liveRoot, fileRoot) {
    if (!liveRoot || !fileRoot) return;
    reseedFromFileClone(liveRoot, fileRoot);
    if (!rt.seedText) return;
    function walkText(liveNode, fileNode) {
      if (!liveNode || !fileNode) return;
      if (liveNode.nodeType === 3 && fileNode.nodeType === 3) {
        if (liveNode.data !== fileNode.data) {
          rt.seedText(liveNode, fileNode.data, liveNode.data);
        }
        return;
      }
      if (liveNode.nodeType === 1 && fileNode.nodeType === 1) {
        const lKids = liveNode.childNodes;
        const fKids = fileNode.childNodes;
        const len = Math.min(lKids.length, fKids.length);
        for (let i = 0; i < len; i++) {
          walkText(lKids[i], fKids[i]);
        }
      }
    }
    walkText(liveRoot, fileRoot);
  }

  function placeCaretAtEnd(el) {
    el.focus({ preventScroll: true });
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    let targetNode = el;
    if (el.tagName === 'UL' || el.tagName === 'OL') {
      const lis = el.querySelectorAll('li');
      if (lis.length > 0) targetNode = lis[lis.length - 1];
    }
    range.selectNodeContents(targetNode);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    state.savedRange = range.cloneRange();
  }

  function replaceTrackedNode(oldNode, newNode) {
    if (!oldNode || !newNode || oldNode === newNode) return;
    for (const step of undoStack) {
      if (step.node === oldNode) step.node = newNode;
      if (step.listNode === oldNode) step.listNode = newNode;
      if (step.img === oldNode) step.img = newNode;
      if (step.paragraph && step.paragraph.node === oldNode) step.paragraph.node = newNode;
    }
    for (const step of redoStack) {
      if (step.node === oldNode) step.node = newNode;
      if (step.listNode === oldNode) step.listNode = newNode;
      if (step.img === oldNode) step.img = newNode;
      if (step.paragraph && step.paragraph.node === oldNode) step.paragraph.node = newNode;
    }
    if (activeTyping && activeTyping.el === oldNode) activeTyping.el = newNode;
    if (state.hover === oldNode) state.hover = newNode;
    if (state.imgTarget === oldNode) state.imgTarget = newNode;
  }

  function restoreSnapshot(currentNode, snapshot) {
    let restored = null;
    rt.ignore(() => {
      const doc = (currentNode && currentNode.ownerDocument) || document;
      const range = doc.createRange();
      if (currentNode && currentNode.parentNode) {
        range.selectNode(currentNode);
      } else if (snapshot.parent) {
        range.selectNodeContents(snapshot.parent);
      }
      let frag = null;
      try {
        frag = range.createContextualFragment(snapshot.liveOuterHtml);
      } catch (_) {}
      restored = frag ? frag.firstElementChild : null;
      if (!restored) {
        const t = doc.createElement('template');
        t.innerHTML = snapshot.liveOuterHtml;
        restored = t.content.firstElementChild;
      }
      if (!restored) return;

      if (currentNode && currentNode.parentNode) {
        currentNode.parentNode.replaceChild(restored, currentNode);
        replaceTrackedNode(currentNode, restored);
      } else if (snapshot.parent) {
        const ref = (snapshot.nextSibling && snapshot.nextSibling.parentNode === snapshot.parent) ? snapshot.nextSibling : null;
        snapshot.parent.insertBefore(restored, ref);
        replaceTrackedNode(currentNode, restored);
      }

      if (currentNode && currentNode !== restored) {
        currentNode.removeEventListener('beforeinput', onBeforeInput);
        currentNode.removeEventListener('input', onInput);
        currentNode.removeEventListener('keydown', onKeydown);
        currentNode.removeEventListener('focus', onFocus);
        currentNode.removeEventListener('blur', onBlur);
        currentNode.removeAttribute('contenteditable');
        unmarkShape(currentNode);
        state.edited.delete(currentNode);
      }

      if (snapshot.fileViewClone) {
        reseedFromSnapshot(restored, snapshot.fileViewClone);
      }
    });

    if (!restored) return null;

    markShape(restored);
    if (snapshot.editedRecord) {
      state.edited.set(restored, {
        html: snapshot.editedRecord.html,
        tag: snapshot.editedRecord.tag,
        slots: { skeleton: snapshot.editedRecord.slots.skeleton, texts: [...snapshot.editedRecord.slots.texts] },
        tagCounts: Object.assign({}, snapshot.editedRecord.tagCounts),
        firstText: snapshot.editedRecord.firstText,
        lastText: snapshot.editedRecord.lastText,
        emptyOrigin: snapshot.editedRecord.emptyOrigin,
        fileClone: snapshot.editedRecord.fileClone ? snapshot.editedRecord.fileClone.cloneNode(true) : null,
        absorbed: snapshot.editedRecord.absorbed ? [...snapshot.editedRecord.absorbed] : []
      });
      restored.setAttribute('contenteditable', 'plaintext-only');
      restored.addEventListener('beforeinput', onBeforeInput);
      restored.addEventListener('input', onInput);
      restored.addEventListener('keydown', onKeydown);
      restored.addEventListener('focus', onFocus);
      restored.addEventListener('blur', onBlur);
    } else {
      state.edited.delete(restored);
      restored.removeAttribute('contenteditable');
      unmarkShape(restored);
    }

    if (state.hover === currentNode) state.hover = restored;
    placeCaretAtEnd(restored);
    refresh();
    positionPopover();
    return restored;
  }

  function pushStep(step) {
    undoStack.push(step);
    redoStack.length = 0;
    sendUndoState();
  }

  function closeTypingBurst() {
    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }
    if (!activeTyping) return;
    const { el, before } = activeTyping;
    activeTyping = null;
    if (!el.parentNode) return;
    const after = takeSnapshot(el);
    if (!after) return;
    if (before.liveOuterHtml !== after.liveOuterHtml) {
      pushStep({
        before,
        after,
        node: el
      });
    } else {
      sendUndoState();
    }
  }

  function recordAction(targetNodeGetter, fn) {
    closeTypingBurst();
    if (isExecutingCommand) return fn();
    isExecutingCommand = true;
    let beforeNode = typeof targetNodeGetter === 'function' ? targetNodeGetter() : targetNodeGetter;
    if (beforeNode && !state.edited.has(beforeNode)) beginEdit(beforeNode);
    const before = beforeNode ? takeSnapshot(beforeNode) : null;
    try {
      const result = fn();
      const afterNode = (result && result.nodeType === 1) ? result : ((typeof targetNodeGetter === 'function' ? targetNodeGetter() : targetNodeGetter) || beforeNode);
      const after = afterNode ? takeSnapshot(afterNode) : null;
      if (before && after && before.liveOuterHtml !== after.liveOuterHtml) {
        pushStep({
          before,
          after,
          node: afterNode
        });
      }
      return result;
    } finally {
      isExecutingCommand = false;
    }
  }

  function undo() {
    if (activeTyping) {
      closeTypingBurst();
    }
    if (undoStack.length === 0) return;
    const step = undoStack.pop();
    if (step.kind === 'join') {
      undoJoin(step);
    } else if (step.kind === 'image') {
      restoreImageSnapshot(step.img, step.before);
    } else {
      step.node = restoreSnapshot(step.node, step.before);
    }
    redoStack.push(step);
    sendUndoState();
  }

  function redo() {
    if (activeTyping) {
      closeTypingBurst();
    }
    if (redoStack.length === 0) return;
    const step = redoStack.pop();
    if (step.kind === 'join') {
      redoJoin(step);
    } else if (step.kind === 'image') {
      restoreImageSnapshot(step.img, step.after);
    } else {
      step.node = restoreSnapshot(step.node, step.after);
    }
    undoStack.push(step);
    sendUndoState();
  }

  function onBeforeInput(e) {
    const el = e.currentTarget;
    if (!el) return;
    if (activeTyping && activeTyping.el !== el) {
      closeTypingBurst();
    }
    if (!activeTyping) {
      activeTyping = { el, before: takeSnapshot(el) };
      if (redoStack.length > 0) redoStack.length = 0;
      sendUndoState();
    }
  }

  function beginEdit(el) {
    rt.busy();
    if (state.edited.has(el)) return;
    if (el.closest('[contenteditable]')) return;
    if (el.querySelector('[contenteditable]')) return;
    markShape(el);
    const fv = fileView(el);
    const tn = textNodes(fv).filter((n) => n.data.trim());
    state.edited.set(el, {
      html: el.innerHTML, fileClone: fv.cloneNode(true), tag: el.tagName.toLowerCase(), slots: slots(fv), tagCounts: countTags(fv), emptyOrigin: isEmptyLeaf(el),
      firstText: tn.length ? tn[0].data : null, lastText: tn.length ? tn[tn.length - 1].data : null
    });
    el.setAttribute('contenteditable', 'plaintext-only');
    el.addEventListener('beforeinput', onBeforeInput);
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKeydown);
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);
  }

  function swapTag(el, newTag) {
    return recordAction(el, () => {
      rt.busy();
      if (!state.edited.has(el)) beginEdit(el);
      const curTag = el.tagName.toLowerCase();
      const targetTag = newTag.toLowerCase();
      if (curTag === targetTag) return el;
      const newEl = document.createElement(targetTag);

      copyAttributesAndSeed(el, newEl);
      if (el.hasAttribute('data-retouch-changed')) newEl.setAttribute('data-retouch-changed', '');

      while (el.firstChild) newEl.appendChild(el.firstChild);

      el.parentNode.replaceChild(newEl, el);
      replaceTrackedNode(el, newEl);

      el.removeEventListener('beforeinput', onBeforeInput);
      el.removeEventListener('input', onInput);
      el.removeEventListener('keydown', onKeydown);
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', onBlur);
      el.removeAttribute('contenteditable');
      unmarkShape(el);

      markShape(newEl);
      newEl.setAttribute('contenteditable', 'plaintext-only');
      newEl.addEventListener('beforeinput', onBeforeInput);
      newEl.addEventListener('input', onInput);
      newEl.addEventListener('keydown', onKeydown);
      newEl.addEventListener('focus', onFocus);
      newEl.addEventListener('blur', onBlur);

      const rec = state.edited.get(el);
      if (rec) {
        state.edited.delete(el);
        state.edited.set(newEl, rec);
      }
      if (state.hover === el) state.hover = newEl;

      newEl.focus({ preventScroll: true });
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(newEl);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        state.savedRange = range.cloneRange();
      }
      refresh();
      return newEl;
    });
  }

  function wrapAsList(el, listTag) {
    return recordAction(el, () => {
      rt.busy();
      if (!state.edited.has(el)) beginEdit(el);
      const targetTag = listTag.toLowerCase();
      if (el.tagName === 'UL' || el.tagName === 'OL') return swapTag(el, targetTag);

      const listEl = document.createElement(targetTag);
      const hasBrs = Array.from(el.childNodes).some((n) => n.nodeName === 'BR');
      if (hasBrs) {
        let currentLi = document.createElement('li');
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeName === 'BR') {
            if (currentLi.childNodes.length > 0) {
              listEl.appendChild(currentLi);
              currentLi = document.createElement('li');
            }
          } else {
            currentLi.appendChild(child);
          }
        }
        if (currentLi.childNodes.length > 0) listEl.appendChild(currentLi);
      } else {
        const li = document.createElement('li');
        while (el.firstChild) li.appendChild(el.firstChild);
        listEl.appendChild(li);
      }

      // Carry over the original element's own attributes (class, id, etc.) the same way swapTag does —
      // otherwise a class like "lede" is silently and permanently lost, even on a round-trip back to <p>.
      copyAttributesAndSeed(el, listEl);
      if (el.hasAttribute('data-retouch-changed')) listEl.setAttribute('data-retouch-changed', '');

      el.parentNode.replaceChild(listEl, el);
      replaceTrackedNode(el, listEl);

      el.removeEventListener('beforeinput', onBeforeInput);
      el.removeEventListener('input', onInput);
      el.removeEventListener('keydown', onKeydown);
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', onBlur);
      el.removeAttribute('contenteditable');
      unmarkShape(el);

      markShape(listEl);
      listEl.setAttribute('contenteditable', 'plaintext-only');
      listEl.addEventListener('beforeinput', onBeforeInput);
      listEl.addEventListener('input', onInput);
      listEl.addEventListener('keydown', onKeydown);
      listEl.addEventListener('focus', onFocus);
      listEl.addEventListener('blur', onBlur);

      const rec = state.edited.get(el);
      if (rec) {
        state.edited.delete(el);
        state.edited.set(listEl, rec);
      }
      if (state.hover === el) state.hover = listEl;

      listEl.focus({ preventScroll: true });
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(listEl);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        state.savedRange = range.cloneRange();
      }
      refresh();
      return listEl;
    });
  }

  function unwrapList(listEl) {
    return recordAction(listEl, () => {
      rt.busy();
      if (!state.edited.has(listEl)) beginEdit(listEl);
      if (listEl.tagName !== 'UL' && listEl.tagName !== 'OL') return listEl;
      const pEl = document.createElement('p');

      const lis = Array.from(listEl.querySelectorAll('li'));
      if (lis.length > 0) {
        lis.forEach((li, idx) => {
          if (idx > 0) pEl.appendChild(document.createElement('br'));
          while (li.firstChild) pEl.appendChild(li.firstChild);
        });
      } else {
        while (listEl.firstChild) pEl.appendChild(listEl.firstChild);
      }

      // Same reasoning as wrapAsList: carry over attributes so a round-trip doesn't silently drop them.
      copyAttributesAndSeed(listEl, pEl);
      if (listEl.hasAttribute('data-retouch-changed')) pEl.setAttribute('data-retouch-changed', '');

      listEl.parentNode.replaceChild(pEl, listEl);
      replaceTrackedNode(listEl, pEl);

      listEl.removeEventListener('beforeinput', onBeforeInput);
      listEl.removeEventListener('input', onInput);
      listEl.removeEventListener('keydown', onKeydown);
      listEl.removeEventListener('focus', onFocus);
      listEl.removeEventListener('blur', onBlur);
      listEl.removeAttribute('contenteditable');
      unmarkShape(listEl);

      markShape(pEl);
      pEl.setAttribute('contenteditable', 'plaintext-only');
      pEl.addEventListener('beforeinput', onBeforeInput);
      pEl.addEventListener('input', onInput);
      pEl.addEventListener('keydown', onKeydown);
      pEl.addEventListener('focus', onFocus);
      pEl.addEventListener('blur', onBlur);

      const rec = state.edited.get(listEl);
      if (rec) {
        state.edited.delete(listEl);
        state.edited.set(pEl, rec);
      }
      if (state.hover === listEl) state.hover = pEl;

      pEl.focus({ preventScroll: true });
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(pEl);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        state.savedRange = range.cloneRange();
      }
      refresh();
      return pEl;
    });
  }

  // Focus mode: mark the path from body to the focused block; CSS fades everything off the path.
  function setFocusPath(el) {
    clearFocusPath();
    let cur = el.parentElement;
    while (cur && cur !== document.documentElement) { cur.setAttribute('data-retouch-path', ''); cur = cur.parentElement; }
    rt.ignore(() => {
      document.documentElement.classList.add('retouch-focus');
    });
  }
  function clearFocusPath() {
    for (const n of document.querySelectorAll('[data-retouch-path]')) n.removeAttribute('data-retouch-path');
    rt.ignore(() => {
      document.documentElement.classList.remove('retouch-focus');
    });
  }
  function onFocus(e) {
    if (activeTyping && activeTyping.el !== e.currentTarget) closeTypingBurst();
    setFocusPath(e.currentTarget);
  }
  function onBlur(e) {
    closeTypingBurst();
    if (e.relatedTarget && isUi(e.relatedTarget)) return;   // moving into the popover keeps the block live
    clearFocusPath();
    const el = e.currentTarget;
    pruneEmptyCreatedItems(el);
    const rec = state.edited.get(el);
    if (!rec) return;
    const d = diffElement(el, rec);
    if (d.kind === 'text' && !d.changes.length) release(el);  // clicked but unchanged: leave no trace
  }
  function release(el) {
    rt.busy();
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-retouch-changed');
    unmarkShape(el);
    el.removeEventListener('beforeinput', onBeforeInput);
    el.removeEventListener('input', onInput);
    el.removeEventListener('keydown', onKeydown);
    el.removeEventListener('focus', onFocus);
    el.removeEventListener('blur', onBlur);
    state.edited.delete(el);
    if (state.hover === el) el.setAttribute('data-retouch-target', '');
    refresh();
  }
  function checkRuntimeTextRefusal(el) {
    if (!rt.textEntry) return null;
    const elements = [el, ...el.querySelectorAll('*')];
    for (const elem of elements) {
      const entry = rt.textEntry(elem);
      if (entry && !entry.restructured && entry.original != null) {
        if (elem.textContent !== entry.last) {
          return {
            kind: 'refuse',
            reason: 'runtime-text',
            shown: elem.textContent.trim(),
            original: entry.original
          };
        }
      }
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let tn;
    while ((tn = walker.nextNode())) {
      const entry = rt.textEntry(tn);
      if (entry && !entry.restructured && entry.original != null) {
        if (tn.data !== entry.last) {
          return {
            kind: 'refuse',
            reason: 'runtime-text',
            shown: tn.data.trim(),
            original: entry.original
          };
        }
      }
    }
    return null;
  }

  function diffElement(el, rec) {
    if (rec.absorbed && rec.absorbed.length) return { kind: 'element' };
    if (rec.emptyOrigin) {
      const html = cleanInnerHtml(el);
      return html.trim() ? { kind: 'insert', changes: [] } : { kind: 'text', changes: [] };
    }
    if (el.tagName.toLowerCase() !== rec.tag) return { kind: 'element' };
    const fv = fileView(el);
    const now = slots(fv);
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
      const refusal = checkRuntimeTextRefusal(el);
      const d = diffElement(el, rec);
      const changed = !!refusal || d.kind === 'structural' || d.kind === 'element' || d.changes.length > 0;
      el.toggleAttribute('data-retouch-changed', changed);
      if (refusal) count++;
      else if (d.kind === 'structural') structural++;
      else if (d.kind === 'element' || d.kind === 'insert') count++;
      else count += d.changes.length;
    }
    for (const [img, rec] of state.images) {
      const n = (rec.newSrc != null && rec.newSrc !== rec.originalSrc ? 1 : 0) + (rec.newAlt != null && rec.newAlt !== (rec.originalAlt || '') ? 1 : 0);
      img.toggleAttribute('data-retouch-changed', n > 0);
      count += n;
    }
    count += state.theme.size;
    send({ type: 'changes', count, structural });
  }
  function onInput(e) {
    const el = e && e.currentTarget;
    if (el) {
      if (activeTyping && activeTyping.el !== el) {
        closeTypingBurst();
      }
      if (!activeTyping) {
        activeTyping = { el, before: takeSnapshot(el) };
        if (redoStack.length > 0) redoStack.length = 0;
      }
      if (typingTimer) clearTimeout(typingTimer);
      typingTimer = setTimeout(closeTypingBurst, 1000);
      sendUndoState();
    }
    refresh();
    positionPopover();
  }

  // Changes in document order, each with an anchor: the nearest preceding text of 3+ characters
  // outside any edited element. The patcher uses it to pick the right occurrence.
  function collect() {
    for (const el of [...state.edited.keys()]) {
      pruneEmptyCreatedItems(el);
    }
    const editedEls = [...state.edited.keys()].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const allText = textNodes(document.body || document.documentElement);
    const between = (a, b) => (n) => (!a || (a.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) && (b.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING);
    const changes = [];
    let structural = 0;
    const rewrittenAncestors = new Set();
    for (const el of editedEls) {
      if (checkRuntimeTextRefusal(el)) continue;
      const rec = state.edited.get(el);
      const d = diffElement(el, rec);
      if (d.kind === 'element') {
        rewrittenAncestors.add(el);
      }
    }

    const items = [];
    for (const el of editedEls) {
      items.push({ kind: 'element', node: el });
    }
    for (const img of state.images.keys()) {
      const rec = state.images.get(img);
      const isChanged = (rec.newSrc != null && rec.newSrc !== rec.originalSrc) || (rec.newAlt != null && rec.newAlt !== (rec.originalAlt || ''));
      if (isChanged) {
        let insideRewritten = false;
        for (const anc of rewrittenAncestors) {
          if (anc.contains(img)) {
            insideRewritten = true;
            break;
          }
        }
        if (!insideRewritten) {
          items.push({ kind: 'image', node: img });
        }
      }
    }

    items.sort((a, b) => (a.node === b.node ? 0 : (a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)));

    for (const item of items) {
      if (item.kind === 'element') {
        const el = item.node;
        const refusal = checkRuntimeTextRefusal(el);
        if (refusal) {
          changes.push(refusal);
          continue;
        }
        const rec = state.edited.get(el);
        const d = diffElement(el, rec);
        if (d.kind === 'structural') { structural++; continue; }
        const anchor = anchorBefore(el, editedEls, allText);
        if (d.kind === 'insert') {
          const aNode = anchorNodeBefore(el, editedEls, allText);
          const inRange = between(aNode, el);
          let skip = 0;
          for (const c of document.body.getElementsByTagName(el.tagName)) if (c !== el && !isUi(c) && inRange(c) && emptyInSource(c)) skip++;
          changes.push({ kind: 'empty', tag: el.tagName.toLowerCase(), skip, afterHtml: cleanInnerHtml(el), anchor });
          continue;
        }
        if (d.kind === 'element') {
          if (rec.absorbed && rec.absorbed.length) {
            const runItems = [
              { tag: rec.tag, firstText: rec.firstText, lastText: rec.lastText, tagCounts: rec.tagCounts },
              ...rec.absorbed.map((a) => ({ tag: a.tag, firstText: a.firstText, lastText: a.lastText, tagCounts: a.tagCounts }))
            ];
            changes.push({ kind: 'run', items: runItems, afterHtml: cleanOuterHtml(el), anchor });
          } else {
            changes.push({ kind: 'element', tag: rec.tag, firstText: rec.firstText, lastText: rec.lastText, tagCounts: rec.tagCounts, afterHtml: cleanOuterHtml(el), anchor });
          }
        } else {
          for (const c of d.changes) changes.push({ before: c.before, after: c.after, anchor });
        }
      } else if (item.kind === 'image') {
        const img = item.node;
        const rec = state.images.get(img);
        const aNode = anchorNodeBefore(img, editedEls, allText);
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
    }
    for (const rec of state.theme.values()) {
      changes.push({ kind: 'style', property: rec.property, before: rec.before, after: rec.after, skip: rec.skip || 0, media: rec.media || null });
    }
    return { changes, structural };
  }
  function resetImages() {
    rt.busy();
    for (const [img, rec] of state.images) {
      if (rec.originalSrc == null) img.removeAttribute('src'); else img.setAttribute('src', rec.originalSrc);
      if (rec.originalAlt == null) img.removeAttribute('alt'); else img.setAttribute('alt', rec.originalAlt);
      img.removeAttribute('data-retouch-src');
      img.removeAttribute('data-retouch-changed');
    }
    state.images.clear();
    hideImagePanel();
  }
  function reseedFromFileClone(liveRoot, fileRoot) {
    if (!liveRoot || !fileRoot || !rt.seed) return;
    const liveEls = [liveRoot, ...liveRoot.querySelectorAll('*')];
    const fileEls = [fileRoot, ...fileRoot.querySelectorAll('*')];
    const len = Math.min(liveEls.length, fileEls.length);
    for (let i = 0; i < len; i++) {
      const lEl = liveEls[i];
      const fEl = fileEls[i];
      const names = new Set();
      for (const a of lEl.attributes) if (!a.name.startsWith('data-retouch-') && a.name !== 'contenteditable') names.add(a.name);
      for (const a of fEl.attributes) if (!a.name.startsWith('data-retouch-') && a.name !== 'contenteditable') names.add(a.name);
      for (const name of names) {
        const liveVal = lEl.hasAttribute(name) ? lEl.getAttribute(name) : null;
        const origVal = fEl.hasAttribute(name) ? fEl.getAttribute(name) : null;
        if (liveVal !== origVal) rt.seed(lEl, name, origVal, liveVal);
      }
    }
  }
  function reset() {
    rt.busy();
    for (const [el, rec] of [...state.edited.entries()]) {
      let cur = el;
      if (cur.tagName.toLowerCase() !== rec.tag) {
        if (cur.tagName === 'UL' || cur.tagName === 'OL') cur = unwrapList(cur);
        if (cur.tagName.toLowerCase() !== rec.tag) cur = swapTag(cur, rec.tag);
      }
      if (cur.innerHTML !== rec.html) {
        cur.innerHTML = rec.html;
        if (rec.fileClone) reseedFromFileClone(cur, rec.fileClone);
      }
      if (rec.absorbed && rec.absorbed.length) {
        let insertAfter = cur;
        for (const item of rec.absorbed) {
          if (item.commentsBefore && item.commentsBefore.length) {
            for (const c of item.commentsBefore) {
              insertAfter.after(c);
              insertAfter = c;
            }
          }
          item.node.innerHTML = item.html;
          insertAfter.after(item.node);
          insertAfter = item.node;
        }
        rec.absorbed = [];
      }
    }
    resetImages();
    resetTheme();
    cleanupBlobUrls();
    undoStack.length = 0;
    redoStack.length = 0;
    activeTyping = null;
    if (typingTimer) { clearTimeout(typingTimer); typingTimer = null; }
    sendUndoState();
    endAll();
  }
  function commit(renames) {
    rt.busy();
    commitTheme();
    for (const [img, rec] of state.images) {
      if (rec.pendingId && renames && renames[rec.pendingId]) rec.newSrc = renames[rec.pendingId];
      if (rec.newSrc != null) { img.setAttribute('src', rec.newSrc); rec.originalSrc = rec.newSrc; }
      if (rec.newAlt != null) rec.originalAlt = rec.newAlt;
      rec.blobUrl = null;
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
      rec.absorbed = [];
      const fv = fileView(el);
      const tn = textNodes(fv).filter((n) => n.data.trim());
      rec.html = el.innerHTML; rec.fileClone = fv.cloneNode(true); rec.tag = el.tagName.toLowerCase(); rec.slots = slots(fv); rec.tagCounts = countTags(fv);
      rec.firstText = tn.length ? tn[0].data : null; rec.lastText = tn.length ? tn[tn.length - 1].data : null;
      rec.emptyOrigin = isEmptyLeaf(el);
      if (!rec.emptyOrigin) el.removeAttribute('data-retouch-empty');
    }
    createdListItems = new WeakSet();
    cleanupBlobUrls();
    undoStack.length = 0;
    redoStack.length = 0;
    activeTyping = null;
    if (typingTimer) { clearTimeout(typingTimer); typingTimer = null; }
    sendUndoState();
    refresh();
  }
  function endAll() {
    rt.busy();
    for (const [el] of state.edited) {
      el.removeAttribute('contenteditable');
      el.removeAttribute('data-retouch-changed');
      unmarkShape(el);
      el.removeEventListener('beforeinput', onBeforeInput);
      el.removeEventListener('input', onInput);
      el.removeEventListener('keydown', onKeydown);
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', onBlur);
    }
    state.edited.clear();
    createdListItems = new WeakSet();
    clearFocusPath();
    if (state.hover) { state.hover.removeAttribute('data-retouch-target'); state.hover = null; }
    hidePopover();
    hideImagePanel();
    cleanupBlobUrls();
    undoStack.length = 0;
    redoStack.length = 0;
    activeTyping = null;
    if (typingTimer) { clearTimeout(typingTimer); typingTimer = null; }
    sendUndoState();
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
    rt.ignore(() => {
      blocks.forEach((b, i) => {
        b.style.animationDelay = Math.min(i * 22, 600) + 'ms';
        b.setAttribute('data-retouch-reveal', '');
      });
    });
    setTimeout(() => {
      rt.ignore(() => {
        for (const b of blocks) {
          b.removeAttribute('data-retouch-reveal');
          b.style.animationDelay = '';
          if (!b.getAttribute('style')) b.removeAttribute('style');
        }
      });
    }, 1900);
  }
  function setEditing(on) {
    ensureStyle();
    state.editing = on;
    rt.ignore(() => {
      document.documentElement.classList.toggle('retouch-editing', on);
    });
    if (on && !state.palette) harvest().then((p) => { state.palette = p; buildPopover(); });
    markEmpties(on);
    if (on) { reveal(); sendUndoState(); }
    if (!on) reset();
  }

  // ---------- formatting ----------
  const ALIAS = { strong: ['strong', 'b'], em: ['em', 'i'], code: ['code'], a: ['a'], u: ['u'], s: ['s', 'strike', 'del'] };
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
    rt.busy();
    const info = selectionInfo();
    if (!info || info.range.collapsed) return null;
    const { range, ed } = info;
    const w = document.createElement(tag);
    if (setup) setup(w);
    w.appendChild(range.extractContents());
    range.insertNode(w);
    // Drop wrappers emptied by the extraction.
    for (const e of ed.querySelectorAll('strong,b,em,i,code,a,span,u,s,strike,del')) if (!e.textContent && !e.children.length && !e.matches(UI)) e.remove();
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
    rt.busy();
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
    rt.busy();
    const info = selectionInfo();
    if (!info) return;
    recordAction(info.ed, () => {
      const existing = findWrapper(info.range.commonAncestorContainer, ALIAS[tag], info.ed);
      if (existing) unwrap(existing, info.ed);
      else { restoreSelection(info.range); wrapSelection(tag); }
    });
  }
  function setLink(href) {
    rt.busy();
    const info = selectionInfo();
    if (!info) return;
    recordAction(info.ed, () => {
      const existing = findWrapper(info.range.commonAncestorContainer, ['a'], info.ed);
      if (existing) {
        if (href) existing.setAttribute('href', href); else unwrap(existing, info.ed);
        afterFormat(info.ed);
      } else if (href) {
        restoreSelection(info.range);
        wrapSelection('a', (a) => a.setAttribute('href', href));
      }
    });
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
    rt.busy();
    const map = styleMap(el);
    if (value) map.set(prop, value); else map.delete(prop);
    const text = [...map].map(([k, v]) => `${k}: ${v}`).join('; ');
    if (text) el.setAttribute('style', text); else el.removeAttribute('style');
  }
  // Inline style from the page's palette or free-form panel. Empty value removes that property from the nearest
  // styled span (unwrapping it when nothing is left). A collapsed selection or forceBlock styles the whole element.
  function applyStyle(prop, value, forceBlock = false) {
    rt.busy();
    const info = selectionInfo();
    if (!info) return;
    recordAction(info.ed, () => {
      const { range, ed } = info;
      if (forceBlock) {
        setInlineStyle(ed, prop, value);
        afterFormat(ed);
        return;
      }
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
    });
  }
  function applyClass(name, inlineSafe) {
    rt.busy();
    const info = selectionInfo();
    if (!info) return;
    recordAction(info.ed, () => {
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
    });
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
          // Constructed stylesheets reject @import (Chrome logs a warning per rule), and an import cannot
          // be harvested anyway, so drop those lines before parsing.
          if (!list) { try { const s = new CSSStyleSheet(); s.replaceSync(text.replace(/@import\b[^;]*;/g, '')); list = s.cssRules; } catch (e) { /* unparsable */ } }
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


  // ---------- the page's own CSS variables (the Theme panel) ----------
  // Phase 1 (D29): custom properties declared on :root / html / body inside the page's own <style>
  // blocks, including redefinitions inside @media. Linked sheets are listed but not editable.
  const ROOT_SEL = /^(:root|html|body)$/i;
  const rootSelector = (text) => String(text || '').split(',').some((s2) => ROOT_SEL.test(s2.trim()));

  function matchesRootOrBodyOverride(selectorText) {
    const parts = String(selectorText || '').split(',');
    for (const part of parts) {
      const sel = part.trim();
      if (!sel || ROOT_SEL.test(sel)) continue;
      try {
        if (document.documentElement && document.documentElement.matches(sel)) return true;
        if (document.body && document.body.matches(sel)) return true;
      } catch (e) {}
    }
    return false;
  }

  function themeRules(list, media, out) {
    for (const r of list) {
      if (r.type === CSSRule.STYLE_RULE) { if (rootSelector(r.selectorText)) out.push({ rule: r, media }); }
      else if (r.type === CSSRule.MEDIA_RULE) themeRules(r.cssRules, r.media.mediaText || media, out);
      else if (r.cssRules) themeRules(r.cssRules, media, out);
    }
  }

  function themeOverrideRules(list, media, out) {
    for (const r of list) {
      if (r.type === CSSRule.STYLE_RULE) {
        if (matchesRootOrBodyOverride(r.selectorText)) {
          if (!media || (window.matchMedia && window.matchMedia(media).matches)) {
            out.push({ rule: r, media });
          }
        }
      } else if (r.type === CSSRule.MEDIA_RULE) {
        const m = r.media.mediaText || media;
        if (!m || (window.matchMedia && window.matchMedia(m).matches)) {
          themeOverrideRules(r.cssRules, m, out);
        }
      } else if (r.cssRules) {
        themeOverrideRules(r.cssRules, media, out);
      }
    }
  }

  // A value is a color when the browser accepts it for `color` and it is not simply inherited.
  function isColorValue(probe, value) {
    probe.style.color = '';
    probe.style.color = 'rgb(1, 2, 3)';
    const base = probe.style.color;
    probe.style.color = '';
    probe.style.color = value;
    const got = probe.style.color;
    return !!got && got !== base && !/^(inherit|initial|unset|currentcolor)$/i.test(value.trim());
  }

  function harvestTheme() {
    const probe = document.createElement('span');
    const found = [];
    const overrides = [];
    for (const sheet of document.styleSheets) {
      if (sheet.ownerNode && sheet.ownerNode.matches && sheet.ownerNode.matches(UI)) continue;
      const inline = !!(sheet.ownerNode && sheet.ownerNode.tagName === 'STYLE');
      let list = null;
      try { list = sheet.cssRules; } catch (e) { list = null; }
      if (!list) continue;
      const rules = [];
      themeRules(list, null, rules);
      for (const { rule, media } of rules) {
        for (const property of Array.from(rule.style)) {
          if (!property.startsWith('--')) continue;
          const value = rule.style.getPropertyValue(property).trim();
          if (!value || !isColorValue(probe, value)) continue;
          found.push({ property, value, media: media || null, source: inline ? 'inline' : 'linked', href: sheet.href || null });
        }
      }
      themeOverrideRules(list, null, overrides);
    }
    for (const { rule, media } of overrides) {
      for (const property of Array.from(rule.style)) {
        if (!property.startsWith('--')) continue;
        const value = rule.style.getPropertyValue(property).trim();
        if (!value) continue;
        for (const item of found) {
          if (item.property === property && (!item.media || item.media === (media || null))) {
            item.overriddenBy = rule.selectorText;
          }
        }
      }
    }
    // `skip` counts earlier inline declarations of the same property in the same media context, which
    // is exactly the occurrence the patcher counts when it walks the <style> blocks in file order.
    const seen = new Map();
    for (const item of found) {
      if (item.source !== 'inline') { item.skip = 0; continue; }
      const key = item.property + '|' + (item.media || '');
      const n = seen.get(key) || 0;
      item.skip = n;
      seen.set(key, n + 1);
    }
    return found;
  }

  // One injected <style> holds every live preview, so nothing on disk changes before Save. It comes
  // last in the head, so it wins on order; `except` keeps a change to the light value from also
  // repainting the page when the dark block is the one actually in force.
  function renderThemePreview() {
    let node = document.getElementById('retouch-theme-preview');
    if (!state.theme.size) { if (node) node.remove(); return; }
    if (!node) {
      node = document.createElement('style');
      node.id = 'retouch-theme-preview';
      node.setAttribute('data-retouch-ui', '');
      (document.head || document.documentElement).appendChild(node);
    }
    const groups = new Map();
    for (const rec of state.theme.values()) {
      const except = rec.media ? [] : (rec.except || []);
      const key = (rec.media || '') + '\u0000' + except.join('\u0000');
      if (!groups.has(key)) groups.set(key, { media: rec.media || null, except, decls: [] });
      groups.get(key).decls.push(`  ${rec.property}: ${rec.after};`);
    }
    const parts = [];
    for (const g of groups.values()) {
      let block = `:root {\n${g.decls.join('\n')}\n}`;
      for (const q of g.except) block = `@media not all and ${q} {\n${block}\n}`;
      if (g.media) block = `@media ${g.media} {\n${block}\n}`;
      parts.push(block);
    }
    node.textContent = parts.join('\n');
  }

  function themePreview(m) {
    rt.busy();
    const key = m.property + '|' + (m.media || '');
    if (m.value == null) state.theme.delete(key);
    else state.theme.set(key, { property: m.property, media: m.media || null, before: m.before, after: m.value, skip: m.skip || 0, except: m.except || [] });
    renderThemePreview();
    refresh();
  }

  function resetTheme() {
    rt.busy();
    state.theme.clear();
    renderThemePreview();
  }

  // After a save the file holds the new values, so write them into the page's own rules too and drop
  // the preview. A fresh harvest then reports the saved value as the original, as it should.
  function commitTheme() {
    rt.busy();
    if (!state.theme.size) return;
    const targets = new Map();
    for (const sheet of document.styleSheets) {
      if (!(sheet.ownerNode && sheet.ownerNode.tagName === 'STYLE')) continue;
      if (sheet.ownerNode.matches && sheet.ownerNode.matches(UI)) continue;
      let list = null;
      try { list = sheet.cssRules; } catch (e) { continue; }
      if (!list) continue;
      const rules = [];
      themeRules(list, null, rules);
      for (const { rule, media } of rules) {
        for (const property of Array.from(rule.style)) {
          if (!property.startsWith('--')) continue;
          const key = property + '|' + (media || '');
          if (!targets.has(key)) targets.set(key, []);
          targets.get(key).push(rule);
        }
      }
    }
    for (const [key, rec] of state.theme) {
      const rule = (targets.get(key) || [])[rec.skip || 0];
      if (rule) rule.style.setProperty(rec.property, rec.after);
    }
    resetTheme();
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
    row.appendChild(el('div', { class: 'sep' }));
    row.appendChild(btn('+', '', 'More formatting options', () => openMenu('advanced')));
    pop.appendChild(row);
    const menu = el('div', { class: 'menu' });
    pop.appendChild(menu);
    pop.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
    document.body.appendChild(pop);
    state.pop = pop;
    state.menu = menu;
  }
  function openMenu(kind, force = false) {
    const menu = state.menu;
    if (!force && menu.dataset.kind === kind && menu.classList.contains('on')) { menu.classList.remove('on'); menu.dataset.kind = ''; positionPopover(); return; }
    menu.textContent = '';
    menu.dataset.kind = kind;
    menu.classList.toggle('grid', kind === 'colors' || kind === 'fonts');
    const p = state.palette || { classes: [], colors: [], fonts: [] };
    const item = (children, onClick, title) => { const b = el('button', { title: title || '' }, children); b.addEventListener('click', () => { onClick(); menu.classList.remove('on'); positionPopover(); }); menu.appendChild(b); };
    if (kind === 'advanced') {
      const info = selectionInfo();
      const ed = info ? info.ed : null;
      const curTag = ed ? ed.tagName.toLowerCase() : '';
      const edStyle = info ? styleMap(info.ed) : new Map();
      let spanStyle = new Map();
      if (info && !info.range.collapsed) {
        const span = findWrapper(info.range.commonAncestorContainer, ['span'], info.ed);
        if (span) spanStyle = styleMap(span);
      }

      const svgNode = (str) => {
        const t = document.createElement('template');
        t.innerHTML = str.trim();
        return t.content.firstChild;
      };

      const row1 = el('div', { class: 'adv-row' });

      // 1. Heading Level Switcher (H1, H2, H3, P)
      const headingPill = el('div', { class: 'adv-pill' });
      const headTags = [
        { tag: 'h1', text: 'H1', title: 'Heading 1' },
        { tag: 'h2', text: 'H2', title: 'Heading 2' },
        { tag: 'h3', text: 'H3', title: 'Heading 3' },
        { tag: 'p', text: 'P', title: 'Paragraph' }
      ];
      const activeHeadTag = (curTag === 'h1' || curTag === 'h2' || curTag === 'h3') ? curTag : 'p';
      for (const h of headTags) {
        const hb = el('button', { class: activeHeadTag === h.tag ? 'active' : '', title: h.title, text: h.text });
        hb.addEventListener('click', () => {
          if (!ed) return;
          recordAction(ed, () => {
            let target = ed;
            if (target.tagName === 'UL' || target.tagName === 'OL') target = unwrapList(target);
            if (target.tagName.toLowerCase() !== h.tag) target = swapTag(target, h.tag);
            return target;
          });
          openMenu('advanced', true);
        });
        headingPill.appendChild(hb);
      }
      row1.appendChild(headingPill);

      // 2. List Toggles (Bullets & Numbered & Join)
      const listPill = el('div', { class: 'adv-pill' });
      const bulletSvg = '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M2 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4-2h9v2H6V2zm-4 6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4-2h9v2H6V6zm-4 6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4-2h9v2H6v-2z"/></svg>';
      const numberSvg = '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1 1h2v5H1V4.5h1V2H1V1zm4 1h10v2H5V2zm-4 5h3v1H2v1h2v2H1V7zm4 2h10v2H5V9zm-4 4h3v1H1v-1h2v-1H1v-1h3v4H1v-1zm4 1h10v2H5v-2z"/></svg>';
      const joinSvg = '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M2 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-2.5h10v2H5zm-3 5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-2.5h10v2H5zm6 4.5L5.8 11h1.4v2h1.6v-2h1.4L8 8.5zM2 13.5h13v2H2z"/></svg>';

      const ulBtn = el('button', { class: curTag === 'ul' ? 'active' : '', title: 'Bullet list' }, [svgNode(bulletSvg)]);
      ulBtn.addEventListener('click', () => {
        if (!ed) return;
        if (ed.tagName === 'UL') unwrapList(ed);
        else wrapAsList(ed, 'ul');
        openMenu('advanced', true);
      });

      const olBtn = el('button', { class: curTag === 'ol' ? 'active' : '', title: 'Numbered list' }, [svgNode(numberSvg)]);
      olBtn.addEventListener('click', () => {
        if (!ed) return;
        if (ed.tagName === 'OL') unwrapList(ed);
        else wrapAsList(ed, 'ol');
        openMenu('advanced', true);
      });

      const onlyWhitespaceBetween = (a, b) => {
        let cur = a.nextSibling;
        while (cur && cur !== b) {
          if (cur.nodeType === Node.TEXT_NODE) {
            if (cur.data.trim().length > 0) return false;
          } else if (cur.nodeType !== Node.COMMENT_NODE) {
            return false;
          }
          cur = cur.nextSibling;
        }
        return true;
      };

      let canJoin = false;
      let joinTitle = 'Join next paragraph into this list';
      const isList = ed && (ed.tagName === 'UL' || ed.tagName === 'OL');
      const nextSiblingEl = ed ? ed.nextElementSibling : null;
      if (isList && nextSiblingEl && nextSiblingEl.tagName === 'P' && nextSiblingEl.textContent.trim().length > 0) {
        if (onlyWhitespaceBetween(ed, nextSiblingEl)) {
          let blocked = false;
          for (const [el, pRec] of [...state.edited.entries()]) {
            if (el === nextSiblingEl || nextSiblingEl.contains(el)) {
              const d = diffElement(el, pRec);
              const isChanged = d.kind === 'structural' || d.kind === 'element' || (d.changes && d.changes.length > 0);
              if (isChanged) {
                blocked = true;
              } else {
                release(el);
              }
            }
          }
          if (blocked) {
            joinTitle = 'Save first, then join';
          } else {
            canJoin = true;
          }
        }
      }

      const joinAttrs = { title: joinTitle };
      if (!canJoin) joinAttrs.disabled = '';
      const joinBtn = el('button', joinAttrs, [svgNode(joinSvg)]);
      joinBtn.addEventListener('click', () => {
        rt.busy();
        if (!canJoin || !ed) return;
        const nextP = ed.nextElementSibling;
        if (!nextP || nextP.tagName !== 'P') return;
        const rec = state.edited.get(ed);
        if (!rec) return;

        closeTypingBurst();
        const listBefore = takeSnapshot(ed);
        const pParent = nextP.parentNode;
        const pNextSibling = nextP.nextSibling;
        const pHtml = nextP.innerHTML;
        const pFileView = fileView(nextP).cloneNode(true);

        if (!rec.absorbed) rec.absorbed = [];
        const comments = [];
        let sib = ed.nextSibling;
        while (sib && sib !== nextP) {
          if (sib.nodeType === Node.COMMENT_NODE) comments.push(sib);
          sib = sib.nextSibling;
        }
        const tn = textNodes(nextP).filter((n) => n.data.trim());
        rec.absorbed.push({
          tag: 'p',
          firstText: tn.length ? tn[0].data : null,
          lastText: tn.length ? tn[tn.length - 1].data : null,
          tagCounts: countTags(nextP),
          node: nextP,
          html: nextP.innerHTML,
          commentsBefore: comments
        });
        for (const c of comments) ed.appendChild(c);
        const lastLi = ed.querySelector(':scope > li:last-child') || ed.lastElementChild;
        const newLi = document.createElement('li');
        if (lastLi) {
          copyAttributesAndSeed(lastLi, newLi);
        }
        while (nextP.firstChild) newLi.appendChild(nextP.firstChild);
        ed.appendChild(newLi);
        createdListItems.add(newLi);
        nextP.remove();

        const listAfter = takeSnapshot(ed);
        pushStep({
          kind: 'join',
          listNode: ed,
          listBefore,
          listAfter,
          paragraph: {
            node: nextP,
            parent: pParent,
            nextSibling: pNextSibling,
            html: pHtml,
            fileViewClone: pFileView
          },
          comments
        });

        refresh();
        openMenu('advanced', true);
      });

      listPill.appendChild(ulBtn);
      listPill.appendChild(olBtn);
      listPill.appendChild(joinBtn);
      row1.appendChild(listPill);

      // 3. Underline & Strikethrough
      const uActive = info && findWrapper(info.range.commonAncestorContainer, ALIAS.u, info.ed);
      const sActive = info && findWrapper(info.range.commonAncestorContainer, ALIAS.s, info.ed);
      const uBtn = el('button', { class: 'u' + (uActive ? ' active' : ''), title: 'Underline', text: 'U' });
      uBtn.addEventListener('click', () => { toggleTag('u'); openMenu('advanced', true); });
      const sBtn = el('button', { class: 's' + (sActive ? ' active' : ''), title: 'Strikethrough', text: 'S' });
      sBtn.addEventListener('click', () => { toggleTag('s'); openMenu('advanced', true); });
      const stylePill = el('div', { class: 'adv-pill' }, [uBtn, sBtn]);
      row1.appendChild(stylePill);

      const row2 = el('div', { class: 'adv-row' });

      // 4. Alignment (Left, Center, Right, Justify) with SVG Icons
      const currentAlign = edStyle.get('text-align') || '';
      const aligns = [
        { key: 'left', title: 'Align left', svg: '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2h14v2H1V2zm0 4h8v2H1V6zm0 4h14v2H1v-2zm0 4h8v2H1v-2z"/></svg>' },
        { key: 'center', title: 'Align center', svg: '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2h14v2H1V2zm3 4h8v2H4V6zm-3 4h14v2H1v-2zm3 4h8v2H4v-2z"/></svg>' },
        { key: 'right', title: 'Align right', svg: '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2h14v2H1V2zm6 4h8v2H7V6zm-6 4h14v2H1v-2zm6 4h8v2H7v-2z"/></svg>' },
        { key: 'justify', title: 'Justify', svg: '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2h14v2H1V2zm0 4h14v2H1V6zm0 4h14v2H1v-2zm0 4h8v2H1v-2z"/></svg>' }
      ];
      const alignPill = el('div', { class: 'adv-pill' });
      for (const a of aligns) {
        const ab = el('button', { class: currentAlign === a.key ? 'active' : '', title: a.title }, [svgNode(a.svg)]);
        ab.addEventListener('click', () => {
          const newVal = currentAlign === a.key ? '' : a.key;
          applyStyle('text-align', newVal, true);
          openMenu('advanced', true);
        });
        alignPill.appendChild(ab);
      }
      row2.appendChild(alignPill);

      // Helper for numeric inputs
      const applyNumStyle = (prop, rawVal, forceBlock, suffix = '') => {
        const trimmed = rawVal.trim();
        if (!trimmed) {
          applyStyle(prop, '', forceBlock);
          openMenu('advanced', true);
          return;
        }
        if (!/^\d+(\.\d+)?$/.test(trimmed)) return;
        const num = parseFloat(trimmed);
        if (prop === 'font-size' && (num < 1 || num > 500)) return;
        if (prop === 'line-height' && (num < 0.5 || num > 10)) return;
        applyStyle(prop, num + suffix, forceBlock);
        openMenu('advanced', true);
      };

      // 5. Font Size (Icon + Input + px)
      const currentFS = (spanStyle.get('font-size') || edStyle.get('font-size') || '').replace(/px$/, '');
      const fsIcon = svgNode('<svg class="adv-icon" width="13" height="13" viewBox="0 0 16 16" fill="currentColor" title="Font size"><path d="M2.5 13h2.1l1.1-3h4.6l1.1 3h2.1L8.8 3H7.2L2.5 13zm4-5L8 3.8 9.5 8h-3z"/></svg>');
      const fsInput = el('input', { type: 'text', class: 'adv-num-input', placeholder: '16', value: currentFS, title: 'Font size (px)' });
      fsInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); applyNumStyle('font-size', fsInput.value, false, 'px'); }
        if (e.key === 'Escape') { menu.classList.remove('on'); }
      });
      fsInput.addEventListener('change', () => applyNumStyle('font-size', fsInput.value, false, 'px'));
      const fsField = el('div', { class: 'adv-field', title: 'Font size (px)' }, [fsIcon, fsInput, el('span', { class: 'adv-unit', text: 'px' })]);
      row2.appendChild(fsField);

      // 6. Line Height (Icon + Input)
      const currentLH = spanStyle.get('line-height') || edStyle.get('line-height') || '';
      const lhIcon = svgNode('<svg class="adv-icon" width="13" height="13" viewBox="0 0 16 16" fill="currentColor" title="Line height"><path d="M3 1.5L5.5 4H4v8h1.5L3 14.5L1.5 12H3V4H1.5L3 1.5zM7 3h8v2H7V3zm0 4h8v2H7V7zm0 4h8v2H7v-2z"/></svg>');
      const lhInput = el('input', { type: 'text', class: 'adv-num-input', placeholder: '1.5', value: currentLH, title: 'Line height' });
      lhInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); applyNumStyle('line-height', lhInput.value, true); }
        if (e.key === 'Escape') { menu.classList.remove('on'); }
      });
      lhInput.addEventListener('change', () => applyNumStyle('line-height', lhInput.value, true));
      const lhField = el('div', { class: 'adv-field', title: 'Line height' }, [lhIcon, lhInput]);
      row2.appendChild(lhField);

      menu.appendChild(row1);
      menu.appendChild(row2);
      menu.classList.add('on');
      positionPopover();
      return;
    }
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
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); apply.click(); } if (e.key === 'Escape') { menu.classList.remove('on'); } });
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
      item([el('span', { class: 'sw none' }), el('span', { text: 'Default' })], () => applyStyle('font-family', ''), 'Remove the font');
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
      const cls = tag === 'strong' ? '.b' : tag === 'em' ? '.i' : tag === 'code' ? '.c' : '.' + tag;
      const b = pop.querySelector(cls);
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
      rt.busy();
      const f = file.files && file.files[0];
      const img = state.imgTarget;
      if (!f || !img) return;
      const buffer = await f.arrayBuffer();
      const id = Math.random().toString(36).slice(2);
      const named = await new Promise((resolve) => {
        state.pending.set(id, resolve);
        send({ type: 'image-picked', id, name: f.name, mime: f.type, buffer });
        setTimeout(() => { if (state.pending.has(id)) { state.pending.delete(id); resolve(null); } }, 4000);
      });
      if (!named) { meta.textContent = 'Could not hand the image to Retouch. Try again.'; return; }
      rt.busy();
      closeTypingBurst();
      const before = takeImageSnapshot(img);
      const rec = imageRecord(img);
      const blobUrl = URL.createObjectURL(new Blob([buffer], { type: f.type }));
      activeBlobUrls.add(blobUrl);
      rec.blobUrl = blobUrl;
      rec.newSrc = named;
      rec.pendingId = id;
      img.setAttribute('data-retouch-src', named);
      img.src = rec.blobUrl;
      const pic = img.closest('picture');
      const hasSources = pic && pic.querySelector('source');
      const picWarn = hasSources ? ' · picture has responsive <source> variants Retouch won\'t update' : '';
      meta.textContent = `${named} · saved next to the page when you press Save${picWarn}`;
      restore.style.display = '';
      file.value = '';
      refresh();
      positionImagePanel();
      const after = takeImageSnapshot(img);
      pushStep({
        kind: 'image',
        img,
        before,
        after
      });
    });
    restore.addEventListener('click', () => {
      rt.busy();
      const img = state.imgTarget;
      const rec = img && state.images.get(img);
      if (!rec) return;
      closeTypingBurst();
      const before = takeImageSnapshot(img);
      if (rec.originalSrc == null) img.removeAttribute('src'); else img.setAttribute('src', rec.originalSrc);
      if (rec.originalAlt == null) img.removeAttribute('alt'); else img.setAttribute('alt', rec.originalAlt);
      img.removeAttribute('data-retouch-src');
      state.images.delete(img);
      img.removeAttribute('data-retouch-changed');
      const pic = img.closest('picture');
      const hasSources = pic && pic.querySelector('source');
      const picWarn = hasSources ? ' · picture has responsive <source> variants Retouch won\'t update' : '';
      meta.textContent = (img.getAttribute('src') || '').split('/').pop().slice(0, 48) + picWarn;
      alt.value = img.getAttribute('alt') || '';
      restore.style.display = 'none';
      refresh();
      const after = takeImageSnapshot(img);
      pushStep({
        kind: 'image',
        img,
        before,
        after
      });
    });
    const applyAlt = () => {
      rt.busy();
      const img = state.imgTarget;
      if (!img) return;
      const prevAlt = img.getAttribute('alt') || '';
      const existingRec = state.images.get(img);
      const prevNewAlt = existingRec && existingRec.newAlt != null ? existingRec.newAlt : prevAlt;
      if (alt.value === prevNewAlt && alt.value === prevAlt && !existingRec) return;
      closeTypingBurst();
      const before = takeImageSnapshot(img);
      const rec = imageRecord(img);
      rec.newAlt = alt.value;
      img.setAttribute('alt', alt.value);
      restore.style.display = '';
      refresh();
      const after = takeImageSnapshot(img);
      pushStep({
        kind: 'image',
        img,
        before,
        after
      });
    };
    apply.addEventListener('click', applyAlt);
    alt.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); applyAlt(); } if (e.key === 'Escape') hideImagePanel(); });
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
    const pic = img.closest('picture');
    const hasSources = pic && pic.querySelector('source');
    const picWarn = hasSources ? ' · picture has responsive <source> variants Retouch won\'t update' : '';
    panel._meta.textContent = (rec && rec.newSrc ? `${rec.newSrc} · saved next to the page when you press Save` : (img.getAttribute('src') || '').split('/').pop().slice(0, 48)) + picWarn;
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

  // ---------- Prompt mode: pointing, pinning and the request card ----------
  // "Block" per the spec: the nearest ancestor that is one of these, or a link only when its own
  // parent is not already a block, or a div with visible text. Never html or body.
  const PROMPT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'blockquote', 'pre', 'figure', 'img', 'button', 'section', 'article', 'header', 'footer', 'nav', 'aside']);
  function isPromptBlock(el) {
    if (!el || el.nodeType !== 1 || el.matches(UI)) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return !isPromptBlock(el.parentElement);
    if (PROMPT_TAGS.has(tag)) return true;
    return tag === 'div' && isTextBearing(el);
  }
  function pickPromptTarget(node) {
    let target = node.nodeType === 1 ? node : node.parentElement;
    if (isUi(target)) return null;
    while (target && target !== document.documentElement) {
      if (target === document.body) return null;
      if (isPromptBlock(target)) return target;
      target = target.parentElement;
    }
    return null;
  }
  // D21: marks derive from the page's own text color, the same formula the editing marks use.
  const markColorFor = (el) => `color-mix(in srgb, #f4c05f 78%, ${getComputedStyle(el).color})`;
  function previewOf(el) {
    const fv = fileView(el);
    const text = (fv.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length > 80 ? text.slice(0, 80) : text;
  }
  function ensureOverlay() {
    if (state.overlay) return state.overlay;
    state.overlay = el('div', { id: 'retouch-prompt-overlay', 'data-retouch-ui': '' });
    document.body.appendChild(state.overlay);
    return state.overlay;
  }
  const pinEl = (id) => state.overlay && state.overlay.querySelector(`.retouch-pin[data-id="${id}"]`);
  function queueReposition() {
    if (state.rafQueued) return;
    state.rafQueued = true;
    requestAnimationFrame(() => { state.rafQueued = false; repositionPins(); });
  }
  function positionCard(card, targetOrRecord) {
    const rect = (targetOrRecord && targetOrRecord.kind === 'region') ? {
      left: targetOrRecord.box.x - window.scrollX,
      top: targetOrRecord.box.y - window.scrollY,
      right: targetOrRecord.box.x + targetOrRecord.box.width - window.scrollX,
      bottom: targetOrRecord.box.y + targetOrRecord.box.height - window.scrollY
    } : targetOrRecord.getBoundingClientRect();
    const w = card.offsetWidth || 320;
    const h = card.offsetHeight || 140;
    const x = Math.max(8, Math.min(rect.left + window.scrollX, window.scrollX + window.innerWidth - w - 8));
    let y = rect.bottom + window.scrollY + 8;
    if (y + h > window.scrollY + window.innerHeight - 8) y = Math.max(window.scrollY + 8, rect.top + window.scrollY - h - 8);
    card.style.left = x + 'px';
    card.style.top = y + 'px';
  }
  function repositionPins() {
    for (const [id, target] of state.pinTargets) {
      const record = state.pins.get(id);
      if (!record) continue;
      if (record.kind !== 'region') {
        const pin = pinEl(id);
        if (!pin) continue;
        const rect = target.getBoundingClientRect();
        pin.style.left = Math.round(rect.right + window.scrollX - 6) + 'px';
        pin.style.top = Math.round(rect.top + window.scrollY - 6) + 'px';
      }
      if (state.activeCard && state.activeCard.id === id) positionCard(state.activeCard.el, target);
    }
  }
  let resizePosTimer = null;
  window.addEventListener('scroll', () => { if (state.promptMode) queueReposition(); }, true);
  window.addEventListener('resize', () => {
    if (!state.promptMode) return;
    queueReposition();
    clearTimeout(resizePosTimer);
    resizePosTimer = setTimeout(sendPositions, 120);
  });
  function collectSections() {
    function scan(selector) {
      const out = [];
      for (const h of document.querySelectorAll(selector)) {
        if (isUi(h)) continue;
        if (h.closest && h.closest('[hidden], template, dialog:not([open])')) continue;
        const cs = window.getComputedStyle(h);
        if (!cs || cs.display === 'none' || cs.visibility === 'hidden') continue;
        const rect = h.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const raw = (h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim();
        if (!raw) continue;
        const label = raw.length > 18 ? raw.slice(0, 18).trimEnd() + '…' : raw;
        if (out.length > 0 && out[out.length - 1].label.toLowerCase() === label.toLowerCase()) continue;
        const y = Math.max(0, Math.round(rect.top + window.scrollY));
        out.push({ y, label });
      }
      return out;
    }
    let list = scan('h1, h2');
    if (list.length < 2) list = scan('h1, h2, h3');
    list.sort((a, b) => a.y - b.y);
    const deduped = [];
    for (const item of list) {
      if (deduped.length > 0) {
        const prev = deduped[deduped.length - 1];
        if (prev.label.toLowerCase() === item.label.toLowerCase() || Math.abs(prev.y - item.y) < 8) continue;
      }
      deduped.push(item);
    }
    if (deduped.length > 8) {
      const spread = [];
      for (let i = 0; i < 8; i++) {
        spread.push(deduped[Math.floor((i * deduped.length) / 8)]);
      }
      return spread;
    }
    return deduped;
  }
  function sendPositions() {
    const positions = [];
    for (const [id, record] of state.pins) {
      let y = 0;
      if (record.kind === 'region' && record.box) {
        y = Math.round(record.box.y);
      } else {
        const target = state.pinTargets.get(id);
        if (target && target.getBoundingClientRect) {
          const rect = target.getBoundingClientRect();
          y = Math.round(rect.top + window.scrollY);
        }
      }
      positions.push({ id, y });
    }
    const docHeight = Math.max(1, document.documentElement.scrollHeight || 1);
    send({ type: 'prompt-positions', positions, docHeight, sections: collectSections() });
  }
  function renderPin(record, target) {
    const overlay = ensureOverlay();
    const pin = el('button', { class: 'retouch-pin', type: 'button', 'data-retouch-ui': '', 'data-id': record.id, text: String(record.number) });
    pin.style.background = markColorFor(target);
    pin.addEventListener('click', (e) => { e.stopPropagation(); openCard(record.id); });
    overlay.appendChild(pin);
    queueReposition();
  }
  function renderRegionBox(record) {
    const overlay = ensureOverlay();
    const boxEl = el('div', { class: 'retouch-region-box', 'data-retouch-ui': '', 'data-id': record.id });
    boxEl.style.left = record.box.x + 'px';
    boxEl.style.top = record.box.y + 'px';
    boxEl.style.width = record.box.width + 'px';
    boxEl.style.height = record.box.height + 'px';
    const pin = el('button', { class: 'retouch-pin retouch-region-pin', type: 'button', 'data-retouch-ui': '', 'data-id': record.id, text: String(record.number) });
    pin.addEventListener('click', (e) => { e.stopPropagation(); openCard(record.id); });
    boxEl.appendChild(pin);
    overlay.appendChild(boxEl);
    queueReposition();
  }
  // Closing persists what was typed and is idempotent: removing a focused textarea fires `blur`
  // synchronously, and that handler lands back here while the first removal is still in progress.
  function closeCard(forceDelete) {
    const c = state.activeCard;
    if (!c) return;
    state.activeCard = null;
    const text = c.ta.value.trim();
    c.el.remove();
    if (forceDelete || c.dropped || !text) { removePin(c.id); return; }
    if (c.record.request !== text) { c.record.request = text; notifyChanged(); }
    if (c.record.kind === 'region' && text) { send({ type: 'prompt-region-saved', id: c.id, box: c.record.box }); }
  }
  const WORDS = [
    [/^h[1-6]$/, 'heading'],
    [/^p$/, 'paragraph'],
    [/^li$/, 'list item'],
    [/^(td|th)$/, 'table cell'],
    [/^img$/, 'image'],
    [/^button$/, 'button'],
    [/^a$/, 'link'],
    [/^(section|article|header|footer|nav|aside)$/, 'section']
  ];
  function wordForTag(tag) {
    for (const [re, word] of WORDS) if (re.test(tag)) return word;
    return 'block';
  }
  const capWord = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function buildCard(record, target) {
    const card = el('div', { id: 'retouch-card', 'data-retouch-ui': '' });

    let titleText = '';
    if (record.kind === 'region') {
      const near = (record.near || '').trim();
      titleText = near ? `${record.number} · Box near “${near}”` : `${record.number} · Box`;
    } else {
      const label = capWord(wordForTag(record.tag));
      const quoted = (record.selected || record.preview || record.alt || (record.tag === 'img' ? 'image' : record.tag)).slice(0, 80);
      titleText = `${record.number} · ${label} “${quoted}”`;
    }

    const headText = el('div', { class: 'head-text', text: titleText });

    const saveBtn = el('button', { class: 'card-act save', type: 'button', title: 'Save request', 'aria-label': 'Save request' });
    saveBtn.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M1.5 6l3.5 3.5 5.5-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

    const delBtn = el('button', { class: 'card-act trash', type: 'button', title: 'Delete request', 'aria-label': 'Delete request' });
    delBtn.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 3.5h7M4.5 3.5V2a1 1 0 011-1h1a1 1 0 011 1v1.5M3.5 3.5v6.5a1 1 0 001 1h3a1 1 0 001-1v-6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

    const actions = el('div', { class: 'head-actions' }, [saveBtn, delBtn]);
    const headRow = el('div', { class: 'head' }, [headText, actions]);
    card.appendChild(headRow);

    const ta = el('textarea', { placeholder: 'What should change here?' });
    ta.value = record.request || '';
    const taBox = el('div', { class: 'ta-box' }, [ta]);
    card.appendChild(taBox);

    if (record.kind === 'region') {
      const hintLine = el('div', { class: 'region-hint', text: 'Right-click anywhere on the page and choose "Capture this area for Retouch" to attach a screenshot.' });
      card.appendChild(hintLine);
    }

    ta.addEventListener('keydown', (e) => {
      // The host page may have its own document-level keydown listeners (slide decks, carousels,
      // games) that treat space/arrows/etc. as shortcuts; typing here must never reach them.
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); closeCard(false); }
      else if (e.key === 'Escape') { e.preventDefault(); closeCard(false); }
    });
    // Switching windows also blurs; keep the card open then, so the request is not lost mid-thought.
    ta.addEventListener('blur', () => { if (document.hasFocus()) closeCard(false); });
    saveBtn.addEventListener('click', (e) => { e.stopPropagation(); closeCard(false); });
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); closeCard(true); });
    card.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'TEXTAREA') e.preventDefault(); });
    ensureOverlay().appendChild(card);
    positionCard(card, target);
    setTimeout(() => ta.focus(), 0);
    return { el: card, ta };
  }
  function openCard(id) {
    if (state.activeCard && state.activeCard.id === id) return;
    const record = state.pins.get(id);
    const target = state.pinTargets.get(id);
    if (!record || !target) return;
    closeCard();
    const built = buildCard(record, target);
    state.activeCard = { id, el: built.el, ta: built.ta, record, dropped: false };
  }
  function notifyChanged() {
    send({ type: 'prompt-changed', items: [...state.pins.values()].map((r) => Object.assign({}, r)) });
    sendPositions();
  }
  // `silent` tears a pin down without reporting it: used when Prompt mode is left or the pins are rebuilt, where
  // the notes still exist. Reporting each removal there made the viewer save an ever-shorter list, so leaving
  // Prompt mode erased every note.
  function removePin(id, silent) {
    state.pins.delete(id);
    state.pinTargets.delete(id);
    const pin = pinEl(id);
    if (pin) pin.remove();
    const boxEl = state.overlay && state.overlay.querySelector(`.retouch-region-box[data-id="${id}"]`);
    if (boxEl) boxEl.remove();
    if (state.activeCard && state.activeCard.id === id) state.activeCard = null;
    if (!silent) notifyChanged();
  }
  function addPin(target, selected) {
    const rec = elementRecord(target);
    const number = ++state.pinSeq;
    const id = 'pin' + number;
    const record = {
      id, number, tag: rec.tag, firstText: rec.firstText, lastText: rec.lastText, anchor: rec.anchor,
      selected: selected || null, preview: previewOf(target), src: null, alt: null, request: '', createdAt: Date.now()
    };
    if (target.tagName === 'IMG') { record.src = target.getAttribute('src') || ''; record.alt = target.getAttribute('alt') || ''; }
    state.pins.set(id, record);
    state.pinTargets.set(id, target);
    renderPin(record, target);
    openCard(id);
    notifyChanged();
  }
  function addRegionBox(box) {
    const candidates = [...document.body.querySelectorAll('*')].filter((e) => !isUi(e) && isPromptBlock(e));
    const overlaps = [];
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const elLeft = rect.left + window.scrollX;
      const elTop = rect.top + window.scrollY;
      const elRight = elLeft + rect.width;
      const elBottom = elTop + rect.height;

      const ix1 = Math.max(box.x, elLeft);
      const iy1 = Math.max(box.y, elTop);
      const ix2 = Math.min(box.x + box.width, elRight);
      const iy2 = Math.min(box.y + box.height, elBottom);

      if (ix2 > ix1 && iy2 > iy1) {
        const area = (ix2 - ix1) * (iy2 - iy1);
        const rec = elementRecord(el);
        overlaps.push({
          tag: el.tagName.toLowerCase(),
          preview: previewOf(el),
          firstText: rec.firstText,
          lastText: rec.lastText,
          anchor: rec.anchor,
          area
        });
      }
    }
    overlaps.sort((a, b) => b.area - a.area);
    const topOverlaps = overlaps.slice(0, 8).map(({ area, ...rest }) => rest);

    let near = '';
    const cx = box.x + box.width / 2 - window.scrollX;
    const cy = box.y + box.height / 2 - window.scrollY;
    let hit = null;
    rt.ignore(() => {
      if (state.overlay) state.overlay.style.display = 'none';
      hit = document.elementFromPoint(cx, cy);
      if (state.overlay) state.overlay.style.display = '';
    });
    if (hit && !isUi(hit) && hit !== document.body && hit !== document.documentElement) {
      const raw = (hit.innerText || hit.textContent || '').replace(/\s+/g, ' ').trim();
      if (raw) near = raw.length > 40 ? raw.slice(0, 40).trimEnd() + '…' : raw;
    }
    if (!near && topOverlaps.length && topOverlaps[0].preview) {
      const raw = topOverlaps[0].preview.replace(/\s+/g, ' ').trim();
      if (raw) near = raw.length > 40 ? raw.slice(0, 40).trimEnd() + '…' : raw;
    }

    const number = ++state.pinSeq;
    const id = 'pin' + number;
    const record = {
      id, number, kind: 'region', box, near, overlaps: topOverlaps, request: '', createdAt: Date.now()
    };
    state.pins.set(id, record);
    state.pinTargets.set(id, record);
    renderRegionBox(record);
    openCard(id);
    notifyChanged();
  }
  // Re-finds each restored request by tag + firstText + lastText + anchor: the first exact match in
  // document order. A request that no longer matches anything is kept, greyed, with `lost: true`.
  function restorePrompt(items) {
    closeCard();
    for (const id of [...state.pins.keys()]) { removePin(id, true); }
    state.pins.clear();
    state.pinTargets.clear();
    const candidates = [...document.body.querySelectorAll('*')].filter((e) => !isUi(e));
    const used = new Set();
    for (const item of items) {
      const record = Object.assign({}, item, { lost: false });
      if (record.kind === 'region') {
        state.pins.set(record.id, record);
        state.pinTargets.set(record.id, record);
        renderRegionBox(record);
        continue;
      }
      const target = candidates.find((e) => {
        if (used.has(e) || e.tagName.toLowerCase() !== record.tag) return false;
        if (record.tag === 'img' && record.src && e.getAttribute('src') !== record.src) return false;
        const rec = elementRecord(e);
        return rec.firstText === record.firstText && rec.lastText === record.lastText && rec.anchor === record.anchor;
      });
      if (target) { used.add(target); state.pins.set(record.id, record); state.pinTargets.set(record.id, target); renderPin(record, target); }
      else { record.lost = true; state.pins.set(record.id, record); }
    }
    state.pinSeq = items.reduce((max, i) => Math.max(max, i.number || 0), state.pinSeq);
    notifyChanged();
  }
  function setPromptMode(on) {
    if (state.promptMode === on) return;
    ensureStyle();
    state.promptMode = on;
    state.promptTool = 'pointer';
    rt.ignore(() => {
      document.documentElement.classList.toggle('retouch-prompt', on);
    });
    if (state.promptHover) { state.promptHover.removeAttribute('data-retouch-prompt-hover'); state.promptHover = null; }
    closeCard();
    for (const id of [...state.pins.keys()]) { removePin(id, true); }
    if (state.overlay) { state.overlay.remove(); state.overlay = null; }
    state.pins.clear();
    state.pinTargets.clear();
    if (on) sendPositions();
  }

  function isCaretAtStart(range, li) {
    if (!range.collapsed) return false;
    const pre = document.createRange();
    pre.setStart(li, 0);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString() === '' && !pre.cloneContents().querySelector('img');
  }
  function isCaretAtEnd(range, li) {
    if (!range.collapsed) return false;
    const post = document.createRange();
    post.setStart(range.startContainer, range.startOffset);
    post.setEnd(li, li.childNodes.length);
    return post.toString() === '' && !post.cloneContents().querySelector('img');
  }

  function removeEmptyWrappers(root) {
    rt.busy();
    let removed;
    do {
      removed = false;
      for (const e of root.querySelectorAll('strong,b,em,i,code,a,span,u,s,strike,del')) {
        if (!e.textContent && !e.children.length && !e.matches(UI)) {
          e.remove();
          removed = true;
        }
      }
    } while (removed);
  }

  // ---------- events ----------
  function onKeydown(e) {
    rt.busy();
    // The host page may have its own document-level keydown listeners (slide decks, carousels,
    // games) that treat space/arrows/etc. as shortcuts; typing here must never reach them. This
    // runs after Retouch's own capture-phase ⌘S listener below, so Save is unaffected.
    e.stopPropagation();
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (!e.shiftKey && k === 'z') { e.preventDefault(); undo(); return; }
      if ((e.shiftKey && k === 'z') || (!e.shiftKey && k === 'y')) { e.preventDefault(); redo(); return; }
      if (!e.shiftKey && k === 'b') { e.preventDefault(); toggleTag('strong'); return; }
      if (!e.shiftKey && k === 'i') { e.preventDefault(); toggleTag('em'); return; }
      if (!e.shiftKey && k === 'k') { e.preventDefault(); if (!state.pop) buildPopover(); openMenu('link'); return; }
    }
    if (e.key === 'Escape') { e.preventDefault(); if (state.menu && state.menu.classList.contains('on')) hidePopover(); else e.currentTarget.blur(); return; }

    if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') {
      closeTypingBurst();
    }

    const isList = e.currentTarget.tagName === 'UL' || e.currentTarget.tagName === 'OL';
    if (!isList) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
      return;
    }

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    let li = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    while (li && li.parentElement !== e.currentTarget) {
      li = li.parentElement;
    }
    if (!li || li.tagName !== 'LI') {
      if (range.startContainer === e.currentTarget) {
        li = e.currentTarget.children[range.startOffset] || e.currentTarget.children[range.startOffset - 1];
        if (li && li.tagName !== 'LI') li = null;
      }
    }
    if (!li) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const listEl = e.currentTarget;
      recordAction(listEl, () => {
        rt.busy();
        if (!range.collapsed) {
          range.deleteContents();
        }
        const listItems = Array.from(listEl.children).filter((c) => c.tagName === 'LI');
        const isEmpty = isListItemEmpty(li);
        if (isEmpty && listItems.length > 1) {
          li.remove();
          refresh();
          listEl.blur();
          return listEl;
        }
        const afterRange = document.createRange();
        afterRange.setStart(range.startContainer, range.startOffset);
        afterRange.setEnd(li, li.childNodes.length);
        const frag = afterRange.extractContents();

        const newLi = document.createElement('li');
        copyAttributesAndSeed(li, newLi);
        newLi.appendChild(frag);
        li.after(newLi);

        removeEmptyWrappers(li);
        removeEmptyWrappers(newLi);

        if (!isEmpty && isListItemEmpty(li)) {
          if (createdListItems.has(li)) createdListItems.add(newLi);
          else createdListItems.add(li);
        } else {
          createdListItems.add(newLi);
        }

        const walker = document.createTreeWalker(newLi, NodeFilter.SHOW_TEXT, textFilter);
        let firstText = walker.nextNode();
        while (firstText && !firstText.data) {
          firstText = walker.nextNode();
        }
        const newRange = document.createRange();
        if (firstText) {
          newRange.setStart(firstText, 0);
        } else {
          newRange.setStart(newLi, 0);
        }
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);

        refresh();
        return listEl;
      });
      return;
    }

    if (e.key === 'Backspace') {
      if (isCaretAtStart(range, li)) {
        const prevLi = li.previousElementSibling;
        if (prevLi && prevLi.tagName === 'LI') {
          e.preventDefault();
          const listEl = e.currentTarget;
          recordAction(listEl, () => {
            rt.busy();
            let joinNode;
            let joinOffset;
            if (prevLi.lastChild && prevLi.lastChild.nodeType === 3) {
              joinNode = prevLi.lastChild;
              joinOffset = joinNode.data.length;
            } else {
              joinNode = prevLi;
              joinOffset = prevLi.childNodes.length;
            }
            while (li.firstChild) {
              prevLi.appendChild(li.firstChild);
            }
            if (!createdListItems.has(li)) createdListItems.delete(prevLi);
            li.remove();
            removeEmptyWrappers(prevLi);

            const newRange = document.createRange();
            newRange.setStart(joinNode, Math.min(joinOffset, joinNode.nodeType === 3 ? joinNode.data.length : joinNode.childNodes.length));
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);

            refresh();
            return listEl;
          });
          return;
        } else {
          e.preventDefault();
          return;
        }
      }
    }

    if (e.key === 'Delete') {
      if (isCaretAtEnd(range, li)) {
        const nextLi = li.nextElementSibling;
        if (nextLi && nextLi.tagName === 'LI') {
          e.preventDefault();
          const listEl = e.currentTarget;
          recordAction(listEl, () => {
            rt.busy();
            const curContainer = range.startContainer;
            const curOffset = range.startOffset;

            while (nextLi.firstChild) {
              li.appendChild(nextLi.firstChild);
            }
            if (!createdListItems.has(nextLi)) createdListItems.delete(li);
            nextLi.remove();
            removeEmptyWrappers(li);

            const newRange = document.createRange();
            newRange.setStart(curContainer, Math.min(curOffset, curContainer.nodeType === 3 ? curContainer.data.length : curContainer.childNodes.length));
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);

            refresh();
            return listEl;
          });
          return;
        }
      }
    }
  }
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); closeTypingBurst(); send({ type: 'save-request' }); return; }
    if (state.editing && mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (!e.shiftKey && k === 'z') {
        e.preventDefault();
        e.stopPropagation();
        undo();
        return;
      }
      if ((e.shiftKey && k === 'z') || (!e.shiftKey && k === 'y')) {
        e.preventDefault();
        e.stopPropagation();
        redo();
        return;
      }
    }
  }, true);
  document.addEventListener('mousedown', (e) => {
    if (!state.editing || isUi(e.target)) return;
    closeTypingBurst();
    if (state.menu && state.menu.classList.contains('on')) hidePopover();
    if (e.target.tagName === 'IMG') { e.preventDefault(); openImagePanel(e.target); return; }
    if (state.imgPanel && state.imgPanel.classList.contains('on')) hideImagePanel();
    const t = listUnitFor(pickTarget(e.target));
    if (t) beginEdit(t);
  }, true);
  document.addEventListener('click', (e) => {
    if (!state.editing || isUi(e.target)) return;
    if (e.target.closest && e.target.closest('a, button, input, label, summary')) e.preventDefault();
  }, true);
  document.addEventListener('mouseover', (e) => {
    if (!state.editing || isUi(e.target)) return;
    const t = e.target.tagName === 'IMG' ? e.target : listUnitFor(pickTarget(e.target));
    if (t === state.hover) return;
    if (state.hover) { state.hover.removeAttribute('data-retouch-target'); if (!state.hover.hasAttribute('contenteditable')) unmarkShape(state.hover); }
    state.hover = t;
    if (t) { t.setAttribute('data-retouch-target', ''); markShape(t); }
  }, true);
  document.addEventListener('mouseover', (e) => {
    if (!state.promptMode || state.promptTool !== 'pointer' || isUi(e.target)) return;
    const t = pickPromptTarget(e.target);
    if (t === state.promptHover) return;
    if (state.promptHover) state.promptHover.removeAttribute('data-retouch-prompt-hover');
    state.promptHover = t;
    if (t) t.setAttribute('data-retouch-prompt-hover', '');
  }, true);
  document.addEventListener('click', (e) => {
    if (!state.promptMode || state.promptTool !== 'pointer' || isUi(e.target)) return;
    if (e.target.closest && e.target.closest('a, button, input, label, summary')) e.preventDefault();
    const block = pickPromptTarget(e.target);
    if (!block) { send({ type: 'prompt-whole' }); return; }
    const sel = document.getSelection();
    let selected = null;
    if (sel && sel.rangeCount && !sel.isCollapsed && sel.toString().trim()) {
      const range = sel.getRangeAt(0);
      if (block.contains(range.commonAncestorContainer)) selected = sel.toString().trim();
    }
    // Selecting the whole block is the same as pointing at it; keep the plainer wording.
    if (selected && selected === previewOf(block)) selected = null;
    // Clicking a block that already carries a request reopens that request instead of adding another.
    if (!selected) for (const [id, t] of state.pinTargets) if (t === block && !state.pins.get(id).selected) { openCard(id); return; }
    addPin(block, selected);
  }, true);

  let dragBox = null;
  let startX = 0;
  let startY = 0;
  document.addEventListener('mousedown', (e) => {
    if (!state.promptMode || state.promptTool !== 'box' || isUi(e.target) || e.button !== 0) return;
    e.preventDefault();
    startX = e.pageX;
    startY = e.pageY;
    dragBox = el('div', { class: 'retouch-box-drag', 'data-retouch-ui': '' });
    dragBox.style.left = startX + 'px';
    dragBox.style.top = startY + 'px';
    dragBox.style.width = '0px';
    dragBox.style.height = '0px';
    ensureOverlay().appendChild(dragBox);
    rt.ignore(() => {
      document.documentElement.classList.add('retouch-prompt-box');
    });

    const onMouseMove = (me) => {
      if (!dragBox) return;
      const curX = me.pageX;
      const curY = me.pageY;
      const left = Math.min(startX, curX);
      const top = Math.min(startY, curY);
      const width = Math.abs(curX - startX);
      const height = Math.abs(curY - startY);
      dragBox.style.left = left + 'px';
      dragBox.style.top = top + 'px';
      dragBox.style.width = width + 'px';
      dragBox.style.height = height + 'px';
    };

    const onMouseUp = (ue) => {
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      rt.ignore(() => {
        document.documentElement.classList.remove('retouch-prompt-box');
      });
      if (!dragBox) return;
      const endX = ue.pageX;
      const endY = ue.pageY;
      const left = Math.min(startX, endX);
      const top = Math.min(startY, endY);
      const width = Math.abs(endX - startX);
      const height = Math.abs(endY - startY);
      dragBox.remove();
      dragBox = null;
      if (width >= 10 && height >= 10) {
        addRegionBox({ x: left, y: top, width, height });
      }
    };

    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);
  }, true);

  window.addEventListener('message', (e) => {
    if (e.origin !== EXT_ORIGIN || e.source !== window.parent) return;
    const m = e.data || {};
    if (!m.retouch) return;
    rt.busy();
    switch (m.type) {
      case 'hello': send({ type: 'ready', href: location.href, title: document.title }); break;
      case 'edit': setEditing(!!m.on); break;
      case 'prompt': setPromptMode(!!m.on); break;
      case 'prompt-tool': {
        state.promptTool = m.tool || 'pointer';
        if (state.promptHover) {
          state.promptHover.removeAttribute('data-retouch-prompt-hover');
          state.promptHover = null;
        }
        break;
      }
      case 'prompt-restore': restorePrompt(m.items || []); break;
      case 'prompt-remove': removePin(m.id); break;
      case 'prompt-update': {
        const record = state.pins.get(m.id);
        if (record && record.request !== m.request) {
          record.request = m.request || '';
          if (state.activeCard && state.activeCard.id === m.id && state.activeCard.ta) {
            state.activeCard.ta.value = record.request;
          }
          notifyChanged();
        }
        break;
      }
      case 'prompt-update-screenshot': {
        const record = state.pins.get(m.id);
        if (record) {
          record.screenshotPath = m.screenshotPath || null;
          notifyChanged();
        }
        break;
      }
      case 'get-region-rect': {
        // The stored box is page-relative (survives scrolling, per positionCard/repositionPins) so
        // it must be re-measured now, not reused from whenever the region was drawn: the user may
        // have scrolled the page in between saving the note and right-clicking to capture it.
        const boxEl = document.querySelector('.retouch-region-box[data-id="' + m.id + '"]');
        const rect = boxEl ? boxEl.getBoundingClientRect() : null;
        send({ type: 'region-rect', id: m.id, rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null });
        break;
      }
      case 'prompt-hover': {
        if (state.drawerHover) {
          state.drawerHover.removeAttribute('data-retouch-prompt-hover');
          state.drawerHover = null;
        }
        if (m.id) {
          const target = state.pinTargets.get(m.id);
          if (target && target.nodeType === 1) {
            state.drawerHover = target;
            target.setAttribute('data-retouch-prompt-hover', '');
          }
        }
        break;
      }
      case 'prompt-scroll': {
        const target = state.pinTargets.get(m.id);
        if (target) {
          if (target.kind === 'region') {
            window.scrollTo({ left: Math.max(0, target.box.x - 40), top: Math.max(0, target.box.y - 40), behavior: 'smooth' });
            setTimeout(() => openCard(m.id), 260);
          } else if (target.scrollIntoView) {
            target.scrollIntoView({ block: 'center', behavior: 'smooth' });
            setTimeout(() => openCard(m.id), 260);
          }
        }
        break;
      }
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'collect': send(Object.assign({ type: 'collected' }, collect())); break;
      case 'reset': reset(); break;
      case 'theme': send({ type: 'theme', items: harvestTheme() }); break;
      case 'themePreview': themePreview(m); break;
      case 'commit': commit(m.renames || null); break;
      case 'fetch-result': { const r = state.pending.get(m.id); if (r) { state.pending.delete(m.id); r(m.text || null); } break; }
      case 'image-named': { const r = state.pending.get(m.id); if (r) { state.pending.delete(m.id); r(m.name || null); } break; }
    }
  });
  window.retouchDebug = window.__retouchDebug = { toggleTag, setLink, applyStyle, applyClass, harvest, harvestTheme, collect, commit, undo, redo, undoStack, redoStack, closeTypingBurst, state };
  send({ type: 'ready', href: location.href, title: document.title });
})();
