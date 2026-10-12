import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRUSH_PRESETS,
  createBrushLibrary,
  normalizeBrush,
  ditherPixel,
  stampBrush,
} from '../dist/brushes.js';

test('ordered dithering has exact density and a stable canvas phase', () => {
  for (let density = 1; density <= 16; density++) {
    const config = normalizeBrush({ dither: { enabled: true, density } }).dither;
    let count = 0;
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        count += Number(ditherPixel(x, y, config));
        assert.equal(ditherPixel(x, y, config), ditherPixel(x + 12, y - 8, config));
      }
    assert.equal(count, density);
  }
});
test('half-density produces the classic checkerboard and invert/scale preserve coverage', () => {
  const config = normalizeBrush({ dither: { density: 8 } }).dither;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      assert.equal(ditherPixel(x, y, config), (x + y) % 2 === 0);
      assert.equal(ditherPixel(x, y, { ...config, invert: true }), (x + y) % 2 !== 0);
      assert.equal(ditherPixel(x * 2 + 1, y * 2, { ...config, scale: 2 }), (x + y) % 2 === 0);
    }
});
test('overlapping stamps and different brush sizes do not fill dither gaps', () => {
  const brush = normalizeBrush({ dither: { enabled: true, density: 6 } });
  const pixels = new Uint8ClampedArray(16 * 16 * 4);
  for (const size of [1, 4, 7, 12])
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        stampBrush({ pixels, w: 16, h: 16, x, y, size, brush, color: [200, 100, 50, 255] });
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++)
      assert.equal(pixels[(y * 16 + x) * 4 + 3], ditherPixel(x, y, brush.dither) ? 255 : 0);
});
test('two-color dithering, selection clipping and patterned erasing use the same coverage', () => {
  const brush = normalizeBrush({ dither: { enabled: true, secondary: true } });
  const pixels = new Uint8ClampedArray(4 * 4 * 4),
    selection = new Uint8Array(16).fill(1);
  selection[0] = 0;
  const args = {
    pixels,
    w: 4,
    h: 4,
    x: 2,
    y: 2,
    size: 4,
    brush,
    color: [255, 0, 0, 255],
    secondary: [0, 0, 255, 255],
    selection,
  };
  stampBrush(args);
  assert.deepEqual([...pixels.slice(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual([...pixels.slice(4, 8)], [0, 0, 255, 255]);
  assert.deepEqual([...pixels.slice(8, 12)], [255, 0, 0, 255]);
  stampBrush({ ...args, erase: true });
  assert.deepEqual([...pixels.slice(4, 8)], [0, 0, 255, 255]);
  assert.deepEqual([...pixels.slice(8, 12)], [0, 0, 0, 0]);
});
test('magic masks and custom tips clip correctly without modifying source pixels', () => {
  const mask = new Uint8Array(16),
    pixels = new Uint8ClampedArray(64);
  const brush = normalizeBrush({
    shape: 'custom',
    mask: Array.from({ length: 64 }, (_, i) => Number(i === 0)),
    dither: { enabled: true },
  });
  stampBrush({ pixels, w: 4, h: 4, x: 2, y: 2, size: 4, brush, color: [255, 0, 0, 255], mask });
  assert.equal(
    mask.reduce((a, b) => a + b),
    1,
  );
  assert.equal(mask[0], 1);
  assert.equal(pixels.some(Boolean), false);
});
test('library migration keeps custom tips, remembers per-brush settings and sanitizes stored data', () => {
  const mask = Array(64).fill(1),
    library = createBrushLibrary(null, { mask, pressure: false });
  assert.deepEqual(library.brushes.find((b) => b.id === 'pixel-custom').mask, mask);
  const dither = library.brushes.find((b) => b.id === 'dither-4');
  dither.size = 20;
  dither.dither.scale = 3;
  library.active = dither.id;
  const loaded = createBrushLibrary(JSON.parse(JSON.stringify(library)));
  assert.equal(loaded.active, dither.id);
  assert.equal(loaded.brushes.find((b) => b.id === dither.id).size, 20);
  assert.equal(loaded.brushes.find((b) => b.id === dither.id).dither.scale, 3);
  assert.equal(loaded.brushes.find((b) => b.id === 'pixel-hard').size, 1);
  const dirty = createBrushLibrary({
    version: 1,
    active: 'invalid',
    brushes: [
      null,
      { id: 'pixel-hard', size: 999, magic: { mode: 'bad' }, dither: { scale: 0 } },
      { id: 'user-safe', name: '自己的笔', size: 6 },
    ],
  });
  assert.equal(dirty.active, 'pixel-hard');
  assert.equal(dirty.brushes[0].size, 32);
  assert.equal(dirty.brushes[0].dither.scale, 1);
  assert.equal(dirty.brushes[0].magic.mode, 'outline-brush');
  assert.equal(dirty.brushes.at(-1).group, 'user');
  loaded.brushes[0].mask[0] = 1;
  assert.equal(BRUSH_PRESETS[0].mask[0], 0);
});
