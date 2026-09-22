// Finding where a dropped folder lives on disk (D31). Drag data carries no path, and the viewer needs
// a file:// URL, so Retouch reads Chrome's own file:// directory listings under the user's home
// folders and proves a candidate by comparing a file's bytes. Read-only, local, and bounded.
(function (root) {
  const SKIP = new Set(['node_modules', 'Library', 'Applications', 'System', 'Volumes', 'Shared']);
  const MAX_DEPTH = 7;
  // Chrome's listing calls addRow("name", "url-encoded-name", isdir, size, "size", date, "date").
  const ROW = /addRow\(\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")\s*,\s*(true|false|1|0)/g;

  function skip(name) {
    return name.startsWith('.') || SKIP.has(name);
  }
  function childUrl(dirUrl, name, isdir) {
    return dirUrl + encodeURIComponent(name) + (isdir ? '/' : '');
  }
  function segmentsOf(url) {
    return new URL(url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
  }
  function parseListing(html) {
    const rows = [];
    ROW.lastIndex = 0;
    let m;
    while ((m = ROW.exec(html))) {
      let name;
      try { name = JSON.parse(m[1]); } catch (e) { continue; }
      if (name === '.' || name === '..' || !name) continue;
      rows.push({ name, isdir: m[3] === 'true' || m[3] === '1' });
    }
    return rows;
  }

  // Breadth-first over local directory listings, shallowest first. `verify` decides a candidate by
  // content, so same-named folders elsewhere on disk cannot win. Returns null when the budget runs out.
  async function findEntry({ kind, name, entryNames, verify, fetchText, roots, budget }) {
    const limit = Object.assign({ listings: 2500, ms: 5000 }, budget || {});
    const started = Date.now();
    const wanted = Array.from(new Set(entryNames || []));
    const seen = new Set();
    const queue = [];
    let listings = 0;
    for (const root of roots) if (!seen.has(root)) { seen.add(root); queue.push({ url: root, depth: 0 }); }

    const list = async (url) => {
      if (listings >= limit.listings || Date.now() - started > limit.ms) return null;
      listings++;
      try { return parseListing(await fetchText(url)); } catch (e) { return []; }
    };

    while (queue.length) {
      const { url, depth } = queue.shift();
      const rows = await list(url);
      if (rows === null) return null;
      for (const row of rows) {
        if (row.name !== name || row.isdir !== (kind === 'directory')) continue;
        const found = childUrl(url, row.name, row.isdir);
        if (kind === 'directory' && wanted.length) {
          const inside = await list(found);
          if (inside === null) return null;
          const have = new Set(inside.map((r) => r.name));
          if (!wanted.every((w) => have.has(w))) continue;
        }
        if (await verify(found)) return { url: found, segments: segmentsOf(found) };
      }
      if (depth >= MAX_DEPTH) continue;
      for (const row of rows) {
        if (!row.isdir || skip(row.name)) continue;
        const next = childUrl(url, row.name, true);
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push({ url: next, depth: depth + 1 });
      }
    }
    return null;
  }

  // The places a person keeps pages: every user's Documents, Desktop and Downloads first, then homes.
  async function homeRoots(fetchText) {
    const homes = [];
    for (const base of ['file:///Users/', 'file:///home/', 'file:///C:/Users/']) {
      let rows = [];
      try { rows = parseListing(await fetchText(base)); } catch (e) { continue; }
      for (const row of rows) if (row.isdir && !skip(row.name)) homes.push(childUrl(base, row.name, true));
    }
    const roots = [];
    for (const home of homes) for (const f of ['Documents/', 'Desktop/', 'Downloads/']) roots.push(home + f);
    return roots.concat(homes);
  }

  root.RetouchLocate = { parseListing, findEntry, homeRoots };
})(typeof self !== 'undefined' ? self : globalThis);
