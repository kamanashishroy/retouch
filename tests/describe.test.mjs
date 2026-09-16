import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(here, '..', 'extension', 'describe.js'), 'utf8'), ctx);
const { colorName, fontLabel, humanize, describeRule } = ctx.RetouchDescribe;

test('colors from the test page get sensible names', () => {
  const cases = [
    ['rgb(207, 34, 46)', 'Red'], ['rgb(26, 127, 55)', 'Dark green'], ['rgb(154, 103, 0)', 'Brown'],
    ['rgb(255, 243, 191)', 'Pale yellow'], ['rgb(82, 96, 109)', 'Gray'], ['rgb(110, 110, 115)', 'Gray'],
    ['rgb(31, 41, 51)', 'Dark gray'], ['rgb(217, 222, 227)', 'Light gray'], ['rgb(31, 111, 235)', 'Blue'],
    ['rgb(255, 255, 255)', 'White'], ['rgb(0, 0, 0)', 'Black'], ['rgb(255, 159, 10)', 'Orange'],
    ['rgb(52, 199, 89)', 'Green'], ['rgb(175, 82, 222)', 'Purple'], ['rgba(0, 0, 0, 0)', 'Transparent'],
    ['rgb(245, 247, 250)', 'White']
  ];
  for (const [css, name] of cases) assert.equal(colorName(css), name, css);
});

test('font stacks become readable labels', () => {
  assert.equal(fontLabel('Georgia, "Times New Roman", serif').label, 'Georgia (serif)');
  assert.equal(fontLabel('-apple-system, system-ui, sans-serif').label, 'System font');
  assert.equal(fontLabel('ui-monospace, Menlo, monospace').label, 'Monospace');
  assert.equal(fontLabel('"Helvetica Neue", Arial, sans-serif').label, 'System font');
  assert.equal(fontLabel('Inter, sans-serif').label, 'Inter');
});

test('class names read as words', () => {
  assert.equal(humanize('expect-ok'), 'Expect ok');
  assert.equal(humanize('sideNote'), 'Side note');
  assert.equal(humanize('n'), 'N');
});

test('rules become one-line descriptions', () => {
  assert.equal(describeRule({ color: 'rgb(26, 127, 55)' }).summary, 'Dark green text');
  assert.equal(describeRule({ color: 'rgb(82, 96, 109)', 'font-size': '14px' }, { bodyFontPx: 16 }).summary, 'Gray text, smaller text');
  assert.equal(describeRule({ 'background-color': 'rgb(255, 243, 191)' }).summary, 'Pale yellow highlight');
  assert.equal(describeRule({ 'font-family': 'Georgia, "Times New Roman", serif' }).summary, 'Georgia (serif) font');
  assert.equal(describeRule({ 'border-left-width': '3px', 'border-left-color': 'rgb(31, 111, 235)', 'padding-left': '12px' }).summary, 'Blue bar on the left');
  assert.equal(describeRule({ 'font-weight': '600', 'text-transform': 'uppercase' }).summary, 'Bold, all caps');
  assert.equal(describeRule({ display: 'flex', gap: '12px' }).summary, 'Spacing and layout');
  assert.equal(describeRule({ 'font-size': '2rem' }).summary, 'Much larger text');
});

test('preview carries only what renders inline', () => {
  const p = describeRule({ color: 'rgb(26, 127, 55)', 'font-weight': '700', display: 'block' }).preview;
  assert.equal(p, 'color: rgb(26, 127, 55); font-weight: 700');
});
