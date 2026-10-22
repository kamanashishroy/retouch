// Onboarding setup logic and animated settings mockup
const IS_EXT = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
const EXT_ID = IS_EXT ? chrome.runtime.id : null;
const STORE_URL = 'https://chromewebstore.google.com/detail/retouch-fix-the-html-your/ckcjhaefngkggppffpbhmokbopcaloeh';

if (!IS_EXT) {
  document.body.classList.add('web');
  const storeLinks = document.querySelectorAll('.store-link');
  for (const a of storeLinks) a.href = STORE_URL;
}

// 1. Check & display file URL access state
let isFileAccessAllowed = false;
const accessState = document.getElementById('access-state');
function checkAccess() {
  if (!IS_EXT || !accessState) return;
  chrome.extension.isAllowedFileSchemeAccess((ok) => {
    isFileAccessAllowed = !!ok;
    accessState.textContent = ok ? 'On. Retouch can see your files.' : 'Off. Switch it on in Chrome Settings, then restart Chrome.';
    accessState.className = 'state ' + (ok ? 'ok' : 'warn');
    if (toggleFile) toggleFile.classList.toggle('on', isFileAccessAllowed);
    if (ok && typeof RetouchReach !== 'undefined') RetouchReach.mark('access');
  });
}
checkAccess();
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkAccess(); });

// 2. Open Chrome Extension Settings button
const openDetailsBtn = document.getElementById('open-details');
if (openDetailsBtn) {
  openDetailsBtn.addEventListener('click', () => {
    if (IS_EXT) {
      chrome.tabs.create({ url: `chrome://extensions/?id=${EXT_ID}` });
    } else {
      window.open(STORE_URL, '_blank');
    }
  });
}

// 3. Make practice page action
const makePracticeBtn = document.getElementById('make-practice');
const practiceState = document.getElementById('practice-state');

if (makePracticeBtn) {
  makePracticeBtn.addEventListener('click', async () => {
    if (!IS_EXT) { window.open(STORE_URL, '_blank'); return; }
    if (practiceState) {
      practiceState.textContent = '';
      practiceState.className = 'state';
    }
    const allowed = await new Promise((r) => chrome.extension.isAllowedFileSchemeAccess(r));
    if (!allowed) {
      if (practiceState) {
        practiceState.textContent = 'Please enable file URL access in Chrome Settings first.';
        practiceState.className = 'state warn';
      }
      return;
    }
    const granted = await chrome.permissions.request({ permissions: ['downloads'] });
    if (!granted) {
      if (practiceState) {
        practiceState.textContent = 'Permission needed to place practice file.';
        practiceState.className = 'state warn';
      }
      return;
    }
    try {
      const url = chrome.runtime.getURL('practice.html');
      const wanted = { filename: 'Retouch/retouch-practice.html', conflictAction: 'uniquify' };
      const ours = new Set([url]);
      const onName = (item, suggest) => { if (ours.has(item.url)) suggest(wanted); };
      chrome.downloads.onDeterminingFilename.addListener(onName);
      let id;
      try {
        id = await chrome.downloads.download(Object.assign({ url, saveAs: false }, wanted));
      } catch (e) {
        const html = await (await fetch(url)).text();
        const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        ours.add(blobUrl);
        id = await chrome.downloads.download(Object.assign({ url: blobUrl, saveAs: false }, wanted));
      }
      chrome.downloads.onDeterminingFilename.removeListener(onName);
      const search = (id) => new Promise((r) => chrome.downloads.search({ id }, (res) => r(res && res[0])));
      let item = await search(id);
      while (item && item.state === 'in_progress') {
        await new Promise((r) => setTimeout(r, 100));
        item = await search(id);
      }
      if (item && item.state === 'complete' && item.filename) {
        const fileUrl = 'file://' + item.filename.replace(/\\/g, '/');
        const viewerUrl = chrome.runtime.getURL('viewer.html') + '?src=' + encodeURIComponent(fileUrl) + '&fresh=1';

        // Warm profile check: if a vault already covers this file, open viewer immediately
        const match = typeof RetouchVault !== 'undefined' ? await RetouchVault.resolve(fileUrl) : null;
        if (match) {
          chrome.tabs.create({ url: viewerUrl });
          return;
        }

        // Cold profile / first run: resolve folder grant on welcome screen before opening viewer tab
        const confirmBox = document.getElementById('confirm-folder-box');
        const confirmBtn = document.getElementById('confirm-folder');
        if (confirmBox && confirmBtn) {
          makePracticeBtn.hidden = true;
          confirmBox.hidden = false;

          confirmBtn.onclick = async () => {
            confirmBtn.disabled = true;
            try {
              const segs = RetouchVault.segments(fileUrl);
              const dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'retouch-practice', startIn: 'downloads' });
              if (dir && segs.slice(0, -1).includes(dir.name)) {
                await RetouchVault.add(dir, segs.slice(0, -1));
              }
            } catch (e) {
              // Graceful fallback: user cancelled native picker (AbortError), open viewer tab anyway
            }
            chrome.tabs.create({ url: viewerUrl });
          };
        } else {
          chrome.tabs.create({ url: viewerUrl });
        }
      }
    } catch (err) {
      if (practiceState) {
        practiceState.textContent = 'Error creating practice page: ' + (err.message || String(err));
        practiceState.className = 'state warn';
      }
    }
  });
}

