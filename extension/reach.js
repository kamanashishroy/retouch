// How far someone got with Retouch, for the one question on the uninstall page (D51). Chrome opens
// goodbye.html with the version and one word (installed, access, opened, saved, or unknown) when
// Retouch is removed; nothing is sent unless the user chooses to email their answer. The word lives in
// IndexedDB and only ever moves forward. Classic script, so pages and the service worker can both load
// it after idb.js.
const RetouchReach = (() => {
  const ORDER = ['unknown', 'installed', 'access', 'opened', 'saved'];
  const KEY = 'reached';
  function url(reached) {
    const v = chrome.runtime.getManifest().version;
    return `https://fastretouch.com/goodbye.html?v=${encodeURIComponent(v)}&reached=${reached}`;
  }
  async function stored() {
    try { return (await RetouchIDB.get(KEY)) || null; } catch (e) { return null; }
  }
  // Records a step if it is further than the last one, and points the uninstall URL at the result.
  async function mark(step) {
    const prev = await stored();
    const best = prev && ORDER.indexOf(prev) >= ORDER.indexOf(step) ? prev : step;
    if (best !== prev) { try { await RetouchIDB.set(KEY, best); } catch (e) { /* the URL below still says it */ } }
    try { await chrome.runtime.setUninstallURL(url(best)); } catch (e) { /* uninstall page is optional */ }
    return best;
  }
  // On update: the URL already set says the old version, so rewrite it from what was recorded.
  async function refresh() {
    return mark((await stored()) || 'unknown');
  }
  return { mark, refresh, url };
})();
