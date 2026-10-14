import test from 'node:test';
import assert from 'node:assert/strict';
import { blank, composite } from '../dist/engine.js';
import { encodeGif, encodeGifAsync, gifPlan } from '../dist/gif.js';

// Small independent GIF89a reader for rendered pixels, disposal and variable-width LZW.
function decode(data) {
  let pos = 6;
  const byte = () => data[pos++],
    word = () => byte() | (byte() << 8);
  const width = word(),
    height = word(),
    flags = byte();
  byte();
  byte();
  const palette = Array.from({ length: 1 << ((flags & 7) + 1) }, () => [
    byte(),
    byte(),
    byte(),
    255,
  ]);
  const blocks = () => {
    const out = [];
    let size;
    while ((size = byte())) for (let i = 0; i < size; i++) out.push(byte());
    return out;
  };
  const frames = [],
    rects = [],
    canvas = new Uint8ClampedArray(width * height * 4);
  let gce = {};
  while (pos < data.length) {
    const block = byte();
    if (block === 0x3b) break;
    if (block === 0x21) {
      const kind = byte();
      if (kind === 0xf9) {
        byte();
        gce = { flags: byte(), delay: word() * 10, transparent: byte() };
        byte();
      } else blocks();
      continue;
    }
    assert.equal(block, 0x2c);
    const x = word(),
      y = word(),
      w = word(),
      h = word();
    assert.equal(byte(), 0);
    const minimum = byte(),
      input = blocks(),
      clear = 1 << minimum,
      end = clear + 1;
    let bits = minimum + 1,
      at = 0,
      next = end + 1,
      previous = null,
      dict = [];
    const reset = () => {
      dict = Array.from({ length: clear }, (_, i) => [i]);
      bits = minimum + 1;
      next = end + 1;
      previous = null;
    };
    reset();
    const pixels = [];
    while (true) {
      let code = 0;
      for (let b = 0; b < bits; b++, at++) code |= ((input[at >> 3] >> (at & 7)) & 1) << b;
      if (code === clear) {
        reset();
        continue;
      }
      if (code === end) break;
      const entry = dict[code] || (code === next && previous ? [...previous, previous[0]] : null);
      assert.ok(entry, 'valid LZW reference');
      pixels.push(...entry);
      if (previous && next < 4096) {
        dict[next++] = [...previous, entry[0]];
        if (next === 1 << bits && bits < 12) bits++;
      }
      previous = entry;
      assert.ok(at <= input.length * 8);
    }
    assert.equal(pixels.length, w * h);
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const index = pixels[yy * w + xx];
        if (gce.flags & 1 && index === gce.transparent) continue;
        canvas.set(palette[index], ((y + yy) * width + x + xx) * 4);
      }
    frames.push({ pixels: new Uint8ClampedArray(canvas), duration: gce.delay });
    rects.push({ x, y, w, h });
    if (((gce.flags >> 2) & 7) === 2)
      for (let yy = 0; yy < h; yy++)
        canvas.fill(0, ((y + yy) * width + x) * 4, ((y + yy) * width + x + w) * 4);
  }
  return { width, height, frames, rects };
}
function frame(p, duration = 100) {
  p.frames.push({ duration, cels: [new Uint8ClampedArray(p.w * p.h * 4)] });
  return p.frames.at(-1).cels[0];
}

test('GIF uses real LZW across dictionary sizes/resets and keeps exact small palettes', () => {
  const p = blank(256, 128);
  let seed = 12345;
  const colors = Array.from({ length: 200 }, (_, i) => [i, (i * 17) % 256, (i * 73) % 256, 255]);
  for (let i = 0; i < p.w * p.h; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    p.frames[0].cels[0].set(colors[(seed >>> 24) % 200], i * 4);
  }
  const q = decode(encodeGif(p));
  assert.deepEqual(q.frames[0].pixels, composite(p, 0));
});
test('GIF changed rectangles, transparent holds and duplicate merging preserve displayed frames and timing', () => {
  const p = blank(64, 32);
  p.frames[0].duration = 33;
  const c = p.frames[0].cels[0];
  for (let i = 0; i < c.length; i += 4) c.set([70, 45, 90, 255], i);
  frame(p, 34).set(c);
  p.frames[1].cels[0].set([255, 100, 120, 255], (10 * 64 + 10) * 4);
  frame(p, 33).set(p.frames[1].cels[0]);
  frame(p, 33).set(c);
  const bytes = encodeGif(p),
    q = decode(bytes);
  assert.equal(q.frames.length, 3);
  assert.deepEqual(
    q.frames.map((f) => f.duration),
    [30, 70, 30],
  );
  assert.deepEqual(q.frames[0].pixels, composite(p, 0));
  assert.deepEqual(q.frames[1].pixels, composite(p, 1));
  assert.deepEqual(q.frames[2].pixels, composite(p, 3));
  assert.equal(q.rects[1].w * q.rects[1].h, 1);
  assert.ok(bytes.length < 500);
});
test('transparent moving and disappearing objects do not leave previous-frame trails', () => {
  const p = blank(12, 12);
  p.frames[0].cels[0].set([12, 230, 70, 255], 0);
  frame(p).set([240, 20, 80, 255], (8 * 12 + 8) * 4);
  frame(p);
  frame(p).set([12, 230, 70, 255], 0);
  const q = decode(encodeGif(p));
  for (let i = 0; i < 4; i++) assert.deepEqual(q.frames[i].pixels, composite(p, i));
});
test('30 FPS timing retains a full second and resampling preserves total duration', () => {
  const p = blank(8, 8);
  p.frames = [];
  for (let i = 0; i < 30; i++)
    frame(p, Math.round(((i + 1) * 1000) / 30) - Math.round((i * 1000) / 30)).set(
      [i * 7, 50, 80, 255],
      0,
    );
  assert.equal(
    decode(encodeGif(p)).frames.reduce((n, f) => n + f.duration, 0),
    1000,
  );
  const plan = gifPlan(p, { fps: 12, maxEdge: 4, colors: 32 });
  assert.equal(plan.samples.length, 12);
  assert.equal(plan.duration, 1000);
  const q = decode(encodeGif(p, { fps: 12, maxEdge: 4, colors: 32 }));
  assert.equal(q.width, 4);
  assert.equal(q.height, 4);
  assert.equal(
    q.frames.reduce((n, f) => n + f.duration, 0),
    1000,
  );
  assert.deepEqual(
    gifPlan(p, { fps: 50 }).samples.map((f) => f.duration),
    p.frames.map((f) => f.duration),
  );
});
test('palette reduction is bounded, async matches sync, cancellation and input validation work', async () => {
  const p = blank(32, 32);
  for (let i = 0; i < 1024; i++)
    p.frames[0].cels[0].set([i % 256, (i * 37) % 256, Math.floor(i / 4), 255], i * 4);
  const bytes = encodeGif(p, { colors: 16 });
  assert.deepEqual(await encodeGifAsync(p, { colors: 16 }), bytes);
  const q = decode(bytes);
  assert.equal(q.frames.length, 1);
  assert.ok(
    new Set(
      Array.from({ length: 1024 }, (_, i) => q.frames[0].pixels.slice(i * 4, i * 4 + 3).join(',')),
    ).size <= 15,
  );
  const controller = new AbortController();
  await assert.rejects(
    encodeGifAsync(p, {}, { signal: controller.signal, progress: () => controller.abort() }),
    /取消/,
  );
  assert.throws(() => gifPlan(p, { fps: 51 }));
  assert.throws(() => gifPlan(p, { colors: 100 }));
  assert.throws(() => gifPlan(p, { from: 1, to: 0 }));
});
