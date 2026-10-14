import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { blank, serialize, deserialize, composite } from '../dist/engine.js';
import { parseFont, renderPixelText } from '../dist/pixel-type.js';
import {
  warpPixels,
  rectangleQuad,
  quadMatrix,
  inverseMatrix,
  mapPoint,
} from '../dist/perspective.js';
import { outlinePixels } from '../dist/pixel-outline.js';
import { initialTransform, transformSelection } from '../dist/selection.js';
import { createScene, validateScene, moveSceneCanvas } from '../dist/procedural-model.js';
import {
  createObject,
  compileScene,
  evaluateScene,
  bakeScene,
  objectState,
} from '../dist/procedural.js';
import { effectClip } from '../dist/scene-effects.js';
const font = parseFont(
  gunzipSync(
    fs.readFileSync(new URL('../dist/fonts/unifont-18.0.01.hex.gz', import.meta.url)),
  ).toString(),
);
test('bundled bitmap font renders Chinese, Japanese, English and vertical columns without antialiasing', () => {
  for (const c of '中日英你好あいうえおカタカナHello♥') assert.ok(font.has(c.codePointAt(0)), c);
  const a = renderPixelText(font, '你好ABC'),
    b = renderPixelText(font, '你好ABC', { direction: 'vertical' });
  assert.equal(a.height, 16);
  assert.equal(b.width, 16);
  assert.equal(b.height, 84);
  assert.ok(a.pixels.some(Boolean));
  assert.ok([...a.pixels].filter((_, i) => i % 4 === 3).every((v) => v === 0 || v === 255));
  assert.throws(() => renderPixelText(font, 'a'.repeat(513)), /512/);
});
test('perspective inverse recovers coordinates; identity and mirror preserve exact RGBA', () => {
  const q = [
      { x: 3, y: 4 },
      { x: 20, y: 1 },
      { x: 17, y: 18 },
      { x: 5, y: 16 },
    ],
    m = quadMatrix(q),
    inv = inverseMatrix(m);
  for (const [x, y] of [
    [0, 0],
    [0.5, 0.6],
    [1, 1],
  ]) {
    const p = mapPoint(m, x, y),
      r = mapPoint(inv, p.x, p.y);
    assert.ok(Math.abs(r.x - x) < 1e-9);
    assert.ok(Math.abs(r.y - y) < 1e-9);
  }
  const source = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]);
  assert.deepEqual(warpPixels(source, 2, 1, 2, 1, rectangleQuad(0, 0, 2, 1)), source);
  assert.deepEqual(
    [...warpPixels(source, 2, 1, 2, 1, rectangleQuad(0, 0, 2, 1), { flipX: true })],
    [0, 255, 0, 128, 255, 0, 0, 255],
  );
  assert.throws(
    () =>
      quadMatrix([
        { x: 0, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
        { x: 2, y: 0 },
      ]),
    /交叉/,
  );
});
test('perspective selection preserves unselected destination and can move transparent selected pixels', () => {
  const p = blank(8, 8),
    pixels = p.frames[0].cels[0],
    mask = new Uint8Array(64);
  pixels.set([220, 20, 20, 255], 9 * 4);
  pixels.set([0, 90, 240, 255], 63 * 4);
  mask[9] = 1;
  const t = initialTransform(mask, 8, 8);
  t.quad = rectangleQuad(3, 4, 2, 2);
  const result = transformSelection(pixels, 8, 8, mask, t);
  assert.equal(result.pixels[9 * 4 + 3], 0);
  assert.equal(result.pixels[(4 * 8 + 3) * 4], 220);
  assert.equal(result.pixels[63 * 4 + 2], 240);
  assert.equal(
    result.mask.reduce((a, b) => a + b, 0),
    4,
  );
});
test('outline width, selection, canvas edge and inner/outer placement retain original pixels', () => {
  const cel = new Uint8ClampedArray(25 * 4);
  cel.set([10, 20, 30, 255], 12 * 4);
  cel.set([10, 20, 30, 255], 0);
  const saved = new Uint8ClampedArray(cel),
    mask = new Uint8Array(25);
  mask[12] = 1;
  const out = outlinePixels(cel, 5, 5, { mask, width: 1 });
  assert.equal(out[12 * 4 + 3], 0);
  assert.equal([...out].filter((v, i) => i % 4 === 3 && v).length, 8);
  assert.deepEqual(cel, saved);
  const inside = outlinePixels(cel, 5, 5, { position: 'inside' });
  assert.equal(inside[3], 255);
  assert.equal(inside[12 * 4 + 3], 255);
  assert.throws(() => outlinePixels(cel, 5, 5, { width: Infinity }), /宽度/);
});
function fixture() {
  const p = blank(12, 12);
  p.frames[0].cels[0].set([150, 40, 60, 200], (6 * 12 + 6) * 4);
  p.procedural = createScene(p, 0);
  p.procedural.objects.push(createObject(p, p.procedural, [0], null, '测试'));
  return p;
}
test('appearance holds invisible outside its interval, fades correctly, and fade-out does not reappear', () => {
  const p = fixture(),
    o = p.procedural.objects[0];
  o.appearance = { start: 0.2, end: 1.8, fadeIn: 0.4, fadeOut: 0.4 };
  assert.equal(objectState(o, 0).opacity, 0);
  assert.ok(Math.abs(objectState(o, 0.4).opacity - 0.5) < 1e-9);
  assert.equal(objectState(o, 1).opacity, 1);
  assert.equal(objectState(o, 1.8).opacity, 0);
  delete o.appearance;
  o.clips = [effectClip('fade', 'fadeOut', 0.5, 1)];
  assert.equal(objectState(o, 1.5).opacity, 0);
  assert.equal(objectState(o, 0).opacity, 1);
});
test('rainbow, gradient and blink are deterministic, reversible and preserve source pixels', () => {
  const p = fixture(),
    s = p.procedural,
    o = s.objects[0],
    c = compileScene(p, s),
    source = serialize(p);
  o.clips = [effectClip('rainbow', 'rainbow', 0, 2)];
  const a = new Uint8ClampedArray(evaluateScene(c, s, 0.2)),
    b = new Uint8ClampedArray(evaluateScene(c, s, 0.8));
  assert.notDeepEqual(a, b);
  assert.equal(a[(6 * 12 + 6) * 4 + 3], 200);
  o.clips = [effectClip('blink', 'blink', 0, 2)];
  assert.equal(objectState(o, 0.3).opacity, 0);
  assert.equal(objectState(o, 0.6).opacity, 1);
  o.clips = [effectClip('tint', 'tint', 0, 2)];
  assert.notDeepEqual([...evaluateScene(c, s, 0)], [...evaluateScene(c, s, 1)]);
  o.clips = [];
  assert.equal(serialize(p), source);
});
test('dynamic lights preserve transparency, survive serialization, move with expansion, and bake', async () => {
  const p = fixture(),
    s = p.procedural;
  s.lights = [
    {
      id: 'monitor',
      name: '电脑光',
      enabled: true,
      x: 6,
      y: 7,
      radius: 10,
      intensity: 1,
      color: '#88ccff',
      colorTo: '#ff88aa',
      start: 0,
      end: 2,
      pulse: 1,
      frequency: 1,
      colorCycle: true,
    },
  ];
  const re = deserialize(serialize(p));
  assert.deepEqual(re.procedural, s);
  const c = compileScene(re, re.procedural);
  const a = new Uint8ClampedArray(evaluateScene(c, s, 0)),
    b = new Uint8ClampedArray(evaluateScene(c, s, 0.5));
  assert.notDeepEqual(a, b);
  assert.equal(a[3], 0);
  assert.equal(a[(6 * 12 + 6) * 4 + 3], 200);
  const moved = moveSceneCanvas(s, 16, 16, 2, 3);
  assert.equal(moved.lights[0].x, 8);
  assert.equal(moved.lights[0].y, 10);
  s.fps = 2;
  const baked = await bakeScene(
    p,
    s,
    { mode: 'composite' },
    () => {},
    async () => {},
  );
  assert.deepEqual(composite(baked.project, baked.frame), a);
  s.lights[0].radius = NaN;
  assert.throws(() => validateScene(s, p), /无效/);
});
