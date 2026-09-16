// Unit tests for extension/patch.js. Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, '..', 'extension', 'patch.js'), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const { apply } = ctx.RetouchPatch;

test('replaces a single text run', () => {
  const src = '<p>Pipeline grew 18% quarter over quarter.</p>';
  const r = apply(src, [{ before: 'Pipeline grew 18% quarter over quarter.', after: 'Pipeline grew 21% quarter over quarter.', anchor: '' }]);
  assert.equal(r.ok, true);
  assert.equal(r.source, '<p>Pipeline grew 21% quarter over quarter.</p>');
});

test('leaves everything else byte for byte', () => {
  const src = '<!DOCTYPE html>\n<html>\n  <body>\n    <!-- keep me -->\n    <td>42</td>\n  </body>\n</html>\n';
  const r = apply(src, [{ before: '42', after: '43', anchor: '' }]);
  assert.equal(r.source, src.replace('42', '43'));
});

test('uses the anchor to pick the right duplicate', () => {
  const src = '<tr><td>Events</td><td>42</td></tr><tr><td>Inbound</td><td>42</td></tr>';
  const r = apply(src, [{ before: '42', after: '31', anchor: 'Inbound' }]);
  assert.equal(r.source, '<tr><td>Events</td><td>42</td></tr><tr><td>Inbound</td><td>31</td></tr>');
});

test('applies changes in order, advancing past earlier edits', () => {
  const src = '<li>a</li><li>a</li><li>a</li>';
  const r = apply(src, [
    { before: 'a', after: 'x', anchor: '' },
    { before: 'a', after: 'y', anchor: '' },
    { before: 'a', after: 'z', anchor: '' }
  ]);
  assert.equal(r.source, '<li>x</li><li>y</li><li>z</li>');
});

test('matches entity-escaped source and escapes the replacement', () => {
  const src = '<p>Q&amp;A with &lt;team&gt;</p>';
  const r = apply(src, [{ before: 'Q&A with <team>', after: 'Q&A with <everyone>', anchor: '' }]);
  assert.equal(r.ok, true);
  assert.equal(r.source, '<p>Q&amp;A with &lt;everyone&gt;</p>');
});

test('reports text that is not in the source (script generated)', () => {
  const src = '<tbody></tbody><script>rows = ["W35"]</script>';
  const r = apply(src, [{ before: 'Total signups: 405', after: 'Total signups: 406', anchor: '' }]);
  assert.equal(r.ok, false);
  assert.equal(r.failures[0].reason, 'not-found');
  assert.match(ctx.RetouchPatch.describeFailure(r.failures[0]), /Total signups/);
});

test('refuses empty originals', () => {
  const r = apply('<p></p>', [{ before: '', after: 'new', anchor: '' }]);
  assert.equal(r.ok, false);
  assert.equal(r.failures[0].reason, 'empty');
});

test('falls back to searching from the cursor when the anchor text is missing', () => {
  const src = '<p>one</p><p>two</p>';
  const r = apply(src, [{ before: 'two', after: '2', anchor: 'nowhere' }]);
  assert.equal(r.source, '<p>one</p><p>2</p>');
});

test('never matches inside a script block', () => {
  const src = '<td>120</td>\n<script>\n  const rows = [{ week: "W35", signups: 120 }];\n</script>';
  // The DOM cell "120" is real text and matches. The script literal must not.
  const ok = apply(src, [{ before: '120', after: '121', anchor: '' }]);
  assert.equal(ok.source, '<td>121</td>\n<script>\n  const rows = [{ week: "W35", signups: 120 }];\n</script>');
  // Script-generated "120" with no text occurrence: refused, script untouched.
  const gen = apply('<tbody></tbody><script>signups: 120</script>', [{ before: '120', after: '121', anchor: '' }]);
  assert.equal(gen.ok, false);
  assert.equal(gen.failures[0].reason, 'not-found');
});

test('never matches inside tags, attributes, comments or style', () => {
  const src = '<!-- 42 --><style>.a{width:42px}</style><a href="/42" title="42">42</a><img alt="42">';
  const r = apply(src, [{ before: '42', after: '43', anchor: '' }]);
  assert.equal(r.source, '<!-- 42 --><style>.a{width:42px}</style><a href="/42" title="42">43</a><img alt="42">');
});

