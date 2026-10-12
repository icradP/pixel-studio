import test from 'node:test';
import assert from 'node:assert/strict';
import { blank } from '../dist/engine.js';
import { pixelSvg } from '../dist/svg.js';
import { parsePalette, paletteGpl, extractPalette } from '../dist/palettes.js';
import { hsvToHex, hexToHsv } from '../dist/color-studio.js';
test('SVG encodes exact horizontal pixel runs, alpha and escaped title without a bitmap', () => {
  const p = blank(3, 2, 'A < B & C');
  p.frames[0].cels[0].set([
    255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 128, 0, 0, 255, 255, 0, 0, 0, 0,
  ]);
  const text = pixelSvg(p);
  assert.match(text, /A &lt; B &amp; C/);
  assert.match(text, /M0 0h2v1H0z/);
  assert.match(text, /fill-opacity="0.501961"/);
  assert.match(text, /viewBox="0 0 3 2"/);
  assert.doesNotMatch(text, /<image|base64/);
  assert.equal((text.match(/<path /g) || []).length, 3);
});
test('empty transparent frame exports a valid empty SVG', () => {
  assert.doesNotMatch(pixelSvg(blank(2, 2)), /<path/);
});
test('GPL round trip preserves names and exact RGB values', () => {
  const palette = { name: '肤色', colors: ['#00ff12', '#abcdef', '#123456'] };
  assert.deepEqual(parsePalette(paletteGpl(palette)), palette);
  assert.throws(() => parsePalette('GIMP Palette\n256 0 0 invalid'));
  assert.throws(() => parsePalette('{"colors":["red"]}'));
  assert.deepEqual(parsePalette('["#ABCDEF","#abcdef"]', 'Mine.json'), {
    name: 'Mine',
    colors: ['#abcdef'],
  });
});
test('palette extraction ignores transparent colors and ranks frequency', () => {
  const p = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 255, 0, 0]);
  assert.deepEqual(extractPalette(p, 2), ['#ff0000', '#0000ff']);
});
test('HSV conversions preserve primary, gray and arbitrary RGB values', () => {
  for (const hex of [
    '#000000',
    '#ffffff',
    '#ff0000',
    '#00ff00',
    '#0000ff',
    '#ef87a0',
    '#123456',
    '#808080',
  ])
    assert.equal(hsvToHex(...hexToHsv(hex)), hex);
});
