import test from 'node:test';
import assert from 'node:assert/strict';
import { rectangleMask } from '../dist/plugin-core.js';
import {
  wandSelection,
  combineSelection,
  ellipseMask,
  polygonMask,
  initialTransform,
  transformSelection,
} from '../dist/selection.js';
import {
  recognizeShape,
  adjustShape,
  traceShape,
  ShapePreview,
  shapeDelay,
} from '../dist/quick-shape.js';
test('wand selects connected matching color, optional global colors and tolerance', () => {
  const pixels = Uint8ClampedArray.from([
    100, 0, 0, 255, 110, 0, 0, 255, 0, 200, 0, 255, 100, 0, 0, 255,
  ]);
  assert.deepEqual([...wandSelection(pixels, 4, 1, 0, 0, { tolerance: 0 })], [1, 0, 0, 0]);
  assert.deepEqual([...wandSelection(pixels, 4, 1, 0, 0, { tolerance: 5 })], [1, 1, 0, 0]);
  assert.deepEqual(
    [...wandSelection(pixels, 4, 1, 0, 0, { tolerance: 0, contiguous: false })],
    [1, 0, 0, 1],
  );
});
test('transparent RGB is ignored by wand; alpha boundaries remain distinct', () => {
  const p = Uint8ClampedArray.from([255, 50, 10, 0, 0, 240, 90, 0, 0, 0, 0, 255]);
  assert.deepEqual([...wandSelection(p, 3, 1, 0, 0, { tolerance: 0 })], [1, 1, 0]);
});
test('selection union, subtraction, ellipse and lasso preserve mask semantics', () => {
  const a = new Uint8Array([1, 1, 0]),
    b = new Uint8Array([0, 1, 1]);
  assert.deepEqual([...combineSelection(a, b, 'add')], [1, 1, 1]);
  assert.deepEqual([...combineSelection(a, b, 'subtract')], [1, 0, 0]);
  assert.equal(combineSelection(null, b, 'subtract'), null);
  const e = ellipseMask(5, 5, { x: 0, y: 0 }, { x: 4, y: 4 });
  assert.equal(e[0], 0);
  assert.equal(e[12], 1);
  const p = polygonMask(4, 4, [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 0, y: 3 },
  ]);
  assert.equal(p[0], 1);
  assert.equal(p[15], 0);
});
test('selection transform identity keeps exact RGBA, move reads overlap safely', () => {
  const p = Uint8ClampedArray.from([200, 0, 0, 128, 0, 200, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0]),
    mask = new Uint8Array([1, 1, 0, 0]),
    t = initialTransform(mask, 4, 1);
  assert.deepEqual(transformSelection(p, 4, 1, mask, t).pixels, p);
  const moved = transformSelection(p, 4, 1, mask, { ...t, cx: t.cx + 1 });
  assert.deepEqual([...moved.pixels], [0, 0, 0, 0, 200, 0, 0, 128, 0, 200, 0, 255, 0, 0, 0, 0]);
  assert.deepEqual([...mask], [1, 1, 0, 0]);
});
test('nearest-neighbor scale has no holes and rotation clips to canvas', () => {
  const p = new Uint8ClampedArray(6 * 6 * 4);
  p.set([255, 100, 10, 255], (2 * 6 + 2) * 4);
  const mask = rectangleMask(6, 6, { x: 2, y: 2 }, { x: 2, y: 2 }),
    t = initialTransform(mask, 6, 6);
  const scaled = transformSelection(p, 6, 6, mask, { ...t, cx: 3, cy: 3, width: 4, height: 4 });
  assert.equal(
    scaled.mask.reduce((a, b) => a + b),
    16,
  );
  assert.equal([...scaled.pixels].filter((v, i) => i % 4 === 3 && v === 255).length, 16);
  const rotated = transformSelection(p, 6, 6, mask, {
    ...t,
    width: 4,
    height: 2,
    angle: Math.PI / 2,
    cx: 0,
    cy: 0,
  });
  assert.equal(
    rotated.mask.reduce((a, b) => a + b),
    2,
  );
  assert.throws(() => transformSelection(p, 6, 6, mask, { ...t, width: 0 }));
});
test('copy preserves source and flip reverses the selected colors', () => {
  const p = Uint8ClampedArray.from([255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0]),
    mask = new Uint8Array([1, 1, 0, 0]),
    t = initialTransform(mask, 4, 1);
  assert.deepEqual(
    [...transformSelection(p, 4, 1, mask, { ...t, cx: 3, copy: true, flipX: true }).pixels],
    [255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255],
  );
});
const path = (vertices) =>
  vertices.flatMap((p, i) =>
    i
      ? Array.from({ length: 20 }, (_, j) => ({
          x: vertices[i - 1].x + ((p.x - vertices[i - 1].x) * (j + 1)) / 20,
          y: vertices[i - 1].y + ((p.y - vertices[i - 1].y) * (j + 1)) / 20,
        }))
      : [p],
  );
