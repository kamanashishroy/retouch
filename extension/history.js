// Version history stored in IndexedDB (D48). Keeps previous versions before each save,
// allowing "Undo" and restoring earlier revisions from the History popover.
// Pure module: no DOM, unit-testable with an injected store.

(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  }
  root.RetouchHistory = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_VERSIONS = 20;
  const MAX_BYTES = 25 * 1024 * 1024; // 25 MB cap per file

  function normalizeKey(key) {
    if (typeof key !== 'string') return '';
    if (key.startsWith('file://')) {
      try {
        return decodeURIComponent(new URL(key).pathname);
      } catch (e) {
        return key;
      }
    }
    return key;
  }

  function metaKey(fileKey) {
    return 'history:meta:' + normalizeKey(fileKey);
  }

  function blobKey(fileKey, id) {
    return 'history:blob:' + normalizeKey(fileKey) + ':' + id;
  }

  class RetouchHistoryInstance {
    constructor(store) {
      this.store = store || (typeof RetouchIDB !== 'undefined' ? RetouchIDB : null);
    }

    async push(fileKey, { savedAt, bytes, summary }) {
      if (!this.store) throw new Error('No store configured for RetouchHistory');
      const key = normalizeKey(fileKey);
      const now = typeof savedAt === 'number' ? savedAt : Date.now();
      const id = String(now) + '-' + Math.random().toString(36).slice(2, 8);
      const byteSize = typeof bytes === 'string'
        ? new TextEncoder().encode(bytes).length
        : (bytes ? bytes.byteLength || 0 : 0);

      const entry = { id, savedAt: now, summary: summary || '', size: byteSize };
      await this.store.set(blobKey(key, id), bytes);

      const list = (await this.store.get(metaKey(key))) || [];
      list.unshift(entry);

      // Keep the newest 20 versions per file
      while (list.length > MAX_VERSIONS) {
        const dropped = list.pop();
        if (dropped && dropped.id) {
          await this.store.del(blobKey(key, dropped.id));
        }
      }

      // Drop the oldest while the file's total exceeds 25 MB
      let totalSize = list.reduce((sum, item) => sum + (item.size || 0), 0);
      // Never drop the version just pushed, or a single large page would leave Undo pointing at nothing.
      while (list.length > 1 && totalSize > MAX_BYTES) {
        const dropped = list.pop();
        if (dropped) {
          totalSize -= (dropped.size || 0);
          if (dropped.id) {
            await this.store.del(blobKey(key, dropped.id));
          }
        }
      }

      await this.store.set(metaKey(key), list);
      return id;
    }

    async list(fileKey) {
      if (!this.store) throw new Error('No store configured for RetouchHistory');
      const key = normalizeKey(fileKey);
      const list = (await this.store.get(metaKey(key))) || [];
      return [...list];
    }

    async get(fileKey, id) {
      if (!this.store) throw new Error('No store configured for RetouchHistory');
      const key = normalizeKey(fileKey);
      return await this.store.get(blobKey(key, id));
    }
  }

  function RetouchHistory(store) {
    return new RetouchHistoryInstance(store);
  }

  const defaultInstance = new RetouchHistoryInstance();
  RetouchHistory.push = (fileKey, data) => defaultInstance.push(fileKey, data);
  RetouchHistory.list = (fileKey) => defaultInstance.list(fileKey);
  RetouchHistory.get = (fileKey, id) => defaultInstance.get(fileKey, id);
  RetouchHistory.create = (store) => new RetouchHistoryInstance(store);
  Object.defineProperty(RetouchHistory, 'store', {
    get: () => defaultInstance.store,
    set: (s) => { defaultInstance.store = s; },
    configurable: true,
    enumerable: true
  });

  return RetouchHistory;
});