test('a match may not straddle a tag boundary', () => {
  const src = '<p>foo</p><p>bar</p>';
  const r = apply(src, [{ before: 'foobar', after: 'x', anchor: '' }]);
  assert.equal(r.ok, false);
});

test('text regions handle quoted > inside attributes and raw text elements', () => {
  const src = '<div data-x="a>b">text</div><textarea>not text</textarea><script>s</script>tail';
  const regions = ctx.RetouchPatch.textRegions(src).map(([a, b]) => src.slice(a, b));
  assert.equal(regions.join('|'), 'text|tail');
});

const elementChange = (tag, firstText, lastText, afterHtml, extra = {}) => ({ kind: 'element', tag, firstText, lastText, afterHtml, anchor: '', tagCounts: {}, ...extra });

test('element: adds bold inside a cell and leaves neighbours alone', () => {
  const src = '<tr>\n  <td class="n">1</td><td>Pipeline grew 18% this quarter.</td>\n</tr>';
  const r = apply(src, [elementChange('td', 'Pipeline grew 18% this quarter.', 'Pipeline grew 18% this quarter.',
    '<td>Pipeline grew <strong>18%</strong> this quarter.</td>')]);
  assert.equal(r.ok, true);
  assert.equal(r.source, '<tr>\n  <td class="n">1</td><td>Pipeline grew <strong>18%</strong> this quarter.</td>\n</tr>');
});

test('element: removes original bold (first text sits inside a child)', () => {
  const src = '<p><strong>Win rate</strong> held at 24%.</p><p>next</p>';
  const r = apply(src, [elementChange('p', 'Win rate', ' held at 24%.', '<p>Win rate held at 24%.</p>', { tagCounts: { strong: 1 } })]);
  assert.equal(r.source, '<p>Win rate held at 24%.</p><p>next</p>');
});

test('element: skips a same-named ancestor and a same-named earlier sibling', () => {
  const src = '<div>x</div><div><div>x</div> tail</div>';
  // The edited element is the outer div whose texts are "x" (inside the inner div) and " tail".
  const r = apply(src, [elementChange('div', 'x', ' tail', '<div><div><em>x</em></div> tail</div>', { tagCounts: { div: 1 } })]);
  assert.equal(r.source, '<div>x</div><div><div><em>x</em></div> tail</div>');
});

test('element: uses the anchor to pick the right one of two identical cells', () => {
  const src = '<td>Events</td><td>42</td><td>Inbound</td><td>42</td>';
  const r = apply(src, [elementChange('td', '42', '42', '<td><b>42</b></td>', { anchor: 'Inbound' })]);
  assert.equal(r.source, '<td>Events</td><td>42</td><td>Inbound</td><td><b>42</b></td>');
});

test('element: refuses when the DOM has more child elements than the source (script-added)', () => {
  const src = '<p>Total: <span id="n"></span></p>';
  const r = apply(src, [elementChange('p', 'Total: ', 'Total: ', '<p><b>Total:</b> <span id="n"><i>405</i></span></p>', { tagCounts: { span: 1, i: 1 } })]);
  assert.equal(r.ok, false);
  assert.equal(r.failures[0].reason, 'generated');
});

test('element: refuses when the element had no text', () => {
  const r = apply('<td></td>', [elementChange('td', '', '', '<td>new</td>')]);
  assert.equal(r.failures[0].reason, 'no-text');
});

test('element: text and element changes mix in document order', () => {
  const src = '<ul><li>one</li><li>two</li><li>three</li></ul>';
  const r = apply(src, [
    { before: 'one', after: '1', anchor: '' },
    elementChange('li', 'two', 'two', '<li><em>two</em></li>'),
    { before: 'three', after: '3', anchor: '' }
  ]);
  assert.equal(r.source, '<ul><li>1</li><li><em>two</em></li><li>3</li></ul>');
});

test('tokenizer: literal < in text, void tags, self-closing and raw blocks', () => {
  const src = 'a < b<br><img src="x"/><script>if (a < b) {}</script><p>c</p>';
  const t = ctx.RetouchPatch.tokenize(src).map((x) => x.type + (x.name ? ':' + x.name : '')).join(' ');
  assert.equal(t, 'text tag:br tag:img tag:script raw tag:script tag:p text tag:p');
});

