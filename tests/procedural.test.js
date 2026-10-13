import test from 'node:test';
import assert from 'node:assert/strict';
import { blank, clone, composite, serialize, deserialize, validate } from '../dist/engine.js';
import { createScene, pathNode, encodeRegion, validateScene } from '../dist/procedural-model.js';
import {
  createObject,
  compileScene,
  evaluateScene,
  objectState,
  sampleTimes,
  bakeScene,
  bakePlan,
} from '../dist/procedural.js';
import {
  pathPoint,
  curveValue,
  setKey,
  setTransformKey,
  fitPath,
} from '../dist/procedural-path.js';
import { createHistory } from '../dist/history.js';
import { duplicateLayer } from '../dist/layer-actions.js';
import { reorderBeside } from '../dist/layer-actions.js';
import { expandCanvas } from '../dist/canvas-resize.js';
const pixel = (p, x, y, c, layer = 0) => p.frames[0].cels[layer].set(c, (y * p.w + x) * 4);
function fixture() {
  const p = blank(16, 12);
  pixel(p, 2, 3, [255, 0, 0, 255]);
  pixel(p, 3, 3, [255, 0, 0, 128]);
  pixel(p, 10, 8, [0, 80, 255, 255]);
  p.procedural = createScene(p, 0);
  const scene = p.procedural;
  const a = new Uint8Array(192);
  a[3 * 16 + 2] = a[3 * 16 + 3] = 1;
  const b = new Uint8Array(192);
  b[8 * 16 + 10] = 1;
  scene.objects.push(createObject(p, scene, [0], a, '史莱姆'));
  scene.objects.push(createObject(p, scene, [0], b, '石头'));
  return p;
}
const noWait = async () => {};
test('two objects reference disjoint pixels without mutating or copying source art', () => {
  const p = fixture(),
    s = p.procedural,
    c = compileScene(p, s),
    before = serialize(p);
  assert.deepEqual(evaluateScene(c, s, 0), composite(p, 0));
  s.objects[0].path = [pathNode(3, 3.5), pathNode(7, 3.5)];
  const output = evaluateScene(c, s, 1);
  assert.equal(output[(3 * 16 + 4) * 4], 255);
  assert.equal(output[(8 * 16 + 10) * 4 + 2], 255);
  assert.equal(s.objects[1].path.length, 1);
  assert.equal(JSON.parse(before).frames[0].cels[0], JSON.parse(serialize(p)).frames[0].cels[0]);
  assert.throws(() => createObject(p, s, [0], null, '冲突'), /重叠/);
});
test('progress and arc length control time independently of path geometry', () => {
  const nodes = [pathNode(0, 0), pathNode(10, 0), pathNode(100, 0)];
  assert.ok(Math.abs(pathPoint(nodes, 0.5).x - 50) < 1e-8);
  const p = fixture(),
    o = p.procedural.objects[0];
  o.path = nodes;
  const before = structuredClone(nodes);
  o.progress = [
    { t: 0, v: 0 },
    { t: 0.5, v: 0.2 },
    { t: 0.8, v: 0.2 },
    { t: 1, v: 1 },
  ];
  assert.equal(objectState(o, 1).x, objectState(o, 1.5).x);
  assert.deepEqual(nodes, before);
  assert.equal(curveValue(o.progress, 1), 1);
  assert.equal(curveValue([], 0, 1), 1);
  assert.ok(
    fitPath(Array.from({ length: 300 }, (_, i) => ({ x: i / 3, y: Math.sin(i / 30) * 20 })))
      .length <= 64,
  );
});
test('clip effects combine additively/multiplicatively with deterministic shake', () => {
  const p = fixture(),
    o = p.procedural.objects[0];
  o.tracks.rotation = [{ t: 0, v: 10 }];
  const clip = (id, type, params) => ({
    id,
    type,
    start: 0,
    end: 2,
    enabled: true,
    intensity: 1,
    curve: [
      { t: 0, v: 1 },
      { t: 1, v: 1 },
    ],
    blend: ['rotate', 'shake'].includes(type) ? 'add' : 'multiply',
    params: { angle: 0, x: 1, y: 1, opacity: 1, amplitude: 0, frequency: 8, ...params },
  });
  o.clips = [
    clip('a', 'rotate', { angle: 30 }),
    clip('b', 'rotate', { angle: 20 }),
    clip('c', 'stretch', { x: 2, y: 0.5 }),
    clip('d', 'fade', { opacity: 0.5 }),
    clip('e', 'shake', { amplitude: 3 }),
  ];
  const state = objectState(o, 0.73);
  assert.equal(state.rotation, 60);
  assert.equal(state.scaleX, 2);
  assert.equal(state.scaleY, 0.5);
  assert.equal(state.opacity, 0.5);
  assert.deepEqual(state, objectState(o, 0.73));
  o.clips.reverse();
  assert.deepEqual(state, objectState(o, 0.73));
  assert.equal(objectState(o, 3).rotation, 10);
  o.enabled = false;
  assert.equal(objectState(o, 0.73).scaleX, 1);
});
test('scene round trip and clone isolate all nested editable animation data', () => {
  const p = fixture(),
    restored = deserialize(serialize(p)),
    copy = clone(p);
  assert.deepEqual(restored, p);
  copy.procedural.objects[0].path[0].out.x += 3;
  copy.procedural.objects[0].source.region.runs[0]++;
  assert.notDeepEqual(copy.procedural, p.procedural);
  assert.deepEqual(p, restored);
});
test('source IDs survive reorder, duplicates receive new identities, deletion is explicit', () => {
  const p = fixture();
  duplicateLayer(p, 0);
  assert.notEqual(p.layers[0].id, p.layers[1].id);
  const before = new Uint8ClampedArray(
    evaluateScene(compileScene(p, p.procedural), p.procedural, 0),
  );
  reorderBeside(p, 0, 1);
  assert.deepEqual(evaluateScene(compileScene(p, p.procedural), p.procedural, 0), before);
  p.layers.pop();
  p.frames[0].cels.pop();
  assert.throws(() => compileScene(p, p.procedural), /来源图层已删除/);
});
test('scene-only undo uses metadata memory and preserves source buffer identity', () => {
  const p = fixture(),
    h = createHistory(),
    pixels = p.frames[0].cels[0],
    bytes = JSON.stringify(p.procedural).length * 2;
  h.checkpointScene(p.procedural);
  const next = { ...p, procedural: structuredClone(p.procedural) };
  next.procedural.objects[0].name = '修改';
  const restored = h.undo(next);
  assert.equal(restored.frames[0].cels[0], pixels);
  assert.equal(restored.procedural.objects[0].name, '史莱姆');
  assert.equal(h.redo(restored).procedural.objects[0].name, '修改');
  assert.equal(h.bytes, bytes);
});
test('uniform samples exclude the end point and millisecond durations do not accumulate drift', () => {
  const p = fixture(),
    s = p.procedural;
  s.duration = 1;
  s.range = [0, 1];
  s.fps = 24;
  const samples = sampleTimes(s);
  assert.equal(samples.length, 24);
  assert.equal(samples[23].time, 23 / 24);
  assert.equal(
    samples.reduce((n, f) => n + f.duration, 0),
    1000,
  );
  s.range = [0.25, 0.75];
  assert.equal(sampleTimes(s).length, 12);
  assert.equal(sampleTimes(s)[0].time, 0.25);
});
for (const mode of ['objects', 'composite'])
  test(`${mode} baking matches every preview sample and leaves source pixels unchanged`, async () => {
    const p = fixture(),
      s = p.procedural;
    s.fps = 6;
    s.objects[0].path = [pathNode(3, 3.5), pathNode(8, 5)];
    setKey(s.objects[0].tracks.rotation, 0, 0);
    setKey(s.objects[0].tracks.rotation, 2, 45);
    setKey(s.objects[1].tracks.opacity, 0, 1);
    setKey(s.objects[1].tracks.opacity, 2, 0);
    const before = serialize(p),
      c = compileScene(p, s),
      result = await bakeScene(p, s, { mode }, () => {}, noWait);
    for (const [i, sample] of sampleTimes(s).entries())
      assert.deepEqual(
        composite(result.project, result.frame + i),
        evaluateScene(c, s, sample.time),
      );
    assert.equal(serialize(p), before);
    assert.deepEqual(result.project.frames[0].cels[0], p.frames[0].cels[0]);
    assert.deepEqual(deserialize(serialize(result.project)), result.project);
  });