// 4. Synced multi-toggle animation engine for Image 2 Chrome Mockup
const cursor = document.getElementById('seq-cursor');
const togglePin = document.getElementById('toggle-pin');
const toggleIncognito = document.getElementById('toggle-incognito');
const toggleFile = document.getElementById('toggle-file');

if (cursor && toggleFile) {
  let startTime = null;
  const DURATION = 6000; // 6s cycle

  function animateMock(timestamp) {
    if (!startTime) startTime = timestamp;
    const elapsed = (timestamp - startTime) % DURATION;

    let cursorX, cursorY, scale = 1;
    let pinOn = false, incognitoOn = false, fileOn = false;

    if (elapsed < 1000) {
      // Step 1: Move cursor to Pin to toolbar (340, 165)
      const p = elapsed / 1000;
      const easeP = 1 - Math.pow(1 - p, 3);
      cursorX = 260 + (340 - 260) * easeP;
      cursorY = 280 + (165 - 280) * easeP;
    } else if (elapsed < 1200) {
      // Step 1 Click
      cursorX = 340; cursorY = 165;
      scale = 1 - 0.2 * Math.sin(((elapsed - 1000) / 200) * Math.PI);
      pinOn = elapsed >= 1100;
    } else if (elapsed < 2000) {
      // Step 2: Move cursor to Allow in Incognito (340, 220)
      pinOn = true;
      const p = (elapsed - 1200) / 800;
      const easeP = 1 - Math.pow(1 - p, 3);
      cursorX = 340;
      cursorY = 165 + (220 - 165) * easeP;
    } else if (elapsed < 2200) {
      // Step 2 Click
      pinOn = true;
      cursorX = 340; cursorY = 220;
      scale = 1 - 0.2 * Math.sin(((elapsed - 2000) / 200) * Math.PI);
      incognitoOn = elapsed >= 2100;
    } else if (elapsed < 3000) {
      // Step 3: Move cursor to Allow access to file URLs (340, 275)
      pinOn = true; incognitoOn = true;
      const p = (elapsed - 2200) / 800;
      const easeP = 1 - Math.pow(1 - p, 3);
      cursorX = 340;
      cursorY = 220 + (275 - 220) * easeP;
    } else if (elapsed < 3200) {
      // Step 3 Click
      pinOn = true; incognitoOn = true;
      cursorX = 340; cursorY = 275;
      scale = 1 - 0.2 * Math.sin(((elapsed - 3000) / 200) * Math.PI);
      fileOn = elapsed >= 3100;
    } else if (elapsed < 5000) {
      // Hold state
      pinOn = true; incognitoOn = true; fileOn = true;
      cursorX = 340; cursorY = 275; scale = 1;
    } else {
      // Move cursor back and reset
      const p = (elapsed - 5000) / 1000;
      cursorX = 340 + (260 - 340) * p;
      cursorY = 275 + (280 - 275) * p;
      pinOn = false; incognitoOn = false; fileOn = false;
    }

    cursor.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0) scale(${scale})`;

    if (togglePin) togglePin.classList.toggle('on', pinOn);
    if (toggleIncognito) toggleIncognito.classList.toggle('on', incognitoOn);
    if (toggleFile) toggleFile.classList.toggle('on', isFileAccessAllowed || fileOn);

    requestAnimationFrame(animateMock);
  }

  requestAnimationFrame(animateMock);
}
