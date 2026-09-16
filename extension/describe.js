// Plain-English descriptions of CSS for people who do not read CSS. Pure functions, no DOM, shared
// by the content script (Styles, Color and Font menus) and unit-tested under Node.
(function (root) {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function parseColor(css) {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(String(css).trim());
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }
  function toHsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0;
    let s = 0;
    if (d > 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return { h, s, l };
  }

  // "Dark green", "Light gray", "Brown", "Pale yellow". Works for any rgb()/rgba() string.
  function colorName(css) {
    const c = parseColor(css);
    if (!c) return String(css);
    if (c.a === 0) return 'Transparent';
    const { h, s, l } = toHsl(c);
    if (l < 0.08) return 'Black';
    if (l > 0.96 && s < 0.5) return 'White';
    if (s < 0.2 || (l < 0.2 && s < 0.4)) {
      if (l < 0.3) return 'Dark gray';
      if (l > 0.7) return 'Light gray';
      return 'Gray';
    }
    let hue;
    if (h < 15 || h >= 345) hue = 'red';
    else if (h < 45) hue = 'orange';
    else if (h < 70) hue = 'yellow';
    else if (h < 160) hue = 'green';
    else if (h < 200) hue = 'teal';
    else if (h < 260) hue = 'blue';
    else if (h < 300) hue = 'purple';
    else hue = 'pink';
    if (hue === 'orange' && l < 0.42) return 'Brown';
    if (hue === 'yellow' && l < 0.45) return 'Olive';
    let mod = '';
    if (l < 0.22) mod = 'very dark ';
    else if (l < 0.4) mod = 'dark ';
    else if (l > 0.85) mod = 'pale ';
    else if (l > 0.7) mod = 'light ';
    return cap(mod + hue);
  }

  const SYSTEM = /^(-apple-system|blinkmacsystemfont|system-ui|ui-sans-serif|segoe ui|roboto|helvetica neue|arial)$/i;
  // "Georgia (serif)", "System font", "Monospace". `stack` is a font-family value.
  function fontLabel(stack) {
    const families = String(stack).split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    if (!families.length) return { label: 'Default font', kind: '' };
    const first = families[0];
    const lower = families.map((f) => f.toLowerCase());
    const kind = lower.includes('monospace') || /^ui-monospace$|mono|menlo|courier|consolas/i.test(first) ? 'monospace'
      : (lower.includes('serif') && !lower.includes('sans-serif')) || /georgia|times|garamond|palatino|baskerville|cambria/i.test(first) ? 'serif' : '';
    if (SYSTEM.test(first) || /^(sans-serif|serif|monospace|ui-monospace)$/i.test(first)) {
      if (kind === 'monospace') return { label: 'Monospace', kind };
      if (kind === 'serif') return { label: 'Serif', kind };
      return { label: 'System font', kind: '' };
    }
    return { label: kind ? `${first} (${kind})` : first, kind };
  }

  // Class names as words: "expect-ok" -> "Expect ok", "sideNote" -> "Side note".
  function humanize(name) {
    const words = String(name).replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
    return cap(words || name);
  }

  const LAYOUT = /^(display|position|top|left|right|bottom|width|height|max-|min-|margin|flex|grid|gap|align|justify|overflow|float|clear|z-index|box-sizing|column|order|place|inset|vertical-align|list-style|table-layout|border-collapse|border-spacing|cursor|transition|animation|transform|content|visibility|pointer-events|resize|object-)/;
  function sizeWord(value, bodyPx) {
    const v = String(value).trim();
    let ratio = null;
    let m;
    if ((m = /^([\d.]+)px$/.exec(v))) ratio = +m[1] / (bodyPx || 16);
    else if ((m = /^([\d.]+)(em|rem)$/.exec(v))) ratio = +m[1];
    else if ((m = /^([\d.]+)%$/.exec(v))) ratio = +m[1] / 100;
    else if (/^(smaller|x-small|xx-small|small)$/.test(v)) ratio = 0.8;
    else if (/^(larger|x-large|xx-large|large)$/.test(v)) ratio = 1.3;
    if (ratio === null) return '';
    if (ratio < 0.9) return ratio < 0.75 ? 'much smaller text' : 'smaller text';
    if (ratio > 1.15) return ratio > 1.6 ? 'much larger text' : 'larger text';
    return '';
  }

  // decl: { 'prop': 'value' } of longhand properties (values as the CSS object model reports them).
  // Returns { summary, preview } where preview is a style attribute for rendering the style's name.
  function describeRule(decl, ctx) {
    const bodyPx = (ctx && ctx.bodyFontPx) || 16;
    const get = (p) => (decl[p] || '').trim();
    const parts = [];
    const preview = [];
    let sawVisual = false;

    const color = get('color');
    const bg = get('background-color') || ((get('background').match(/rgba?\([^)]*\)/) || [])[0] || '');
    if (color && parseColor(color) && parseColor(color).a !== 0) { parts.push(colorName(color).toLowerCase() + ' text'); preview.push(`color: ${color}`); sawVisual = true; }
    if (bg && parseColor(bg) && parseColor(bg).a !== 0) { parts.push(colorName(bg).toLowerCase() + ' highlight'); preview.push(`background-color: ${bg}`); sawVisual = true; }

    const weight = get('font-weight');
    if (weight && (weight === 'bold' || weight === 'bolder' || +weight >= 600)) { parts.push('bold'); preview.push('font-weight: 700'); sawVisual = true; }
    else if (weight && (+weight > 0 && +weight <= 300 || weight === 'lighter')) { parts.push('light weight'); preview.push('font-weight: 300'); sawVisual = true; }
    if (/italic|oblique/.test(get('font-style'))) { parts.push('italic'); preview.push('font-style: italic'); sawVisual = true; }
    const deco = get('text-decoration-line') || get('text-decoration');
    if (/underline/.test(deco)) { parts.push('underlined'); preview.push('text-decoration: underline'); sawVisual = true; }
    if (/line-through/.test(deco)) { parts.push('struck through'); preview.push('text-decoration: line-through'); sawVisual = true; }
    const tt = get('text-transform');
    if (tt === 'uppercase') { parts.push('all caps'); preview.push('text-transform: uppercase'); sawVisual = true; }
    else if (tt === 'capitalize') { parts.push('capitalized'); sawVisual = true; }
    else if (tt === 'lowercase') { parts.push('lowercase'); preview.push('text-transform: lowercase'); sawVisual = true; }

    const size = get('font-size');
    const sw = size ? sizeWord(size, bodyPx) : '';
    if (sw) { parts.push(sw); sawVisual = true; }
    const ff = get('font-family');
    if (ff) { const f = fontLabel(ff); parts.push(f.label.toLowerCase() === 'system font' ? 'system font' : `${f.label} font`); preview.push(`font-family: ${ff}`); sawVisual = true; }
    if (get('letter-spacing') && get('letter-spacing') !== 'normal') { parts.push('spaced letters'); sawVisual = true; }

    const bl = get('border-left-width') || get('border-left');
    const bb = get('border-bottom-width') || get('border-bottom');
    const bt = get('border-top-width') || get('border-top');
    const bw = get('border-width') || get('border');
    const side = (w) => w && w !== '0px' && !/^0\b|none/.test(w);
    if (side(bl) && !side(bw)) { const c = get('border-left-color'); parts.push((c && parseColor(c) ? colorName(c).toLowerCase() + ' ' : '') + 'bar on the left'); sawVisual = true; }
    else if (side(bw)) { parts.push('boxed'); sawVisual = true; }
    else if (side(bb)) { parts.push('rule underneath'); sawVisual = true; }
    else if (side(bt)) { parts.push('rule above'); sawVisual = true; }
    if (get('border-radius') && get('border-radius') !== '0px' && (bg || side(bw))) parts.push('rounded corners');
    if (get('text-align') && /center|right/.test(get('text-align'))) { parts.push(get('text-align') === 'center' ? 'centered' : 'right aligned'); sawVisual = true; }

    const layoutOnly = !sawVisual && Object.keys(decl).some((p) => LAYOUT.test(p) || /^(padding|margin)/.test(p));
    let summary = parts.length ? cap(parts.join(', ')) : layoutOnly ? 'Spacing and layout' : 'No visible change';
    return { summary, preview: preview.join('; ') };
  }

  root.RetouchDescribe = { colorName, fontLabel, humanize, describeRule, parseColor };
})(typeof self !== 'undefined' ? self : globalThis);
