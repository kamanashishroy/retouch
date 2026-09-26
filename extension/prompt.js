// The Prompt Collector's compiler: turns pinned requests into one plain-text prompt for the user's
// own AI. Pure functions, no DOM; RetouchPatch.locate() is the only dependency, for line numbers.
(function (root) {
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
  function wordFor(tag) {
    for (const [re, word] of WORDS) if (re.test(tag)) return word;
    return 'block';
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // Line number (1-based) of an item's element in `source`, or null when it cannot be found there.
  function locateLine(source, item) {
    if (!source) return null;
    const loc = root.RetouchPatch.locate(source, { tag: item.tag, firstText: item.firstText, lastText: item.lastText, anchor: item.anchor, src: item.src || null });
    if (!loc) return null;
    return 1 + (source.slice(0, loc.start).match(/\n/g) || []).length;
  }

  function where(item, source) {
    if (item.lost) return '(not found on the current page)';
    const line = locateLine(source, item);
    return line ? `on line ${line}` : '(could not find the exact line)';
  }

  // A data: URI can run to kilobytes and a long path buries the request; describe or shorten it.
  function srcLabel(src) {
    if (!src) return 'src ""';
    const data = /^data:([^;,]+)/i.exec(src);
    if (data) return `src (inline ${data[1]} data)`;
    if (/^data:/i.test(src)) return 'src (inline data)';
    return `src "${src.length > 80 ? src.slice(0, 77) + '…' : src}"`;
  }

  function itemLine(item, source) {
    if (item.kind === 'region') {
      const w = item.box ? Math.round(item.box.width) : 0;
      const h = item.box ? Math.round(item.box.height) : 0;
      let desc = `Region (${w}×${h}px area)`;
      if (item.overlaps && item.overlaps.length) {
        const list = item.overlaps.slice(0, 4).map((o) => `${o.tag}${o.preview ? ` "${o.preview.slice(0, 30)}"` : ''}`).join(', ');
        desc += ` covering ${list}`;
      }
      if (item.screenshotPath) {
        desc += ` (see ${item.screenshotPath})`;
      }
      return `${item.number}. ${desc}\n   → ${item.request}`;
    }
    const loc = where(item, source);
    if (item.tag === 'img') {
      return `${item.number}. Image ${item.tag} ${loc}, ${srcLabel(item.src)}, alt "${item.alt || ''}"\n   → ${item.request}`;
    }
    const word = wordFor(item.tag);
    if (item.selected) {
      return `${item.number}. In the ${word} ${loc}, the words "${item.selected}"\n   → ${item.request}`;
    }
    return `${item.number}. ${cap(word)} ${item.tag} ${loc}, "${item.preview || ''}"\n   → ${item.request}`;
  }

  function decodePath(src) {
    try { return decodeURIComponent(new URL(src).pathname); } catch (e) { return src || ''; }
  }

  // { src, items, whole, source } -> the compiled prompt text.
  function compile({ src, items, whole, source }) {
    const lines = [`File: ${decodePath(src)}`, 'Apply these changes to the file in place. Change nothing else.', ''];
    for (const item of items || []) lines.push(itemLine(item, source), '');
    lines.push(`Whole page: ${whole && whole.trim() ? whole.trim() : 'none'}`, '');
    lines.push('If any item cannot be applied, say which and why.');
    return lines.join('\n');
  }

  root.RetouchPrompt = { compile, locateLine, wordFor };
})(typeof self !== 'undefined' ? self : globalThis);
