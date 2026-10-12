import test from 'node:test';
import assert from 'node:assert/strict';
import { blank, validate, serialize, deserialize } from '../dist/engine.js';
import { readAse, writeAse } from '../dist/ase.js';
import { projectUsage } from '../dist/limits.js';
import { canvasPoint } from '../dist/camera.js';
import { pinchCamera } from '../dist/gestures.js';
import { proportionalExpansion, expansionSize, expandCanvas } from '../dist/canvas-resize.js';

test('1024 canvases preserve boundary pixels through project and Aseprite round trips and retain bounded capacity', async () => {
  const p = blank(1024, 1024);
  p.frames[0].cels[0].set([10, 40, 70, 255], (1024 * 1024 - 1) * 4);
  validate(p);
  assert.deepEqual(deserialize(serialize(p)), p);
  const result = await readAse(writeAse(p).buffer);
  assert.equal(result.project.w, 1024);
  assert.deepEqual(result.project.frames[0].cels[0], p.frames[0].cels[0]);
  assert.equal(projectUsage(p).moreLayers, 6);
  assert.equal(projectUsage(p).moreFrames, 6);
  assert.throws(() => validate({ ...p, w: 1025 }));
});
test('proportional expansion anchors original pixels without resampling and validates capacity before allocation', () => {
  const p = blank(3, 5);
  p.frames[0].cels[0].set([3, 4, 5, 255]);
  for (const anchor of [
    [0, 0],
    [0.5, 0.5],
    [1, 1],
  ]) {
    const sides = proportionalExpansion(p, 200, anchor),
      result = expandCanvas(p, sides);
    assert.equal(result.w, 6);
    assert.equal(result.h, 10);
    assert.deepEqual(
      [
        ...result.frames[0].cels[0].slice(
          (sides.top * 6 + sides.left) * 4,
          (sides.top * 6 + sides.left) * 4 + 4,
        ),
      ],
      [3, 4, 5, 255],
    );
    assert.equal(result.frames[0].cels[0].filter((v, i) => i % 4 === 3 && v > 0).length, 1);
  }
  for (const percent of [0, 99, 801, NaN]) assert.throws(() => proportionalExpansion(p, percent));
  assert.throws(
    () =>
      expansionSize(
        { w: 1024, h: 1024, layers: [{}], frames: [{}] },
        proportionalExpansion({ w: 1024, h: 1024 }, 125),
      ),
    /最大/,
  );
  const many = { w: 512, h: 512, layers: Array(8), frames: [{}] };
  assert.throws(() => expansionSize(many, proportionalExpansion(many, 200)), /800 万/);
});
test('mirrored and rotated view coordinates map back to exact artwork coordinates', () => {
  for (const flipX of [true, false])
    for (const flipY of [true, false])
      for (const angle of [0, Math.PI / 2, 0.74]) {
        const c = { x: 30, y: -50, scale: 2.3, angle, flipX, flipY };
        const p = { x: 913.5, y: 70.5 },
          x = (p.x - 512) * (flipX ? -1 : 1) * c.scale,
          y = (p.y - 256) * (flipY ? -1 : 1) * c.scale;
        const result = canvasPoint(
          {
            x: c.x + x * Math.cos(angle) - y * Math.sin(angle),
            y: c.y + x * Math.sin(angle) + y * Math.cos(angle),
          },
          c,
          1024,
          512,
        );
        assert.ok(Math.abs(result.x - p.x) < 1e-9);
        assert.ok(Math.abs(result.y - p.y) < 1e-9);
      }
});
test('pinch zoom retains mirror orientation and supports fitting 1024 canvases on narrow displays', () => {
  const result = pinchCamera(
    { x: 0, y: 0, scale: 0.2, angle: 0, flipX: true, flipY: false },
    { x: 0, y: 0, distance: 100, angle: 0 },
    { x: 10, y: 20, distance: 50, angle: 0.4 },
  );
  assert.equal(result.scale, 0.1);
  assert.equal(result.flipX, true);
  assert.equal(result.flipY, false);
  assert.equal(result.x, 10);
  assert.equal(result.y, 20);
});
