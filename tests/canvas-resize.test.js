import test from 'node:test';
import assert from 'node:assert/strict';
import { blank, clone, validate } from '../dist/engine.js';
import { expansionSize, expandCanvas } from '../dist/canvas-resize.js';
import { createHistory } from '../dist/history.js';

function sample() {
  const p = blank(3, 2, '扩展测试');
  p.layers.push({ name: '锁定图层', visible: false, opacity: 128, locked: true });
  p.frames = [80, 140].map((duration, f) => ({
    duration,
    cels: [0, 1].map((l) => Uint8ClampedArray.from({ length: 24 }, (_, i) => i + f * 50 + l * 25)),
  }));
  p.tags = [{ name: '循环', from: 0, to: 1, direction: 2, color: '#ffffff', repeat: 0 }];
  return validate(p);
}
test('four-sided expansion translates all cels without resampling and leaves transparent margins', () => {
  const p = sample(),
    before = clone(p),
    next = expandCanvas(p, { left: 2, right: 4, top: 3, bottom: 1 });
  assert.equal(next.w, 9);
  assert.equal(next.h, 6);
  for (let f = 0; f < p.frames.length; f++)
    for (let l = 0; l < p.layers.length; l++) {
      const cel = next.frames[f].cels[l];
      for (let y = 0; y < next.h; y++)
        for (let x = 0; x < next.w; x++) {
          const offset = (y * next.w + x) * 4;
          const old = ((y - 3) * p.w + x - 2) * 4;
          assert.deepEqual(
            [...cel.slice(offset, offset + 4)],
            x >= 2 && x < 5 && y >= 3 && y < 5
              ? [...p.frames[f].cels[l].slice(old, old + 4)]
              : [0, 0, 0, 0],
          );
        }
    }
  assert.deepEqual(p, before);
  assert.deepEqual(next.layers, p.layers);
  assert.deepEqual(next.tags, p.tags);
  assert.deepEqual(
    next.frames.map((f) => f.duration),
    [80, 140],
  );
  next.layers[1].locked = false;
  next.tags[0].name = 'changed';
  next.frames[0].cels[0].fill(0);
  assert.deepEqual(p, before);
});
test('each individual direction can expand independently', () => {
  for (const key of ['left', 'right', 'top', 'bottom']) {
    const p = blank(1, 1);
    p.frames[0].cels[0].set([1, 2, 3, 255]);
    const next = expandCanvas(p, { [key]: 1 });
    const x = key === 'left' ? 1 : 0,
      y = key === 'top' ? 1 : 0;
    assert.deepEqual(
      [...next.frames[0].cels[0].slice((y * next.w + x) * 4, (y * next.w + x) * 4 + 4)],
      [1, 2, 3, 255],
    );
  }
});
test('invalid dimensions and total-pixel overflow reject before touching existing cels', () => {
  const p = sample(),
    before = clone(p);
  for (const sides of [{ left: -1 }, { top: 1.5 }, { right: NaN }, { bottom: 511 }, {}])
    assert.throws(() => expandCanvas(p, sides));
  assert.deepEqual(p, before);
  const large = { w: 500, h: 500, layers: Array(32), frames: [{}] };
  assert.throws(() => expansionSize(large, { left: 1 }), /800 万/);
  assert.equal(expansionSize(p, { left: 1 }).bytes, 4 * 2 * 2 * 2 * 4);
});
test('canvas expansion undo and redo restore dimensions, frames, layers and pixels', () => {
  const p = sample(),
    history = createHistory();
  history.checkpoint(clone(p));
  const expanded = expandCanvas(p, { left: 5, bottom: 7 });
  const undone = history.undo(expanded);
  assert.deepEqual(undone, p);
  assert.deepEqual(history.redo(undone), expanded);
});
