import test from 'node:test';
import assert from 'node:assert/strict';
import { blank, clone, validate } from '../dist/engine.js';
import { addLayer, editFrames } from '../dist/animation-edit.js';
import { compactProject, readCel } from '../dist/cel-storage.js';
import { copySelectionLayer } from '../dist/selection-layer.js';

test('copy selection preserves exact selected RGBA, holes and source; other frames stay empty', () => {
  let p = blank(8, 8);
  const source = p.frames[0].cels[0];
  source.set([10, 20, 30, 128], 36);
  source.set([40, 50, 60, 255], 40);
  source.set([70, 80, 90, 0], 44);
  editFrames(p, 'duplicate', 0);
  addLayer(p, 0);
  p = compactProject(p);
  const before = clone(p),
    mask = new Uint8Array(64);
  mask[9] = mask[11] = 1;
  const at = copySelectionLayer(p, 0, 0, mask);
  assert.equal(at, 1);
  assert.deepEqual(readCel(p.frames[0].cels[0]), readCel(before.frames[0].cels[0]));
  assert.deepEqual(readCel(p.frames[1].cels[0]), readCel(before.frames[1].cels[0]));
  assert.deepEqual(
    [...readCel(p.frames[0].cels[at]).slice(36, 48)],
    [10, 20, 30, 128, 0, 0, 0, 0, 70, 80, 90, 0],
  );
  assert.equal(readCel(p.frames[1].cels[at]).some(Boolean), false);
  validate(p);
});

test('copy selection bakes mask and adjustment, inherits opacity, and permits alpha-locked source', () => {
  const p = blank(4, 4),
    mask = new Uint8Array(16);
  p.frames[0].cels[0].set([100, 20, 30, 200]);
  Object.assign(p.layers[0], {
    alphaLock: true,
    opacity: 120,
    mask: new Uint8ClampedArray(16).fill(128),
    adjustments: { brightness: 10 },
  });
  mask[0] = 1;
  const at = copySelectionLayer(p, 0, 0, mask),
    target = p.layers[at];
  assert.equal(p.frames[0].cels[at][3], 100);
  assert.ok(p.frames[0].cels[at][0] > 100);
  assert.equal(target.opacity, 120);
  assert.equal(target.mask, undefined);
  assert.equal(target.adjustments, undefined);
  assert.equal(target.alphaLock, undefined);
  assert.equal(p.frames[0].cels[0][3], 200);
});

test('copy selection keeps clipping stack and group membership; locked parent and empty pixels reject', () => {
  const p = blank(4, 4),
    mask = new Uint8Array(16).fill(1);
  const group = addLayer(p, 0, true),
    base = addLayer(p, group),
    clipped = addLayer(p, group);
  p.layers[clipped].clipping = true;
  p.frames[0].cels[base][3] = 255;
  const at = copySelectionLayer(p, 0, base, mask);
  assert.equal(at, clipped + 1);
  assert.equal(p.layers[at].level, 1);
  assert.equal(p.layers[clipped].clipping, true);
  const count = p.layers.length;
  p.layers[group].locked = true;
  assert.throws(() => copySelectionLayer(p, 0, base, mask), /解锁/);
  p.layers[group].locked = false;
  assert.throws(() => copySelectionLayer(p, 0, clipped, mask), /没有可拷贝/);
  assert.throws(() => copySelectionLayer(p, 0, group, mask), /像素图层/);
  assert.equal(p.layers.length, count);
});
