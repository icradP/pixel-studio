import test from 'node:test';
import assert from 'node:assert/strict';
import { packBytes, unpackBytes } from '../dist/byte-pack.js';
import {
  packCel,
  readCel,
  editCel,
  compactProject,
  storageBytes,
  decodeCacheBytes,
} from '../dist/cel-storage.js';
import { blank, clone, serialize, deserialize, composite, validate } from '../dist/engine.js';
import { encodeProjectFile, decodeProjectFile } from '../dist/project-file.js';
import { createScene } from '../dist/procedural-model.js';
import { createObject, bakeScene, compileScene, evaluateScene } from '../dist/procedural.js';
import { drawBatch } from '../dist/editor-drawing.js';
import { createHistory } from '../dist/history.js';
import { importKind } from '../dist/file-import.js';
import { writeAse } from '../dist/ase.js';

test('byte dictionary roundtrips random, repeated and overlapping sequences; rejects corrupt bounds', () => {
  let seed = 123456;
  for (const n of [0, 1, 2, 3, 4, 16, 255, 256, 65536, 100000]) {
    for (const mode of [0, 1, 2]) {
      const input = Uint8Array.from({ length: n }, (_, i) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return mode === 0 ? seed >>> 24 : mode === 1 ? i % 37 : 0;
      });
      assert.deepEqual(unpackBytes(packBytes(input), n), input);
    }
  }
  assert.throws(() => unpackBytes(new Uint8Array([0, 0, 0]), 4), /参考/);
  assert.throws(() => unpackBytes(new Uint8Array([240]), 4), /完整/);
  assert.throws(() => unpackBytes(new Uint8Array([0]), 999999999), /长度/);
});
test('RGBA compression retains invisible RGB and alpha exactly, XOR is independent of reference editing', () => {
  const pixels = Uint8ClampedArray.from({ length: 4096 }, (_, i) => i % 21),
    a = packCel(pixels),
    bPixels = new Uint8ClampedArray(pixels);
  bPixels.set([123, 99, 0, 0], 100);
  const b = packCel(bPixels, a);
  assert.deepEqual(readCel(a), pixels);
  assert.deepEqual(readCel(b), bPixels);
  const f = { cels: [a, b] };
  editCel(f, 0)[100] = 88;
  assert.equal(readCel(b)[100], 123);
  assert.equal(readCel(a)[100], pixels[100]);
});
test('compressed project deduplicates blank cels, shares immutable snapshots and edits one cel only', () => {
  const p = blank(32, 32);
  p.frames.push({ ...p.frames[0], cels: [new Uint8ClampedArray(p.frames[0].cels[0])] });
  p.frames[0].cels[0].set([99, 10, 12, 0], 0);
  const compressed = compactProject(p),
    before = serialize(compressed),
    copy = clone(compressed);
  drawBatch(
    copy,
    { frame: 0, layer: 0, commands: [{ type: 'pixel', x: 0, y: 0, color: '#ffaa88' }] },
    null,
  );
  assert.equal(serialize(compressed), before);
  assert.equal(readCel(copy.frames[1].cels[0])[3], 0);
  assert.deepEqual(composite(deserialize(serialize(copy)), 0), composite(copy, 0));
  assert.ok(storageBytes(compressed) < (p.w * p.h * 4) / 4);
  const h = createHistory();
  h.checkpoint(compressed);
  const restored = h.undo(copy);
  assert.equal(serialize(restored), before);
});
test('compressed pixel files read gzip and legacy JSON and reject invalid pools before expanding', async () => {
  const p = blank(64, 64);
  p.frames[0].cels[0].set([33, 44, 55, 0], 4);
  const file = await encodeProjectFile(p),
    decoded = await decodeProjectFile(file);
  assert.deepEqual(decoded, p);
  assert.ok(file.size < 1000);
  assert.equal(await importKind(file), 'project');
  const legacy = {
    ...p,
    frames: [{ ...p.frames[0], cels: [Buffer.from(p.frames[0].cels[0]).toString('base64')] }],
  };
  assert.deepEqual(await decodeProjectFile(new Blob([JSON.stringify(legacy)])), p);
  const invalid = JSON.parse(serialize(compactProject(p)));
  invalid.pool[0].encoding = 'xor32';
  invalid.pool[0].base = 0;
  assert.throws(() => deserialize(JSON.stringify(invalid)), /参考/);
});
test('120-frame compact merged bake is exact, editable and bounded; selected bake excludes other objects', async () => {
  const p = blank(256, 128);
  p.layers.push({ name: 'second', opacity: 255, visible: true });
  p.frames[0].cels.push(new Uint8ClampedArray(256 * 128 * 4));
  p.frames[0].cels[0].set([120, 80, 90, 255], 5000 * 4);
  p.frames[0].cels[1].set([10, 240, 90, 200], 6000 * 4);
  const s = createScene(p, 0);
  p.procedural = s;
  s.duration = 4;
  s.range = [0, 4];
  s.fps = 30;
  s.objects.push(createObject(p, s, [0], null, 'A'));
  s.objects.push(createObject(p, s, [1], null, 'B'));
  s.objects[0].tracks.rotation = [
    { t: 0, v: 0 },
    { t: 4, v: 180 },
  ];
  const c = compileScene(p, s),
    result = await bakeScene(
      p,
      s,
      { mode: 'composite' },
      () => {},
      async () => {},
    );
  assert.equal(result.project.storage, 'packed');
  assert.equal(result.project.frames.length, 121);
  assert.throws(() => writeAse(result.project), /Aseprite 导出预算/);
  for (let i = 0; i < 120; i++)
    assert.deepEqual(composite(result.project, result.frame + i), evaluateScene(c, s, i / 30));
  assert.ok(storageBytes(result.project) < 1024 * 1024);
  assert.ok(decodeCacheBytes() <= 16 * 1024 * 1024);
  const selected = await bakeScene(
    p,
    s,
    { mode: 'composite', objectIds: [s.objects[1].id] },
    () => {},
    async () => {},
  );
  assert.deepEqual(
    composite(selected.project, selected.frame),
    evaluateScene(c, s, 0, { objectIds: [s.objects[1].id] }),
  );
  const copied = clone(result.project);
  drawBatch(
    copied,
    {
      frame: result.frame,
      layer: result.layer,
      commands: [{ type: 'pixel', x: 0, y: 0, color: '#ff0000' }],
    },
    null,
  );
  assert.equal(composite(copied, result.frame)[0], 255);
  assert.equal(composite(result.project, result.frame)[3], 0);
  validate(copied);
});
