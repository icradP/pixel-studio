import test from 'node:test';
import assert from 'node:assert/strict';
import { blank, clone, validate, serialize, deserialize, composite } from '../dist/engine.js';
import { addLayer } from '../dist/animation-edit.js';
import {
  compactProject,
  editCel,
  readCel,
  validateCel,
  storageBytes,
} from '../dist/cel-storage.js';
import { layerPreview, createLayerPreviewCache } from '../dist/layer-preview.js';
import { layerPixels } from '../dist/layer-effects.js';
import { expandCanvas } from '../dist/canvas-resize.js';
import { writeAse, readAse } from '../dist/ase.js';

test('wide canvases and 96 layers remain editable and roundtrip without a fixed count cap', async () => {
  const p = blank(2048, 16);
  for (let i = 1; i < 96; i++) addLayer(p, -1);
  editCel(p.frames[0], 95).set([40, 80, 120, 255], (2048 * 16 - 1) * 4);
  validate(p);
  const restored = deserialize(serialize(p));
  assert.equal(restored.layers.length, 96);
  assert.deepEqual(composite(restored, 0).slice(-4), new Uint8ClampedArray([40, 80, 120, 255]));
  const ase = (await readAse(writeAse(p).buffer)).project;
  assert.equal(ase.w, 2048);
  assert.equal(ase.layers.length, 96);
  assert.deepEqual(composite(ase, 0), composite(p, 0));
});

test('large empty planes and duplicated animation cels stay shared through metadata edits', () => {
  const p = blank(4096, 4096);
  for (let i = 1; i < 128; i++) addLayer(p, -1);
  p.frames = Array.from({ length: 120 }, () => ({ duration: 40, cels: [...p.frames[0].cels] }));
  validate(p);
  assert.equal(storageBytes(p), 8);
  const q = clone(p);
  q.layers[127].visible = false;
  validate(q, { reusePixels: true });
  assert.equal(q.frames[119].cels[127], p.frames[0].cels[0]);
  assert.equal(p.layers[127].visible, true);
  assert.equal(storageBytes(deserialize(serialize(q))), 8);
});

test('trusted validation still checks replacement buffers and external validation always checks data', () => {
  const p = compactProject(blank(8, 8)),
    c = p.frames[0].cels[0];
  validate(p);
  assert.doesNotThrow(() => validate(p, { reusePixels: true }));
  c.data = new Uint32Array([0x80000000, 0]);
  assert.throws(() => validate(p, { reusePixels: true }), /长度/);
  c.data = new Uint32Array([0x80000040, 0]);
  validateCel(c, 256);
  c.data[0] = 0;
  assert.throws(() => validate(p), /长度/);
});

test('tiny layer previews match nearest sampling with mask and adjustments, and cache stays bounded', () => {
  const p = blank(512, 128);
  p.frames[0].cels[0].set([210, 100, 40, 255], (64 * 512 + 256) * 4);
  p.layers[0].adjustments = { brightness: 10, hue: 30 };
  p.layers[0].mask = new Uint8ClampedArray(512 * 128).fill(128);
  const full = layerPixels(p, 0, 0),
    preview = layerPreview(p, 0, 0);
  assert.ok(preview.width <= 72 && preview.height <= 72);
  for (let y = 0; y < preview.height; y++)
    for (let x = 0; x < preview.width; x++) {
      const source =
        (Math.floor(((y + 0.5) * p.h) / preview.height) * p.w +
          Math.floor(((x + 0.5) * p.w) / preview.width)) *
        4;
      const at = (y * preview.width + x) * 4;
      assert.deepEqual(preview.data.slice(at, at + 4), full.slice(source, source + 4));
    }
  const packed = compactProject(p),
    cache = createLayerPreviewCache(8192);
  const first = cache.get(packed, 0, 0, 0);
  packed.layers[0].visible = false;
  assert.equal(cache.get(packed, 0, 0, 0), first);
  delete packed.layers[0].adjustments;
  assert.notEqual(cache.get(packed, 0, 0, 0), first);
  cache.get(compactProject(blank(72, 72)), 0, 0, 0);
  assert.ok(cache.bytes <= 8192);
  cache.clear();
  assert.equal(cache.bytes, 0);
});

test('expanded packed transparent pixels retain invisible RGB and editing a shared cel stays isolated', () => {
  const p = blank(2, 1);
  p.frames[0].cels[0].set([99, 88, 77, 0, 99, 88, 77, 0]);
  const packed = compactProject(p);
  packed.frames.push({ duration: 120, cels: [...packed.frames[0].cels] });
  const next = expandCanvas(packed, { right: 2048 });
  assert.deepEqual(readCel(next.frames[0].cels[0]).slice(0, 8), p.frames[0].cels[0]);
  assert.equal(next.frames[0].cels[0], next.frames[1].cels[0]);
  editCel(next.frames[0], 0)[0] = 15;
  assert.equal(readCel(next.frames[1].cels[0])[0], 99);
});

test('clipped compositing does not modify shared source planes or hidden groups', () => {
  const p = blank(1, 1);
  p.frames[0].cels[0].set([250, 20, 30, 255]);
  addLayer(p, -1);
  p.layers[1].clipping = true;
  p.frames[0].cels[1].set([20, 240, 30, 255]);
  const before = serialize(p);
  assert.deepEqual(composite(p, 0), new Uint8ClampedArray([20, 240, 30, 255]));
  assert.equal(serialize(p), before);
});
