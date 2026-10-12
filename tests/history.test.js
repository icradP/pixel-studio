import test from 'node:test';
import assert from 'node:assert/strict';
import { blank } from '../dist/engine.js';
import { createHistory } from '../dist/history.js';

const project = (value) => {
  const p = blank(1, 1);
  p.frames[0].cels[0][0] = value;
  return p;
};
const value = (p) => p.frames[0].cels[0][0];

test('undo and redo restore independent project snapshots', () => {
  const history = createHistory();
  history.checkpoint(project(1));
  const current = project(2);
  assert.equal(value(history.undo(current)), 1);
  current.frames[0].cels[0][0] = 99;
  assert.equal(value(history.redo(project(1))), 2);
  assert.equal(history.canRedo, false);
});

test('undo and redo share the same byte budget when project size changes', () => {
  const history = createHistory({ maxBytes: 12 });
  history.checkpoint(project(1));
  history.checkpoint(project(2));
  history.checkpoint(project(3));
  const previous = history.undo(blank(2, 1));
  assert.equal(value(previous), 3);
  assert.ok(history.bytes <= 12);
  history.redo(previous);
  assert.ok(history.bytes <= 12);
  history.clear();
  assert.equal(history.bytes, 0);
  assert.equal(history.canUndo || history.canRedo, false);
});

test('entry limits evict oldest snapshots and a new edit discards the redo branch', () => {
  const history = createHistory({ maxEntries: 2 });
  for (const n of [1, 2, 3]) history.checkpoint(project(n));
  let p = history.undo(project(4));
  assert.equal(value(p), 3);
  p = history.undo(p);
  assert.equal(value(p), 2);
  assert.equal(history.canUndo, false);
  history.checkpoint(p);
  assert.equal(history.canRedo, false);
  assert.equal(history.bytes, 4);
});

test('oversized snapshots do not exceed the configured memory limit', () => {
  const history = createHistory({ maxBytes: 4 });
  history.checkpoint(blank(2, 2));
  assert.equal(history.bytes, 0);
  assert.equal(history.undo(project(1)), null);
});
