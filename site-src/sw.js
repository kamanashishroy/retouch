// Service Worker for live demo on fastretouch.com.
// Serves saved HTML edits and saved images from the retouch-live-demo cache.
const VERSION = '0.3.0-dev';
const CACHE_NAME = 'retouch-live-demo';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        const cached = (await cache.match(event.request)) ||
                       (await cache.match(event.request.url)) ||
                       (await cache.match(url.pathname + url.search)) ||
                       (await cache.match(url.pathname)) ||
                       (await cache.match(url.pathname.replace(/^\//, '')));
        if (cached) {
          return cached;
        }
        return await fetch(event.request);
      } catch (err) {
        return fetch(event.request);
      }
    })()
  );
});
