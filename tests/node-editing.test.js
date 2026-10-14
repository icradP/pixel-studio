import test from 'node:test';
import assert from 'node:assert/strict';
import { insertPathNode, subdividePath, subdivideCurve } from '../dist/node-editing.js';
import { bezier, curveValue } from '../dist/procedural-path.js';
import { pathNode } from '../dist/procedural-model.js';
import { normalizeCurve, pressureKeys, pressureResponse } from '../dist/paint.js';
import { mergeUp } from '../dist/layer-actions.js';
import { blank, composite } from '../dist/engine.js';

test('Bézier insertion preserves every sampled location and does not mutate source handles', () => {
  const path = [pathNode(0, 0), pathNode(100, 0)];
  path[0].out = { x: 0, y: 100 };
  path[1].in = { x: 100, y: -50 };
  const before = structuredClone(path),
    out = insertPathNode(path, 0, 0.37);
  for (let i = 0; i <= 100; i++) {
    const t = i / 100,
      a = bezier(...path, t),
      b = t <= 0.37 ? bezier(out[0], out[1], t / 0.37) : bezier(out[1], out[2], (t - 0.37) / 0.63);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-10);
  }
  assert.deepEqual(path, before);
  const dense = subdividePath(path, 12);
  assert.ok(dense.length > 8 && dense.length <= 64);
  assert.throws(() => subdividePath(path, 0.001), /64/);
  assert.throws(() => subdividePath(path, 0));
});
test('batch keys retain original corners, endpoints and interpolation at arbitrary times', () => {
  const keys = [
      { t: 0, v: 0 },
      { t: 0.37, v: 0.9 },
      { t: 1, v: 1 },
    ],
    out = subdivideCurve(keys, 0.1);
  assert.ok(out.some((k) => k.t === 0.37));
  assert.equal(out.at(-1).t, 1);
  for (let i = 0; i < 1000; i++)
    assert.ok(Math.abs(curveValue(keys, i / 999) - curveValue(out, i / 999)) < 1e-10);
  assert.throws(() => subdivideCurve(keys, 0.0001), /128/);
});
test('arbitrary brush pressure nodes stay monotone, preserve old presets and survive serialization', () => {
  const old = [0, 0.5, 0.75, 0.9, 1],
    keys = normalizeCurve(subdivideCurve(pressureKeys(old), 0.1));
  for (let i = 0; i <= 100; i++)
    assert.ok(Math.abs(pressureResponse(i / 100, old) - pressureResponse(i / 100, keys)) < 1e-10);
  assert.deepEqual(normalizeCurve(JSON.parse(JSON.stringify(keys))), keys);
  assert.equal(
    normalizeCurve([
      { t: 0, v: 0 },
      { t: 0.3, v: 0.8 },
      { t: 0.5, v: 0.2 },
      { t: 1, v: 1 },
    ])[2].v,
    0.8,
  );
});
test('merge upward preserves all-frame composite and the lower selected layer position', () => {
  const p = blank(2, 2);
  p.layers.push({ name: 'upper', opacity: 255, visible: true });
  p.frames[0].cels.push(new Uint8ClampedArray(16));
  p.frames[0].cels[0].set([40, 80, 120, 255]);
  p.frames[0].cels[1].set([200, 30, 60, 128]);
  const before = composite(p, 0);
  assert.equal(mergeUp(p, 0), 0);
  assert.equal(p.layers.length, 1);
  assert.deepEqual(composite(p, 0), before);
  assert.throws(() => mergeUp(p, 0));
});
