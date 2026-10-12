import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, projectUsage, mebibytes } from '../dist/limits.js';

const project = (w, h, layers, frames) => ({
  w,
  h,
  layers: Array(layers),
  frames: Array(frames),
});

test('capacity reports pixel bytes and the limiting layer/frame budget', () => {
  const usage = projectUsage(project(512, 512, 3, 10));
  assert.equal(usage.pixels, 7_864_320);
  assert.equal(usage.bytes, 31_457_280);
  assert.equal(usage.moreLayers, 0);
  assert.equal(usage.moreFrames, 0);
  assert.ok(usage.ratio > 0.98);
  assert.equal(mebibytes(usage.bytes), '30.0 MiB');
});

test('small canvases still respect layer and frame count limits', () => {
  const usage = projectUsage(project(16, 16, 2, 4));
  assert.equal(usage.moreLayers, LIMITS.layers - 2);
  assert.equal(usage.moreFrames, LIMITS.frames - 4);
  assert.equal(projectUsage(project(1, 1, 32, 1)).ratio, 1);
  assert.equal(projectUsage(project(1, 1, 1, 240)).ratio, 1);
});

test('remaining capacity never promises an allocation over the pixel budget', () => {
  for (const [w, h, layers, frames] of [
    [160, 112, 3, 6],
    [256, 256, 4, 20],
    [512, 512, 1, 30],
  ]) {
    const usage = projectUsage(project(w, h, layers, frames));
    const maxLayers = layers + usage.moreLayers,
      maxFrames = frames + usage.moreFrames;
    assert.ok(w * h * maxLayers * frames <= LIMITS.pixels);
    assert.ok(w * h * layers * maxFrames <= LIMITS.pixels);
    if (maxLayers < LIMITS.layers) assert.ok(w * h * (maxLayers + 1) * frames > LIMITS.pixels);
    if (maxFrames < LIMITS.frames) assert.ok(w * h * layers * (maxFrames + 1) > LIMITS.pixels);
  }
});