test('rebaking into a new group preserves old refinements, replacing affects owned cels only', async () => {
  const p = fixture();
  p.procedural.fps = 2;
  const first = await bakeScene(p, p.procedural, {}, () => {}, noWait),
    q = first.project;
  q.frames[first.frame].cels[first.layer + 1][0] = 123;
  const second = await bakeScene(q, q.procedural, {}, () => {}, noWait);
  assert.equal(second.project.frames[first.frame].cels[first.layer + 1][0], 123);
  q.layers.push({ name: '精修', visible: true, opacity: 255 });
  q.frames.forEach((f) => f.cels.push(new Uint8ClampedArray(16 * 12 * 4)));
  q.frames[first.frame].cels.at(-1).set([4, 5, 6, 255], 0);
  const replaced = await bakeScene(q, q.procedural, { replace: true }, () => {}, noWait);
  assert.equal(replaced.project.frames.length, q.frames.length);
  assert.equal(replaced.project.frames[first.frame].cels[first.layer + 1][0], 0);
  assert.deepEqual(
    [...replaced.project.frames[first.frame].cels.at(-1).slice(0, 4)],
    [4, 5, 6, 255],
  );
});
test('bake capacity rejection is atomic and schema rejects malformed and oversized input', () => {
  const p = fixture(),
    before = serialize(p);
  p.procedural.fps = 50;
  p.procedural.duration = 60;
  p.procedural.range = [0, 60];
  assert.throws(() => bakePlan(p, p.procedural), /上限/);
  const bad = deserialize(before);
  bad.procedural.objects[0].path[0].x = Infinity;
  assert.throws(() => validate(bad), /动画数据/);
  const b = deserialize(before);
  b.procedural.objects[1].source = b.procedural.objects[0].source;
  assert.throws(() => validate(b), /重叠/);
  const c = deserialize(before);
  c.procedural.version = 99;
  assert.throws(() => validateScene(c.procedural, c), /动画数据/);
});
test('canvas expansion translates references, path tangents and origins without changing animation', () => {
  const p = fixture(),
    before = new Uint8ClampedArray(evaluateScene(compileScene(p, p.procedural), p.procedural, 0)),
    q = expandCanvas(p, { left: 5, top: 3 }),
    after = evaluateScene(compileScene(q, q.procedural), q.procedural, 0);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      assert.deepEqual(
        after.slice(((y + 3) * q.w + x + 5) * 4, ((y + 3) * q.w + x + 5) * 4 + 4),
        before.slice((y * p.w + x) * 4, (y * p.w + x) * 4 + 4),
      );
  assert.deepEqual(
    p.procedural.objects[0].source.region,
    encodeRegion(
      Uint8Array.from({ length: 192 }, (_, i) => (i === 50 || i === 51 ? 1 : 0)),
      16,
      12,
    ),
  );
});

