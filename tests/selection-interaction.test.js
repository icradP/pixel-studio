import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionHistory } from '../dist/selection-history.js';
import { createWandSampler } from '../dist/selection.js';

test('selection history restores clear, owns snapshots and discards a redo branch', () => {
  const history = createSelectionHistory();
  const a = new Uint8Array([1, 0, 0]),
    b = new Uint8Array([1, 1, 0]);
  history.checkpoint(null, a);
  history.checkpoint(a, b);
  a[0] = 0;
  assert.deepEqual(history.undo(b).mask, new Uint8Array([1, 0, 0]));
  assert.deepEqual(history.redo(new Uint8Array([1, 0, 0])).mask, b);
  history.checkpoint(b, null);
  assert.deepEqual(history.undo(null).mask, b);
  history.checkpoint(b, new Uint8Array([0, 0, 1]));
  assert.equal(history.canRedo, false);
  history.clear();
  assert.equal(history.canUndo, false);
});
test('selection history ignores empty and unchanged gestures and bounds combined snapshots', () => {
  const history = createSelectionHistory({ steps: 2, bytes: 4 });
  assert.equal(history.checkpoint(null, new Uint8Array(4)), false);
  const a = new Uint8Array([1, 0, 0, 0]),
    b = new Uint8Array([1, 1, 0, 0]),
    c = new Uint8Array([1, 1, 1, 0]);
  history.checkpoint(null, a);
  history.checkpoint(a, b);
  history.checkpoint(b, c);
  assert.deepEqual(history.undo(c).mask, b);
  assert.equal(history.canUndo, false);
  assert.deepEqual(history.redo(b).mask, c);
});
test('reusable wand sampling grows and shrinks without retaining visited pixels or source mutations', () => {
  const pixels = Uint8ClampedArray.from([
    100, 0, 0, 255, 120, 0, 0, 255, 200, 0, 0, 255, 100, 0, 0, 255,
  ]);
  const sample = createWandSampler(pixels, 4, 1, 0, 0);
  assert.deepEqual([...sample(0)], [1, 0, 0, 0]);
  assert.deepEqual([...sample(10)], [1, 1, 0, 0]);
  assert.deepEqual([...sample(40)], [1, 1, 1, 1]);
  pixels.fill(0);
  assert.deepEqual([...sample(0)], [1, 0, 0, 0]);
  assert.deepEqual([...sample(10)], [1, 1, 0, 0]);
});
test('global sampling preserves alpha boundaries, exact threshold endpoints and off-canvas seeds', () => {
  const pixels = Uint8ClampedArray.from([100, 0, 0, 255, 100, 0, 0, 0, 100, 0, 0, 255]);
  const sample = createWandSampler(pixels, 3, 1, 0, 0, { contiguous: false });
  assert.deepEqual([...sample(0)], [1, 0, 1]);
  assert.deepEqual([...sample(100)], [1, 1, 1]);
  assert.deepEqual([...sample(NaN)], [1, 0, 1]);
  assert.deepEqual([...createWandSampler(pixels, 3, 1, -1, 0)(100)], [0, 0, 0]);
});

test('undo retains a bounded, independent sampling origin so a restored selection can be refined', () => {
  const h = createSelectionHistory({ bytes: 16 });
  const a = new Uint8Array([1, 0, 0, 0]),
    b = new Uint8Array([1, 1, 0, 0]);
  const wand = { p: { x: 0, y: 0 }, before: new Uint8Array(4), tolerance: 10, mode: 'add' };
  h.checkpoint(a, b, { beforeWand: wand });
  wand.p.x = 3;
  wand.before.fill(1);
  const restored = h.undo(b, { ...wand, tolerance: 20 });
  assert.equal(restored.wand.p.x, 0);
  assert.equal(restored.wand.before.some(Boolean), false);
  assert.equal(restored.wand.tolerance, 10);
  assert.equal(h.redo(restored.mask, restored.wand).wand.tolerance, 20);
});
