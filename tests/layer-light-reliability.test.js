import test from 'node:test';
import assert from 'node:assert/strict';
import { blank, clone, composite, serialize, deserialize, validate } from '../dist/engine.js';
import { addLayer, groupLayer } from '../dist/animation-edit.js';
import { mergeLayers, dropLayer } from '../dist/layer-actions.js';
import { createScene, encodeRegion, moveSceneCanvas } from '../dist/procedural-model.js';
import { putPosition, translateLight } from '../dist/light-model.js';
import { lightState, applyLights } from '../dist/scene-effects.js';
import { compileScene, evaluateScene, bakeScene, createObject } from '../dist/procedural.js';
import { compactProject, readCel } from '../dist/cel-storage.js';
import { prepareSave } from '../dist/save-preparation.js';

function artwork() {
  const p = blank(4, 4);
  p.frames[0].cels[0].set([60, 80, 100, 255]);
  addLayer(p, -1);
  p.frames[0].cels[1].set([210, 80, 40, 128]);
  p.layers[1].blend = 1;
  p.layers[1].mask = new Uint8ClampedArray(16).fill(180);
  p.frames.push({ duration: 80, cels: p.frames[0].cels.map((c) => new Uint8ClampedArray(c)) });
  return p;
}
const light = () => ({
  id: 'lamp',
  name: '灯光',
  enabled: true,
  x: 2,
  y: 2,
  radius: 8,
  intensity: 1,
  color: '#ffffff',
  start: 0,
  end: 2,
});

