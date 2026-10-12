import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { duplicateLayer } from '../dist/layer-actions.js';
import { expandCanvas } from '../dist/canvas-resize.js';
import { createHistory } from '../dist/history.js';
import { normalizeBrush, stampBrush } from '../dist/brushes.js';
import { onionPixels } from '../dist/onion.js';
import { blank, clone, composite, serialize, deserialize, validate } from '../dist/engine.js';
import {
  BLEND_MODES,
  blendPixels,
  blendRgb,
  applyMask,
  adjustedRgb,
} from '../dist/layer-effects.js';
import { readAse, writeAse } from '../dist/ase.js';
import {
  normalizeCurve,
  pressureResponse,
  strokeOpacity,
  paintPixel,
  paintMask,
  applyGradient,
  gradientAmount,
} from '../dist/paint.js';
const pixel = (a) => new Uint8ClampedArray(a);

test('moving clipped cels retain their stationary base coverage in onion previews', () => {
  const p = blank(2, 1);
  p.frames[0].cels[0].set([200, 100, 50, 255, 200, 100, 50, 255]);
  p.layers.push({ name: 'clip', visible: true, opacity: 255, clipping: true });
  p.frames[0].cels.push(pixel([10, 30, 50, 255, 0, 0, 0, 0]));
  p.frames.push({
    duration: 120,
    cels: [pixel(p.frames[0].cels[0]), pixel([0, 0, 0, 0, 10, 30, 50, 255])],
  });
  const ghost = onionPixels(p, 1, 0, 1);
  assert.ok(ghost[3] > 0);
  assert.deepEqual([...ghost.slice(0, 3)], [255, 95, 132]);
});

test('color adjustments retain fractional RGB values from typed pixel buffers', () => {
  assert.deepEqual(
    [...new Uint8ClampedArray(adjustedRgb(pixel([100, 150, 200]), {}))],
    [100, 150, 200],
  );
  assert.deepEqual(
    [...new Uint8ClampedArray(adjustedRgb(pixel([100, 150, 200]), { brightness: 10 }))],
    [126, 176, 226],
  );
  assert.deepEqual(
    [...new Uint8ClampedArray(adjustedRgb(pixel([200, 100, 50]), { hue: 120 }))],
    [50, 200, 100],
  );
});

test('mask copies, expansion and history own independent buffers and account for mask memory', () => {
  const p = blank(2, 1);
  p.layers[0].mask = pixel([0, 128]);
  p.layers[0].adjustments = { hue: 25 };
  const history = createHistory();
  history.checkpoint(clone(p));
  assert.equal(history.bytes, 10);
  duplicateLayer(p, 0);
  p.layers[1].mask[0] = 255;
  p.layers[1].adjustments.hue = 50;
  assert.deepEqual([...p.layers[0].mask], [0, 128]);
  assert.equal(p.layers[0].adjustments.hue, 25);
  const next = expandCanvas(p, { left: 1, bottom: 1 });
  assert.deepEqual([...next.layers[0].mask], [255, 0, 128, 255, 255, 255]);
  assert.deepEqual([...history.undo(next).layers[0].mask], [0, 128]);
  assert.deepEqual([...history.redo(p).layers[0].mask], [255, 0, 128, 255, 255, 255]);
});

