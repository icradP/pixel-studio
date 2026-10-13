import { renderComposite } from './layer-effects.js';
import { LIMITS } from './limits.js';
import { validateScene } from './procedural-model.js';
export const MAX_PIXELS = LIMITS.pixels;
export function blank(w = 64, h = 64, name = '未命名作品') {
  return {
    format: 'pixel-studio',
    version: 1,
    name,
    w,
    h,
    layers: [{ name: '图层 1', visible: true, opacity: 255 }],
    frames: [{ duration: 120, cels: [new Uint8ClampedArray(w * h * 4)] }],
  };
}
export function cloneLayer(l) {
  return {
    ...l,
    ...(l.mask ? { mask: new Uint8ClampedArray(l.mask) } : {}),
    ...(l.adjustments ? { adjustments: { ...l.adjustments } } : {}),
  };
}
export function clone(p) {
  return {
    ...p,
    ...(p.procedural ? { procedural: structuredClone(p.procedural) } : {}),
    ...(p.tags ? { tags: p.tags.map((t) => ({ ...t })) } : {}),
    layers: p.layers.map(cloneLayer),
    frames: p.frames.map((f) => ({ ...f, cels: f.cels.map((c) => new Uint8ClampedArray(c)) })),
  };
}
export function validate(p) {
  if (
    !p ||
    p.format !== 'pixel-studio' ||
    p.version !== 1 ||
    !Number.isInteger(p.w) ||
    !Number.isInteger(p.h) ||
    p.w < 1 ||
    p.h < 1 ||
    p.w > LIMITS.dimension ||
    p.h > LIMITS.dimension ||
    !Array.isArray(p.layers) ||
    !Array.isArray(p.frames) ||
    p.layers.length < 1 ||
    p.layers.length > LIMITS.layers ||
    p.frames.length < 1 ||
    p.frames.length > LIMITS.frames ||
    p.w * p.h * p.layers.length * p.frames.length > MAX_PIXELS
  )
    throw Error('项目尺寸或图层、帧数量超出限制（最大 1024 × 1024，总计 800 万像素）。');
  if (typeof p.name !== 'string' || p.name.length > 160) throw Error('项目名称无效');
  p.layers.forEach((l) => {
    if (
      typeof l.name !== 'string' ||
      l.name.length > 160 ||
      typeof l.visible !== 'boolean' ||
      !Number.isFinite(l.opacity) ||
      l.opacity < 0 ||
      l.opacity > 255
    )
      throw Error('图层数据无效');
    if (l.blend !== undefined && (!Number.isInteger(l.blend) || l.blend < 0 || l.blend > 18))
      throw Error('图层混合模式无效');
    for (const key of ['alphaLock', 'clipping', 'maskEnabled'])
      if (l[key] !== undefined && typeof l[key] !== 'boolean') throw Error('图层效果数据无效');
    if (
      l.mask !== undefined &&
      (!(l.mask instanceof Uint8ClampedArray) || l.mask.length !== p.w * p.h || l.group)
    )
      throw Error('图层遮罩数据无效');
    if (l.adjustments !== undefined) {
      if (
        !l.adjustments ||
        typeof l.adjustments !== 'object' ||
        Array.isArray(l.adjustments) ||
        l.group
      )
        throw Error('图层调整数据无效');
      for (const [key, min, max] of [
        ['hue', -180, 180],
        ['saturation', 0, 200],
        ['brightness', -100, 100],
        ['contrast', -100, 100],
      ]) {
        const n = l.adjustments[key];
        if (n !== undefined && (!Number.isFinite(n) || n < min || n > max))
          throw Error('图层调整范围无效');
      }
    }
    if (l.group && l.clipping) throw Error('图层组不能作为剪贴层');
  });
  const parents = [];
  p.layers.forEach((l, i) => {
    const depth = l.level || 0;
    if (!Number.isInteger(depth) || depth < 0 || depth > 31 || depth > parents.length)
      throw Error('图层组层级无效');
    parents.length = depth;
    if (depth && !p.layers[parents[depth - 1]]?.group) throw Error('图层父级不是组');
    if (l.group !== undefined && typeof l.group !== 'boolean') throw Error('图层组无效');
    if (l.group) parents[depth] = i;
  });
  if (p.tags !== undefined) {
    if (!Array.isArray(p.tags) || p.tags.length > 1024) throw Error('动画标签无效');
    p.tags.forEach((t) => {
      if (
        typeof t.name !== 'string' ||
        t.name.length > 160 ||
        !Number.isInteger(t.from) ||
        !Number.isInteger(t.to) ||
        t.from < 0 ||
        t.to < t.from ||
        t.to >= p.frames.length ||
        ![0, 1, 2, 3].includes(t.direction) ||
        !Number.isInteger(t.repeat) ||
        t.repeat < 0 ||
        t.repeat > 65535 ||
        !/^#[0-9a-f]{6}$/i.test(t.color)
      )
        throw Error('动画标签范围或数据无效');
    });
  }
  p.frames.forEach((f) => {
    if (
      !Number.isFinite(f.duration) ||
      f.duration < 20 ||
      f.duration > 10000 ||
      !Array.isArray(f.cels) ||
      f.cels.length !== p.layers.length
    )
      throw Error('动画数据无效');
    f.cels.forEach((c) => {
      if (c.length !== p.w * p.h * 4) throw Error('像素数据不完整');
    });
  });
  validateScene(p.procedural, p);
  return p;
}
function encodeBytes(c) {
  let s = '';
  for (let i = 0; i < c.length; i += 8192) s += String.fromCharCode(...c.subarray(i, i + 8192));
  return btoa(s);
}
export function serialize(p) {
  return JSON.stringify({
    ...p,
    layers: p.layers.map((l) => ({ ...l, ...(l.mask ? { mask: encodeBytes(l.mask) } : {}) })),
    frames: p.frames.map((f) => ({
      ...f,
      cels: f.cels.map((c) => {
        let s = '';
        for (let i = 0; i < c.length; i += 8192)
          s += String.fromCharCode(...c.subarray(i, i + 8192));
        return btoa(s);
      }),
    })),
  });
}
export function deserialize(s) {
  const p = JSON.parse(s);
  if (!p.frames || !Array.isArray(p.frames)) throw Error('不是像素画室项目');
  if (!Array.isArray(p.layers) || p.layers.length > LIMITS.layers) throw Error('图层数据无效');
  p.layers = p.layers.map((l) => {
    if (l.mask === undefined) return l;
    if (typeof l.mask !== 'string' || l.mask.length > Math.ceil(LIMITS.dimension ** 2 / 3) * 4)
      throw Error('图层遮罩数据无效');
    return { ...l, mask: Uint8ClampedArray.from(atob(l.mask), (x) => x.charCodeAt(0)) };
  });
  validate({
    ...p,
    frames: p.frames.map((f) => ({
      ...f,
      cels: (f.cels || []).map((c) => ({
        length:
          typeof c === 'string'
            ? Math.floor((c.length * 3) / 4) - (c.endsWith('==') ? 2 : c.endsWith('=') ? 1 : 0)
            : -1,
      })),
    })),
  });
  p.frames = p.frames.map((f) => ({
    ...f,
    cels: f.cels.map((c) => Uint8ClampedArray.from(atob(c), (x) => x.charCodeAt(0))),
  }));
  return validate(p);
}
export const composite = renderComposite;
export function rgba(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
    255,
  ];
}
export function line(x0, y0, x1, y1, visit) {
  const dx = Math.abs(x1 - x0),
    sx = x0 < x1 ? 1 : -1,
    dy = -Math.abs(y1 - y0),
    sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    visit(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e = 2 * err;
    if (e >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}
export function flood(c, w, h, x, y, color) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const start = (y * w + x) * 4,
    target = Array.from(c.subarray(start, start + 4));
  if (target.every((v, i) => v === color[i])) return;
  const stack = [y * w + x];
  while (stack.length) {
    const n = stack.pop(),
      i = n * 4;
    if (!target.every((v, k) => c[i + k] === v)) continue;
    c.set(color, i);
    if (n % w > 0) stack.push(n - 1);
    if (n % w < w - 1) stack.push(n + 1);
    if (n >= w) stack.push(n - w);
    if (n < w * (h - 1)) stack.push(n + w);
  }
}
export function demo() {
  const p = blank(160, 112, '雨巷 · 霓虹练习');
  p.layers = [
    { name: '夜色与建筑', visible: true, opacity: 255 },
    { name: '招牌与街灯', visible: true, opacity: 255 },
    { name: '雨点与倒影', visible: true, opacity: 255 },
  ];
  p.frames = [];
  const bg = new Uint8ClampedArray(p.w * p.h * 4),
    lights = new Uint8ClampedArray(bg.length);
  const rect = (c, x, y, w, h, col) => {
    const a = rgba(col);
    for (let yy = Math.max(0, y); yy < Math.min(p.h, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(p.w, x + w); xx++) c.set(a, (yy * p.w + xx) * 4);
  };
  rect(bg, 0, 0, 160, 112, '#172c39');
  rect(bg, 0, 82, 160, 30, '#203c4a');
  let seed = 47;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let b = 0; b < 9; b++) {
    const x = b * 20 - 4,
      y = 8 + Math.floor(rand() * 24),
      w = 18 + Math.floor(rand() * 7);
    rect(bg, x, y, w, 83 - y, b % 2 ? '#294653' : '#213946');
    rect(bg, x + 1, y + 1, 2, 82 - y, '#3b5b67');
    for (let yy = y + 7; yy < 78; yy += 11)
      for (let xx = x + 5; xx < x + w - 3; xx += 7) {
        rect(bg, xx, yy, 4, 6, '#102834');
        if (rand() > 0.6) rect(lights, xx, yy, 3, 4, rand() > 0.5 ? '#628f9b' : '#e6b866');
      }
  }
  rect(bg, 45, 39, 55, 42, '#3d5360');
  rect(bg, 48, 42, 49, 36, '#172d3b');
  rect(bg, 49, 64, 45, 17, '#ad5968');
  rect(bg, 53, 67, 36, 13, '#362f46');
  rect(bg, 49, 78, 44, 3, '#e18186');
  rect(bg, 46, 83, 52, 2, '#5b6670');
  rect(lights, 44, 34, 58, 10, '#713d60');
  rect(lights, 46, 36, 54, 6, '#ef87a0');
  rect(lights, 48, 37, 50, 1, '#ffd5b4');
  const glyphs = ['111101111', '110101110', '101101101', '111010010', '100100111'];
  glyphs.forEach((g, k) => {
    for (let i = 0; i < 9; i++)
      if (g[i] === '1')
        rect(lights, 51 + k * 9 + (i % 3) * 2, 38 + Math.floor(i / 3), 1, 1, '#62334b');
  });
  rect(bg, 108, 25, 2, 61, '#496570');
  rect(bg, 106, 24, 18, 2, '#496570');
  rect(lights, 119, 26, 5, 4, '#f3d7a2');
  rect(bg, 12, 54, 15, 31, '#375466');
  rect(bg, 14, 57, 11, 26, '#1b3444');
  rect(lights, 15, 58, 9, 4, '#71acb7');
  rect(lights, 15, 66, 3, 6, '#df9b85');
  rect(bg, 8, 84, 25, 2, '#496b76');
  for (let i = 0; i < 24; i++) {
    const x = Math.floor(rand() * 160),
      y = 88 + Math.floor(rand() * 23);
    rect(bg, x, y, 3 + Math.floor(rand() * 10), 1, '#2a4b59');
  }
  for (let f = 0; f < 6; f++) {
    const rain = new Uint8ClampedArray(bg.length);
    seed = 91;
    for (let i = 0; i < 42; i++) {
      const x = Math.floor(rand() * 160),
        y = (Math.floor(rand() * 112) + f * 6) % 112;
      rect(rain, x, y, 1, 2, '#56808a');
    }
    for (let i = 0; i < 11; i++)
      rect(
        rain,
        46 + Math.floor(rand() * 47),
        88 + i * 2,
        2 + Math.floor(rand() * 13),
        1,
        f % 2 ? '#976175' : '#815267',
      );
    p.frames.push({
      duration: 150,
      cels: [new Uint8ClampedArray(bg), new Uint8ClampedArray(lights), rain],
    });
  }
  return p;
}
