import test from 'node:test';
import assert from 'node:assert/strict';
import { FingerSession, pinchCamera } from '../dist/gestures.js';
function setup(draw = false) {
  let now = 0,
    queued = null;
  const events = [];
  const a = {
    canDraw: () => draw,
    begin: (p) => events.push(['begin', p.id]),
    move: (p) => events.push(['move', p.id]),
    end: (cancel) => events.push(['end', cancel]),
    gestureStart: (p) => events.push(['start', p]),
    gestureMove: (p) => events.push(['pinch', p]),
    gestureEnd: () => {},
    undo: () => events.push(['undo']),
    redo: () => events.push(['redo']),
  };
  return {
    s: new FingerSession(a, {
      clock: () => now,
      later: (fn) => ((queued = fn), 1),
      clear: () => (queued = null),
    }),
    events,
    advance: (ms) => (now += ms),
    flush: () => {
      const f = queued;
      queued = null;
      f?.();
    },
  };
}
const p = (id, x, y = 0) => ({ id, x, y, width: id === 2 ? 90 : 20 });
test('thumb and index finger zoom without any stroke', () => {
  const t = setup();
  t.s.update([p(1, 0)]);
  t.s.update([p(1, 0), p(2, 100)]);
  t.s.update([p(1, -50), p(2, 150)]);
  t.s.update([p(2, 150)]);
  t.s.update([p(2, 180)]);
  t.s.update([]);
  assert.deepEqual(
    t.events.map((e) => e[0]),
    ['start', 'pinch'],
  );
  assert.equal(t.events[1][1].distance, 200);
});
test('second contact arriving after finger drawing rolls back the whole stroke', () => {
  const t = setup(true);
  t.s.update([p(1, 0)]);
  t.flush();
  t.s.update([p(1, 10)]);
  t.s.update([p(1, 10), p(2, 100)]);
  t.s.update([p(1, 20)]);
  t.s.update([]);
  assert.equal(t.events.filter((e) => e[0] === 'begin').length, 1);
  assert.deepEqual(
    t.events.find((e) => e[0] === 'end'),
    ['end', true],
  );
});
test('two fingers arriving inside grace period never paint, tap undoes once', () => {
  const t = setup(true);
  t.s.update([p(1, 0)]);
  t.s.update([p(1, 0), p(2, 50)]);
  t.flush();
  t.s.update([p(2, 50)]);
  t.s.update([]);
  assert.deepEqual(
    t.events.map((e) => e[0]),
    ['start', 'undo'],
  );
});
test('three finger tap redoes once; cancellation does not undo', () => {
  const t = setup();
  t.s.update([p(1, 0), p(2, 50)]);
  t.s.update([p(1, 0), p(2, 50), p(3, 100)]);
  t.s.update([]);
  assert.equal(t.events.at(-1)[0], 'redo');
  const u = setup();
  u.s.update([p(1, 0), p(2, 50)]);
  u.s.update([], { cancel: true });
  assert.equal(
    u.events.some((e) => e[0] === 'undo'),
    false,
  );
});
test('pinch keeps centroid anchor stable and wraps rotation across pi', () => {
  const base = { x: 10, y: 20, scale: 2, angle: 0 },
    start = { x: 110, y: 20, distance: 100, angle: Math.PI - 0.05 },
    current = { x: 120, y: 40, distance: 200, angle: -Math.PI + 0.05 };
  const c = pinchCamera(base, start, current);
  assert.equal(c.scale, 4);
  assert.ok(Math.abs(c.angle - 0.1) < 1e-9);
  assert.ok(Math.abs(c.x + 200 * Math.cos(0.1) - 120) < 1e-9);
  assert.ok(Math.abs(c.y + 200 * Math.sin(0.1) - 40) < 1e-9);
});
test('single finger optional drawing commits a tap and move; long multigesture never undoes', () => {
  const t = setup(true);
  t.s.update([p(1, 5)]);
  t.s.update([]);
  assert.deepEqual(t.events, [
    ['begin', 1],
    ['end', false],
  ]);
  const u = setup();
  u.s.update([p(1, 0), p(2, 30)]);
  u.advance(800);
  u.s.update([]);
  assert.equal(
    u.events.some((e) => e[0] === 'undo'),
    false,
  );
});
