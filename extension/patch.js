// Source patching: apply edits to the original HTML source without re-serializing the document.
// Two kinds of change, both located by text the page showed the user:
//   text     { before, after, anchor }  replace one run of text (kept byte for byte around it)
//   element  { tag, firstText, lastText, tagCounts, afterHtml, anchor }
//            replace a whole element whose structure changed (formatting added or removed) with its
//            new markup, located by its own first and last text and its tag name
//   run      { items: [{ tag, firstText, lastText, tagCounts }, ...], afterHtml, anchor }
//            replace several adjacent sibling elements in the source from items[0] through the last
//            item with afterHtml
//   empty    { tag, skip, afterHtml, anchor }
//            fill an element that had no text: the (skip+1)th empty element of that tag after the anchor
//   attr     { tag, attr, before, after, skip, anchor }
//            change one attribute on the (skip+1)th tag of that name after the anchor whose attribute
//            currently equals `before` (or lacks it when `before` is null); quoting is preserved
//   style    { property, before, after, skip, media }
//            change the value of one CSS custom property inside the page's own <style> blocks: the
//            (skip+1)th declaration of that property in the matching @media context. Only the value
//            characters move; whitespace, `!important` and the semicolon stay as they were (D29)
// `anchor` is the text of a nearby preceding text node, used to pick the right occurrence when the
// located text appears more than once. Pure functions, no DOM, unit-tested under Node.
(function (root) {
  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Elements whose content is raw text the browser never shows as page text.
  const RAW = new Set(['script', 'style', 'textarea', 'template', 'noscript', 'title']);
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

  // Splits the source into text, tag, comment, declaration and raw-content tokens.
  function tokenize(source) {
    const tokens = [];
    const n = source.length;
    const lower = source.toLowerCase();
    let i = 0;
    let start = 0;
    const flush = (end) => { if (end > start) tokens.push({ type: 'text', start, end }); };
    while (i < n) {
      if (source[i] !== '<' || !/[a-zA-Z!?\/]/.test(source[i + 1] || '')) { i++; continue; }
      flush(i);
      if (source.startsWith('<!--', i)) {
        const end = source.indexOf('-->', i + 4);
        const e = end === -1 ? n : end + 3;
        tokens.push({ type: 'comment', start: i, end: e });
        i = e;
      } else {
        const m = /^<(\/?)([a-zA-Z][\w:-]*)/.exec(source.slice(i, i + 80));
        let j = i + 1;
        let quote = null;
        while (j < n) {
          const c = source[j];
          if (quote) { if (c === quote) quote = null; }
          else if (c === '"' || c === "'") quote = c;
          else if (c === '>') break;
          j++;
        }
        j = Math.min(j + 1, n);
        if (m) {
          const name = m[2].toLowerCase();
          const closing = !!m[1];
          const selfClosing = !closing && (VOID.has(name) || source[j - 2] === '/');
          tokens.push({ type: 'tag', start: i, end: j, name, closing, selfClosing });
          if (!closing && RAW.has(name)) {
            const close = lower.indexOf('</' + name, j);
            const e = close === -1 ? n : close;
            tokens.push({ type: 'raw', start: j, end: e });
            j = e;
          }
        } else {
          tokens.push({ type: 'decl', start: i, end: j });
        }
        i = j;
      }
      start = i;
    }
    flush(n);
    return tokens;
  }

  // [start, end) ranges of page text: outside tags, comments, the doctype and raw-text elements.
  const textRegions = (source) => tokenize(source).filter((t) => t.type === 'text').map((t) => [t.start, t.end]);

  const NAMED_ENTITIES = {
    // Basic XML/HTML entities
    nbsp: '\u00A0',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",

    // Legacy uppercase aliases
    AMP: '&',
    LT: '<',
    GT: '>',
    QUOT: '"',
    COPY: '\u00A9',
    REG: '\u00AE',

    // Full Latin-1 set (U+00A0 - U+00FF)
    iexcl: '\u00A1',
    cent: '\u00A2',
    pound: '\u00A3',
    curren: '\u00A4',
    yen: '\u00A5',
    brvbar: '\u00A6',
    sect: '\u00A7',
    uml: '\u00A8',
    copy: '\u00A9',
    ordf: '\u00AA',
    laquo: '\u00AB',
    not: '\u00AC',
    shy: '\u00AD',
    reg: '\u00AE',
    macr: '\u00AF',
    deg: '\u00B0',
    plusmn: '\u00B1',
    sup2: '\u00B2',
    sup3: '\u00B3',
    acute: '\u00B4',
    micro: '\u00B5',
    para: '\u00B6',
    middot: '\u00B7',
    cedil: '\u00B8',
    sup1: '\u00B9',
    ordm: '\u00BA',
    raquo: '\u00BB',
    frac14: '\u00BC',
    frac12: '\u00BD',
    frac34: '\u00BE',
    iquest: '\u00BF',

    Agrave: '\u00C0',
    Aacute: '\u00C1',
    Acirc: '\u00C2',
    Atilde: '\u00C3',
    Auml: '\u00C4',
    Aring: '\u00C5',
    AElig: '\u00C6',
    Ccedil: '\u00C7',
    Egrave: '\u00C8',
    Eacute: '\u00C9',
    Ecirc: '\u00CA',
    Euml: '\u00CB',
    Igrave: '\u00CC',
    Iacute: '\u00CD',
    Icirc: '\u00CE',
    Iuml: '\u00CF',
    ETH: '\u00D0',
    Ntilde: '\u00D1',
    Ograve: '\u00D2',
    Oacute: '\u00D3',
    Ocirc: '\u00D4',
    Otilde: '\u00D5',
    Ouml: '\u00D6',
    times: '\u00D7',
    Oslash: '\u00D8',
    Ugrave: '\u00D9',
    Uacute: '\u00DA',
    Ucirc: '\u00DB',
    Uuml: '\u00DC',
    Yacute: '\u00DD',
    THORN: '\u00DE',
    szlig: '\u00DF',

    agrave: '\u00E0',
    aacute: '\u00E1',
    acirc: '\u00E2',
    atilde: '\u00E3',
    auml: '\u00E4',
    aring: '\u00E5',
    aelig: '\u00E6',
    ccedil: '\u00E7',
    egrave: '\u00E8',
    eacute: '\u00E9',
    ecirc: '\u00EA',
    euml: '\u00EB',
    igrave: '\u00EC',
    iacute: '\u00ED',
    icirc: '\u00EE',
    iuml: '\u00EF',
    eth: '\u00F0',
    ntilde: '\u00F1',
    ograve: '\u00F2',
    oacute: '\u00F3',
    ocirc: '\u00F4',
    otilde: '\u00F5',
    ouml: '\u00F6',
    divide: '\u00F7',
    oslash: '\u00F8',
    ugrave: '\u00F9',
    uacute: '\u00FA',
    ucirc: '\u00FB',
    uuml: '\u00FC',
    yacute: '\u00FD',
    thorn: '\u00FE',
    yuml: '\u00FF',

    // Extras
    OElig: '\u0152',
    oelig: '\u0153',
    Scaron: '\u0160',
    scaron: '\u0161',
    Yuml: '\u0178',
    fnof: '\u0192',
    circ: '\u02C6',
    tilde: '\u02DC',
    lsaquo: '\u2039',
    rsaquo: '\u203A',
    dagger: '\u2020',
    Dagger: '\u2021',
    permil: '\u2030',
    prime: '\u2032',
    Prime: '\u2033',
    oline: '\u203E',
    frasl: '\u2044',
    hearts: '\u2665',
    spades: '\u2660',
    clubs: '\u2663',
    diams: '\u2666',
    check: '\u2713',
    star: '\u2606',

    // Punctuation & symbols
    mdash: '\u2014',
    ndash: '\u2013',
    hellip: '\u2026',
    lsquo: '\u2018',
    rsquo: '\u2019',
    ldquo: '\u201C',
    rdquo: '\u201D',
    sbquo: '\u201A',
    bdquo: '\u201E',
    trade: '\u2122',
    bull: '\u2022',
    euro: '\u20AC',
    larr: '\u2190',
    rarr: '\u2192',
    uarr: '\u2191',
    darr: '\u2193',
    harr: '\u2194',
    thinsp: '\u2009',
    ensp: '\u2002',
    emsp: '\u2003',
    zwnj: '\u200C',
    zwj: '\u200D',
    lrm: '\u200E',
    rlm: '\u200F'
  };

  function decodeRegion(source, start, end) {
    let decoded = '';
    const map = [start];
    let i = start;
    while (i < end) {
      if (source[i] === '\r' && i + 1 < end && source[i + 1] === '\n') {
        decoded += '\n';
        i += 2;
        map.push(i);
        continue;
      }
      if (source[i] === '&') {
        const semi = source.indexOf(';', i + 1);
        if (semi !== -1 && semi < end && semi - i <= 10) {
          const body = source.slice(i + 1, semi);
          let ch = null;
          if (body.startsWith('#')) {
            let cp = null;
            if (body[1] === 'x' || body[1] === 'X') {
              const hex = body.slice(2);
              if (/^[0-9a-fA-F]+$/.test(hex)) cp = parseInt(hex, 16);
            } else {
              const dec = body.slice(1);
              if (/^[0-9]+$/.test(dec)) cp = parseInt(dec, 10);
            }
            if (cp != null && cp >= 0 && cp <= 0x10FFFF) {
              try { ch = String.fromCodePoint(cp); } catch {}
            }
          } else if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body)) {
            ch = NAMED_ENTITIES[body];
          }
          if (ch != null) {
            decoded += ch;
            const nextI = semi + 1;
            if (ch.length === 1) {
              map.push(nextI);
            } else {
              map.push(i);
              map.push(nextI);
            }
            i = nextI;
            continue;
          }
        }
      }
      decoded += source[i];
      i++;
      map.push(i);
    }
    return { decoded, map };
  }

  function getDecodedRegion(source, a, b, cache) {
    if (cache && cache.has(a)) return cache.get(a);
    const res = decodeRegion(source, a, b);
    if (cache) cache.set(a, res);
    return res;
  }

  function findDecodedPos(map, from) {
    let low = 0;
    let high = map.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (map[mid] < from) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  // Earliest match of `text` at or after `from`, lying entirely inside one text region.
  function findFrom(source, text, from, regions) {
    if (!regions._cache) regions._cache = new Map();
    const cache = regions._cache;
    let best = -1;
    let used = null;
    let bestRegion = null;
    let bestDecodedIndex = -1;

    for (let r = 0; r < regions.length; r++) {
      const reg = regions[r];
      const a = reg[0];
      const b = reg[1];
      if (b <= from) continue;
      if (best !== -1 && a >= best) break;

      const { decoded, map } = getDecodedRegion(source, a, b, cache);
      const decodedFrom = from <= a ? 0 : findDecodedPos(map, from);
      if (decodedFrom >= decoded.length && text.length > 0) continue;

      const idx = decoded.indexOf(text, decodedFrom);
      if (idx !== -1) {
        const srcStart = map[idx];
        const srcEnd = map[idx + text.length];
        if (best === -1 || srcStart < best) {
          best = srcStart;
          used = source.slice(srcStart, srcEnd);
          bestRegion = reg;
          bestDecodedIndex = idx;
        }
      }
    }
    return { index: best, matched: used, region: bestRegion, decodedIndex: bestDecodedIndex };
  }

  // Index of the token that matches the opening tag at tokens[openIdx], or -1.
  function matchingClose(tokens, openIdx) {
    let depth = 0;
    for (let k = openIdx + 1; k < tokens.length; k++) {
      const t = tokens[k];
      if (t.type !== 'tag' || t.selfClosing) continue;
      if (!t.closing) depth++;
      else if (depth > 0) depth--;
      else return t.name === tokens[openIdx].name ? k : -1;
    }
    return -1;
  }

  // Finds the source range [start, end) of the element described by `change`, or { error }.
  // Tries each occurrence of the first text in turn, since an earlier sibling may show the same text.
  function locateElement(source, tokens, change, from) {
    const regions = tokens.filter((t) => t.type === 'text').map((t) => [t.start, t.end]);
    if (!change.firstText || !change.firstText.trim()) return { error: 'no-text' };
    let searchFrom = from;
    let sawCandidate = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      const f = findFrom(source, change.firstText, searchFrom, regions);
      if (f.index === -1) break;
      searchFrom = f.index + 1;
      const l = findFrom(source, change.lastText, f.index, regions);
      if (l.index === -1) break;
      const lastEnd = l.index + l.matched.length;
      const textIdx = tokens.findIndex((t) => t.start <= f.index && f.index < t.end);
      // Walk back over unclosed ancestors until an opening tag of the right name whose matching
      // close lies beyond the last text. Same-named ancestors and siblings fail that check.
      let depth = 0;
      for (let k = textIdx - 1; k >= 0; k--) {
        const t = tokens[k];
        if (t.type !== 'tag' || t.selfClosing) continue;
        if (t.closing) { depth++; continue; }
        if (depth > 0) { depth--; continue; }
        if (t.name !== change.tag) continue;
        const c = matchingClose(tokens, k);
        if (c === -1 || tokens[c].start < lastEnd) continue;
        sawCandidate = true;
        const open = t;
        const close = tokens[c];
        const counts = {};
        for (const x of tokens) {
          if (x.type === 'tag' && !x.closing && x.start >= open.end && x.end <= close.start) counts[x.name] = (counts[x.name] || 0) + 1;
        }
        let generated = false;
        for (const [name, want] of Object.entries(change.tagCounts || {})) {
          if (name !== 'tbody' && (counts[name] || 0) < want) generated = true;
        }
        if (generated) break;
        return { start: open.start, end: close.end };
      }
    }
    return { error: sawCandidate ? 'generated' : 'not-found' };
  }

  const decodeAttr = (v) => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const encodeAttr = (v, quote) => v.replace(/&/g, '&amp;').replace(quote === '"' ? /"/g : /'/g, quote === '"' ? '&quot;' : '&#39;');

  // Position (index into the source) to start looking from: after the anchor if it can be found.
  function startAfterAnchor(source, change, cursor, regions) {
    if (change.anchor && change.anchor.trim()) {
      const a = findFrom(source, change.anchor, cursor, regions);
      if (a.index !== -1) return a.index + a.matched.length;
    }
    return cursor;
  }

  // Read-only lookup of an element's range, for callers that only want to point at it (the Prompt
  // collector's line numbers). No side effects, unlike apply(): always searches from the top.
  function locate(source, change) {
    const tokens = tokenize(source);
    const regions = tokens.filter((t) => t.type === 'text').map((t) => [t.start, t.end]);
    const from = startAfterAnchor(source, change, 0, regions);
    if (change.tag === 'img' && change.src) {
      // Images have no text of their own, so find the tag whose src matches, preferring one after the anchor.
      const hit = (start) => tokens.find((t) => t.type === 'tag' && !t.closing && t.name === 'img' && t.start >= start && (findAttr(source.slice(t.start, t.end), 'src') || {}).value === change.src);
      const t = hit(from) || (from !== 0 ? hit(0) : null);
      return t ? { start: t.start, end: t.end } : null;
    }
    let loc = locateElement(source, tokens, change, from);
    if (loc.error === 'not-found' && from !== 0) loc = locateElement(source, tokens, change, 0);
    return loc.error ? null : { start: loc.start, end: loc.end };
  }

  // The (skip+1)th element of `tag` after `from` whose content has no text. Returns its content range.
  function locateEmpty(source, tokens, change, from) {
    let seen = 0;
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k];
      if (t.type !== 'tag' || t.closing || t.selfClosing || t.name !== change.tag || t.start < from) continue;
      const c = matchingClose(tokens, k);
      if (c === -1) continue;
      let hasText = false;
      for (let j = k + 1; j < c; j++) {
        const x = tokens[j];
        if ((x.type === 'text' && source.slice(x.start, x.end).trim()) || x.type === 'raw') { hasText = true; break; }
      }
      if (hasText) continue;
      if (seen++ === (change.skip || 0)) return { start: t.end, end: tokens[c].start };
    }
    return { error: 'not-found' };
  }

  // Parses `attr` out of a tag's text. Returns { start, end, value, quote } relative to the tag, or null.
  function findAttr(tagText, attr) {
    const re = new RegExp('(\\s' + attr + '\\s*=\\s*)("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
    const m = re.exec(tagText);
    if (!m) return null;
    const valueStart = m.index + m[1].length;
    const quote = m[2][0] === '"' || m[2][0] === "'" ? m[2][0] : '';
    const raw = quote ? m[2].slice(1, -1) : m[2];
    return { start: valueStart, end: valueStart + m[2].length, value: decodeAttr(raw), quote };
  }

  // The (skip+1)th `tag` after `from` whose `attr` equals `before` (or is absent when before is null).
  // Returns { start, end, text } describing the replacement inside the source.
  function locateAttr(source, tokens, change, from) {
    let seen = 0;
    for (const t of tokens) {
      if (t.type !== 'tag' || t.closing || t.name !== change.tag || t.start < from) continue;
      const tagText = source.slice(t.start, t.end);
      const found = findAttr(tagText, change.attr);
      const matches = change.before == null ? !found : (found && found.value === change.before);
      if (!matches) continue;
      if (seen++ !== (change.skip || 0)) continue;
      if (found) {
        const quote = found.quote || '"';
        const text = quote + encodeAttr(change.after, quote) + quote;
        return { start: t.start + found.start, end: t.start + found.end, text };
      }
      const closeAt = tagText.endsWith('/>') ? tagText.length - 2 : tagText.length - 1;
      return { start: t.start + closeAt, end: t.start + closeAt, text: ` ${change.attr}="${encodeAttr(change.after, '"')}"` };
    }
    return { error: 'not-found' };
  }

  // Declarations of `property` inside the page's own <style> blocks, in document order, each tagged
  // with the prelude of the @media block it sits in (null at the top level). A brace-depth walk is
  // enough here: we only need to know which at-rule we are inside, not to understand the CSS.
  const ROOT_SEL = /^(:root|html|body)$/i;

  function styleDeclarations(source, tokens, property) {
    const out = [];
    const esc = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k];
      if (t.type !== 'raw') continue;
      const open = tokens[k - 1];
      if (!open || open.type !== 'tag' || open.name !== 'style') continue;
      const css = source.slice(t.start, t.end);
      // Prelude stack: the text before each `{`, so the innermost @media is known at any point.
      const stack = [];
      let chunk = 0;
      const re = new RegExp('(' + esc + ')(\\s*:\\s*)([^;}]*?)(\\s*(?:!important)?\\s*)(?=[;}])|[{}]', 'g');
      let m;
      while ((m = re.exec(css))) {
        if (!m[1]) {
          if (m[0] === '{') { stack.push(css.slice(chunk, m.index).trim()); chunk = re.lastIndex; }
          else { stack.pop(); chunk = re.lastIndex; }
          continue;
        }
        chunk = re.lastIndex;
        if (/[\w-]/.test(css[m.index - 1] || '')) continue;
        // Only declarations on :root, html or body count, the same rule the harvest applies to the
        // CSSOM, so `skip` means the same occurrence on both sides. A `.hero { --accent: … }` above
        // the :root block must not be the one we edit.
        const selector = stack.filter((p) => p && !p.startsWith('@')).pop() || '';
        if (!selector.split(',').some((part) => ROOT_SEL.test(part.trim()))) continue;
        const at = stack.filter((p) => p.startsWith('@media')).pop() || null;
        out.push({
          media: at ? at.replace(/^@media\s*/, '').trim() : null,
          value: m[3].trim(),
          start: t.start + m.index + m[1].length + m[2].length,
          end: t.start + m.index + m[1].length + m[2].length + m[3].length,
        });
      }
    }
    return out;
  }

  // Media queries are compared with whitespace removed, so the browser's normalised `mediaText`
  // lines up with however the author spaced the query in the file.
  const sameMedia = (a, b) => (a || '').replace(/\s+/g, '') === (b || '').replace(/\s+/g, '');

  // The (skip+1)th declaration of the property in the change's media context whose value is `before`.
  function locateStyle(source, tokens, change) {
    const all = styleDeclarations(source, tokens, change.property);
    const inContext = all.filter((d) => sameMedia(d.media, change.media));
    const d = inContext[change.skip || 0];
    if (!d || d.value !== (change.before || '').trim()) return { error: 'style-not-found' };
    return { start: d.start, end: d.end };
  }

  // Locates an element candidate from `from` (with fallback to `cursor`), checking for anchor ambiguity.
  function locateElementWithAmbiguity(source, tokens, item, anchor, from, cursor, regions) {
    const hasAnchor = !!(anchor && anchor.trim());
    const anchorFound = hasAnchor && from !== cursor;
    let loc = locateElement(source, tokens, item, from);
    let usedFallback = false;
    if (loc.error === 'not-found' && anchorFound) {
      loc = locateElement(source, tokens, item, cursor);
      usedFallback = true;
    }
    if (loc.error) return { error: loc.error };
    if (usedFallback || (hasAnchor && !anchorFound)) {
      const again = locateElement(source, tokens, item, loc.end);
      if (!again.error && (again.start !== loc.start || again.end !== loc.end)) {
        return { error: 'ambiguous-anchor' };
      }
    } else if (anchorFound) {
      let searchAnchorFrom = from;
      while (searchAnchorFrom < source.length) {
        const nextAnchor = findFrom(source, anchor, searchAnchorFrom, regions);
        if (nextAnchor.index === -1) break;
        const altFrom = nextAnchor.index + nextAnchor.matched.length;
        const altLoc = locateElement(source, tokens, item, altFrom);
        if (!altLoc.error && (altLoc.start !== loc.start || altLoc.end !== loc.end)) {
          return { error: 'ambiguous-anchor' };
        }
        searchAnchorFrom = altFrom;
      }
    }
    return loc;
  }

  function apply(source, changes) {
    let out = source;
    let cursor = 0;
    const failures = [];
    // Style changes go first and on their own: <style> blocks can sit anywhere in the file, so they
    // must not move the cursor the text and element passes walk forward with.
    changes.forEach((change, index) => {
      if (change.kind !== 'style') return;
      const loc = locateStyle(out, tokenize(out), change);
      if (loc.error) { failures.push({ index, before: change.before || '', reason: loc.error, property: change.property }); return; }
      out = out.slice(0, loc.start) + change.after + out.slice(loc.end);
    });
    changes.forEach((change, index) => {
      if (change.kind === 'style') return;
      if (change.kind === 'refuse') {
        failures.push({
          index,
          before: change.shown || '',
          shown: change.shown || '',
          original: change.original != null ? change.original : '',
          reason: change.reason || 'runtime-text'
        });
        return;
      }
      const tokens = tokenize(out);
      const regions = tokens.filter((t) => t.type === 'text').map((t) => [t.start, t.end]);
      const from = startAfterAnchor(out, change, cursor, regions);
      if (change.kind === 'empty') {
        const hasAnchor = !!(change.anchor && change.anchor.trim());
        const anchorFound = hasAnchor && from !== cursor;
        let loc = locateEmpty(out, tokens, change, from);
        let usedFallback = false;
        if (loc.error && anchorFound) {
          loc = locateEmpty(out, tokens, change, cursor);
          usedFallback = true;
        }
        if (loc.error) { failures.push({ index, before: '', reason: 'empty-not-found', tag: change.tag }); return; }
        if (usedFallback || (hasAnchor && !anchorFound)) {
          const again = locateEmpty(out, tokens, change, loc.end);
          if (!again.error && (again.start !== loc.start || again.end !== loc.end)) {
            failures.push({ index, before: '', reason: 'empty-ambiguous-anchor', tag: change.tag });
            return;
          }
        } else if (anchorFound) {
          let searchAnchorFrom = from;
          while (searchAnchorFrom < out.length) {
            const nextAnchor = findFrom(out, change.anchor, searchAnchorFrom, regions);
            if (nextAnchor.index === -1) break;
            const altFrom = nextAnchor.index + nextAnchor.matched.length;
            const altLoc = locateEmpty(out, tokens, change, altFrom);
            if (!altLoc.error && (altLoc.start !== loc.start || altLoc.end !== loc.end)) {
              failures.push({ index, before: '', reason: 'empty-ambiguous-anchor', tag: change.tag });
              return;
            }
            searchAnchorFrom = altFrom;
          }
        }
        out = out.slice(0, loc.start) + change.afterHtml + out.slice(loc.end);
        cursor = loc.start + change.afterHtml.length;
        return;
      }
      if (change.kind === 'attr') {
        const hasAnchor = !!(change.anchor && change.anchor.trim());
        const anchorFound = hasAnchor && from !== cursor;
        let loc = locateAttr(out, tokens, change, from);
        let usedFallback = false;
        if (loc.error && anchorFound) {
          loc = locateAttr(out, tokens, change, cursor);
          usedFallback = true;
        }
        if (loc.error) { failures.push({ index, before: change.before || '', reason: 'attr-not-found', tag: change.tag, attr: change.attr }); return; }
        if (usedFallback || (hasAnchor && !anchorFound)) {
          const again = locateAttr(out, tokens, change, loc.end);
          if (!again.error && (again.start !== loc.start || again.end !== loc.end)) {
            failures.push({ index, before: change.before || '', reason: 'ambiguous-anchor', tag: change.tag, attr: change.attr });
            return;
          }
        } else if (anchorFound) {
          let searchAnchorFrom = from;
          while (searchAnchorFrom < out.length) {
            const nextAnchor = findFrom(out, change.anchor, searchAnchorFrom, regions);
            if (nextAnchor.index === -1) break;
            const altFrom = nextAnchor.index + nextAnchor.matched.length;
            const altLoc = locateAttr(out, tokens, change, altFrom);
            if (!altLoc.error && (altLoc.start !== loc.start || altLoc.end !== loc.end)) {
              failures.push({ index, before: change.before || '', reason: 'ambiguous-anchor', tag: change.tag, attr: change.attr });
              return;
            }
            searchAnchorFrom = altFrom;
          }
        }
        out = out.slice(0, loc.start) + loc.text + out.slice(loc.end);
        cursor = loc.start + loc.text.length;
        return;
      }
      if (change.kind === 'element') {
        const loc = locateElementWithAmbiguity(out, tokens, change, change.anchor, from, cursor, regions);
        if (loc.error) { failures.push({ index, before: change.firstText || '', reason: loc.error }); return; }
        out = out.slice(0, loc.start) + change.afterHtml + out.slice(loc.end);
        cursor = loc.start + change.afterHtml.length;
        return;
      }
      if (change.kind === 'run') {
        const items = change.items || [];
        if (!items.length) { failures.push({ index, before: '', reason: 'not-found' }); return; }
        const loc0 = locateElementWithAmbiguity(out, tokens, items[0], change.anchor, from, cursor, regions);
        if (loc0.error) { failures.push({ index, before: items[0].firstText || '', reason: loc0.error }); return; }
        const firstStart = loc0.start;
        let lastEnd = loc0.end;
        for (let i = 1; i < items.length; i++) {
          const item = items[i];
          let k = tokens.findIndex((t) => t.start >= lastEnd);
          while (k !== -1 && k < tokens.length) {
            const t = tokens[k];
            if (t.type === 'comment' || (t.type === 'text' && !out.slice(t.start, t.end).trim())) {
              k++;
              continue;
            }
            break;
          }
          if (k === -1 || k >= tokens.length) {
            failures.push({ index, before: item.firstText || '', reason: 'run-not-adjacent' });
            return;
          }
          const t = tokens[k];
          if (t.type !== 'tag' || t.closing || t.selfClosing || t.name !== item.tag) {
            failures.push({ index, before: item.firstText || '', reason: 'run-not-adjacent' });
            return;
          }
          const loc = locateElement(out, tokens, item, t.start);
          if (loc.error) {
            const reason = (loc.error === 'generated' || loc.error === 'no-text') ? loc.error : 'run-not-adjacent';
            failures.push({ index, before: item.firstText || '', reason });
            return;
          }
          if (loc.start !== t.start) {
            failures.push({ index, before: item.firstText || '', reason: 'run-not-adjacent' });
            return;
          }
          lastEnd = loc.end;
        }
        out = out.slice(0, firstStart) + change.afterHtml + out.slice(lastEnd);
        cursor = firstStart + change.afterHtml.length;
        return;
      }
      const before = change.before || '';
      if (!before.trim()) { failures.push({ index, before, reason: 'empty' }); return; }
      const hasAnchor = !!(change.anchor && change.anchor.trim());
      const anchorFound = hasAnchor && from !== cursor;
      let hit = findFrom(out, before, from, regions);
      let usedFallback = false;
      if (hit.index === -1 && anchorFound) {
        hit = findFrom(out, before, cursor, regions);
        usedFallback = true;
      }
      if (hit.index === -1) { failures.push({ index, before, reason: 'not-found' }); return; }
      if (usedFallback || (hasAnchor && !anchorFound)) {
        const again = findFrom(out, before, hit.index + hit.matched.length, regions);
        if (again.index !== -1) {
          failures.push({ index, before, reason: 'ambiguous-anchor' });
          return;
        }
      } else if (anchorFound) {
        let searchAnchorFrom = from;
        while (searchAnchorFrom < out.length) {
          const nextAnchor = findFrom(out, change.anchor, searchAnchorFrom, regions);
          if (nextAnchor.index === -1) break;
          const altFrom = nextAnchor.index + nextAnchor.matched.length;
          const altHit = findFrom(out, before, altFrom, regions);
          if (altHit.index !== -1 && altHit.index !== hit.index) {
            failures.push({ index, before, reason: 'ambiguous-anchor' });
            return;
          }
          searchAnchorFrom = altFrom;
        }
      }
      const after = change.after || '';
      let prefixLen = 0;
      while (prefixLen < before.length && prefixLen < after.length && before[prefixLen] === after[prefixLen]) {
        prefixLen++;
      }
      let suffixLen = 0;
      while (
        suffixLen < (before.length - prefixLen) &&
        suffixLen < (after.length - prefixLen) &&
        before[before.length - 1 - suffixLen] === after[after.length - 1 - suffixLen]
      ) {
        suffixLen++;
      }
      const isHighSurrogate = (code) => code >= 0xD800 && code <= 0xDBFF;
      const isLowSurrogate = (code) => code >= 0xDC00 && code <= 0xDFFF;
      if (prefixLen > 0 && isHighSurrogate(before.charCodeAt(prefixLen - 1)) && isLowSurrogate(before.charCodeAt(prefixLen))) {
        prefixLen--;
      }
      const beforeMidEnd = before.length - suffixLen;
      if (suffixLen > 0 && isHighSurrogate(before.charCodeAt(beforeMidEnd - 1)) && isLowSurrogate(before.charCodeAt(beforeMidEnd))) {
        suffixLen--;
      }

      const { map } = getDecodedRegion(out, hit.region[0], hit.region[1], regions._cache);
      const srcStart = map[hit.decodedIndex + prefixLen];
      const srcEnd = map[hit.decodedIndex + before.length - suffixLen];
      const afterMiddle = after.slice(prefixLen, after.length - suffixLen);
      const replacement = escapeHtml(afterMiddle);
      out = out.slice(0, srcStart) + replacement + out.slice(srcEnd);
      cursor = srcStart + replacement.length;
    });
    return { ok: failures.length === 0, source: out, failures };
  }

  function describeFailure(f) {
    const snippet = (f.before || '').trim().replace(/\s+/g, ' ');
    const shown = snippet.length > 48 ? snippet.slice(0, 45) + '…' : snippet;
    switch (f.reason) {
      case 'runtime-text': {
        const s = f.shown || shown;
        const o = f.original != null ? f.original : '';
        return `“${s}” is written by the page’s own script while it runs (the file says “${o}”), so Retouch can’t change it here. Use Prompt mode to ask your AI to change it in the script.`;
      }
      case 'empty': return 'One edit replaced text that was empty in the original, which cannot be located in the source.';
      case 'no-text': return 'One formatted element had no text of its own in the original, so Retouch cannot find it in the source.';
      case 'generated': return `The element containing “${shown}” has parts that a script added after the page loaded, so Retouch will not rewrite it.`;
      case 'empty-not-found': return `Could not find the empty <${f.tag}> in the source file to put your text into. It may be created by a script.`;
      case 'empty-ambiguous-anchor': return `More than one empty <${f.tag}> could match here, so Retouch can't tell which one you meant. Try filling the other one first, or add more surrounding text so Retouch can tell them apart.`;
      case 'style-not-found': return `Could not find ${f.property} with value “${shown}” in the page's own styles. The color may live in a separate CSS file, which Retouch cannot edit yet.`;
      case 'attr-not-found': return `Could not find the <${f.tag}> whose ${f.attr} is “${shown}” in the source file. It may be created by a script.`;
      case 'ambiguous-anchor': return `More than one “${shown}” could match here, so Retouch can't tell which one you meant. Try selecting more surrounding text, or edit the other occurrence first.`;
      case 'run-not-adjacent': return 'The paragraphs you joined aren’t next to each other in the source file, so Retouch won’t merge them. Discard and join fewer, or use Prompt mode to ask your AI.';
      default: return `Could not find “${shown}” in the source file. It is probably produced by a script; edit the script's data instead.`;
    }
  }

  root.RetouchPatch = { apply, describeFailure, escapeHtml, textRegions, tokenize, locate };
})(typeof self !== 'undefined' ? self : globalThis);