test('merge down bakes every frame, mask and blending exactly and owns independent pixels', () => {
  for (const packed of [false, true]) {
    const p = packed ? compactProject(artwork()) : artwork(),
      before = clone(p);
    assert.equal(mergeLayers(p, 1), 0);
    assert.equal(p.layers.length, 1);
    assert.equal(p.layers[0].opacity, 255);
    for (let i = 0; i < 2; i++) assert.deepEqual(composite(p, i), composite(before, i));
    assert.deepEqual(
      p.frames.map((f) => f.duration),
      [120, 80],
    );
    validate(p);
    assert.equal(before.layers.length, 2);
  }
});
test('merging groups preserves group opacity, frames and parent level', () => {
  const p = artwork();
  const at = groupLayer(p, 0);
  p.layers[at].opacity = 160;
  const before = composite(p, 1);
  mergeLayers(p, at, true);
  assert.deepEqual(composite(p, 1), before);
  assert.equal(p.layers[0].group, undefined);
});
test('merge refuses locked or animation source layers without changing data', () => {
  const p = artwork();
  p.layers[0].locked = true;
  const before = serialize(p);
  assert.throws(() => mergeLayers(p, 1), /解锁/);
  assert.equal(serialize(p), before);
  p.layers[0].locked = false;
  p.procedural = createScene(p, 0);
  p.procedural.objects.push(createObject(p, p.procedural, [0], null, '物体'));
  assert.throws(() => mergeLayers(p, 1), /来源/);
});
test('cross group drops keep all cels and complete subtrees aligned', () => {
  const p = artwork();
  groupLayer(p, 0);
  addLayer(p, -1, true);
  const moving = p.layers[2],
    pixels = p.frames.map((f) => f.cels[2]);
  const destination = dropLayer(p, 2, 3, 'inside');
  assert.equal(p.layers[destination], moving);
  assert.equal(moving.level, 1);
  p.frames.forEach((f, i) => assert.equal(f.cels[destination], pixels[i]));
  const root = dropLayer(p, destination, 0, 'above');
  assert.equal(p.layers[root], moving);
  assert.equal(moving.level, 0);
  validate(p);
  assert.throws(() => dropLayer(p, 0, 1, 'inside'), /子组/);
});
test('light positions, radius and brightness interpolate and translate as an animation object', () => {
  const l = light();
  putPosition(l, 0, { x: 0, y: 0 });
  putPosition(l, 2, { x: 10, y: 6 });
  l.radiusKeys = [
    { t: 0, v: 2 },
    { t: 2, v: 6 },
  ];
  l.intensityKeys = [
    { t: 0, v: 0 },
    { t: 2, v: 2 },
  ];
  const state = lightState(l, 1, 2);
  assert.deepEqual([state.x, state.y, state.radius, state.strength], [5, 3, 4, 1]);
  translateLight(l, 3, -2);
  const moved = lightState(l, 1, 2);
  assert.deepEqual([moved.x, moved.y], [8, 1]);
});
test('global and radial illumination obey selection/area and never create alpha', () => {
  const p = blank(4, 4),
    pixels = p.frames[0].cels[0];
  for (let i = 0; i < 15; i++) pixels.set([20, 20, 20, 255], i * 4);
  const l = {
      ...light(),
      coverage: 'global',
      area: { x: 1, y: 0, w: 2, h: 4 },
      region: encodeRegion(
        Uint8Array.from({ length: 16 }, (_, i) => i < 8),
        4,
        4,
      ),
    },
    s = { duration: 2, lights: [l] };
  applyLights(pixels, 4, 4, s, 0);
  assert.equal(pixels[4], 255);
  assert.equal(pixels[0], 20);
  assert.equal(pixels[9 * 4], 20);
  assert.equal(pixels[63], 0);
});
test('light-only scenes save, expand, validate and bake the same result as preview', async () => {
  const p = artwork();
  p.procedural = createScene(p, 0);
  const l = {
    ...light(),
    area: { x: 0, y: 0, w: 2, h: 2 },
    region: encodeRegion(new Uint8Array(16).fill(1), 4, 4),
  };
  putPosition(l, 0, { x: 0, y: 0 });
  putPosition(l, 1, { x: 3, y: 3 });
  p.procedural.lights = [l];
  const restored = deserialize(serialize(p));
  validate(restored);
  assert.deepEqual(restored.procedural.lights, p.procedural.lights);
  const shifted = moveSceneCanvas(p.procedural, 6, 6, 1, 1);
  assert.deepEqual(shifted.lights[0].positionKeys[1], { t: 1, x: 4, y: 4 });
  assert.equal(shifted.lights[0].area.x, 1);
  assert.equal(shifted.lights[0].region.w, 6);
  const c = compileScene(p, p.procedural),
    expected = new Uint8ClampedArray(evaluateScene(c, p.procedural, 0));
  const baked = await bakeScene(p, p.procedural, { mode: 'composite', frameCount: 2 });
  assert.deepEqual(composite(baked.project, baked.frame), expected);
  p.procedural.lights[0].area.w = 99;
  assert.throws(() => validate(p), /动画数据/);
});
test('object targeted lights leave all other surfaces and the background alone', () => {
  const p = blank(4, 1);
  p.frames[0].cels[0].set([20, 20, 20, 255]);
  addLayer(p, -1);
  p.frames[0].cels[1].set([20, 20, 20, 255], 8);
  p.procedural = createScene(p, 0);
  const o = createObject(p, p.procedural, [1], null, '目标');
  p.procedural.objects.push(o);
  p.procedural.lights = [{ ...light(), coverage: 'global', targets: [o.id] }];
  const result = evaluateScene(compileScene(p, p.procedural), p.procedural, 0);
  assert.equal(result[0], 20);
  assert.equal(result[8], 255);
});
test('background save packs mutable cels and produces a bounded cover without modifying input', () => {
  const p = compactProject(artwork());
  p.frames[0].cels[0] = new Uint8ClampedArray(readCel(p.frames[0].cels[0]));
  const before = serialize(p),
    result = prepareSave(p);
  assert.equal(serialize(p), before);
  assert.equal(result.project.frames[0].cels[0].encoding, 'rle32');
  assert.deepEqual(composite(result.project, 0), composite(p, 0));
  assert.equal(result.data.length, result.width * result.height * 4);
  assert.ok(result.width <= 256 && result.height <= 256);
});
