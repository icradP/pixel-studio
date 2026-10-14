import { packBytes, unpackBytes } from './byte-pack.js';
// Immutable packed cels. Only editCel() materializes a writable pixel plane.
const cache = new Map();
let cacheBytes = 0;
const CACHE_LIMIT = 16 * 1024 * 1024;
export const packed = (cel) => cel?.encoding === 'rle32' || cel?.encoding === 'xor32';
export function validateCel(c, length) {
  if (!c || c.length !== length) throw Error('像素数据不完整');
  if (!packed(c)) return;
  if (
    !(
      (c.data instanceof Uint32Array && c.compression === undefined) ||
      (c.data instanceof Uint8Array &&
        c.compression === 'lz' &&
        Number.isInteger(c.words) &&
        c.words > 0 &&
        c.words * 4 <= length + 4096)
    ) ||
    c.data.byteLength > length + 4096
  )
    throw Error('压缩像素数据无效');
  if (c.encoding === 'xor32') {
    if (!c.base || c.base.encoding !== 'rle32') throw Error('帧差参考无效');
    validateCel(c.base, length);
  }
  const data = celWords(c);
  let n = 0;
  for (let i = 0; i < data.length;) {
    const header = data[i++],
      count = header & 0x7fffffff;
    if (!count || n + count > length / 4) throw Error('压缩像素长度无效');
    i += header >>> 31 ? 1 : count;
    if (i > data.length) throw Error('压缩像素数据不完整');
    n += count;
  }
  if (n !== length / 4) throw Error('压缩像素长度无效');
  return data;
}
function remember(c, pixels) {
  cache.set(c, pixels);
  cacheBytes += pixels.byteLength;
  while (cacheBytes > CACHE_LIMIT && cache.size > 1) {
    const first = cache.keys().next().value;
    cacheBytes -= cache.get(first).byteLength;
    cache.delete(first);
  }
  return pixels;
}
export function readCel(c) {
  if (!packed(c)) return c;
  if (cache.has(c)) {
    const pixels = cache.get(c);
    cache.delete(c);
    cache.set(c, pixels);
    return pixels;
  }
  const data = validateCel(c, c.length);
  const pixels = new Uint8ClampedArray(c.length),
    words = new Uint32Array(pixels.buffer);
  let at = 0;
  for (let i = 0; i < data.length;) {
    const header = data[i++],
      count = header & 0x7fffffff;
    if (header >>> 31) words.fill(data[i++], at, at + count);
    else {
      words.set(data.subarray(i, i + count), at);
      i += count;
    }
    at += count;
  }
  if (c.encoding === 'xor32') {
    const base = readCel(c.base),
      b = new Uint32Array(base.buffer, base.byteOffset, base.length / 4);
    for (let i = 0; i < words.length; i++) words[i] ^= b[i];
  }
  return remember(c, pixels);
}
export const cloneCel = (c) => (packed(c) ? c : new Uint8ClampedArray(c));
export function editCel(frame, index) {
  const c = frame.cels[index];
  return packed(c) ? (frame.cels[index] = new Uint8ClampedArray(readCel(c))) : c;
}
export const celVisible = (c) => (packed(c) ? c.visible : c.some((v, i) => i % 4 === 3 && v));
function runs(words) {
  const out = [];
  for (let i = 0; i < words.length;) {
    let end = i + 1;
    while (end < words.length && words[end] === words[i]) end++;
    if (end - i >= 3) {
      out.push((0x80000000 | (end - i)) >>> 0, words[i]);
      i = end;
    } else {
      const start = i++;
      while (
        i < words.length &&
        (i + 2 >= words.length || words[i] !== words[i + 1] || words[i] !== words[i + 2])
      )
        i++;
      out.push(i - start);
      for (let j = start; j < i; j++) out.push(words[j]);
    }
  }
  return Uint32Array.from(out);
}
export function packCel(input, base = null) {
  if (packed(input) && !base) return input;
  const pixels = readCel(input),
    words = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length / 4);
  const full = {
    encoding: 'rle32',
    length: pixels.length,
    ...packedWords(runs(words)),
    visible: celVisible(pixels),
  };
  if (!base || base.encoding !== 'rle32') return full;
  const b = readCel(base),
    bw = new Uint32Array(b.buffer, b.byteOffset, b.length / 4),
    delta = new Uint32Array(words.length);
  for (let i = 0; i < words.length; i++) delta[i] = words[i] ^ bw[i];
  const compressed = packedWords(runs(delta));
  return compressed.data.byteLength < full.data.byteLength
    ? { encoding: 'xor32', length: pixels.length, ...compressed, base, visible: full.visible }
    : full;
}
const emptyCache = new Map();
export function emptyCel(length) {
  if (!emptyCache.has(length))
    emptyCache.set(length, {
      encoding: 'rle32',
      length,
      data: new Uint32Array([0x80000000 | (length / 4), 0]),
      visible: false,
    });
  return emptyCache.get(length);
}
export function storageBytes(project) {
  const seen = new Set();
  let bytes = 0;
  const visit = (c) => {
    if (seen.has(c)) return;
    seen.add(c);
    if (packed(c)) {
      bytes += c.data.byteLength;
      if (c.base) visit(c.base);
    } else bytes += c.byteLength ?? c.length;
  };
  for (const f of project.frames) for (const c of f.cels) visit(c);
  for (const l of project.layers) bytes += l.mask?.byteLength || 0;
  return bytes;
}
export function compactProject(p) {
  return {
    ...p,
    storage: 'packed',
    frames: p.frames.map((f) => ({ ...f, cels: f.cels.map((c) => packCel(c)) })),
  };
}
export const decodeCacheBytes = () => cacheBytes;

export const emptyPackedCel = (c) =>
  packed(c) &&
  c.encoding === 'rle32' &&
  !c.compression &&
  c.data.length === 2 &&
  c.data[1] >>> 24 === 0;

function packedWords(words) {
  const bytes = new Uint8Array(words.buffer, words.byteOffset, words.byteLength),
    compressed = packBytes(bytes);
  return compressed.byteLength < bytes.byteLength
    ? { compression: 'lz', words: words.length, data: compressed }
    : { data: words };
}
function celWords(c) {
  if (!c.compression) return c.data;
  const bytes = unpackBytes(c.data, c.words * 4);
  return new Uint32Array(bytes.buffer);
}
