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

// First install: open the tour.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});
