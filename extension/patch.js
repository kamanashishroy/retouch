// Source patching: apply edits to the original HTML source without re-serializing the document.
// Two kinds of change, both located by text the page showed the user:
//   text     { before, after, anchor }  replace one run of text (kept byte for byte around it)
//   element  { tag, firstText, lastText, tagCounts, afterHtml, anchor }
//            replace a whole element whose structure changed (formatting added or removed) with its
//            new markup, located by its own first and last text and its tag name
//   empty    { tag, skip, afterHtml, anchor }
//            fill an element that had no text: the (skip+1)th empty element of that tag after the anchor
//   attr     { tag, attr, before, after, skip, anchor }
//            change one attribute on the (skip+1)th tag of that name after the anchor whose attribute
//            currently equals `before` (or lacks it when `before` is null); quoting is preserved
// `anchor` is the text of a nearby preceding text node, used to pick the right occurrence when the
// located text appears more than once. Pure functions, no DOM, unit-tested under Node.
(function (root) {
  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Elements whose content is raw text the browser never shows as page text.
  const RAW = new Set(['script', 'style', 'textarea', 'template', 'noscript']);
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

  function spellings(text) {
    const out = [text];
    const esc = escapeHtml(text);
    if (esc !== text) out.push(esc);
    return out;
  }

  // Earliest match of any spelling of `text` at or after `from`, lying entirely inside one text region.
  function findFrom(source, text, from, regions) {
    let best = -1;
    let used = null;
    for (const cand of spellings(text)) {
      for (const [a, b] of regions) {
        if (b <= from) continue;
        const i = source.indexOf(cand, Math.max(a, from));
        if (i === -1) break;
        if (i + cand.length <= b) {
          if (best === -1 || i < best) { best = i; used = cand; }
          break;
        }
      }
    }
    return { index: best, matched: used };
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

  function apply(source, changes) {
    let out = source;
    let cursor = 0;
    const failures = [];
    changes.forEach((change, index) => {
      const tokens = tokenize(out);
      const regions = tokens.filter((t) => t.type === 'text').map((t) => [t.start, t.end]);
      const from = startAfterAnchor(out, change, cursor, regions);
      if (change.kind === 'empty') {
        let loc = locateEmpty(out, tokens, change, from);
        if (loc.error && from !== cursor) loc = locateEmpty(out, tokens, change, cursor);
        if (loc.error) { failures.push({ index, before: '', reason: 'empty-not-found', tag: change.tag }); return; }
        out = out.slice(0, loc.start) + change.afterHtml + out.slice(loc.end);
        cursor = loc.start + change.afterHtml.length;
        return;
      }
      if (change.kind === 'attr') {
        let loc = locateAttr(out, tokens, change, from);
        if (loc.error && from !== cursor) loc = locateAttr(out, tokens, change, cursor);
        if (loc.error) { failures.push({ index, before: change.before || '', reason: 'attr-not-found', tag: change.tag, attr: change.attr }); return; }
        out = out.slice(0, loc.start) + loc.text + out.slice(loc.end);
        cursor = loc.start + loc.text.length;
        return;
      }
      if (change.kind === 'element') {
        let loc = locateElement(out, tokens, change, from);
        if (loc.error === 'not-found' && from !== cursor) loc = locateElement(out, tokens, change, cursor);
        if (loc.error) { failures.push({ index, before: change.firstText || '', reason: loc.error }); return; }
        out = out.slice(0, loc.start) + change.afterHtml + out.slice(loc.end);
        cursor = loc.start + change.afterHtml.length;
        return;
      }
      const before = change.before || '';
      if (!before.trim()) { failures.push({ index, before, reason: 'empty' }); return; }
      let hit = findFrom(out, before, from, regions);
      if (hit.index === -1 && from !== cursor) hit = findFrom(out, before, cursor, regions);
      if (hit.index === -1) { failures.push({ index, before, reason: 'not-found' }); return; }
      const replacement = escapeHtml(change.after);
      out = out.slice(0, hit.index) + replacement + out.slice(hit.index + hit.matched.length);
      cursor = hit.index + replacement.length;
    });
    return { ok: failures.length === 0, source: out, failures };
  }

  function describeFailure(f) {
    const snippet = (f.before || '').trim().replace(/\s+/g, ' ');
    const shown = snippet.length > 48 ? snippet.slice(0, 45) + '…' : snippet;
    switch (f.reason) {
      case 'empty': return 'One edit replaced text that was empty in the original, which cannot be located in the source.';
      case 'no-text': return 'One formatted element had no text of its own in the original, so Retouch cannot find it in the source.';
      case 'generated': return `The element containing “${shown}” has parts that a script added after the page loaded, so Retouch will not rewrite it.`;
      case 'empty-not-found': return `Could not find the empty <${f.tag}> in the source file to put your text into. It may be created by a script.`;
      case 'attr-not-found': return `Could not find the <${f.tag}> whose ${f.attr} is “${shown}” in the source file. It may be created by a script.`;
      default: return `Could not find “${shown}” in the source file. It is probably produced by a script; edit the script's data instead.`;
    }
  }

  root.RetouchPatch = { apply, describeFailure, escapeHtml, textRegions, tokenize };
})(typeof self !== 'undefined' ? self : globalThis);
