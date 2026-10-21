// Fake RetouchVault for the live demo on fastretouch.com.
// Replaces vault.js on the website. Stores edits in memory and sessionStorage.
// Never calls showDirectoryPicker or asks for folder permissions.

(function (global) {
  let currentSource = null;
  let currentFileUrl = null;
  const memoryFiles = new Map();
  const CACHE_NAME = 'retouch-live-demo';

  function getMimeType(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    switch (ext) {
      case 'svg': return 'image/svg+xml';
      case 'png': return 'image/png';
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'webp': return 'image/webp';
      case 'gif': return 'image/gif';
      case 'html': return 'text/html; charset=utf-8';
      case 'css': return 'text/css; charset=utf-8';
      case 'js': return 'application/javascript; charset=utf-8';
      default: return 'application/octet-stream';
    }
  }

  async function cacheFile(name, blob) {
    if (!('caches' in global)) return;
    try {
      const cache = await caches.open(CACHE_NAME);
      const mime = getMimeType(name);
      const resp = new Response(blob, {
        headers: {
          'Content-Type': mime,
          'Content-Length': String(blob.size)
        }
      });
      const base = currentFileUrl || (location.origin + '/draft.html');
      const resolved = new URL(name, base);
      const cleanName = name.replace(/^\//, '');
      const keys = [
        resolved.href,
        resolved.pathname,
        '/' + cleanName,
        cleanName
      ];
      for (const key of keys) {
        await cache.put(key, resp.clone());
      }
    } catch (e) {
      console.warn('[demo-vault] cacheFile error:', e);
    }
  }

  async function syncCache(source) {
    if ('caches' in global) {
      try {
        const cache = await caches.open(CACHE_NAME);
        const resp = new Response(source, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
        const targets = [
          '/draft.html?embed=1',
          'draft.html?embed=1',
          '/draft.html',
          'draft.html'
        ];
        if (location.origin) {
          targets.push(location.origin + '/draft.html?embed=1');
          targets.push(location.origin + '/draft.html');
        }
        for (const t of targets) {
          await cache.put(t, resp.clone());
        }
      } catch (e) {
        console.warn('[demo-vault] cache sync error:', e);
      }
    }
  }

  // Pre-seed cache if already in sessionStorage
  getInitialSource().catch(() => {});

  async function getInitialSource() {
    if (currentSource !== null) return currentSource;
    const saved = sessionStorage.getItem('retouch:demo-source');
    if (saved) {
      currentSource = saved;
      await syncCache(currentSource);
      return currentSource;
    }
    // Brand new session: clear any stale demo cache from previous sessions
    if ('caches' in global) {
      try {
        await caches.delete(CACHE_NAME);
      } catch (e) {}
    }
    try {
      const res = await fetch('draft.html', { cache: 'no-store' });
      currentSource = await res.text();
    } catch (e) {
      currentSource = '<!DOCTYPE html><html><head><title>Retouch</title></head><body></body></html>';
    }
    return currentSource;
  }

  const RetouchVault = {
    async list() {
      return [{ handle: { name: 'site' }, prefix: ['site'], addedAt: Date.now() }];
    },

    async save() {},

    async add() {},

    async ensurePermission() {
      return 'granted';
    },

    async explain() {
      return [{
        folder: 'site',
        matchesPath: true,
        permission: 'granted',
        rememberedPrefix: null
      }];
    },

    segments(fileUrl) {
      try {
        return new URL(fileUrl, location.href).pathname.split('/').filter(Boolean).map(decodeURIComponent);
      } catch {
        return ['draft.html'];
      }
    },

    async uniqueName(dir, name) {
      const safe = name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
      const dot = safe.lastIndexOf('.');
      const base = dot > 0 ? safe.slice(0, dot) : safe;
      const ext = dot > 0 ? safe.slice(dot) : '';
      for (let i = 1; i < 500; i++) {
        const candidate = i === 1 ? safe : `${base}-${i}${ext}`;
        if (!memoryFiles.has(candidate)) return candidate;
      }
      return `${base}-${Date.now()}${ext}`;
    },

    async walk(dir, rel) {
      const fileName = rel[rel.length - 1] || 'draft.html';
      return { fileHandle: await dir.getFileHandle(fileName), dirHandle: dir };
    },

    async writeScreenshot(fileUrl, blob) {
      currentFileUrl = fileUrl || currentFileUrl;
      const name = `screenshots/note-${Date.now()}.png`;
      memoryFiles.set(name, blob);
      await cacheFile(name, blob);
      return name;
    },

    async resolve(fileUrl, expectedText) {
      currentFileUrl = fileUrl || currentFileUrl;
      await getInitialSource();

      const fileHandle = {
        name: 'draft.html',
        kind: 'file',
        async getFile() {
          return {
            name: 'draft.html',
            lastModified: Date.now(),
            size: currentSource ? currentSource.length : 0,
            text: async () => currentSource
          };
        },
        async createWritable() {
          let buffer = '';
          return {
            async write(chunk) {
              if (typeof chunk === 'string') {
                buffer += chunk;
              } else if (chunk instanceof Blob) {
                buffer += await chunk.text();
              } else if (chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk)) {
                buffer += new TextDecoder().decode(chunk);
              }
            },
            async close() {
              currentSource = buffer;
              try {
                sessionStorage.setItem('retouch:demo-source', currentSource);
              } catch (e) {}
              await syncCache(currentSource);
            }
          };
        }
      };

      const dirHandle = {
        name: 'site',
        kind: 'directory',
        async getFileHandle(name, opts) {
          return {
            name,
            kind: 'file',
            async getFile() {
              const data = memoryFiles.get(name) || '';
              return new File([data], name);
            },
            async createWritable() {
              const chunks = [];
              return {
                async write(c) { chunks.push(c); },
                async close() {
                  const blob = new Blob(chunks, { type: getMimeType(name) });
                  memoryFiles.set(name, blob);
                  await cacheFile(name, blob);
                }
              };
            }
          };
        },
        async getDirectoryHandle(name, opts) {
          return this;
        }
      };

      return {
        vault: { handle: dirHandle, prefix: ['site'], addedAt: Date.now() },
        fileHandle,
        dirHandle,
        relPath: 'draft.html'
      };
    }
  };

  // Expose as global RetouchVault
  global.RetouchVault = RetouchVault;
})(typeof globalThis !== 'undefined' ? globalThis : self);
