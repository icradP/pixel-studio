import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, projectUsage, mebibytes } from '../dist/limits.js';

const project = (w, h, layers, frames) => ({
  w,
  h,
  layers: Array(layers),
  frames: Array(frames),
});

test('capacity reports actual storage without a fixed layer count cap', () => {
  const usage = projectUsage(project(512, 512, 3, 10));
  assert.equal(usage.pixels, 7_864_320);
  assert.equal(usage.bytes, 31_457_280);
  assert.equal(usage.moreLayers, null);
  assert.equal(usage.moreFrames, 230);
  assert.equal(usage.ratio, usage.bytes / LIMITS.projectBytes);
  assert.equal(mebibytes(usage.bytes), '30.0 MiB');
});
test('frame and actual storage budgets are independent of layer count', () => {
  assert.equal(LIMITS.layers, undefined);
  assert.equal(LIMITS.dimension, undefined);
  assert.ok(projectUsage(project(1, 1, 1000, 1)).ratio < 1);
  assert.equal(projectUsage(project(1, 1, 1, 240)).ratio, 1);
  assert.equal(projectUsage(project(4096, 4096, 4, 1)).ratio, 1);
});
