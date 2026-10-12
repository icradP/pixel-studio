import test from 'node:test';
import assert from 'node:assert/strict';
import { blank, clone, validate, composite } from '../dist/engine.js';
import {
  editFrames,
  setDurations,
  applySpeed,
  saveTag,
  addLayer,
  groupLayer,
  ungroupLayer,
  moveLayer,
  reorderLayer,
  deleteLayer,
  parentLayer,
  layerLocked,
  visibleLayerOrder,
  copyCels,
  pasteCels,
  PlaybackClock,
} from '../dist/animation-edit.js';
import { playbackCursor, layerOrder } from '../dist/animation.js';
import { onionPixels } from '../dist/onion.js';
import { pixelSample } from '../dist/pixel-renderer.js';
import { readAse, writeAse } from '../dist/ase.js';
function fixture() {
  const p = blank(2, 1);
  p.frames = Array.from({ length: 5 }, (_, i) => ({
    duration: (i + 1) * 100,
    cels: [new Uint8ClampedArray([i * 40, 20, 30, 255, 0, 0, 0, 0])],
  }));
  p.tags = [{ name: 'walk', from: 1, to: 3, direction: 0, repeat: 0, color: '#5588ff' }];
  return p;
}
test('duplicate and delete frame ranges preserve independent pixels and update tag bounds', () => {
  const p = fixture();
  assert.equal(editFrames(p, 'duplicate', 1, 2), 3);
  assert.equal(p.frames.length, 7);
  assert.equal(p.tags[0].to, 5);
  p.frames[3].cels[0][0] = 99;
  assert.equal(p.frames[1].cels[0][0], 40);
  editFrames(p, 'delete', 1, 2);
  assert.equal(p.frames.length, 5);
  assert.deepEqual([p.tags[0].from, p.tags[0].to], [1, 3]);
  validate(p);
  assert.throws(() => editFrames(p, 'delete', 0, 4), /至少/);
});
test('move and reverse use final positions while retaining timeline tag ranges', () => {
  const p = fixture();
  editFrames(p, 'move', 1, 2, 3);
  assert.deepEqual(
    p.frames.map((f) => f.duration),
    [100, 400, 500, 200, 300],
  );
  editFrames(p, 'reverse', 1, 3);
  assert.deepEqual(
    p.frames.map((f) => f.duration),
    [100, 200, 500, 400, 300],
  );
  assert.deepEqual([p.tags[0].from, p.tags[0].to], [1, 3]);
  validate(p);
});
test('duration edits and speed bake preserve ratios; out-of-range speed bake is atomic', () => {
  const p = fixture();
  applySpeed(p, 2);
  assert.deepEqual(
    p.frames.map((f) => f.duration),
    [50, 100, 150, 200, 250],
  );
  setDurations(p, 1, 2, 80);
  const before = clone(p);
  assert.throws(() => applySpeed(p, 8), /超出/);
  assert.deepEqual(p, before);
  assert.throws(() => setDurations(p, 0, 4, NaN), /范围/);
});
test('grouping, nesting, sibling ordering, moving out and ungrouping retain all frame cels', async () => {
  const p = fixture(),
    before = p.frames.map((_, i) => composite(p, i));
  const group = groupLayer(p, 0);
  assert.equal(parentLayer(p, 1), group);
  const other = addLayer(p, group);
  p.layers[other].name = 'empty';
  const nested = groupLayer(p, other);
  assert.equal(parentLayer(p, nested + 1), nested);
  let moved = reorderLayer(p, nested, -1);
  validate(p);
  assert.equal(moved, 1);
  assert.equal(p.layers[3].name, '图层 1');
  moved = moveLayer(p, 3, 1);
  validate(p);
  assert.equal(parentLayer(p, moved), 1);
  moved = moveLayer(p, moved, -1);
  assert.equal(parentLayer(p, moved), -1);
  validate(p);
  ungroupLayer(p, 1);
  validate(p);
  p.frames.forEach((_, i) => assert.deepEqual(composite(p, i), before[i]));
  const q = (await readAse(writeAse(p).buffer)).project;
  q.frames.forEach((_, i) => assert.deepEqual(composite(q, i), before[i]));
});
test('legacy groups stay pass-through after editing and ASE export', async () => {
  const p = fixture();
  groupLayer(p, 0);
  p.layers[0].isolated = false;
  const group = addLayer(p, 0, true);
  assert.equal(p.layers[group].isolated, false);
  const q = (await readAse(writeAse(p).buffer)).project;
  assert.ok(q.layers.filter((l) => l.group).every((l) => l.isolated === false));
});
test('group locking is inherited, collapsing hides descendants, ASE preserves collapsed groups', async () => {
  const p = fixture();
  groupLayer(p, 0);
  p.layers[0].locked = true;
  p.layers[0].collapsed = true;
  assert.equal(layerLocked(p, 1), true);
  assert.deepEqual(visibleLayerOrder(p, layerOrder(p.layers)), [0]);
  const q = (await readAse(writeAse(p).buffer)).project;
  assert.equal(q.layers[0].collapsed, true);
  assert.throws(() => moveLayer(p, 0, 0), /自身/);
  assert.throws(() => deleteLayer(p, 0), /保留/);
});
test('ungroup preserves inherited visibility and locks and refuses lossy opacity', () => {
  const p = fixture();
  groupLayer(p, 0);
  p.layers[0].opacity = 120;
  assert.throws(() => ungroupLayer(p, 0), /透明度/);
  p.layers[0].opacity = 255;
  p.layers[0].locked = true;
  p.layers[0].visible = false;
  ungroupLayer(p, 0);
  assert.equal(p.layers[0].visible, false);
  assert.equal(p.layers[0].locked, true);
  validate(p);
});
test('cel copy/paste uses independent buffers, respects locks, and validates destination capacity', () => {
  const p = fixture(),
    copy = copyCels(p, 0, 0, 1);
  pasteCels(p, 0, 3, copy);
  p.frames[3].cels[0][0] = 111;
  assert.equal(copy.cels[0][0], 0);
  assert.equal(p.frames[0].cels[0][0], 0);
  assert.throws(() => pasteCels(p, 0, 4, copy), /目标帧不足/);
  groupLayer(p, 0);
  p.layers[0].locked = true;
  assert.throws(() => pasteCels(p, 1, 0, copy), /锁定/);
});
test('tag edits reject invalid ranges and preserve colors/direction/repeat in ASE', async () => {
  const p = fixture();
  const t = { name: 'attack', from: 0, to: 4, direction: 3, repeat: 5, color: '#ddaa33' };
  saveTag(p, -1, t);
  assert.throws(() => saveTag(p, 1, { ...t, to: 5 }), /区间/);
  const q = (await readAse(writeAse(p).buffer)).project;
  assert.deepEqual(
    q.tags.find((tag) => tag.name === 'attack'),
    t,
  );
});
test('ASE writes tag colors in native range order without reordering the project', async () => {
  const p = fixture();
  p.tags = [
    { name: 'last', from: 3, to: 4, direction: 0, repeat: 0, color: '#112233' },
    { name: 'short', from: 0, to: 1, direction: 0, repeat: 0, color: '#abcdef' },
    { name: 'long', from: 0, to: 4, direction: 0, repeat: 0, color: '#5588ff' },
  ];
  const expected = structuredClone(p.tags),
    q = (await readAse(writeAse(p).buffer)).project;
  assert.deepEqual(
    q.tags.map((t) => t.name),
    ['long', 'short', 'last'],
  );
  for (const t of expected)
    assert.deepEqual(
      q.tags.find((v) => v.name === t.name),
      t,
    );
  assert.deepEqual(p.tags, expected);
});
test('playback follows wall time without duration drift, handles catch-up and live speed changes', () => {
  const p = fixture(),
    clock = new PlaybackClock(0);
  let frame = 0;
  const next = () => {
    frame = (frame + 1) % 5;
    return true;
  };
  clock.advance(99, 1, () => p.frames[frame].duration, next);
  assert.equal(frame, 0);
  clock.advance(110, 1, () => p.frames[frame].duration, next);
  assert.equal(frame, 1);
  assert.equal(clock.elapsed, 10);
  clock.advance(450, 1, () => p.frames[frame].duration, next);
  assert.equal(frame, 2);
  assert.equal(clock.elapsed, 150);
  clock.advance(525, 2, () => p.frames[frame].duration, next);
  assert.equal(frame, 3);
  assert.equal(clock.elapsed, 0);
});
test('finite ping-pong repeats count each direction and retain endpoint duration', () => {
  const sequence = (repeat) => {
    const cursor = playbackCursor({ from: 1, to: 3, direction: 2, repeat }, 5, 1),
      a = [cursor.first];
    let n;
    while ((n = cursor.next()) !== null && a.length < 20) a.push(n);
    return a;
  };
  assert.deepEqual(sequence(1), [1, 2, 3]);
  assert.deepEqual(sequence(2), [1, 2, 3, 2, 1]);
  assert.deepEqual(sequence(3), [1, 2, 3, 2, 1, 2, 3]);
});
test('onion skin omits stationary opaque backgrounds and tints changing layer pixels', () => {
  const p = blank(2, 1);
  p.layers.push({ name: 'moving', visible: true, opacity: 255 });
  const bg = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);
  p.frames = [
    { duration: 100, cels: [bg, new Uint8ClampedArray([20, 30, 40, 255, 0, 0, 0, 0])] },
    {
      duration: 100,
      cels: [new Uint8ClampedArray(bg), new Uint8ClampedArray([0, 0, 0, 0, 20, 30, 40, 255])],
    },
  ];
  assert.deepEqual([...onionPixels(p, 1, 0)], [255, 95, 132, 255, 0, 0, 0, 0]);
  assert.deepEqual([...onionPixels(p, 0, 1)], [0, 0, 0, 0, 77, 227, 187, 255]);
  assert.equal(onionPixels(p, 0, -1), null);
  assert.equal(onionPixels(p, 1, 0, 0).some(Boolean), false);
  p.layers[1].visible = false;
  assert.equal(onionPixels(p, 1, 0).some(Boolean), false);
});
test('crisp preview preserves interiors and limits interpolation to a physical-pixel-wide edge', () => {
  for (const position of [0.1, 0.2, 0.5, 0.8, 0.9]) assert.equal(pixelSample(position, 0.1), 0.5);
  assert.ok(Math.abs(pixelSample(0.02, 0.1) - 0.2) < 1e-10);
  assert.ok(Math.abs(pixelSample(0.98, 0.1) - 0.8) < 1e-10);
  assert.equal(pixelSample(-0.5, 0.1), -0.5);
  assert.equal(pixelSample(0.2, 2), 0.2);
});