test('hold recognition distinguishes line, rectangle, circle and polygon', () => {
  assert.equal(
    recognizeShape(
      path([
        { x: 0, y: 0 },
        { x: 40, y: 20 },
      ]),
    ).kind,
    'line',
  );
  assert.equal(
    recognizeShape(
      path([
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 25 },
        { x: 0, y: 25 },
        { x: 0, y: 0 },
      ]),
    ).kind,
    'rectangle',
  );
  const circle = Array.from({ length: 100 }, (_, i) => ({
    x: 30 + 20 * Math.cos((i / 99) * Math.PI * 2),
    y: 30 + 20 * Math.sin((i / 99) * Math.PI * 2),
  }));
  assert.equal(recognizeShape(circle).kind, 'circle');
  assert.equal(
    recognizeShape(
      path([
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 20, y: 30 },
        { x: 0, y: 0 },
      ]),
    ).kind,
    'polygon',
  );
  assert.equal(
    recognizeShape([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]),
    null,
  );
});
test('recognized shape adjustment keeps the start anchor and scales/rotates continuously', () => {
  const shape = {
    anchor: { x: 4, y: 5 },
    points: [
      { x: 4, y: 5 },
      { x: 14, y: 5 },
    ],
  };
  assert.deepEqual(adjustShape(shape, { x: 14, y: 5 }, { x: 4, y: 25 }), [
    { x: 4, y: 5 },
    { x: 4, y: 25 },
  ]);
});
test('circle adjustments resample the analytic circle without accumulating distortion', () => {
  const raw = Array.from({ length: 129 }, (_, i) => ({
      x: 80 + 40 * Math.cos((i / 128) * Math.PI * 2),
      y: 80 + 40 * Math.sin((i / 128) * Math.PI * 2),
    })),
    circle = recognizeShape(raw),
    hold = raw.at(-1),
    current = { x: hold.x - 80, y: hold.y };
  const points = adjustShape(circle, hold, current);
  assert.ok(points.length < 200);
  assert.deepEqual(points[0], points.at(-1));
  for (const p of points) assert.ok(Math.abs(Math.hypot(p.x - 40, p.y - 80) - 80) < 0.8);
  assert.deepEqual(adjustShape(circle, hold, hold), adjustShape(circle, hold, raw[0]));
});
test('shape tracing clips distant segments and stamps each center once', () => {
  const points = [
      { x: -100000, y: 5 },
      { x: 100000, y: 5 },
      { x: 100000, y: 5 },
      { x: -100000, y: 5 },
    ],
    visited = [];
  traceShape(points, 32, 32, 0, (x, y) => visited.push([x, y]));
  assert.equal(visited.length, 32);
  assert.deepEqual(visited[0], [0, 5]);
  assert.deepEqual(visited.at(-1), [31, 5]);
});
test('shape preview coalesces updates and flushes the final sample, cancel discards it', () => {
  let cb,
    count = 0;
  const drawn = [],
    p = new ShapePreview(
      (v) => drawn.push(v),
      (fn) => {
        cb = fn;
        return ++count;
      },
      () => {},
    );
  p.push(1);
  p.push(2);
  p.push(3);
  assert.equal(count, 1);
  cb();
  assert.deepEqual(drawn, [3]);
  p.push(4);
  p.flush();
  assert.deepEqual(drawn, [3, 4]);
  p.push(5);
  p.clear();
  cb();
  assert.deepEqual(drawn, [3, 4]);
  assert.equal(shapeDelay(undefined), 800);
  assert.equal(shapeDelay(20), 200);
  assert.equal(shapeDelay(9999), 3000);
});
