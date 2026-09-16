const reason = new URLSearchParams(location.search).get('reason');
const body = document.getElementById('body');
chrome.extension.isAllowedFileSchemeAccess((allowed) => {
  if (!allowed) {
    body.innerHTML = `
      <h1>Let Retouch see local files</h1>
      <p class="muted">Chrome keeps files on your disk hidden from extensions until you allow it. This takes a minute and you only do it once.</p>
      <ol>
        <li>Open <code>chrome://extensions</code> and click <b>Details</b> on Retouch.</li>
        <li>Switch on <b>Allow access to file URLs</b>.</li>
        <li><b>Quit and reopen Chrome.</b> Chrome applies this setting only after a restart.</li>
        <li>Open your HTML file and click the Retouch icon.</li>
      </ol>
      <p><a href="welcome.html#setup">The tour walks you through it →</a></p>`;
  } else if (reason === 'not-local') {
    body.innerHTML = `
      <h1>This page isn’t a file on your disk</h1>
      <p class="muted">Retouch saves straight back to local files, so it works only on pages whose address starts with <code>file://</code>.</p>
      <p>Open the HTML file from Finder, or use <b>File → Open File…</b> in Chrome, then click the Retouch icon.</p>`;
  } else {
    body.innerHTML = `
      <h1>Ready to edit</h1>
      <p class="ok">File access is on.</p>
      <p class="muted">Open any local HTML file and click the Retouch icon. Click text to change it, then press Save.</p>
      <p><a id="tour" href="welcome.html#setup">Take the one-minute tour and get a practice page →</a></p>`;
  }
});
