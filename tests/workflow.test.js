import test from 'node:test';
import assert from 'node:assert/strict';
import { blank, clone } from '../dist/engine.js';
import { createBrushLibrary, normalizeBrush, stampBrush } from '../dist/brushes.js';
import { createToolBrushes } from '../dist/tool-brushes.js';
import { duplicateLayer, reorderBeside } from '../dist/layer-actions.js';
import { createGalleryLayout } from '../dist/gallery-layout.js';

test('paint and erase independently remember brush parameters, transfer deliberately and restore safely', () => {
  const library = createBrushLibrary();
  const tools = createToolBrushes(library);
  tools.select('dither-8');
  tools.update({ size: 17, opacity: 70 });
  tools.switch('eraser');
  tools.select('pixel-round');
  tools.update({ size: 9, opacity: 35 });
  tools.switch('pencil');
  assert.equal(tools.current().id, 'dither-8');
  assert.equal(tools.current().size, 17);
  assert.equal(tools.current().opacity, 70);
  const saved = structuredClone(tools.state),
    restored = createToolBrushes(library, saved);
  restored.switch('eraser');
  assert.equal(restored.current().id, 'pixel-round');
  assert.equal(restored.current().opacity, 35);
  tools.switch('eraser', true);
  assert.equal(tools.current().id, 'dither-8');
  assert.equal(tools.current().size, 17);
  tools.update({ size: 2 });
  tools.switch('pencil');
  assert.equal(tools.current().size, 17);
});
test('partial painting and erasing use the original stroke pixels and do not build up on overlap', () => {
  const base = new Uint8ClampedArray([0, 0, 255, 255]),
    pixels = new Uint8ClampedArray(base);
  const args = {
    pixels,
    base,
    w: 1,
    h: 1,
    x: 0,
    y: 0,
    size: 1,
    brush: normalizeBrush({ opacity: 50 }),
    color: [255, 0, 0, 255],
  };
  stampBrush(args);
  stampBrush(args);
  assert.deepEqual([...pixels], [128, 0, 128, 255]);
  stampBrush({ ...args, erase: true });
  stampBrush({ ...args, erase: true });
  assert.deepEqual([...pixels], [0, 0, 255, 128]);
  const transparent = new Uint8ClampedArray(4);
  stampBrush({ ...args, pixels: transparent, base: new Uint8ClampedArray(4) });
  assert.deepEqual([...transparent], [255, 0, 0, 128]);
});
test('layer duplication and reorder preserve whole subtrees and independent frame buffers', () => {
  const p = blank(2, 2);
  p.layers = [
    { name: 'base', visible: true, opacity: 255 },
    { name: 'group', group: true, visible: true, opacity: 255 },
    { name: 'child', level: 1, visible: true, opacity: 255 },
    { name: 'top', visible: true, opacity: 255 },
  ];
  p.frames[0].cels = p.layers.map((_, i) => new Uint8ClampedArray(16).fill(i));
  const copy = duplicateLayer(p, 1);
  assert.equal(copy, 3);
  assert.equal(p.layers[4].level, 1);
  p.frames[0].cels[4][0] = 99;
  assert.equal(p.frames[0].cels[2][0], 2);
  const at = reorderBeside(p, 3, 0);
  assert.equal(at, 0);
  assert.equal(p.layers[1].name, 'child');
  assert.equal(p.frames[0].cels[1][0], 99);
  const before = clone(p);
  assert.throws(() => reorderBeside(p, 0, 1), /同一组/);
  assert.deepEqual(p, before);
});
test('layer copy compacts large matrices instead of rejecting a fixed layer count', () => {
  const p = blank(512, 512);
  p.layers = Array.from({ length: 30 }, () => ({ name: 'x', visible: true, opacity: 255 }));
  p.frames[0].cels = p.layers.map(() => new Uint8ClampedArray(512 * 512 * 4));
  for (let i = 0; i < 10; i++) duplicateLayer(p, 0);
  assert.equal(p.layers.length, 40);
  assert.equal(p.storage, 'packed');
  assert.equal(p.frames[0].cels[0], p.frames[0].cels[1]);
});
test('gallery organization survives reload, prunes missing IDs and keeps artwork in only one stack', () => {
  const records = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const layout = createGalleryLayout(records, {
    order: ['missing', 'b', 'b'],
    stacks: [{ id: 'old', name: 'old', members: ['gone', 'a', 'a'] }],
  });
  assert.deepEqual(layout.state.order, ['b', 'a', 'c', 'd']);
  layout.stack(['a', 'b'], 'AB', 'ab');
  layout.moveToStack(['c'], 'ab');
  assert.deepEqual(layout.state.stacks, [{ id: 'ab', name: 'AB', members: ['a', 'b', 'c'] }]);
  layout.reorder('d', 'b');
  assert.equal(layout.state.order[0], 'd');
  const reloaded = createGalleryLayout(
    records.filter((r) => r.id !== 'c'),
    JSON.parse(JSON.stringify(layout.state)),
  );
  assert.deepEqual(reloaded.state.stacks[0].members, ['a', 'b']);
  reloaded.unstack(['a', 'b']);
  assert.equal(reloaded.state.stacks.length, 0);
});
