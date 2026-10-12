import test from 'node:test';
import assert from 'node:assert/strict';
import { getPerfectPixel, reducePalette } from '../dist/perfect-pixel.js';
function tiles(cols, rows, scale) {
  const w = cols * scale,
    h = rows * scale,
    data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4,
        k = Math.floor(y / scale) * cols + Math.floor(x / scale);
      data.set([(k * 43) % 256, (k * 97) % 256, (k * 173) % 256, 255], p);
    }
  return { w, h, data };
}
test('manual grid preserves original tile colors and requested dimensions', () => {
  const image = tiles(16, 12, 6),
    out = getPerfectPixel(image, { grid: [16, 12], refineIntensity: 0 });
  assert.equal(out.w, 16);
  assert.equal(out.h, 12);
  for (let k = 0; k < 192; k++)
    assert.deepEqual(
      [...out.data.slice(k * 4, k * 4 + 4)],
      [(k * 43) % 256, (k * 97) % 256, (k * 173) % 256, 255],
    );
});
test('automatic grid detection handles non-power-of-two input', () => {
  const image = tiles(24, 20, 8),
    out = getPerfectPixel(image);
  assert.ok(Math.abs(out.w - 24) <= 1, `width ${out.w}`);
  assert.ok(Math.abs(out.h - 20) <= 1, `height ${out.h}`);
  assert.ok(['fft', 'gradient'].includes(out.method));
});
test('majority ignores minority edge colors rather than averaging all colors', () => {
  const data = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < 64; i++) data.set(i < 48 ? [220, 40, 50, 255] : [10, 100, 240, 255], i * 4);
  const out = getPerfectPixel({ w: 8, h: 8, data }, { grid: [1, 1], refineIntensity: 0 });
  assert.deepEqual([...out.data], [220, 40, 50, 255]);
});
test('transparent hidden RGB does not contaminate opaque colors', () => {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) data.set(i < 12 ? [80, 120, 180, 128] : [255, 0, 255, 0], i * 4);
  const out = getPerfectPixel({ w: 4, h: 4, data }, { grid: [1, 1] });
  assert.deepEqual([...out.data], [80, 120, 180, 128]);
});
test('median and center handle one-pixel wide sources without out-of-bounds reads', () => {
  for (const method of ['median', 'center', 'majority']) {
    const data = new Uint8ClampedArray([20, 40, 60, 255, 30, 50, 70, 255]);
    const out = getPerfectPixel({ w: 1, h: 2, data }, { grid: [1, 2], sampleMethod: method });
    assert.deepEqual(out.data, data);
  }
});
test('palette reduction bounds colors without changing alpha', () => {
  const { data } = tiles(32, 16, 1),
    out = reducePalette(data, 16),
    colors = new Set();
  for (let i = 0; i < out.length; i += 4) {
    colors.add([...out.slice(i, i + 3)].join(','));
    assert.equal(out[i + 3], data[i + 3]);
  }
  assert.ok(colors.size <= 16);
});
test('uniform images fail automatic detection clearly; invalid grids are rejected', () => {
  const image = { w: 24, h: 24, data: new Uint8ClampedArray(24 * 24 * 4).fill(255) };
  assert.throws(() => getPerfectPixel(image), /未识别/);
  for (const grid of [
    [0, 1],
    [513, 1],
    [NaN, 2],
    [25, 1],
  ])
    assert.throws(() => getPerfectPixel(image, { grid }), /宽高/);
  assert.throws(() => getPerfectPixel({ ...image, w: 2000 }), /尺寸/);
});
