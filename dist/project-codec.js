import { packCel, validateCel, readCel } from './cel-storage.js';
import { canvasPixels, PROJECT_BYTES } from './pixel-budget.js';
const encode = (bytes) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};
const decode = (text, max) => {
  if (
    typeof text !== 'string' ||
    text.length > Math.ceil(max / 3) * 4 ||
    text.length % 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(text)
  )
    throw Error('压缩项目数据无效');
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
};
export function encodeProject(p) {
  const pool = [],
    byIdentity = new Map(),
    byData = new Map();
  function ref(input) {
    if (byIdentity.has(input)) return byIdentity.get(input);
    const c = packCel(input),
      base = c.base ? ref(c.base) : undefined,
      bytes = new Uint8Array(c.compression ? 0 : c.data.length * 4),
      view = new DataView(bytes.buffer);
    if (!c.compression) c.data.forEach((word, i) => view.setUint32(i * 4, word, true));
    const data = encode(c.compression ? c.data : bytes),
      key = c.encoding + ':' + c.compression + ':' + base + ':' + data;
    if (!byData.has(key)) {
      byData.set(key, pool.length);
      pool.push({
        encoding: c.encoding,
        data,
        visible: c.visible,
        ...(c.compression ? { compression: c.compression, words: c.words } : {}),
        ...(base !== undefined ? { base } : {}),
      });
    }
    const id = byData.get(key);
    byIdentity.set(input, id);
    return id;
  }
  const frames = p.frames.map((f) => ({ ...f, cels: f.cels.map(ref) }));
  return JSON.stringify({
    ...p,
    version: 2,
    codec: 'rle-xor32',
    layers: p.layers.map((l) => ({ ...l, ...(l.mask ? { mask: encode(l.mask) } : {}) })),
    frames,
    pool,
  });
}
export function decodeProject(p) {
  const length = canvasPixels(p.w, p.h) * 4;
  if (
    p.codec !== 'rle-xor32' ||
    !Number.isInteger(p.w) ||
    !Number.isInteger(p.h) ||
    p.w < 1 ||
    p.h < 1 ||
    !Array.isArray(p.pool) ||
    !Array.isArray(p.frames) ||
    p.frames.length > 240 ||
    !Array.isArray(p.layers)
  )
    throw Error('压缩项目格式无效');
  if (p.pool.length > p.layers.length * p.frames.length * 2) throw Error('压缩单元池无效');
  const compact =
    p.storage === 'packed' || p.w * p.h * p.layers.length * p.frames.length > 8_000_000;
  let total = 0;
  const pool = [];
  for (const entry of p.pool) {
    if (
      !entry ||
      !['rle32', 'xor32'].includes(entry.encoding) ||
      typeof entry.visible !== 'boolean'
    )
      throw Error('压缩单元无效');
    const bytes = decode(entry.data, length + 4096);
    total += bytes.length;
    if (total > PROJECT_BYTES || (!entry.compression && bytes.length % 4))
      throw Error('压缩项目超过存储预算');
    const words = new Uint32Array(entry.compression ? 0 : Math.floor(bytes.length / 4)),
      view = new DataView(bytes.buffer);
    for (let i = 0; i < words.length; i++) words[i] = view.getUint32(i * 4, true);
    const c = {
      encoding: entry.encoding,
      length,
      data: entry.compression ? bytes : words,
      visible: entry.visible,
      ...(entry.compression ? { compression: entry.compression, words: entry.words } : {}),
    };
    if (entry.encoding === 'xor32') {
      if (
        !Number.isInteger(entry.base) ||
        !pool[entry.base] ||
        pool[entry.base].encoding !== 'rle32'
      )
        throw Error('帧差参考无效');
      c.base = pool[entry.base];
    }
    validateCel(c, length);
    pool.push(c);
  }
  const frames = p.frames.map((f) => ({
    ...f,
    cels: f.cels.map((id) => {
      if (!Number.isInteger(id) || !pool[id]) throw Error('单元引用无效');
      return compact ? pool[id] : new Uint8ClampedArray(readCel(pool[id]));
    }),
  }));
  const layers = p.layers.map((l) => ({
    ...l,
    ...(l.mask ? { mask: new Uint8ClampedArray(decode(l.mask, length / 4)) } : {}),
  }));
  const out = { ...p, ...(compact ? { storage: 'packed' } : {}), version: 1, layers, frames };
  delete out.pool;
  delete out.codec;
  return out;
}
