import { composite } from './engine.js';

// GIF89a: https://www.w3.org/Graphics/GIF/spec-gif89a.txt
// Two passes, retaining only one composited frame and two indexed planes.
export function gifPlan(
  p,
  { from = 0, to = p.frames.length - 1, maxEdge = Math.max(p.w, p.h), colors = 256, fps = 0 } = {},
) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || !p.frames[to])
    throw Error('GIF 帧范围无效');
  if (
    !Number.isInteger(maxEdge) ||
    maxEdge < 1 ||
    maxEdge > 65535 ||
    ![16, 32, 64, 128, 256].includes(colors) ||
    !Number.isFinite(fps) ||
    fps < 0 ||
    fps > 50
  )
    throw Error('GIF 尺寸、颜色或帧率无效');
  const scale = Math.min(1, maxEdge / Math.max(p.w, p.h));
  const width = Math.max(1, Math.round(p.w * scale)),
    height = Math.max(1, Math.round(p.h * scale));
  let duration = 0;
  const frames = [];
  for (let frame = from; frame <= to; frame++) {
    const ms = p.frames[frame].duration;
    if (!Number.isFinite(ms) || ms < 20 || ms > 10000) throw Error('GIF 帧时长无效');
    frames.push({ frame, start: duration, duration: ms });
    duration += ms;
  }
  let samples = frames;
  if (fps && frames.some((f) => f.duration < 1000 / fps)) {
    const step = 1000 / fps,
      byTime = new Map();
    for (const f of frames) {
      const time = Math.ceil(f.start / step - 1e-8) * step;
      if (time < duration) byTime.set(time, f.frame);
    }
    const entries = [...byTime];
    if (entries.length > 1 && duration - entries.at(-1)[0] < 20) entries.pop();
    samples = entries.map(([start, frame], i) => ({
      frame,
      start,
      duration: (entries[i + 1]?.[0] ?? duration) - start,
    }));
  }
  return { width, height, colors, fps, samples, duration, sourceFrames: to - from + 1 };
}
class Writer {
  constructor() {
    this.parts = [];
    this.buffer = new Uint8Array(65536);
    this.at = 0;
    this.length = 0;
  }
  byte(n) {
    if (this.at === this.buffer.length) {
      this.parts.push(this.buffer);
      this.buffer = new Uint8Array(65536);
      this.at = 0;
    }
    this.buffer[this.at++] = n;
    this.length++;
    if (this.length > 64 * 1024 * 1024)
      throw Error('GIF 文件超过 64 MiB，请降低尺寸、帧率或颜色数量');
  }
  word(n) {
    this.byte(n);
    this.byte(n >>> 8);
  }
  text(s) {
    for (const c of s) this.byte(c.charCodeAt(0));
  }
  result() {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    out.set(this.buffer.subarray(0, this.at), offset);
    return out;
  }
}
function imagePixels(p, frame, w, h) {
  const input = composite(p, frame);
  if (w === p.w && h === p.h) return input;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const src =
        (Math.min(p.h - 1, Math.floor(((y + 0.5) * p.h) / h)) * p.w +
          Math.min(p.w - 1, Math.floor(((x + 0.5) * p.w) / w))) *
        4;
      out.set(input.subarray(src, src + 4), (y * w + x) * 4);
    }
  return out;
}
const bucket = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
function paletteBuilder(max) {
  let exact = new Map(),
    transparent = false;
  const count = new Uint32Array(32768),
    sums = Array.from({ length: 3 }, () => new Float64Array(32768));
  return {
    add(pixels) {
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 128) {
          transparent = true;
          continue;
        }
        const r = pixels[i],
          g = pixels[i + 1],
          b = pixels[i + 2],
          key = bucket(r, g, b);
        count[key]++;
        sums[0][key] += r;
        sums[1][key] += g;
        sums[2][key] += b;
        if (exact) {
          exact.set((r << 16) | (g << 8) | b, [r, g, b]);
          if (exact.size > max - 1) exact = null;
        }
      }
    },
    finish() {
      let palette;
      if (exact) palette = [...exact.values()];
      else {
        const points = [];
        for (let i = 0; i < count.length; i++)
          if (count[i]) points.push({ n: count[i], rgb: sums.map((s) => s[i] / count[i]) });
        const box = (items) => {
          const lo = [255, 255, 255],
            hi = [0, 0, 0];
          let weight = 0;
          for (const p of items) {
            weight += p.n;
            for (let c = 0; c < 3; c++) {
              lo[c] = Math.min(lo[c], p.rgb[c]);
              hi[c] = Math.max(hi[c], p.rgb[c]);
            }
          }
          const ranges = hi.map((v, c) => v - lo[c]),
            channel = ranges.indexOf(Math.max(...ranges));
          return {
            items,
            channel,
            weight,
            score: items.length > 1 ? ranges[channel] * Math.log2(weight + 1) : 0,
          };
        };
        const boxes = [box(points)];
        while (boxes.length < max - 1) {
          boxes.sort((a, b) => b.score - a.score);
          const b = boxes[0];
          if (!b.score) break;
          b.items.sort((a, c) => a.rgb[b.channel] - c.rgb[b.channel]);
          let n = 0,
            split = 0;
          while (split < b.items.length - 1 && n < b.weight / 2) n += b.items[split++].n;
          boxes.splice(0, 1, box(b.items.slice(0, split)), box(b.items.slice(split)));
        }
        palette = boxes.map((b) =>
          [0, 1, 2].map((c) =>
            Math.round(b.items.reduce((n, p) => n + p.rgb[c] * p.n, 0) / b.weight),
          ),
        );
      }
      if (!palette.length) palette = [[0, 0, 0]];
      palette.unshift([0, 0, 0]);
      const lookup = new Uint8Array(32768),
        exactIndex = exact
          ? new Map(palette.slice(1).map((c, i) => [(c[0] << 16) | (c[1] << 8) | c[2], i + 1]))
          : null;
      if (!exactIndex)
        for (let k = 0; k < 32768; k++) {
          if (!count[k]) continue;
          const rgb = sums.map((s) => s[k] / count[k]);
          let best = 1,
            distance = Infinity;
          for (let i = 1; i < palette.length; i++) {
            const c = palette[i],
              d = (rgb[0] - c[0]) ** 2 + (rgb[1] - c[1]) ** 2 + (rgb[2] - c[2]) ** 2;
            if (d < distance) {
              distance = d;
              best = i;
            }
          }
          lookup[k] = best;
        }
      return {
        palette,
        transparent,
        index(pixels) {
          const out = new Uint8Array(pixels.length / 4);
          for (let i = 0; i < out.length; i++) {
            const j = i * 4;
            if (pixels[j + 3] >= 128)
              out[i] = exactIndex
                ? exactIndex.get((pixels[j] << 16) | (pixels[j + 1] << 8) | pixels[j + 2])
                : lookup[bucket(pixels[j], pixels[j + 1], pixels[j + 2])];
          }
          return out;
        },
      };
    },
  };
}
// Decoder dictionary growth lags the encoder by one entry. Grow the code width
// after writing the code that makes that extra entry visible to the decoder.
function lzw(indices, minimum, writer) {
  writer.byte(minimum);
  const block = new Uint8Array(255);
  let used = 0,
    bits = 0,
    bitCount = 0;
  const emitByte = (n) => {
    block[used++] = n;
    if (used === 255) flush();
  };
  const flush = () => {
    if (!used) return;
    writer.byte(used);
    for (let i = 0; i < used; i++) writer.byte(block[i]);
    used = 0;
  };
  const clear = 1 << minimum,
    end = clear + 1;
  let width = minimum + 1,
    next = end + 1;
  const code = (n) => {
    bits |= n << bitCount;
    bitCount += width;
    while (bitCount >= 8) {
      emitByte(bits & 255);
      bits >>>= 8;
      bitCount -= 8;
    }
  };
  const dict = new Map();
  code(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const suffix = indices[i],
      key = prefix * 256 + suffix,
      found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    code(prefix);
    if (next === 1 << width && width < 12) width++;
    if (next < 4096) dict.set(key, next++);
    else {
      code(clear);
      dict.clear();
      width = minimum + 1;
      next = end + 1;
    }
    prefix = suffix;
  }
  code(prefix);
  if (next === 1 << width && width < 12) width++;
  code(end);
  if (bitCount) emitByte(bits & 255);
  flush();
  writer.byte(0);
}
function bounds(indices, previous, w, h, transparent) {
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let i = 0; i < indices.length; i++)
    if (transparent ? indices[i] !== 0 : !previous || indices[i] !== previous[i]) {
      const x = i % w,
        y = Math.floor(i / w);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  if (x1 < 0) return { x: 0, y: 0, w: 1, h: 1, data: new Uint8Array(1) };
  const width = x1 - x0 + 1,
    height = y1 - y0 + 1,
    data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y + y0) * w + x + x0;
      data[y * width + x] = !transparent && previous && previous[i] === indices[i] ? 0 : indices[i];
    }
  return { x: x0, y: y0, w: width, h: height, data };
}
function* encode(p, options) {
  const plan = gifPlan(p, options),
    { width: w, height: h, samples } = plan,
    builder = paletteBuilder(plan.colors);
  for (let i = 0; i < samples.length; i++) {
    builder.add(imagePixels(p, samples[i].frame, w, h));
    yield { stage: 'palette', done: i + 1, total: samples.length };
  }
  const colors = builder.finish(),
    bits = Math.max(1, Math.ceil(Math.log2(colors.palette.length))),
    writer = new Writer();
  writer.text('GIF89a');
  writer.word(w);
  writer.word(h);
  writer.byte(0xf0 | (bits - 1));
  writer.byte(0);
  writer.byte(0);
  for (let i = 0; i < 1 << bits; i++)
    for (const c of colors.palette[i] || [0, 0, 0]) writer.byte(c);
  writer.byte(0x21);
  writer.byte(0xff);
  writer.byte(11);
  writer.text('NETSCAPE2.0');
  writer.byte(3);
  writer.byte(1);
  writer.word(0);
  writer.byte(0);
  let pending = null,
    previous = null,
    elapsed = 0,
    writtenTime = 0;
  const write = (record) => {
    let delay = record.delay;
    while (delay > 0) {
      writer.byte(0x21);
      writer.byte(0xf9);
      writer.byte(4);
      writer.byte(colors.transparent ? 9 : 5);
      const part = Math.min(65535, delay);
      writer.word(part);
      writer.byte(0);
      writer.byte(0);
      writer.byte(0x2c);
      writer.word(record.x);
      writer.word(record.y);
      writer.word(record.w);
      writer.word(record.h);
      writer.byte(0);
      lzw(record.data, Math.max(2, bits), writer);
      delay -= part;
    }
  };
  for (let i = 0; i < samples.length; i++) {
    const indices = colors.index(imagePixels(p, samples[i].frame, w, h));
    elapsed += samples[i].duration;
    const deadline = Math.round(elapsed / 10),
      delay = deadline - writtenTime;
    writtenTime = deadline;
    const identical = previous && indices.every((v, j) => v === previous[j]);
    if (identical) pending.delay += delay;
    else {
      if (pending) write(pending);
      pending = { ...bounds(indices, previous, w, h, colors.transparent), delay };
    }
    previous = indices;
    yield { stage: 'encode', done: i + 1, total: samples.length };
  }
  if (pending) write(pending);
  writer.byte(0x3b);
  return writer.result();
}
export function encodeGif(p, options = {}) {
  const run = encode(p, options);
  let result;
  do {
    result = run.next();
  } while (!result.done);
  return result.value;
}
export async function encodeGifAsync(
  p,
  options = {},
  { signal, progress = () => {}, check = () => {} } = {},
) {
  const run = encode(p, options);
  while (true) {
    if (signal?.aborted) throw Error('已取消 GIF 导出');
    check();
    const result = run.next();
    if (result.done) return result.value;
    progress(result.value);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
