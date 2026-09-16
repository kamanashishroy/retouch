# Retouch

**[fastretouch.com](https://fastretouch.com)** · Fix the HTML your AI wrote. In seconds.

Retouch is a Chrome extension for the HTML pages your AI keeps generating: reports, dashboards,
one-pagers. Open the file, click the Retouch icon, click any text, change it, press Save. The file
on your disk is updated in place, and everything you did not touch stays byte for byte the same.

Nothing leaves your machine. No server, no account, no upload. The full [privacy policy](https://fastretouch.com/privacy.html) fits on one page.

## What it does

- Edit text in place. Retouch patches the original source rather than rewriting the file.
- Inline formatting: bold, italic, code, links.
- Styles, colors and fonts offered only from the page's own stylesheet, described in plain words.
- Fill empty cells and paragraphs. Replace images and alt text; the new image is copied next to the page.
- Text that a script generates at load is refused, not silently corrupted.

## Install

A Chrome Web Store listing is on its way. Until it is live:

1. Download the latest release zip and unzip it somewhere permanent.
2. Open `chrome://extensions`, switch on Developer mode, click **Load unpacked**, choose the folder.
3. Open Retouch's Details and switch on **Allow access to file URLs**. Restart Chrome.
4. Click the Retouch icon in the toolbar. The tour walks you through the rest and gives you a practice page.

Chrome, Edge, Brave and Arc. Local files only.

## Development

- `extension/` is the extension. It has no build step; load it unpacked as is.
- `node --test tests/` runs the unit tests for the source patcher and the style describer.
- `node scripts/build-site.mjs` builds the website into `site/` from the extension's own tour.

## License

MIT. Say hello at hello@fastretouch.com.