test('a first transform key at a later time interpolates from the original pose', () => {
  const o = fixture().procedural.objects[0];
  setTransformKey(o.tracks, 'rotation', 1, 90);
  setTransformKey(o.tracks, 'scaleX', 1, 2);
  setTransformKey(o.tracks, 'opacity', 1, 0);
  assert.equal(objectState(o, 0).rotation, 0);
  assert.equal(objectState(o, 0.5).rotation, 45);
  assert.equal(objectState(o, 0.5).scaleX, 1.5);
  assert.equal(objectState(o, 0.5).opacity, 0.5);
});
test('cancelling a bake or replacing a rearranged bake never changes the project', async () => {
  const p = fixture(),
    before = serialize(p),
    controller = new AbortController();
  await assert.rejects(
    bakeScene(p, p.procedural, { signal: controller.signal }, () => controller.abort(), noWait),
    /取消/,
  );
  assert.equal(serialize(p), before);
  const { project: q } = await bakeScene(p, p.procedural, {}, () => {}, noWait);
  q.frames.splice(2, 0, q.frames.pop());
  assert.throws(() => bakePlan(q, q.procedural, { replace: true }), /帧顺序/);
});
test('clipping stacks must remain together when binding editable sources', () => {
  const p = fixture();
  p.procedural.objects = [];
  duplicateLayer(p, 0);
  p.layers[1].clipping = true;
  assert.throws(() => createObject(p, p.procedural, [0], null, '底层'), /剪贴/);
  assert.throws(() => createObject(p, p.procedural, [1], null, '剪贴'), /底层/);
  assert.ok(createObject(p, p.procedural, [0, 1], null, '整体'));
});
