// The Draft checklist and interactive checks (M1-M7)
(function () {
  'use strict';

  // ---------- 0. Adopted Stylesheet (Keeps UI styles out of Retouch palette) ----------

  const UI_CSS = `
    .stat-timer {
      display: inline-flex;
      align-items: center;
      background: rgba(200, 144, 42, 0.12);
      color: #c8902a;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 15px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    /* Checklist UI (marked data-retouch-ui) */
    .checklist-card {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 320px;
      background: #ffffff;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 14px;
      box-shadow: 0 10px 36px rgba(0, 0, 0, 0.12);
      z-index: 9999;
      font-family: Urbanist, -apple-system, sans-serif;
      overflow: hidden;
      user-select: none;
      transition: box-shadow 0.2s ease, transform 0.35s cubic-bezier(.2, .8, .2, 1), opacity 0.35s ease;
    }

    /* Collapsed pill state below 1280px */
    @media (max-width: 1280px) {
      .checklist-card:not(.expanded) {
        width: auto !important;
        min-width: 90px;
        height: 38px !important;
        padding: 0 16px !important;
        border-radius: 999px !important;
        cursor: pointer;
        display: flex !important;
        align-items: center;
        justify-content: center;
        background: #1f2933 !important;
        color: #ffffff !important;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18) !important;
        border: none !important;
      }
      .checklist-card:not(.expanded) .checklist-rows,
      .checklist-card:not(.expanded) .checklist-download {
        display: none !important;
      }
      .checklist-card:not(.expanded) .checklist-header {
        position: absolute !important;
        inset: 0 !important;
        opacity: 0 !important;
        cursor: pointer !important;
        display: block !important;
        z-index: 2 !important;
      }
      .checklist-card:not(.expanded) .checklist-pill-label {
        display: inline-flex !important;
        align-items: center;
        gap: 6px;
        font-size: 14px;
        font-weight: 700;
        color: #ffffff;
      }
    }

    @media (min-width: 1281px) {
      .checklist-pill-label {
        display: none !important;
      }
    }

    .checklist-card.expanded .checklist-pill-label {
      display: none !important;
    }

    .checklist-header {
      background: #faf8f5;
      border-bottom: 1px solid rgba(0, 0, 0, 0.08);
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
    }
    .checklist-title {
      font-weight: 700;
      font-size: 14px;
      color: #1f2933;
    }
    .checklist-badge {
      background: #c8902a;
      color: #ffffff;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 10px;
      white-space: nowrap;
    }
    .checklist-badge.complete {
      background: #2e7d32;
    }
    .checklist-rows {
      list-style: none;
      margin: 0;
      padding: 8px 0;
      max-height: 380px;
      overflow-y: auto;
    }
    .checklist-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 8px 16px;
      cursor: pointer;
      transition: background 0.12s ease;
      font-size: 13px;
      line-height: 1.4;
      color: #1f2933;
    }
    .checklist-row:hover {
      background: #f8f6f2;
    }
    .checklist-icon {
      width: 16px;
      height: 16px;
      margin-top: 2px;
      border-radius: 4px;
      border: 1.5px solid #a0aec0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.2s cubic-bezier(.2, .8, .2, 1);
    }
    .checklist-row.fixed .checklist-icon {
      border-color: #2e7d32;
      background: #2e7d32;
      animation: check-jump 0.3s cubic-bezier(.34, 1.4, .44, 1) forwards;
    }
    .checklist-row.fixed .checklist-icon svg {
      display: block;
    }
    .checklist-icon svg {
      display: none;
      width: 10px;
      height: 10px;
      stroke: #ffffff;
      stroke-width: 2.2;
    }
    .checklist-text {
      flex: 1;
      transition: opacity 0.2s ease, text-decoration 0.2s ease;
    }
    .checklist-row.fixed .checklist-text {
      text-decoration: line-through;
      opacity: 0.55;
    }
    .checklist-download {
      color: #9a5ca3;
      text-decoration: underline;
      font-weight: 600;
    }
    .checklist-hint {
      display: block;
      font-size: 11px;
      color: #52606d;
      margin-top: 2px;
    }

    @keyframes check-jump {
      0% { transform: scale(0); opacity: 0; }
      60% { transform: scale(1.2); opacity: 1; }
      100% { transform: scale(1); opacity: 1; }
    }

    /* Stage Layer */
    #draft-stage {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 100;
      overflow: hidden;
    }

    /* Fixed Stage for Bird at Rest */
    #draft-fixed-stage {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 10000;
    }

    .checklist-card.collapsed .checklist-rows {
      display: none !important;
    }

    /* Marks Layer SVG */
    .draft-mark-svg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: visible;
      z-index: 105;
    }

    /* Illusion Masks */
    .draft-mask {
      position: absolute;
      pointer-events: none;
      z-index: 110;
      box-sizing: border-box;
      overflow: visible;
      transform-origin: center center;
    }

    /* Damage effects */
    .draft-crack {
      position: absolute;
      inset: -6px -4px;
      pointer-events: none;
      overflow: visible;
      z-index: 115;
    }
    .draft-crack path {
      fill: none;
      stroke: #ed1c24;
      stroke-width: 2.5;
      stroke-linecap: round;
    }
    .draft-chip {
      position: absolute;
      width: 6px;
      height: 6px;
      background: #1f2933;
      border-radius: 1px;
      pointer-events: none;
      z-index: 120;
    }
    .draft-drop {
      position: absolute;
      width: 6px;
      height: 9px;
      background: #39ff14;
      border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
      pointer-events: none;
      z-index: 120;
    }

    /* Outline overlay for clicked checklist item */
    #draft-outline-overlay {
      position: absolute;
      pointer-events: none;
      z-index: 9998;
      outline: 2.5px solid #c8902a;
      outline-offset: 4px;
      border-radius: 8px;
      transition: all 0.2s ease;
      animation: outline-pulse 1.4s ease forwards;
    }
    @keyframes outline-pulse {
      0% { opacity: 0; transform: scale(0.98); }
      20% { opacity: 1; transform: scale(1); }
      80% { opacity: 1; }
      100% { opacity: 0; }
    }

    /* Designed thin overlay-style scrollbars matching window scheme */
    html {
      scrollbar-width: thin;
      scrollbar-color: rgba(35, 31, 32, 0.25) transparent;
    }
    @media (prefers-color-scheme: dark) {
      html {
        scrollbar-color: rgba(255, 255, 255, 0.25) transparent;
      }
    }
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(35, 31, 32, 0.25);
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(35, 31, 32, 0.4);
    }
    @media (prefers-color-scheme: dark) {
      ::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.25);
      }
      ::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.4);
      }
    }
  `;

  if (document.adoptedStyleSheets) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(UI_CSS);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } else {
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-retouch-ui', '');
    styleEl.textContent = UI_CSS;
    document.head.appendChild(styleEl);
  }

  // ---------- 1. Stage Layer Construction ----------

  const stage = document.createElement('div');
  stage.id = 'draft-stage';
  stage.setAttribute('data-retouch-ui', '');
  stage.setAttribute('aria-hidden', 'true');
  document.body.appendChild(stage);

  const fixedStage = document.createElement('div');
  fixedStage.id = 'draft-fixed-stage';
  fixedStage.setAttribute('data-retouch-ui', '');
  fixedStage.setAttribute('aria-hidden', 'true');
  document.body.appendChild(fixedStage);

  function updateStageSize() {
    const w = document.documentElement.clientWidth;
    const h = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    stage.style.width = w + 'px';
    stage.style.height = h + 'px';
    if (marksSvg) {
      marksSvg.setAttribute('width', w);
      marksSvg.setAttribute('height', h);
      marksSvg.style.width = w + 'px';
      marksSvg.style.height = h + 'px';
    }
  }

  // ---------- 2. Mistake Checkers ----------

  function checkM1() {
    const h1 = document.querySelector('h1') || document.querySelector('.hero h1');
    if (!h1) return false;
    const text = (h1.textContent || '').replace(/\s+/g, ' ').trim();
    return text === 'Fix the HTML your AI wrote.';
  }

  function checkM2() {
    const stat = document.querySelector('.stat-text');
    if (!stat) return false;
    const text = (stat.textContent || '').replace(/\s+/g, ' ').trim();
    return text.toLowerCase() === 'saves in 3 seconds';
  }

  function checkM3() {
    const logo = document.querySelector('header img.logo') || document.querySelector('.logo');
    if (!logo) return false;
    const src = (logo.getAttribute('src') || '').trim();
    const dataSrc = (logo.getAttribute('data-retouch-src') || '').trim();
    return !src.endsWith('logo-wrong.svg') && (!dataSrc || !dataSrc.endsWith('logo-wrong.svg'));
  }

  function checkM4() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.trim().toLowerCase() === 'machine') {
        const el = node.parentElement;
        if (el) {
          const color = getComputedStyle(el).color.replace(/\s+/g, '');
          return color !== 'rgb(57,255,20)';
        }
      }
    }
    return true;
  }

  function checkM5() {
    const footer = document.querySelector('footer');
    if (!footer) return false;
    const text = footer.textContent || '';
    return !text.includes('[') && !text.includes(']') && /open\s*source/i.test(text);
  }

  function checkM6() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.includes('byte for byte the same')) {
        const parent = node.parentElement;
        if (!parent) continue;
        const tag = parent.tagName.toLowerCase();
        if (tag === 'b' || tag === 'strong' || parent.closest('b, strong')) {
          return true;
        }
        const weight = parseInt(getComputedStyle(parent).fontWeight, 10);
        if (!isNaN(weight) && weight >= 600) {
          return true;
        }
      }
    }
    return false;
  }

  let idbPromptNotes = [];
  let cachedPromptNotes = [];
  try {
    const s = sessionStorage.getItem('retouch:demo-prompt-notes');
    if (s) cachedPromptNotes = JSON.parse(s);
  } catch {}

  function itemMatchesFeatures(item, featuresEl) {
    if (!item || !featuresEl) return false;
    if (item.target && featuresEl.contains(item.target)) return true;
    if (item.kind === 'region' && item.box) {
      const rect = featuresEl.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const bottom = top + rect.height;
      if (item.box.y >= top && item.box.y <= bottom) return true;
    }
    const featuresText = featuresEl.textContent || '';
    if (item.firstText && featuresText.includes(item.firstText)) return true;
    if (item.lastText && featuresText.includes(item.lastText)) return true;
    if (item.preview && featuresText.includes(item.preview)) return true;
    if (item.anchor && featuresText.includes(item.anchor)) return true;
    if (item.request && item.request.toLowerCase().includes('side by side')) return true;
    return false;
  }

  function readPromptNotesFromIDB() {
    return new Promise((resolve) => {
      try {
        const s = sessionStorage.getItem('retouch:demo-prompt-notes');
        cachedPromptNotes = s ? JSON.parse(s) : [];
      } catch {
        cachedPromptNotes = [];
      }
      if (!window.indexedDB) return resolve(cachedPromptNotes);
      try {
        const req = indexedDB.open('retouch', 1);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) { resolve(cachedPromptNotes); return; }
          const tx = db.transaction('kv', 'readwrite');
          const store = tx.objectStore('kv');
          const getReq = store.openCursor();
          const allItems = [];
          getReq.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              if (typeof cursor.key === 'string' && cursor.key.startsWith('prompt:') && cursor.value) {
                const items = cursor.value.items;
                if (Array.isArray(items) && items.length > 0) {
                  allItems.push(...items);
                }
              }
              cursor.continue();
            } else {
              if (allItems.length > 0) {
                cachedPromptNotes = allItems;
                try {
                  sessionStorage.setItem('retouch:demo-prompt-notes', JSON.stringify(allItems));
                } catch {}
                resolve(allItems);
              } else if (cachedPromptNotes.length > 0) {
                try {
                  const key = 'prompt:' + location.origin + '/draft.html?embed=1';
                  store.put({ items: cachedPromptNotes, whole: '' }, key);
                } catch {}
                resolve(cachedPromptNotes);
              } else {
                resolve([]);
              }
            }
          };
          getReq.onerror = () => resolve(cachedPromptNotes);
        };
        req.onerror = () => resolve(cachedPromptNotes);
      } catch {
        resolve(cachedPromptNotes);
      }
    });
  }

  function refreshIDBPromptNotes() {
    readPromptNotesFromIDB().then((items) => {
      idbPromptNotes = items;
      updateChecklist();
    });
  }

  function checkM7() {
    const features = document.querySelector('#features') || document.querySelector('.features');
    if (!features) return false;

    // 1. Live in-memory pins in content.js
    const retouch = window.__retouch;
    if (retouch && retouch.pins && retouch.pins.size > 0) {
      for (const [id, record] of retouch.pins) {
        const target = retouch.pinTargets && retouch.pinTargets.get(id);
        if (target && (target === features || features.contains(target))) {
          return true;
        }
        if (record.kind === 'region' && record.box) {
          const fRect = features.getBoundingClientRect();
          const fTop = fRect.top + window.scrollY;
          if (record.box.y >= fTop && record.box.y <= fTop + fRect.height) {
            return true;
          }
        }
      }
    }

    // 2. Persisted prompt notes in IndexedDB / store
    const notes = (idbPromptNotes && idbPromptNotes.length > 0) ? idbPromptNotes : cachedPromptNotes;
    if (Array.isArray(notes) && notes.length > 0) {
      for (const item of notes) {
        if (itemMatchesFeatures(item, features)) {
          return true;
        }
      }
    }

    return false;
  }

  const CHECKS = [
    { id: 'm1', text: 'Repeated word in the headline', check: checkM1, target: () => document.querySelector('h1') },
    { id: 'm2', text: 'Minutes where it means seconds', check: checkM2, target: () => document.querySelector('.stat-text') },
    {
      id: 'm3',
      text: 'Old logo · <a href="draft/logo-right.svg" download="fastretouch-logo.svg" class="checklist-download">Get the right logo</a>',
      hint: 'Download it, then click the logo and choose Replace image.',
      check: checkM3,
      target: () => document.querySelector('header img.logo')
    },
    { id: 'm4', text: 'Off-brand green', check: checkM4, target: () => document.querySelector('.green-word') || document.querySelector('.how-it-works') },
    { id: 'm5', text: 'Placeholder left in', check: checkM5, target: () => document.querySelector('.license-line') || document.querySelector('footer') },
    { id: 'm6', text: "The point isn't bold", check: checkM6, target: () => {
      const ps = document.querySelectorAll('.how-it-works p');
      for (const p of ps) {
        if (p.textContent.includes('byte for byte the same')) return p;
      }
      return ps[0] || document.querySelector('.how-it-works');
    }},
    { id: 'm7', text: 'Cards should sit side by side · <em>needs your AI</em>', check: checkM7, target: () => document.querySelector('#features') || document.querySelector('.features') }
  ];

  // ---------- 3. Hand-drawn Marks Layer (Red Circle & Gold Tick) ----------

  function getWordRangeRect(container, text, matchIndex = 0) {
    const root = typeof container === 'string' ? document.querySelector(container) : container;
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    let count = 0;
    const needle = text.toLowerCase();
    while ((node = walker.nextNode())) {
      const val = node.nodeValue || '';
      let pos = 0;
      const lower = val.toLowerCase();
      while ((pos = lower.indexOf(needle, pos)) !== -1) {
        if (count === matchIndex) {
          const range = document.createRange();
          range.setStart(node, pos);
          range.setEnd(node, pos + text.length);
          const r = range.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return r;
        }
        count++;
        pos += needle.length;
      }
    }
    return root.getBoundingClientRect();
  }

  function getCheckTargetRect(id) {
    if (id === 'm1') {
      const isFixed = checkM1();
      const r = getWordRangeRect('.hero h1', 'wrote', isFixed ? 0 : 1);
      if (r) return r;
    }
    if (id === 'm2') {
      const isFixed = checkM2();
      const r = getWordRangeRect('.stat-text', isFixed ? 'seconds' : 'minutes', 0);
      if (r) return r;
    }
    if (id === 'm3') {
      const logo = document.querySelector('header img.logo') || document.querySelector('.logo');
      if (logo) return logo.getBoundingClientRect();
    }
    if (id === 'm4') {
      const r = getWordRangeRect('.green-word', 'machine', 0) || getWordRangeRect('.how-it-works', 'machine', 0);
      if (r) return r;
    }
    if (id === 'm5') {
      const isFixed = checkM5();
      const targetText = isFixed ? 'open source' : '[LICENSE_TYPE]';
      const r = getWordRangeRect('.license-line', targetText, 0) || getWordRangeRect('footer', targetText, 0);
      if (r) return r;
      const footerEl = document.querySelector('.license-line') || document.querySelector('footer');
      if (footerEl) return footerEl.getBoundingClientRect();
    }
    if (id === 'm6') {
      const r = getWordRangeRect('.how-it-works', 'byte for byte the same', 0);
      if (r) return r;
      const ps = document.querySelectorAll('.how-it-works p');
      for (const p of ps) {
        if (p.textContent.includes('byte for byte the same')) return p.getBoundingClientRect();
      }
    }
    if (id === 'm7') {
      const cards = document.querySelectorAll('.feature-card');
      if (cards.length > 0) {
        let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
        for (const card of cards) {
          const r = card.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            if (r.left < minLeft) minLeft = r.left;
            if (r.top < minTop) minTop = r.top;
            if (r.right > maxRight) maxRight = r.right;
            if (r.bottom > maxBottom) maxBottom = r.bottom;
          }
        }
        if (minLeft < Infinity) {
          return new DOMRect(minLeft, minTop, maxRight - minLeft, maxBottom - minTop);
        }
      }
      const feat = document.querySelector('#features') || document.querySelector('.features');
      if (feat) return feat.getBoundingClientRect();
    }
    const item = CHECKS.find(c => c.id === id);
    const el = item ? item.target() : null;
    return el ? el.getBoundingClientRect() : null;
  }

  function pseudoRandom(seed) {
    let s = (seed % 2147483647);
    if (s <= 0) s += 2147483646;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function hashSeed(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
    return Math.abs(h) || 1;
  }

  function generateCirclePath(rect, seed) {
    if (!rect || rect.width === 0 || rect.height === 0) return '';
    const isSuper = rect.height > 120 || (rect.width / rect.height) > 4;
    const n = isSuper ? 4 : 2;

    const padX = Math.max(10, Math.min(18, rect.width * 0.08));
    const padY = Math.max(8, Math.min(16, rect.height * 0.1));

    const cx = rect.left + window.scrollX + rect.width / 2;
    const cy = rect.top + window.scrollY + rect.height / 2;
    const rx = rect.width / 2 + padX;
    const ry = rect.height / 2 + padY;

    const rng = pseudoRandom(seed);
    const points = [];
    const N = isSuper ? 48 : 36;
    const startAngle = -0.55 * Math.PI;
    const totalAngle = 2.25 * Math.PI;
    const exp = 2 / n;

    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const angle = startAngle + t * totalAngle;
      const cosT = Math.cos(angle);
      const sinT = Math.sin(angle);
      const signX = Math.sign(cosT) || 1;
      const signY = Math.sign(sinT) || 1;

      const wobble = 1 + (rng() - 0.5) * 0.04;
      const drift = (t - 0.5) * 3;

      const px = cx + (rx * Math.pow(Math.abs(cosT), exp) * signX) * wobble + drift * 0.5;
      const py = cy + (ry * Math.pow(Math.abs(sinT), exp) * signY) * wobble + drift * 0.5;
      points.push({ x: px, y: py });
    }

    let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      d += ` Q ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)} ${xc.toFixed(1)} ${yc.toFixed(1)}`;
    }
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    d += ` Q ${prev.x.toFixed(1)} ${prev.y.toFixed(1)} ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
    return d;
  }

  function generateTickPath(rect, seed) {
    if (!rect || rect.width === 0 || rect.height === 0) return '';
    const rng = pseudoRandom(seed);
    let tx = rect.right + window.scrollX + 14;
    let ty = rect.top + window.scrollY + Math.min(rect.height * 0.5, 30);
    const maxRight = document.documentElement.clientWidth + window.scrollX - 28;
    if (tx + 18 > maxRight) tx = maxRight - 18;

    const w1 = (rng() - 0.5) * 2;
    const w2 = (rng() - 0.5) * 2;
    const p0 = { x: tx - 9 + w1, y: ty - 1 + w2 };
    const p1 = { x: tx - 3, y: ty + 7 };
    const p2 = { x: tx + 9 + w2, y: ty - 7 + w1 };
    return `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} Q ${(p0.x + p1.x) / 2} ${(p0.y + p1.y) / 2} ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} Q ${(p1.x + p2.x) / 2} ${(p1.y + p2.y) / 2} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  const marksSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  marksSvg.id = 'draft-marks-layer';
  marksSvg.setAttribute('class', 'draft-mark-svg');
  marksSvg.setAttribute('data-retouch-ui', '');
  marksSvg.setAttribute('aria-hidden', 'true');
  stage.appendChild(marksSvg);

  const marks = new Map(); // id -> { group, circlePath, tickPath, state: 'none' | 'red' | 'gold', seed }

  for (const item of CHECKS) {
    const seed = hashSeed(item.id);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'draft-mark-group');
    g.dataset.checkId = item.id;

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    circle.setAttribute('class', 'draft-mark-circle');
    circle.setAttribute('stroke', '#ed1c24');
    circle.setAttribute('stroke-width', '2.5');
    circle.setAttribute('stroke-linecap', 'round');
    circle.setAttribute('stroke-linejoin', 'round');
    circle.setAttribute('fill', 'none');

    const tick = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tick.setAttribute('class', 'draft-mark-tick');
    tick.setAttribute('stroke', '#c8902a');
    tick.setAttribute('stroke-width', '2.5');
    tick.setAttribute('stroke-linecap', 'round');
    tick.setAttribute('stroke-linejoin', 'round');
    tick.setAttribute('fill', 'none');

    g.appendChild(circle);
    g.appendChild(tick);
    marksSvg.appendChild(g);

    marks.set(item.id, {
      group: g,
      circlePath: circle,
      tickPath: tick,
      state: 'none',
      seed
    });
  }

  function drawRedMark(id, instant = false) {
    const entry = marks.get(id);
    if (!entry) return;
    const rect = getCheckTargetRect(id);
    if (!rect) return;

    const d = generateCirclePath(rect, entry.seed);
    entry.circlePath.setAttribute('d', d);
    const len = entry.circlePath.getTotalLength();
    entry.circlePath.style.strokeDasharray = len;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (instant || prefersReduced || !window.gsap) {
      if (window.gsap) gsap.killTweensOf(entry.circlePath);
      entry.circlePath.style.strokeDashoffset = '0';
    } else {
      gsap.fromTo(entry.circlePath, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: 0.5, ease: 'power2.out' });
    }

    entry.tickPath.setAttribute('d', '');
    entry.state = 'red';
  }

  function transitionToGold(id) {
    const entry = marks.get(id);
    if (!entry) return;
    const rect = getCheckTargetRect(id);
    if (!rect) return;

    const td = generateTickPath(rect, entry.seed);
    entry.tickPath.setAttribute('d', td);
    const tLen = entry.tickPath.getTotalLength();
    entry.tickPath.style.strokeDasharray = tLen;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced || !window.gsap) {
      entry.circlePath.setAttribute('d', '');
      entry.tickPath.style.strokeDashoffset = '0';
    } else {
      const cLen = entry.circlePath.getTotalLength() || 100;
      gsap.to(entry.circlePath, { strokeDashoffset: cLen, duration: 0.35, ease: 'power2.in', onComplete: () => {
        if (entry.state === 'gold') entry.circlePath.setAttribute('d', '');
      }});
      gsap.fromTo(entry.tickPath, { strokeDashoffset: tLen }, { strokeDashoffset: 0, duration: 0.35, ease: 'power2.out' });
    }

    entry.state = 'gold';
  }

  function transitionToRed(id) {
    const entry = marks.get(id);
    if (!entry) return;
    const rect = getCheckTargetRect(id);
    if (!rect) return;

    const d = generateCirclePath(rect, entry.seed);
    entry.circlePath.setAttribute('d', d);
    const len = entry.circlePath.getTotalLength();
    entry.circlePath.style.strokeDasharray = len;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced || !window.gsap) {
      entry.tickPath.setAttribute('d', '');
      entry.circlePath.style.strokeDashoffset = '0';
    } else {
      const tLen = entry.tickPath.getTotalLength() || 40;
      gsap.to(entry.tickPath, { strokeDashoffset: tLen, duration: 0.3, ease: 'power2.in', onComplete: () => {
        if (entry.state === 'red') entry.tickPath.setAttribute('d', '');
      }});
      gsap.fromTo(entry.circlePath, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: 0.45, ease: 'power2.out' });
    }

    entry.state = 'red';
  }

  function updateMarksPositions() {
    for (const item of CHECKS) {
      const entry = marks.get(item.id);
      if (!entry) continue;
      const rect = getCheckTargetRect(item.id);
      if (!rect) continue;

      if (entry.state === 'red') {
        const d = generateCirclePath(rect, entry.seed);
        entry.circlePath.setAttribute('d', d);
        entry.circlePath.style.strokeDashoffset = '0';
      } else if (entry.state === 'gold') {
        const td = generateTickPath(rect, entry.seed);
        entry.tickPath.setAttribute('d', td);
        entry.tickPath.style.strokeDashoffset = '0';
      }
    }
  }

  // ---------- 4. Illusion Masks for Intro (M1, M2, M3, M4) ----------

  const masks = {};

  function createMasks() {
    // M3: Logo
    const logo = document.querySelector('header img.logo');
    if (logo) {
      const r = logo.getBoundingClientRect();
      const m = document.createElement('div');
      m.className = 'draft-mask draft-mask-m3';
      m.setAttribute('data-retouch-ui', '');
      m.setAttribute('aria-hidden', 'true');
      m.style.left = (r.left + window.scrollX) + 'px';
      m.style.top = (r.top + window.scrollY) + 'px';
      m.style.width = r.width + 'px';
      m.style.height = r.height + 'px';
      m.style.background = '#f6f3ee';
      m.style.display = 'flex';
      m.style.alignItems = 'center';
      const img = document.createElement('img');
      img.src = 'draft/logo-right.svg';
      img.alt = 'Retouch';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'contain';
      img.style.display = 'block';
      m.appendChild(img);
      stage.appendChild(m);
      masks.m3 = m;
    }

    // M1: Headline
    const h1 = document.querySelector('.hero h1');
    const hero = document.querySelector('.hero');
    if (h1 && hero) {
      const r = h1.getBoundingClientRect();
      const cs = window.getComputedStyle(h1);
      const m = document.createElement('div');
      m.className = 'draft-mask draft-mask-m1';
      m.setAttribute('data-retouch-ui', '');
      m.setAttribute('aria-hidden', 'true');
      m.style.left = (r.left + window.scrollX) + 'px';
      m.style.top = (r.top + window.scrollY) + 'px';
      m.style.width = r.width + 'px';
      m.style.height = r.height + 'px';
      m.style.background = '#f6f3ee';
      m.style.overflow = 'hidden';

      // Rebuild the hero's ::before blob inside the mask
      // Hero ::before: top: 10%, left: 50%, transform: translateX(-50%), width: 580px, height: 360px
      const heroR = hero.getBoundingClientRect();
      const heroBlobTop = (heroR.top + window.scrollY) + heroR.height * 0.10;
      const heroBlobLeft = (heroR.left + window.scrollX) + heroR.width * 0.5 - 290;

      const mTop = r.top + window.scrollY;
      const mLeft = r.left + window.scrollX;

      const blob = document.createElement('div');
      blob.setAttribute('data-retouch-ui', '');
      blob.setAttribute('aria-hidden', 'true');
      blob.style.position = 'absolute';
      blob.style.top = (heroBlobTop - mTop) + 'px';
      blob.style.left = (heroBlobLeft - mLeft) + 'px';
      blob.style.width = '580px';
      blob.style.height = '360px';
      blob.style.background = 'radial-gradient(circle, rgba(154, 92, 163, .22) 0%, rgba(200, 144, 42, .18) 50%, transparent 70%)';
      blob.style.filter = 'blur(48px)';
      blob.style.pointerEvents = 'none';
      blob.style.zIndex = '0';
      m.appendChild(blob);

      const textWrap = document.createElement('h1');
      textWrap.setAttribute('data-retouch-ui', '');
      textWrap.setAttribute('aria-hidden', 'true');
      textWrap.style.position = 'relative';
      textWrap.style.zIndex = '1';
      textWrap.style.font = cs.font;
      textWrap.style.letterSpacing = cs.letterSpacing;
      textWrap.style.textAlign = cs.textAlign;
      textWrap.style.color = cs.color;
      textWrap.style.margin = '0';
      textWrap.style.padding = '0';
      textWrap.textContent = 'Fix the HTML your AI wrote.';
      m.appendChild(textWrap);

      stage.appendChild(m);
      masks.m1 = m;
    }

    // M2: Stat
    const stat = document.querySelector('.stat-text');
    if (stat) {
      const r = stat.getBoundingClientRect();
      const cs = window.getComputedStyle(stat);
      const m = document.createElement('div');
      m.className = 'draft-mask draft-mask-m2';
      m.setAttribute('data-retouch-ui', '');
      m.setAttribute('aria-hidden', 'true');
      m.style.left = (r.left + window.scrollX) + 'px';
      m.style.top = (r.top + window.scrollY) + 'px';
      m.style.width = r.width + 'px';
      m.style.height = r.height + 'px';
      m.style.fontFamily = cs.fontFamily;
      m.style.fontSize = cs.fontSize;
      m.style.fontWeight = cs.fontWeight;
      m.style.lineHeight = cs.lineHeight;
      m.style.letterSpacing = cs.letterSpacing;
      m.style.textAlign = cs.textAlign;
      m.style.color = cs.color;
      m.style.background = '#f6f3ee';
      m.textContent = 'Saves in 3 seconds';
      stage.appendChild(m);
      masks.m2 = m;
    }

    // M4: Machine
    const word = document.querySelector('.green-word');
    if (word) {
      const r = word.getBoundingClientRect();
      const cs = window.getComputedStyle(word);
      const m = document.createElement('div');
      m.className = 'draft-mask draft-mask-m4';
      m.setAttribute('data-retouch-ui', '');
      m.setAttribute('aria-hidden', 'true');
      m.style.left = (r.left + window.scrollX) + 'px';
      m.style.top = (r.top + window.scrollY) + 'px';
      m.style.width = r.width + 'px';
      m.style.height = r.height + 'px';
      m.style.fontFamily = cs.fontFamily;
      m.style.fontSize = cs.fontSize;
      m.style.fontWeight = cs.fontWeight;
      m.style.lineHeight = cs.lineHeight;
      m.style.letterSpacing = cs.letterSpacing;
      m.style.color = '#1f2933';
      m.style.background = '#f6f3ee';
      m.textContent = 'machine';
      stage.appendChild(m);
      masks.m4 = m;
    }
  }

  function updateMaskPositions() {
    const h1 = document.querySelector('.hero h1');
    const hero = document.querySelector('.hero');
    const m1 = masks.m1;
    if (h1 && hero && m1) {
      const r = h1.getBoundingClientRect();
      const mTop = r.top + window.scrollY;
      const mLeft = r.left + window.scrollX;
      m1.style.left = mLeft + 'px';
      m1.style.top = mTop + 'px';
      m1.style.width = r.width + 'px';
      m1.style.height = r.height + 'px';

      const cs = window.getComputedStyle(h1);
      const textWrap = m1.querySelector('h1');
      if (textWrap) {
        textWrap.style.font = cs.font;
        textWrap.style.letterSpacing = cs.letterSpacing;
        textWrap.style.textAlign = cs.textAlign;
        textWrap.style.color = cs.color;
      }

      const heroR = hero.getBoundingClientRect();
      const heroBlobTop = (heroR.top + window.scrollY) + heroR.height * 0.10;
      const heroBlobLeft = (heroR.left + window.scrollX) + heroR.width * 0.5 - 290;
      const blob = m1.querySelector('div');
      if (blob) {
        blob.style.top = (heroBlobTop - mTop) + 'px';
        blob.style.left = (heroBlobLeft - mLeft) + 'px';
      }
    }
    const stat = document.querySelector('.stat-text');
    const m2 = masks.m2;
    if (stat && m2) {
      const r = stat.getBoundingClientRect();
      m2.style.left = (r.left + window.scrollX) + 'px';
      m2.style.top = (r.top + window.scrollY) + 'px';
      m2.style.width = r.width + 'px';
      m2.style.height = r.height + 'px';
    }
    const logo = document.querySelector('header img.logo');
    const m3 = masks.m3;
    if (logo && m3) {
      const r = logo.getBoundingClientRect();
      m3.style.left = (r.left + window.scrollX) + 'px';
      m3.style.top = (r.top + window.scrollY) + 'px';
      m3.style.width = r.width + 'px';
      m3.style.height = r.height + 'px';
    }
    const word = document.querySelector('.green-word');
    const m4 = masks.m4;
    if (word && m4) {
      const r = word.getBoundingClientRect();
      m4.style.left = (r.left + window.scrollX) + 'px';
      m4.style.top = (r.top + window.scrollY) + 'px';
      m4.style.width = r.width + 'px';
      m4.style.height = r.height + 'px';
    }
  }
  window.__updateMaskPositions = updateMaskPositions;
  window.__getCheckTargetRect = getCheckTargetRect;

  function spawnChips(r, count = 2) {
    if (!window.gsap) return;
    for (let k = 0; k < count; k++) {
      const c = document.createElement('div');
      c.className = 'draft-chip';
      c.setAttribute('data-retouch-ui', '');
      stage.appendChild(c);
      const startX = r.left + window.scrollX + r.width * 0.5 + (Math.random() - 0.5) * 16;
      const startY = r.top + window.scrollY + r.height * 0.5;
      gsap.fromTo(c,
        { left: startX, top: startY },
        {
          left: `+=${(Math.random() - 0.5) * 60}`,
          top: `+=${25 + Math.random() * 30}`,
          rotation: Math.random() * 360,
          opacity: 0,
          duration: 0.5,
          ease: 'power2.out',
          onComplete: () => c.remove()
        }
      );
    }
  }

  function measureRealBeak(targetId, jabIndex, nearEdgeX, boxTop, boxBottom) {
    if (!bird) return 0;
    const polygon = bird.el.querySelector('polygon');
    const svg = bird.el.querySelector('svg');
    let beakX, beakY;
    if (polygon && svg) {
      try {
        const pt = svg.createSVGPoint();
        pt.x = 363.8;
        pt.y = 59.7;
        const ctm = polygon.getScreenCTM();
        if (ctm) {
          const screenPt = pt.matrixTransform(ctm);
          beakX = screenPt.x + window.scrollX;
          beakY = screenPt.y + window.scrollY;
        }
      } catch {}
    }
    if (beakX == null) {
      const dt = bird.drillTarget ? bird.drillTarget() : bird.beakTarget();
      beakX = dt.x;
      beakY = dt.y;
    }

    const dx = Math.abs(beakX - nearEdgeX);
    const dy = Math.max(0, boxTop - beakY, beakY - boxBottom);
    const dist = Math.hypot(dx, dy);

    window.__realBeakDistances = window.__realBeakDistances || {};
    window.__realBeakDistances[targetId] = window.__realBeakDistances[targetId] || [];
    window.__realBeakDistances[targetId].push({
      jab: jabIndex,
      beakX,
      beakY,
      nearEdgeX,
      boxTop,
      boxBottom,
      dist
    });

    window.__worstRealBeakDistances = window.__worstRealBeakDistances || {};
    window.__worstRealBeakDistances[targetId] = Math.max(
      window.__worstRealBeakDistances[targetId] != null ? window.__worstRealBeakDistances[targetId] : 0,
      dist
    );
    return dist;
  }

  function breakM3() {
    if (!introActive) return;
    const m = masks.m3;
    if (m) {
      if (window.gsap) {
        gsap.to(m, { rotateY: 90, opacity: 0, duration: 0.3, ease: 'power2.in', onComplete: () => {
          m.remove();
          delete masks.m3;
        }});
      } else {
        m.remove();
        delete masks.m3;
      }
    }
    drawRedMark('m3');
  }

  function breakM1() {
    if (!introActive) return;
    const m = masks.m1;
    if (m) {
      if (window.gsap) {
        gsap.to(m, { x: 3, duration: 0.04, repeat: 3, yoyo: true, onComplete: () => {
          gsap.to(m, { opacity: 0, duration: 0.2, onComplete: () => {
            m.remove();
            delete masks.m1;
          }});
        }});
      } else {
        m.remove();
        delete masks.m1;
      }
    }
    drawRedMark('m1');
  }

  function breakM2() {
    if (!introActive) return;
    const m = masks.m2;
    if (m) {
      if (window.gsap) {
        gsap.to(m, { x: 3, duration: 0.04, repeat: 3, yoyo: true, onComplete: () => {
          gsap.to(m, { opacity: 0, duration: 0.2, onComplete: () => {
            m.remove();
            delete masks.m2;
          }});
        }});
      } else {
        m.remove();
        delete masks.m2;
      }
    }
    drawRedMark('m2');
  }

  function breakM4() {
    if (!introActive) return;
    const m = masks.m4;
    if (m) {
      const r = m.getBoundingClientRect();
      if (window.gsap) {
        for (let k = 0; k < 4; k++) {
          const d = document.createElement('div');
          d.className = 'draft-drop';
          d.setAttribute('data-retouch-ui', '');
          stage.appendChild(d);
          const startX = r.left + window.scrollX + (k + 0.5) * (r.width / 4) + (Math.random() - 0.5) * 4;
          const startY = r.top + window.scrollY + r.height * 0.8;
          gsap.fromTo(d,
            { left: startX, top: startY, opacity: 1, scale: 0.8 },
            { top: `+=${35 + Math.random() * 20}`, opacity: 0, scale: 1.1, duration: 0.55 + k * 0.08, ease: 'power2.in', onComplete: () => d.remove() }
          );
        }
        gsap.to(m, { opacity: 0, duration: 0.35, onComplete: () => {
          m.remove();
          delete masks.m4;
        }});
      } else {
        m.remove();
        delete masks.m4;
      }
    }
    drawRedMark('m4');
  }

  // ---------- 5. Checklist DOM Construction ----------

  const card = document.createElement('div');
  card.className = 'checklist-card';
  card.setAttribute('data-retouch-ui', '');

  // Collapsed pill label (displayed when < 1280px and not expanded)
  const pillLabel = document.createElement('div');
  pillLabel.className = 'checklist-pill-label';
  pillLabel.textContent = '7 to go';
  card.appendChild(pillLabel);

  card.addEventListener('click', (e) => {
    if (window.innerWidth <= 1280 && !card.classList.contains('expanded')) {
      card.classList.add('expanded');
      updateBirdOnCard(true);
    } else if (card.classList.contains('collapsed')) {
      card.classList.remove('collapsed');
      updateBirdOnCard(true);
    }
  });

  const header = document.createElement('div');
  header.className = 'checklist-header';
  const title = document.createElement('span');
  title.className = 'checklist-title';
  title.textContent = '7 things your AI got wrong';
  const badge = document.createElement('span');
  badge.className = 'checklist-badge';
  badge.textContent = '7 to go';
  header.appendChild(title);
  header.appendChild(badge);

  header.addEventListener('click', (e) => {
    e.stopPropagation();
    if (window.innerWidth <= 1280) {
      card.classList.toggle('expanded');
    } else {
      card.classList.toggle('collapsed');
    }
    updateBirdOnCard(true);
  });

  card.appendChild(header);

  const list = document.createElement('ul');
  list.className = 'checklist-rows';

  const checkElements = new Map();

  for (const item of CHECKS) {
    const li = document.createElement('li');
    li.className = 'checklist-row';
    li.dataset.checkId = item.id;

    const icon = document.createElement('span');
    icon.className = 'checklist-icon';
    icon.innerHTML = '<svg viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const textSpan = document.createElement('span');
    textSpan.className = 'checklist-text';
    textSpan.innerHTML = item.text;
    if (item.hint) {
      const hint = document.createElement('span');
      hint.className = 'checklist-hint';
      hint.textContent = item.hint;
      textSpan.appendChild(hint);
    }

    li.appendChild(icon);
    li.appendChild(textSpan);

    li.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const el = item.target();
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlightTarget(el);
      }
    });

    list.appendChild(li);
    checkElements.set(item.id, li);
  }

  card.appendChild(list);
  document.body.appendChild(card);

  function showChecklist(instant = false) {
    card.style.display = '';
    card.style.pointerEvents = '';
    if (instant || !window.gsap) {
      const prevTrans = card.style.transition;
      card.style.transition = 'none';
      card.style.transform = 'none';
      card.style.opacity = '1';
      card.offsetHeight; // force reflow
      card.style.transition = prevTrans;
      return Promise.resolve();
    } else {
      return new Promise((resolve) => {
        gsap.to(card, {
          y: 0,
          opacity: 1,
          duration: 0.35,
          ease: 'power2.out',
          onComplete: () => {
            card.style.transform = 'none';
            resolve();
          }
        });
      });
    }
  }

  function hideChecklist() {
    card.style.transform = 'translateY(120px)';
    card.style.opacity = '0';
    card.style.pointerEvents = 'none';
  }

  // ---------- 6. Outline Overlay on Click ----------

  let outlineOverlay = null;
  function highlightTarget(el) {
    if (!outlineOverlay) {
      outlineOverlay = document.createElement('div');
      outlineOverlay.id = 'draft-outline-overlay';
      outlineOverlay.setAttribute('data-retouch-ui', '');
      stage.appendChild(outlineOverlay);
    }
    const rect = el.getBoundingClientRect();
    outlineOverlay.style.top = (rect.top + window.scrollY) + 'px';
    outlineOverlay.style.left = (rect.left + window.scrollX) + 'px';
    outlineOverlay.style.width = rect.width + 'px';
    outlineOverlay.style.height = rect.height + 'px';

    outlineOverlay.style.animation = 'none';
    outlineOverlay.offsetHeight; // trigger reflow
    outlineOverlay.style.animation = 'outline-pulse 1.4s ease forwards';
  }

  // ---------- 7. Update Checklist & Marks State ----------

  function postToParent(msg) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ retouchWorld: 1, ...msg }, location.origin);
    }
  }

  function getFixedIds() {
    return CHECKS.filter((c) => c.check()).map((c) => c.id);
  }

  function updateChecklist() {
    let remaining = 0;
    for (const item of CHECKS) {
      const isFixed = item.check();
      const li = checkElements.get(item.id);
      if (li) {
        li.classList.toggle('fixed', isFixed);
      }

      const mark = marks.get(item.id);
      if (mark) {
        if (isFixed && mark.state !== 'gold') {
          transitionToGold(item.id);
        } else if (!isFixed && mark.state === 'gold') {
          transitionToRed(item.id);
        }
      }

      if (!isFixed) remaining++;
    }

    if (remaining === 0) {
      title.textContent = 'All fixed. Now press Save.';
      badge.textContent = 'Done';
      pillLabel.textContent = 'All fixed';
      badge.classList.add('complete');
    } else if (remaining === 7) {
      title.textContent = '7 things your AI got wrong';
      badge.textContent = '7 to go';
      pillLabel.textContent = '7 to go';
      badge.classList.remove('complete');
    } else {
      title.textContent = '7 things your AI got wrong';
      const label = remaining === 1 ? '1 to go' : `${remaining} to go`;
      badge.textContent = label;
      pillLabel.textContent = label;
      badge.classList.remove('complete');
    }

    postToParent({ type: 'fixes', fixed: getFixedIds() });
  }

  // ---------- 8. Bird Rig & Intro Choreography ----------

  const bird = window.DraftBird ? DraftBird.create({
    parent: stage,
    legs: 2,
    width: 52,
    zIndex: 150
  }) : null;

  // Runtime chicken peck stand position: uses runtime offset beakTarget() - (bird.x, bird.y) without hardcoding rig constants
  function getChickenPeckStandPos(targetX, targetY, facing = 1) {
    if (!bird) return { x: targetX, y: targetY };
    const curX = bird.x, curY = bird.y, curF = bird.facing;
    bird.setPos(0, 0);
    bird.face(facing, true);
    const bt = bird.beakTarget();
    bird.setPos(curX, curY);
    bird.face(curF, true);
    return {
      x: targetX - bt.x,
      y: targetY - bt.y
    };
  }

  function getCardRestPos() {
    const cardRect = card.getBoundingClientRect();
    const isPill = window.innerWidth <= 1280 && !card.classList.contains('expanded');
    const height = card.offsetHeight || cardRect.height;
    // Settled top is window.innerHeight - 24 - height (bottom: 24px in CSS)
    const settledTop = window.innerHeight - 24 - height;
    const restX = isPill ? cardRect.left + cardRect.width * 0.5 : cardRect.left + 50;
    const restY = settledTop > 0 ? settledTop : cardRect.top;
    return { x: restX, y: restY };
  }

  function updateBirdOnCard(hop = true) {
    if (!bird || bird.el.parentNode !== fixedStage) return;
    const rest = getCardRestPos();
    if (Math.abs(bird.x - rest.x) < 2 && Math.abs(bird.y - rest.y) < 2) return;
    if (hop && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      bird.hopTo(rest.x, rest.y, 25);
    } else {
      bird.setPos(rest.x, rest.y);
    }
  }

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      updateBirdOnCard(true);
    });
    ro.observe(card);
  }
  card.addEventListener('transitionend', () => updateBirdOnCard(true));

  let introActive = false;
  window.__draftIntroActive = false;
  window.__draftIntroStepsHistory = [];
  function setIntroStep(step) {
    window.__draftIntroStep = step;
    window.__draftIntroStepsHistory.push(step);
  }
  let interactionCleanup = null;
  let activeScrollTween = null;

  async function scrollWithHop(targetX, targetY, arc = 70) {
    const desiredScroll = Math.max(0, targetY - window.innerHeight * 0.5);
    const startScroll = window.scrollY;
    const deltaScroll = desiredScroll - startScroll;

    if (Math.abs(deltaScroll) > 10 && window.gsap) {
      const scrollObj = { y: startScroll };
      const scrollPromise = new Promise((resolve) => {
        activeScrollTween = gsap.to(scrollObj, {
          y: desiredScroll,
          duration: 0.65,
          delay: 0.08,
          ease: 'power1.inOut',
          onUpdate() {
            window.scrollTo(0, scrollObj.y);
          },
          onComplete() {
            activeScrollTween = null;
            resolve();
          }
        });
      });
      await Promise.all([bird.hopTo(targetX, targetY, arc), scrollPromise]);
    } else {
      await bird.hopTo(targetX, targetY, arc);
    }
  }

  function abortIntro() {
    if (!introActive) return;
    introActive = false;
    window.__draftIntroActive = false;
    postToParent({ type: 'intro-end' });

    if (activeScrollTween) {
      activeScrollTween.kill();
      activeScrollTween = null;
    }

    if (bird) bird.stop();

    if (interactionCleanup) {
      interactionCleanup();
      interactionCleanup = null;
    }

    if (window.gsap) {
      gsap.killTweensOf('.draft-mask');
      gsap.killTweensOf('.draft-chip');
      gsap.killTweensOf('.draft-drop');
      gsap.killTweensOf('.draft-crack');
      gsap.killTweensOf('.draft-mark-circle');
      gsap.killTweensOf('.draft-mark-tick');
    }

    // Remove all mask and effect elements immediately
    document.querySelectorAll('.draft-mask, .draft-chip, .draft-drop, .draft-crack').forEach(el => el.remove());
    for (const k in masks) delete masks[k];

    // Reveal checklist immediately
    showChecklist(true);

    // Place bird at resting position immediately in fixedStage
    if (bird) {
      fixedStage.appendChild(bird.el);
      const rest = getCardRestPos();
      bird.setPos(rest.x, rest.y);
      bird.face(1);
    }

    // Draw all unfixed red marks immediately
    for (const item of CHECKS) {
      if (!item.check()) {
        drawRedMark(item.id, true);
      }
    }
  }

  function setupInteractionListeners() {
    const events = ['pointerdown', 'keydown', 'wheel'];
    const handler = () => abortIntro();
    events.forEach(ev => window.addEventListener(ev, handler, { once: true, passive: true }));

    let parentHandler = null;
    let parentDoc = null;
    try {
      if (window.parent && window.parent !== window && window.parent.document) {
        parentDoc = window.parent.document;
        parentHandler = handler;
        parentDoc.addEventListener('pointerdown', parentHandler, { once: true, passive: true });
        parentDoc.addEventListener('click', parentHandler, { once: true, passive: true });
      }
    } catch {}

    interactionCleanup = () => {
      events.forEach(ev => window.removeEventListener(ev, handler));
      try {
        if (parentDoc && parentHandler) {
          parentDoc.removeEventListener('pointerdown', parentHandler);
          parentDoc.removeEventListener('click', parentHandler);
        }
      } catch {}
    };
  }

  function waitForScroll() {
    return new Promise((resolve) => {
      let timer;
      let fallback;
      const onScroll = () => {
        clearTimeout(timer);
        timer = setTimeout(done, 120);
      };
      const done = () => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('scrollend', done);
        clearTimeout(fallback);
        resolve();
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('scrollend', done, { once: true, passive: true });
      timer = setTimeout(done, 120);
      fallback = setTimeout(done, 1200);
    });
  }

  async function ensureInViewport(standX, standY, targetY) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const birdTop = standY - 123;
    const birdBottom = standY + 9;
    const currentScroll = window.scrollY;
    const viewTop = birdTop - currentScroll;
    const viewBottom = birdBottom - currentScroll;

    const fits = viewTop >= 20 && viewBottom <= window.innerHeight - 20;
    if (!fits) {
      const desiredScroll = Math.max(0, targetY - window.innerHeight * 0.5);
      if (Math.abs(desiredScroll - currentScroll) > 10) {
        window.scrollTo({ top: desiredScroll, behavior: 'smooth' });
        await waitForScroll();
      }
    }
  }

  window.__draftOpenSideChecks = {
    m3: { side: 'left', dir: 1, open: true, note: 'Header logo has open space to left' },
    m1: { side: 'right', dir: -1, open: true, note: 'Headline second wrote ends line, right is open' },
    m2: { side: 'fallback-peck', dir: 1, open: false, note: 'Text 0px on left, timer 16px on right (< 62px); fell back to chicken peck' },
    m4: { side: 'right', dir: -1, open: true, note: 'machine. ends line, right is open' }
  };

  async function playIntro() {
    if (!introActive) return;
    window.__draftIntroActive = true;
    postToParent({ type: 'intro-start' });

    // 1. Visit M3 (Logo) - Woodpecker visit from open left side
    const logoEl = document.querySelector('header img.logo');
    const logoR = logoEl ? logoEl.getBoundingClientRect() : { left: 84, top: 17, width: 120, height: 38 };
    const logoNearX = logoR.left + window.scrollX;
    const logoTargetY = logoR.top + window.scrollY + logoR.height * 0.5;
    const logoCling = bird.clingPos(logoNearX, logoTargetY, 1);

    // Start bird at visible left boundary, head and feet inside viewport
    bird.setPos(24, logoCling.y);
    bird.face(1);
    setIntroStep('arrival');
    await new Promise(r => setTimeout(r, 300));
    if (!introActive) return;

    await bird.walkTo(logoCling.x, 260);
    if (!introActive) return;
    bird.face(1);
    await bird.cling();
    if (!introActive) return;

    await bird.drill((i) => {
      measureRealBeak('m3', i, logoNearX, logoR.top + window.scrollY, logoR.bottom + window.scrollY);
      spawnChips(logoR, 2);
      if (i === 2) setIntroStep('drill-m3');
      if (i === 4) breakM3();
    }, 4, 2);
    if (!introActive) return;
    await bird.uncling();
    if (!introActive) return;

    // 2. Visit M1 (Headline second "wrote") - Woodpecker visit from open right side
    const h1W = getWordRangeRect('.hero h1', 'wrote', 1);
    const h1El = document.querySelector('.hero h1');
    const h1R = h1W || (h1El ? h1El.getBoundingClientRect() : null);
    if (h1R) {
      const h1NearX = h1R.right + window.scrollX;
      const h1DocTop = h1R.top + window.scrollY;
      const h1DocBottom = h1R.bottom + window.scrollY;
      const h1TargetY = h1DocTop + h1R.height * 0.5;
      const h1Cling = bird.clingPos(h1NearX, h1TargetY, -1);

      await ensureInViewport(h1Cling.x, h1Cling.y, h1TargetY);
      if (!introActive) return;
      await bird.hopTo(h1Cling.x, h1Cling.y, 60);
      if (!introActive) return;
      bird.face(-1);
      await bird.cling();
      if (!introActive) return;

      let crackPath = null, crackLen = 100;
      if (masks.m1) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'draft-crack');
        svg.setAttribute('data-retouch-ui', '');
        svg.setAttribute('viewBox', '0 0 100 40');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.innerHTML = '<path d="M6 20 L22 14 L30 24 L44 10 L56 26 L70 16 L82 22 L96 12"/>';
        masks.m1.appendChild(svg);
        crackPath = svg.querySelector('path');
        crackLen = crackPath ? crackPath.getTotalLength() : 100;
        crackPath.style.strokeDasharray = crackLen;
        crackPath.style.strokeDashoffset = crackLen;
      }

      await bird.drill((i) => {
        measureRealBeak('m1', i, h1NearX, h1DocTop, h1DocBottom);
        spawnChips(h1R, 2);
        if (crackPath && i <= 3) {
          crackPath.style.strokeDashoffset = crackLen * (1 - (i + 1) / 4);
          if (masks.m1) gsap.to(masks.m1, { x: (i % 2 === 0 ? 2 : -2), duration: 0.03, yoyo: true });
        }
        if (i === 2) setIntroStep('drill-m1');
        if (i === 4) breakM1();
      }, 4, 2);
      if (!introActive) return;
      await bird.uncling();
      if (!introActive) return;
    }

    // 3. Visit M2 (Stat) - Neither side has 62px clearance (0px to text on left, 16px to timer on right). Falls back to chicken peck.
    const statW = getWordRangeRect('.stat-text', 'minutes', 0);
    const statEl = document.querySelector('.stat-text');
    const statR = statW || (statEl ? statEl.getBoundingClientRect() : null);
    if (statR) {
      const statNearX = statR.left + window.scrollX;
      const statDocTop = statR.top + window.scrollY;
      const statDocBottom = statR.bottom + window.scrollY;
      const statTargetY = statDocTop + statR.height * 0.5;
      const statStand = getChickenPeckStandPos(statNearX, statTargetY, 1);

      await scrollWithHop(statStand.x, statStand.y, 40);
      if (!introActive) return;
      bird.face(1);

      let crackPath = null, crackLen = 100;
      if (masks.m2) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'draft-crack');
        svg.setAttribute('data-retouch-ui', '');
        svg.setAttribute('viewBox', '0 0 100 40');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.innerHTML = '<path d="M6 20 L22 14 L30 24 L44 10 L56 26 L70 16 L82 22 L96 12"/>';
        masks.m2.appendChild(svg);
        crackPath = svg.querySelector('path');
        crackLen = crackPath ? crackPath.getTotalLength() : 100;
        crackPath.style.strokeDasharray = crackLen;
        crackPath.style.strokeDashoffset = 0;
      }

      await bird.peck((i) => {
        measureRealBeak('m2', i, statNearX, statDocTop, statDocBottom);
        spawnChips(statR, 2);
        if (i === 0) {
          setIntroStep('drill-m2');
          breakM2();
        }
      }, 2);
      if (!introActive) return;
    }

    // 4. Visit M4 (Machine) - Woodpecker visit from open right side
    const wordW = getWordRangeRect('.green-word', 'machine', 0);
    const wordEl = document.querySelector('.green-word');
    const wordR = wordW || (wordEl ? wordEl.getBoundingClientRect() : null);
    if (wordR) {
      const wordNearX = wordR.right + window.scrollX;
      const wordDocTop = wordR.top + window.scrollY;
      const wordDocBottom = wordR.bottom + window.scrollY;
      const wordTargetY = wordDocTop + wordR.height * 0.5;
      const wordCling = bird.clingPos(wordNearX, wordTargetY, -1);

      await scrollWithHop(wordCling.x, wordCling.y, 40);
      if (!introActive) return;
      bird.face(-1);
      await bird.cling();
      if (!introActive) return;

      await bird.drill((i) => {
        measureRealBeak('m4', i, wordNearX, wordDocTop, wordDocBottom);
        spawnChips(wordR, 2);
        if (i === 2) setIntroStep('drill-m4');
        if (i === 4) breakM4();
      }, 4, 2);
      if (!introActive) return;
      await bird.uncling();
      if (!introActive) return;
    }

    // 5. Remaining marks (M5-M7) stagger
    const remainingIds = ['m5', 'm6', 'm7'];
    for (const id of remainingIds) {
      if (!introActive) return;
      drawRedMark(id);
      await new Promise(r => setTimeout(r, 150));
    }

    // 6. Bird says "there."
    await bird.say('there.', 0.9);
    if (!introActive) return;

    // Reparent bird to fixedStage so it stays locked in viewport coordinates during return scroll
    const currentViewY = bird.y - window.scrollY;
    const currentViewX = bird.x;
    fixedStage.appendChild(bird.el);
    bird.setPos(currentViewX, currentViewY);

    if (window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await waitForScroll();
      if (!introActive) return;
    }

    // 7. Show checklist, wait until card or pill has finished moving, bird lands on top of card
    await showChecklist();
    if (!introActive) return;

    const rest = getCardRestPos();
    await bird.hopTo(rest.x, rest.y, 50);
    if (!introActive) return;

    bird.setPos(rest.x, rest.y);
    bird.face(1);
    setIntroStep('rest');

    introActive = false;
    window.__draftIntroActive = false;
    postToParent({ type: 'intro-end' });
    if (interactionCleanup) {
      interactionCleanup();
      interactionCleanup = null;
    }
  }

  // ---------- 9. Initialize Intro / Standby State ----------

  updateStageSize();
  window.addEventListener('resize', () => {
    updateStageSize();
    updateMaskPositions();
    updateMarksPositions();
    updateBirdOnCard(false);
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      updateMaskPositions();
      updateMarksPositions();
    });
  }

  const introSeen = sessionStorage.getItem('draft:intro-seen');
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const anyFixedInitially = CHECKS.some(c => c.check());
  const shouldPlayIntro = !introSeen && !prefersReduced && !anyFixedInitially && Boolean(bird);

  let inWorld = false;
  try {
    inWorld = Boolean(window.parent && window.parent !== window && window.parent.innerWidth >= 1100);
  } catch (e) {}

  // Docked, the window covers most of the screen, and Chrome never hands a wheel gesture from a frame back to
  // the page. Until the visitor clicks into the draft, the wheel scrolls the homepage (someone scrolling past
  // shouldn't have to scroll through the whole draft first); after that it scrolls the draft, and the homepage
  // once the draft can't go any further that way.
  if (inWorld) {
    let engaged = false;
    const engage = () => { engaged = true; };
    window.addEventListener('pointerdown', engage, true);
    window.addEventListener('keydown', engage, true);
    let lastPing = 0;
    window.addEventListener('wheel', (e) => {
      const now = performance.now();
      if (now - lastPing > 100) {   // the homepage's dock assist waits while a hand is on the wheel
        lastPing = now;
        try { window.top.postMessage({ retouchWorld: 1, type: 'input' }, location.origin); } catch (err) {}
      }
      if (e.ctrlKey || !e.deltaY) return;
      const root = document.scrollingElement || document.documentElement;
      const atTop = root.scrollTop <= 0;
      const atEnd = root.scrollTop + window.innerHeight >= root.scrollHeight - 1;
      if (engaged && ((e.deltaY > 0 && !atEnd) || (e.deltaY < 0 && !atTop))) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      try { window.top.scrollBy({ top: e.deltaY * unit, left: 0, behavior: 'instant' }); } catch (err) {}
    }, { passive: false });
  }

  if (shouldPlayIntro) {
    sessionStorage.setItem('draft:intro-seen', '1');
    introActive = true;
    createMasks();
    updateMaskPositions();
    hideChecklist();
    setupInteractionListeners();

    if (inWorld) {
      if (bird) {
        const logoEl = document.querySelector('header img.logo');
        const logoR = logoEl ? logoEl.getBoundingClientRect() : { left: 84, top: 17, width: 120, height: 38 };
        const logoNearX = logoR.left + window.scrollX;
        const logoTargetY = logoR.top + window.scrollY + logoR.height * 0.5;
        const logoCling = bird.clingPos(logoNearX, logoTargetY, 1);
        bird.setPos(24, logoCling.y);
        bird.face(1);
      }
      let started = false;
      let fallbackTimer = null;
      const start = () => {
        if (started || !introActive) return;
        started = true;
        window.removeEventListener('message', onWorldMessage);
        if (fallbackTimer) clearTimeout(fallbackTimer);
        playIntro();
      };
      const onWorldMessage = (e) => {
        if (e.origin === location.origin && e.data && e.data.retouchWorld) {
          if (e.data.type === 'intro-hold') {
            if (fallbackTimer) clearTimeout(fallbackTimer);
            fallbackTimer = null;
          } else if (e.data.type === 'opening-done') {
            start();
          }
        }
      };
      window.addEventListener('message', onWorldMessage);
      fallbackTimer = setTimeout(start, 4000);
    } else {
      playIntro();
    }
  } else {
    showChecklist(true);
    if (bird) {
      fixedStage.appendChild(bird.el);
      const rest = getCardRestPos();
      bird.setPos(rest.x, rest.y);
      bird.face(1);
    }
    for (const item of CHECKS) {
      if (item.check()) {
        transitionToGold(item.id);
      } else {
        drawRedMark(item.id, true);
      }
    }
  }

  // ---------- 10. Mutation Observer & Live Event Listeners ----------

  let debounceTimer = null;
  function scheduleCheck() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      updateStageSize();
      updateMarksPositions();
      refreshIDBPromptNotes();
      updateChecklist();
    }, 150);
  }

  const observer = new MutationObserver((mutations) => {
    let hasContentMutation = false;
    for (const m of mutations) {
      if (m.target && m.target.closest && m.target.closest('[data-retouch-ui]')) continue;
      hasContentMutation = true;
      break;
    }
    if (hasContentMutation) scheduleCheck();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true
  });

  window.addEventListener('message', (e) => {
    if (e.data && e.data.retouch) {
      scheduleCheck();
    }
  });

  window.addEventListener('input', scheduleCheck);
  window.addEventListener('click', () => setTimeout(scheduleCheck, 50));

  // Initial check once DOM ready and fetch IDB notes
  refreshIDBPromptNotes();
  updateChecklist();

  // ---------- 11. Stat Strip Timer ----------

  const timerEl = document.querySelector('.stat-timer');
  const digitsEl = document.querySelector('.timer-digits');
  if (timerEl && digitsEl) {
    let timerStarted = false;

    const timerObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !timerStarted) {
          timerStarted = true;
          timerObserver.disconnect();

          if (prefersReduced) {
            digitsEl.textContent = '3.0';
            return;
          }

          const start = performance.now();
          const duration = 1200; // 1.2s animation to 3.0s
          function tick(now) {
            const elapsed = now - start;
            const progress = Math.min(1, elapsed / duration);
            const val = (progress * 3.0).toFixed(1);
            digitsEl.textContent = val;
            if (progress < 1) {
              requestAnimationFrame(tick);
            } else {
              digitsEl.textContent = '3.0';
            }
          }
          requestAnimationFrame(tick);
        }
      }
    }, { threshold: 0.5 });

    timerObserver.observe(timerEl);
  }

  // ---------- 12. Readiness Flag ----------
  window.__draftReady = true;

})();
