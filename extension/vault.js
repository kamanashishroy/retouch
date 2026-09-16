// Vaults: folders the user has granted through the File System Access API. Maps a file:// URL to a
// FileSystemFileHandle inside a vault. A directory handle only knows its own name, not its path, so
// the first match is found by folder name plus content check, and the URL prefix is remembered.
const RetouchVault = {
  async list() {
    return (await RetouchIDB.get('vaults')) || [];
  },
  async save(vaults) {
    await RetouchIDB.set('vaults', vaults);
  },
  async add(handle) {
    const vaults = await this.list();
    for (const v of vaults) if (await v.handle.isSameEntry(handle)) return;
    vaults.push({ handle, prefix: null, addedAt: Date.now() });
    await this.save(vaults);
  },
  async remove(handle) {
    const vaults = await this.list();
    const keep = [];
    for (const v of vaults) if (!(await v.handle.isSameEntry(handle))) keep.push(v);
    await this.save(keep);
  },
  // Human-readable account of every stored folder and how it relates to this file. For messages
  // and for the "Copy details" diagnostics.
  async explain(fileUrl) {
    const segs = this.segments(fileUrl);
    const out = [];
    for (const v of await this.list()) {
      out.push({
        folder: v.handle.name,
        matchesPath: segs.slice(0, -1).includes(v.handle.name) || !!v.prefix,
        permission: await v.handle.queryPermission({ mode: 'readwrite' }),
        rememberedPrefix: v.prefix ? '/' + v.prefix.join('/') : null
      });
    }
    return out;
  },
  segments(fileUrl) {
    return new URL(fileUrl).pathname.split('/').filter(Boolean).map(decodeURIComponent);
  },
  async walk(dir, rel) {
    try {
      let cur = dir;
      for (let i = 0; i < rel.length - 1; i++) cur = await cur.getDirectoryHandle(rel[i]);
      return { fileHandle: await cur.getFileHandle(rel[rel.length - 1]), dirHandle: cur };
    } catch (e) {
      return null;
    }
  },
  // A file name that does not collide with anything in `dir`. "logo.png" -> "logo-2.png" and so on.
  async uniqueName(dir, name) {
    const safe = name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
    const dot = safe.lastIndexOf('.');
    const base = dot > 0 ? safe.slice(0, dot) : safe;
    const ext = dot > 0 ? safe.slice(dot) : '';
    for (let i = 1; i < 500; i++) {
      const candidate = i === 1 ? safe : `${base}-${i}${ext}`;
      try { await dir.getFileHandle(candidate); } catch (e) { return candidate; }
    }
    return `${base}-${Date.now()}${ext}`;
  },
  // 'granted' | 'denied' | 'prompt'. Requesting needs a user gesture, so call from a click handler.
  async ensurePermission(handle) {
    let p = await handle.queryPermission({ mode: 'readwrite' });
    if (p === 'prompt') p = await handle.requestPermission({ mode: 'readwrite' });
    return p;
  },
  // Returns { vault, fileHandle, relPath } or null. When `expectedText` is given, a candidate file
  // only counts if its contents match, which disambiguates same-named folders.
  async resolve(fileUrl, expectedText) {
    const segs = this.segments(fileUrl);
    const vaults = await this.list();
    let dirty = false;
    for (const v of vaults) {
      const candidates = [];
      if (v.prefix && segs.length > v.prefix.length && v.prefix.every((s, i) => segs[i] === s)) {
        candidates.push(segs.slice(v.prefix.length));
      }
      segs.forEach((s, i) => {
        if (s === v.handle.name && i < segs.length - 1) candidates.push(segs.slice(i + 1));
      });
      if (!candidates.length) continue;
      if ((await this.ensurePermission(v.handle)) !== 'granted') continue;
      for (const rel of candidates) {
        const hit = await this.walk(v.handle, rel);
        if (!hit) continue;
        if (expectedText != null) {
          const text = await (await hit.fileHandle.getFile()).text();
          if (text !== expectedText) continue;
        }
        const prefix = segs.slice(0, segs.length - rel.length);
        if (!v.prefix || v.prefix.join('/') !== prefix.join('/')) { v.prefix = prefix; dirty = true; }
        if (dirty) await this.save(vaults);
        return { vault: v, fileHandle: hit.fileHandle, dirHandle: hit.dirHandle, relPath: rel.join('/') };
      }
    }
    return null;
  }
};