test('empty: fills the right empty cell after an anchor, counting empties', () => {
  const src = '<tr><td>19</td><td>Type into the empty cell.</td><td class="target"></td><td></td></tr>';
  const r = apply(src, [{ kind: 'empty', tag: 'td', anchor: 'Type into the empty cell.', skip: 1, afterHtml: 'hello', }]);
  assert.equal(r.ok, true);
  assert.equal(r.source, '<tr><td>19</td><td>Type into the empty cell.</td><td class="target"></td><td>hello</td></tr>');
  const r0 = apply(src, [{ kind: 'empty', tag: 'td', anchor: 'Type into the empty cell.', skip: 0, afterHtml: 'hello' }]);
  assert.equal(r0.source, '<tr><td>19</td><td>Type into the empty cell.</td><td class="target">hello</td><td></td></tr>');
});

test('empty: whitespace-only and comment-only content still counts as empty; text does not', () => {
  const src = '<p>lead</p>\n<p>\n  <!-- todo -->\n</p>\n<p>full</p>\n<p></p>';
  const r = apply(src, [{ kind: 'empty', tag: 'p', anchor: 'lead', skip: 1, afterHtml: 'x' }]);
  assert.equal(r.source, '<p>lead</p>\n<p>\n  <!-- todo -->\n</p>\n<p>full</p>\n<p>x</p>');
});

test('empty: refuses when no empty element exists', () => {
  const r = apply('<td>a</td>', [{ kind: 'empty', tag: 'td', anchor: '', skip: 0, afterHtml: 'x' }]);
  assert.equal(r.failures[0].reason, 'empty-not-found');
});

test('attr: replaces an image src, preserving quote style and other attributes', () => {
  const src = '<h1><img src="logo.svg" alt="Retouch logo" width="40"> Title</h1>';
  const r = apply(src, [{ kind: 'attr', tag: 'img', attr: 'src', before: 'logo.svg', after: 'new-logo.png', skip: 0, anchor: '' }]);
  assert.equal(r.source, '<h1><img src="new-logo.png" alt="Retouch logo" width="40"> Title</h1>');
  const single = apply("<img src='a.png'>", [{ kind: 'attr', tag: 'img', attr: 'src', before: 'a.png', after: "b's.png", skip: 0, anchor: '' }]);
  assert.equal(single.source, "<img src='b&#39;s.png'>");
});

test('attr: picks the (skip+1)th matching image and escapes quotes', () => {
  const src = '<img src="x.png"><p>mid</p><img src="x.png"><img src="y.png">';
  const r = apply(src, [{ kind: 'attr', tag: 'img', attr: 'src', before: 'x.png', after: 'say "hi".png', skip: 1, anchor: '' }]);
  assert.equal(r.source, '<img src="x.png"><p>mid</p><img src="say &quot;hi&quot;.png"><img src="y.png">');
});

test('attr: adds an attribute that was missing', () => {
  const r = apply('<img src="a.png"><img src="b.png"/>', [
    { kind: 'attr', tag: 'img', attr: 'alt', before: null, after: 'A photo', skip: 0, anchor: '' },
    { kind: 'attr', tag: 'img', attr: 'alt', before: null, after: 'B photo', skip: 0, anchor: '' }
  ]);
  assert.equal(r.source, '<img src="a.png" alt="A photo"><img src="b.png" alt="B photo"/>');
});

test('attr: matches an entity-encoded value and refuses a missing one', () => {
  const ok = apply('<a href="?a=1&amp;b=2">x</a>', [{ kind: 'attr', tag: 'a', attr: 'href', before: '?a=1&b=2', after: '?c=3&d=4', skip: 0, anchor: '' }]);
  assert.equal(ok.source, '<a href="?c=3&amp;d=4">x</a>');
  const no = apply('<img src="a.png">', [{ kind: 'attr', tag: 'img', attr: 'src', before: 'zzz.png', after: 'b.png', skip: 0, anchor: '' }]);
  assert.equal(no.failures[0].reason, 'attr-not-found');
});
