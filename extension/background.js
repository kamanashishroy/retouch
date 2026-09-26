// Toolbar click: a file:// tab opens in the Retouch viewer, the viewer goes back to the plain file,
// anything else gets a notice explaining what Retouch can and cannot edit.
const VIEWER = chrome.runtime.getURL('viewer.html');

chrome.action.onClicked.addListener((tab) => {
  const url = tab.url || '';
  if (url.startsWith(VIEWER)) {
    const src = new URL(url).searchParams.get('src');
    if (src) chrome.tabs.update(tab.id, { url: src });
    return;
  }
  if (url.startsWith('file://')) {
    chrome.tabs.update(tab.id, { url: `${VIEWER}?src=${encodeURIComponent(url)}` });
    return;
  }
  // Either not a local file, or a local file we cannot see because file URL access is off.
  chrome.tabs.create({ url: chrome.runtime.getURL('notice.html') + (url ? '?reason=not-local' : '?reason=unknown') });
});

// First install: open the setup screen.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});

// Register context menu for capturing region screenshots. onInstalled and onStartup can both fire
// close together (and the service worker can restart independently of either), so this can run more
// than once; the item persists across restarts, so a second create() racing the first's removeAll()
// fails with "duplicate id" — harmless, since it means the item already exists as intended. The
// callback here only exists to read chrome.runtime.lastError so Chrome doesn't log it as unchecked.
function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'retouch-capture-region',
      title: 'Capture this area for Retouch',
      contexts: ['all'],
      documentUrlPatterns: ['file:///*', `chrome-extension://${chrome.runtime.id}/*`]
    }, () => { void chrome.runtime.lastError; });
  });
}
chrome.runtime.onInstalled.addListener(setupContextMenu);
chrome.runtime.onStartup.addListener(setupContextMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'retouch-capture-region' && tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'get-pending-capture' }, (reply) => {
      const err = chrome.runtime.lastError;
      if (err || !reply || !reply.pending) {
        chrome.tabs.sendMessage(tab.id, { type: 'capture-no-pending' });
        return;
      }
      const pending = reply.pending;
      chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataUrl) => {
        const capErr = chrome.runtime.lastError;
        if (capErr || !dataUrl) {
          console.warn('[retouch] captureVisibleTab failed:', capErr ? capErr.message : 'no dataUrl');
          chrome.tabs.sendMessage(tab.id, { type: 'capture-failed', id: pending.id, error: capErr ? capErr.message : 'Failed' });
        } else {
          chrome.tabs.sendMessage(tab.id, { type: 'capture-result', id: pending.id, box: pending.box, dataUrl });
        }
      });
    });
  }
});