test('new pressure settings survive normalization; stamps respect pressure, alpha lock and mask targets', () => {
  const brush = normalizeBrush({
    opacity: 50,
    opacityPressure: true,
    pressureCurve: [0, 0.5, 0.75, 0.9, 1],
  });
  assert.deepEqual(normalizeBrush(brush).pressureCurve, brush.pressureCurve);
  const base = pixel([200, 0, 0, 128]),
    out = pixel(base),
    coverage = new Uint8Array(1);
  const args = {
    pixels: out,
    base,
    w: 1,
    h: 1,
    x: 0,
    y: 0,
    size: 1,
    brush,
    color: [0, 0, 255, 255],
    secondary: [0, 0, 0, 255],
    coverage,
    alphaLock: true,
  };
  stampBrush({ ...args, pressureFactor: 0.25 });
  stampBrush({ ...args, pressureFactor: 0.75 });
  stampBrush({ ...args, pressureFactor: 0.1 });
  assert.equal(out[3], 128);
  assert.deepEqual([...out.slice(0, 3)], [125, 0, 96]);
  const mask = pixel([255]);
  stampBrush({
    ...args,
    layerMask: mask,
    baseLayerMask: pixel([255]),
    color: [0, 0, 0, 255],
    coverage: new Uint8Array(1),
  });
  assert.equal(mask[0], 127);
  assert.equal(out[3], 128);
});
test('all 19 modes match native Aseprite semi-transparent reference pixels', () => {
  const reference = JSON.parse(
    fs.readFileSync(new URL('./ase-blend-reference.json', import.meta.url), 'utf8'),
  );
  for (const row of reference.rows) {
    const p = blank(16, 16);
    p.layers.push({ name: 'Blend', visible: true, opacity: 199, blend: row.mode });
    p.frames[0].cels.push(new Uint8ClampedArray(1024));
    for (let i = 0; i < 256; i++) {
      p.frames[0].cels[0].set(
        [(i * 73) % 256, (i * 19) % 256, (i * 43) % 256, 80 + ((i * 11) % 176)],
        i * 4,
      );
      p.frames[0].cels[1].set(
        [(i * 23 + 117) % 256, (i * 53 + 77) % 256, (i * 31 + 19) % 256, 60 + ((i * 7) % 196)],
        i * 4,
      );
    }
    assert.deepEqual([...composite(p, 0)], row.rgba, 'blend ' + row.mode);
  }
});
test('common blends have known color results and handle transparent backdrops', () => {
  for (const [mode, expected] of [
    [1, [78, 59, 39, 255]],
    [2, [222, 191, 211, 255]],
    [3, [157, 127, 167, 255]],
    [4, [100, 100, 50, 255]],
    [5, [200, 150, 200, 255]],
    [10, [100, 50, 150, 255]],
    [16, [255, 250, 250, 255]],
    [17, [0, 50, 150, 255]],
  ])
    assert.deepEqual(
      [...blendPixels(pixel([100, 150, 200, 255]), pixel([200, 100, 50, 255]), 255, mode)],
      expected,
    );
  for (let mode = 0; mode < BLEND_MODES.length; mode++) {
    assert.deepEqual(
      [...blendPixels(pixel([0, 0, 0, 0]), pixel([37, 85, 210, 128]), 255, mode)],
      [37, 85, 210, 128],
    );
    const values = blendRgb([0, 0.5, 1], [1, 0.5, 0], mode);
    assert.ok(values.every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
  }
});
test('partial alpha blend and clipped layers preserve coverage', () => {
  assert.deepEqual(
    [...blendPixels(pixel([255, 0, 0, 128]), pixel([0, 0, 255, 128]), 255, 1)],
    [85, 0, 64, 192],
  );
  assert.deepEqual(
    [...blendPixels(pixel([255, 0, 0, 128]), pixel([0, 255, 0, 255]), 255, 0, true)],
    [0, 255, 0, 128],
  );
  const p = blank(2, 1);
  p.frames[0].cels[0].set([255, 0, 0, 128, 0, 0, 0, 0]);
  p.layers.push({ name: 'clip', visible: true, opacity: 255, clipping: true });
  p.frames[0].cels.push(pixel([0, 255, 0, 255, 0, 255, 0, 255]));
  assert.deepEqual([...composite(p, 0)], [0, 255, 0, 128, 0, 0, 0, 0]);
  p.layers[0].visible = false;
  assert.ok(composite(p, 0).every((v) => v === 0));
});
test('mask and adjustments are nondestructive, deep cloned, saved and validated', () => {
  const p = blank(2, 1);
  p.frames[0].cels[0].set([200, 100, 50, 255, 200, 100, 50, 255]);
  p.layers[0].mask = pixel([0, 128]);
  p.layers[0].adjustments = { saturation: 0 };
  const q = clone(p);
  q.layers[0].mask[0] = 255;
  q.layers[0].adjustments.saturation = 200;
  assert.equal(p.layers[0].mask[0], 0);
  assert.equal(p.layers[0].adjustments.saturation, 0);
  const result = composite(p, 0);
  assert.equal(result[3], 0);
  assert.equal(result[7], 128);
  assert.equal(result[4], result[5]);
  assert.equal(p.frames[0].cels[0][0], 200);
  assert.deepEqual(deserialize(serialize(p)), p);
  assert.throws(() => validate({ ...p, layers: [{ ...p.layers[0], mask: pixel([255]) }] }), /遮罩/);
  assert.throws(() => validate({ ...p, layers: [{ ...p.layers[0], blend: 19 }] }), /混合/);
  p.layers[0].maskEnabled = false;
  assert.equal(composite(p, 0)[3], 255);
  p.layers[0].maskEnabled = true;
  applyMask(p, 0);
  assert.equal(p.layers[0].mask, undefined);
  assert.equal(p.frames[0].cels[0][7], 128);
});
test('ASE keeps blend modes and bakes mask, color edits and chained clipping without changing the image', async () => {
  for (let mode = 0; mode < 19; mode++) {
    const p = blank(2, 1);
    p.layers[0].opacity = 153;
    p.layers[0].mask = pixel([255, 170]);
    p.layers[0].adjustments = { hue: 30, brightness: 5 };
    p.frames[0].cels[0].set([180, 60, 20, 128, 90, 160, 220, 80]);
    p.layers.push(
      { name: 'clip A', visible: true, opacity: 127, clipping: true, blend: mode },
      { name: 'clip B', visible: true, opacity: 213, clipping: true, blend: 2 },
    );
    p.frames[0].cels.push(
      pixel([20, 220, 100, 255, 160, 100, 80, 200]),
      pixel([100, 40, 210, 100, 200, 10, 60, 255]),
    );
    p.frames.push({ duration: 80, cels: p.frames[0].cels.map((c) => new Uint8ClampedArray(c)) });
    const original = clone(p),
      q = (await readAse(writeAse(p).buffer)).project;
    assert.equal(q.layers.length, 1);
    for (let f = 0; f < 2; f++) assert.deepEqual(composite(q, f), composite(p, f), 'mode ' + mode);
    assert.deepEqual(p, original);
  }
  const p = blank(1, 1);
  p.layers[0].blend = 9;
  assert.equal((await readAse(writeAse(p).buffer)).project.layers[0].blend, 9);
});
test('fixed opacity caps one stroke and builds up only after a new stroke; alpha lock and erasing respect coverage', () => {
  const base = pixel([0, 0, 0, 0]),
    out = pixel(base),
    coverage = new Uint8Array(1);
  for (let i = 0; i < 20; i++) paintPixel(out, base, 0, [255, 0, 0], 0.5, { coverage });
  assert.deepEqual([...out], [255, 0, 0, 128]);
  const next = pixel(out);
  paintPixel(next, out, 0, [255, 0, 0], 0.5);
  assert.equal(next[3], 192);
  paintPixel(next, out, 0, [0, 0, 255], 1, { alphaLock: true });
  assert.deepEqual([...next], [0, 0, 255, 128]);
  paintPixel(next, out, 0, [0, 0, 0], 0.5, { erase: true });
  assert.equal(next[3], 64);
  paintPixel(next, base, 0, [255, 0, 0], 1, { alphaLock: true });
  assert.equal(next[3], 64);
});
test('pressure response is monotonic, configurable and accepts a zero-pressure sample', () => {
  const curve = normalizeCurve([0, 0.5, 0.75, 0.9, 1]);
  assert.equal(pressureResponse(0.25, curve), 0.5);
  assert.equal(pressureResponse(0, curve), 0);
  assert.equal(strokeOpacity({ pointerType: 'pen', pressure: 0 }, 0.5, true, curve), 0);
  assert.equal(strokeOpacity({ pointerType: 'mouse', pressure: 0 }, 0.5, true, curve), 0.5);
  assert.deepEqual(normalizeCurve([0, 0.7, 0.2, 0.9, 1]), [0, 0.7, 0.7, 0.9, 1]);
});
test('gradient endpoints, radial symmetry, transparency, steps and selection are deterministic', () => {
  const options = { type: 'linear', from: [255, 0, 0], to: [0, 0, 255], opacity: 1, steps: 0 };
  let out = applyGradient(new Uint8ClampedArray(20), 5, 1, { x: 0, y: 0 }, { x: 4, y: 0 }, options);
  assert.deepEqual([...out.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...out.slice(16, 20)], [0, 0, 255, 255]);
  assert.deepEqual([...out.slice(8, 12)], [128, 0, 128, 255]);
  out = applyGradient(
    new Uint8ClampedArray(20),
    5,
    1,
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { ...options, transparent: true },
    { selection: new Uint8Array([1, 0, 1, 0, 1]) },
  );
  assert.equal(out[7], 0);
  assert.equal(out[11], 128);
  assert.equal(out[19], 0);
  assert.equal(
    gradientAmount(1, 3, { x: 3, y: 3 }, { x: 5, y: 3 }, { type: 'radial' }),
    gradientAmount(3, 1, { x: 3, y: 3 }, { x: 5, y: 3 }, { type: 'radial' }),
  );
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      assert.ok(
        [0, 1 / 3, 2 / 3, 1].includes(
          gradientAmount(
            x,
            y,
            { x: 0, y: 0 },
            { x: 7, y: 0 },
            { type: 'linear', steps: 4, dither: true },
          ),
        ),
      );
});
test('mask brush and mask gradient use grayscale coverage without overwriting source pixels', () => {
  const base = pixel([255, 255, 255]),
    out = pixel(base),
    coverage = new Uint8Array(3);
  paintMask(out, base, 1, 0, 0.5, coverage);
  paintMask(out, base, 1, 0, 0.5, coverage);
  assert.equal(out[1], 127);
  assert.deepEqual(
    [
      ...applyGradient(
        base,
        3,
        1,
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { from: [0, 0, 0], to: [255, 255, 255] },
        { mask: true },
      ),
    ],
    [0, 128, 255],
  );
  assert.deepEqual(adjustedRgb([255, 0, 0], { hue: 120 }), [0, 255, 0]);
});
