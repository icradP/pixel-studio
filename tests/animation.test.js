import test from 'node:test';
import assert from 'node:assert/strict';
import { blank, clone, composite, validate, serialize, deserialize } from '../dist/engine.js';
import { readAse, writeAse } from '../dist/ase.js';
import { tagSequence, shiftTags, layerOrder } from '../dist/animation.js';
const tag = (from, to, direction = 0) => ({
  name: 'run',
  from,
  to,
  direction,
  repeat: 0,
  color: '#75aabb',
});
test('nested groups and overlapping tags survive Aseprite and project round trips', async () => {
  const p = blank(2, 2, '导入的 Aseprite');
  p.layers = [
    { name: 'base', visible: true, opacity: 128, group: true, isolated: true },
    { name: 'child', visible: true, opacity: 255, level: 1, locked: true },
  ];
  p.frames = [
    {
      duration: 100,
      cels: [
        new Uint8ClampedArray(16),
        new Uint8ClampedArray([255, 0, 0, 255, ...Array(12).fill(0)]),
      ],
    },
    { duration: 150, cels: [new Uint8ClampedArray(16), new Uint8ClampedArray(16)] },
  ];
  p.tags = [tag(0, 1), { ...tag(1, 1, 2), name: 'attack', repeat: 3 }];
  assert.deepEqual((await readAse(writeAse(p).buffer)).project, p);
  assert.deepEqual(deserialize(serialize(p)), p);
  const q = clone(p);
  q.tags[0].name = 'changed';
  assert.equal(p.tags[0].name, 'run');
  assert.deepEqual([...composite(p, 0).slice(0, 4)], [255, 0, 0, 128]);
  p.layers[0].visible = false;
  assert.equal(composite(p, 0).some(Boolean), false);
});
test('legacy group visibility and layer display order include children correctly', () => {
  const layers = [
    { name: 'floor' },
    { name: 'base', group: true, isolated: false },
    { name: 'a', level: 1 },
    { name: 'nested', group: true, level: 1 },
    { name: 'b', level: 2 },
    { name: 'top' },
  ];
  assert.deepEqual(layerOrder(layers), [5, 1, 3, 4, 2, 0]);
  const p = blank(1, 1);
  p.layers = [
    { name: 'group', group: true, isolated: false, visible: false, opacity: 255 },
    { name: 'child', level: 1, visible: true, opacity: 255 },
  ];
  p.frames[0].cels = [new Uint8ClampedArray(4), new Uint8ClampedArray([255, 20, 30, 255])];
  assert.deepEqual([...composite(p, 0)], [0, 0, 0, 0]);
  p.layers[0].visible = true;
  assert.deepEqual([...composite(p, 0)], [255, 20, 30, 255]);
  assert.throws(() => validate({ ...p, layers: [{ ...p.layers[1], level: 2 }] }), /层级/);
});
test('tag playback directions stay within their section', () => {
  assert.deepEqual(tagSequence(tag(2, 5), 8), [2, 3, 4, 5]);
  assert.deepEqual(tagSequence(tag(2, 5, 1), 8), [5, 4, 3, 2]);
  assert.deepEqual(tagSequence(tag(2, 5, 2), 8), [2, 3, 4, 5, 4, 3]);
  assert.deepEqual(tagSequence(tag(2, 5, 3), 8), [5, 4, 3, 2, 3, 4]);
  assert.deepEqual(tagSequence(tag(2, 2, 2), 8), [2]);
});
test('inserting and deleting frames updates overlapping tag ranges', () => {
  const p = { tags: [tag(0, 3), tag(2, 2), tag(5, 6)] };
  shiftTags(p, 2);
  assert.deepEqual(
    p.tags.map((t) => [t.from, t.to]),
    [
      [0, 4],
      [3, 3],
      [6, 7],
    ],
  );
  shiftTags(p, 3, true);
  assert.deepEqual(
    p.tags.map((t) => [t.from, t.to]),
    [
      [0, 3],
      [5, 6],
    ],
  );
  const q = blank();
  q.tags = [tag(0, 1)];
  assert.throws(() => validate(q), /标签/);
});
test('linked cel uses its own placement and opacity rather than source canvas placement', async () => {
  const p = blank(4, 2);
  p.frames[0].cels[0].set([255, 30, 20, 255], 4);
  p.frames.push({ duration: 150, cels: [new Uint8ClampedArray(32)] });
  const original = writeAse(p),
    v = new DataView(original.buffer),
    frame2 = 128 + v.getUint32(128, true),
    cel = frame2 + 16;
  const bytes = original.slice(0, cel + 24),
    d = new DataView(bytes.buffer);
  d.setUint32(0, bytes.length, true);
  d.setUint32(frame2, 40, true);
  d.setUint32(cel, 24, true);
  d.setInt16(cel + 8, 2, true);
  d.setInt16(cel + 10, 1, true);
  d.setUint8(cel + 12, 128);
  d.setUint16(cel + 13, 1, true);
  d.setUint16(cel + 22, 0, true);
  const q = (await readAse(bytes.buffer)).project;
  assert.deepEqual([...q.frames[1].cels[0].slice(28, 32)], [255, 30, 20, 128]);
  assert.equal(q.frames[1].cels[0].filter((x, i) => i % 4 === 3 && x > 0).length, 1);
  d.setUint16(cel + 22, 1, true);
  await assert.rejects(readAse(bytes.buffer), /循环链接/);
});
