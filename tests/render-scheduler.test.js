import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderScheduler } from '../dist/render-scheduler.js';

function setup(draw) {
  let next = 0;
  const callbacks = new Map();
  const scheduler = createRenderScheduler(draw, {
    request(callback) {
      const id = next++;
      callbacks.set(id, callback);
      return id;
    },
    cancel: (id) => callbacks.delete(id),
  });
  return {
    scheduler,
    callbacks,
    frame() {
      const batch = [...callbacks.values()];
      callbacks.clear();
      batch.forEach((fn) => fn());
    },
  };
}

test('many pointer updates produce one paint with the latest state', () => {
  const seen = [];
  let value = 0;
  const { scheduler, frame, callbacks } = setup(() => seen.push(value));
  for (value = 0; value < 100; value++) scheduler.request();
  assert.equal(callbacks.size, 1);
  frame();
  assert.deepEqual(seen, [100]);
  scheduler.request();
  frame();
  assert.deepEqual(seen, [100, 100]);
});

test('flush paints synchronously without a duplicate pending paint; cancel discards work', () => {
  let paints = 0;
  const { scheduler, frame } = setup(() => paints++);
  scheduler.request();
  scheduler.flush();
  frame();
  assert.equal(paints, 1);
  scheduler.flush();
  assert.equal(paints, 1, 'playback ticks without an edited frame should not repaint');
  scheduler.request();
  scheduler.cancel();
  frame();
  assert.equal(paints, 1);
});

test('a paint can request another frame without losing it', () => {
  let paints = 0;
  const { scheduler, frame, callbacks } = setup(() => {
    if (++paints === 1) scheduler.request();
  });
  scheduler.request();
  frame();
  assert.equal(callbacks.size, 1);
  frame();
  assert.equal(paints, 2);
});
