import { readCel, cloneCel, editCel, compactProject, emptyCel, packCel } from './cel-storage.js';
// Independent browser implementations of publicly described pixel-art workflows.
// No original Aseprite extension code or assets are bundled. See plugin-sources.txt.
import { clone, validate, composite, rgba, line, MAX_PIXELS } from './engine.js';
import { LIMITS } from './limits.js';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const integer = (v, min, max, label) => {
  if (!Number.isInteger(v) || v < min || v > max) throw Error(label + '范围：' + min + '–' + max);
  return v;
};
export function ensureCapacity(_p, _layers, frames) {
  if (frames > LIMITS.frames) throw Error('动画帧数超过 240，请减少生成帧数。');
}
export function addRasterLayer(p, name, cels) {
  ensureCapacity(p, p.layers.length + 1, p.frames.length);
  const out = clone(p);
  out.layers.push({ name, visible: true, opacity: 255 });
  out.frames.forEach((f, i) =>
    f.cels.push(
      cels[i]
        ? p.storage === 'packed'
          ? packCel(cels[i])
          : cloneCel(cels[i])
        : p.storage === 'packed'
          ? emptyCel(p.w * p.h * 4)
          : new Uint8ClampedArray(p.w * p.h * 4),
    ),
  );
  return validate(
    out.storage === 'packed' || out.w * out.h * out.layers.length * out.frames.length > MAX_PIXELS
      ? compactProject(out)
      : out,
    { reusePixels: true },
  );
}
export function rectangleMask(w, h, a, b) {
  const out = new Uint8Array(w * h),
    x0 = clamp(Math.min(a.x, b.x), 0, w - 1),
    x1 = clamp(Math.max(a.x, b.x), 0, w - 1),
    y0 = clamp(Math.min(a.y, b.y), 0, h - 1),
    y1 = clamp(Math.max(a.y, b.y), 0, h - 1);
  for (let y = y0; y <= y1; y++) out.fill(1, y * w + x0, y * w + x1 + 1);
  return out;
}
export function maskBounds(mask, w, h) {
  if (!mask) return null;
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      const x = i % w,
        y = Math.floor(i / w);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
export function snapMask(mask, w, h, { cellW = 16, cellH = 16, offsetX = 0, offsetY = 0 } = {}) {
  integer(cellW, 1, Number.MAX_SAFE_INTEGER, '网格宽度');
  integer(cellH, 1, Number.MAX_SAFE_INTEGER, '网格高度');
  integer(offsetX, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, '网格 X 偏移');
  integer(offsetY, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, '网格 Y 偏移');
  const b = maskBounds(mask, w, h);
  if (!b) throw Error('请先使用矩形选区或魔法选择笔画出选区。');
  const x0 = Math.floor((b.x - offsetX) / cellW) * cellW + offsetX,
    y0 = Math.floor((b.y - offsetY) / cellH) * cellH + offsetY,
    x1 = Math.ceil((b.x + b.w - offsetX) / cellW) * cellW + offsetX - 1,
    y1 = Math.ceil((b.y + b.h - offsetY) / cellH) * cellH + offsetY - 1;
  return rectangleMask(w, h, { x: x0, y: y0 }, { x: x1, y: y1 });
}
export function moveSelected(c, w, h, mask, dx, dy, copy = false) {
  integer(dx, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'X 位移');
  integer(dy, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'Y 位移');
  if (!maskBounds(mask, w, h)) throw Error('请先创建选区。');
  const out = new Uint8ClampedArray(c);
  if (!copy) for (let i = 0; i < mask.length; i++) if (mask[i]) out.fill(0, i * 4, i * 4 + 4);
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      const x = (i % w) + dx,
        y = Math.floor(i / w) + dy;
      if (x >= 0 && y >= 0 && x < w && y < h)
        out.set(c.subarray(i * 4, i * 4 + 4), (y * w + x) * 4);
    }
  return out;
}
function polygon(data, w, h, vertices, color) {
  const col = rgba(color);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let inside = false;
      for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const a = vertices[i],
          b = vertices[j];
        if (
          a[1] > y + 0.5 !== b[1] > y + 0.5 &&
          x + 0.5 < ((b[0] - a[0]) * (y + 0.5 - a[1])) / (b[1] - a[1]) + a[0]
        )
          inside = !inside;
      }
      if (inside) data.set(col, (y * w + x) * 4);
    }
}
export function isoBox({
  left = 12,
  right = 12,
  height = 18,
  corner = 2,
  top = '#b4cdea',
  leftColor = '#617fae',
  rightColor = '#3d567f',
  stroke = '#18283e',
  highlight = '#e2f0ff',
  wire = false,
} = {}) {
  integer(left, 1, 100, '左边长度');
  integer(right, 1, 100, '右边长度');
  integer(height, 1, 250, '高度');
  integer(corner, 2, 3, '角点宽度');
  const extra = corner - 2,
    w = 2 * (left + right) + 1 + extra,
    h = left + right + height + 1,
    data = new Uint8ClampedArray(w * h * 4),
    a = [2 * left + extra, 0],
    b = [w - 1, right],
    c = [2 * right + extra, left + right],
    d = [0, left],
    down = (p) => [p[0], p[1] + height];
  if (!wire) {
    polygon(data, w, h, [a, b, c, d], top);
    polygon(data, w, h, [d, c, down(c), down(d)], leftColor);
    polygon(data, w, h, [c, b, down(b), down(c)], rightColor);
  }
  const edge = (p, q, col) =>
    line(p[0], p[1], q[0], q[1], (x, y) => data.set(rgba(col), (y * w + x) * 4));
  for (const [p, q] of [
    [a, b],
    [b, c],
    [c, d],
    [d, a],
    [d, down(d)],
    [c, down(c)],
    [b, down(b)],
    [down(d), down(c)],
    [down(c), down(b)],
  ])
    edge(p, q, stroke);
  if (!wire) {
    edge(d, c, highlight);
    edge(c, b, highlight);
    edge(c, down(c), highlight);
  }
  return { w, h, data };
}
export function placeRaster(raster, w, h, x, y) {
  integer(x, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'X 位置');
  integer(y, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'Y 位置');
  const out = new Uint8ClampedArray(w * h * 4);
  for (let sy = 0; sy < raster.h; sy++)
    for (let sx = 0; sx < raster.w; sx++) {
      const dx = x + sx,
        dy = y + sy;
      if (dx >= 0 && dy >= 0 && dx < w && dy < h)
        out.set(
          raster.data.subarray((sy * raster.w + sx) * 4, (sy * raster.w + sx + 1) * 4),
          (dy * w + dx) * 4,
        );
    }
  return out;
}
export function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (((h * 60) % 360) + 360) % 360;
  }
  return [h, max ? d / max : 0, max];
}
export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  v = clamp(v, 0, 1);
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c,
    values =
      h < 60
        ? [c, x, 0]
        : h < 120
          ? [x, c, 0]
          : h < 180
            ? [0, c, x]
            : h < 240
              ? [0, x, c]
              : h < 300
                ? [x, 0, c]
                : [c, 0, x];
  return values.map((n) => Math.round((n + m) * 255));
}
function nearestColor(c, palette) {
  let best = c,
    distance = Infinity;
  for (const hex of palette) {
    const p = rgba(hex),
      d = p.slice(0, 3).reduce((s, v, i) => s + (v - c[i]) ** 2, 0);
    if (d < distance) {
      distance = d;
      best = p;
    }
  }
  return best.slice(0, 3);
}
export function magicPixels(base, w, h, mask, config, color, palette = []) {
  const out = new Uint8ClampedArray(base),
    mode = config.mode,
    fg = rgba(color),
    outline = rgba(config.outline || '#18283e'),
    strength = clamp(config.strength ?? 0.2, 0, 1),
    write = (i, c) => {
      const rgb = config.indexed && palette.length ? nearestColor(c, palette) : c;
      out.set([rgb[0], rgb[1], rgb[2], c[3]], i * 4);
    };
  if (['lift', 'merge', 'select', 'select-erase'].includes(mode)) return out;
  if (['outline-brush', 'graffiti'].includes(mode)) {
    const painted = new Uint8Array(mask);
    if (mode === 'graffiti')
      for (let i = 0; i < mask.length; i++)
        if (mask[i]) {
          const random = ((Math.imul(i + 1, 1103515245) + 12345) >>> 0) / 4294967296;
          if (random < strength * 0.35) {
            const n = 1 + (Math.floor(random * 200) % Math.max(2, Math.round(2 + strength * 14)));
            for (let k = 1; k <= n && i + k * w < mask.length; k++) painted[i + k * w] = 1;
          }
          if (random > 0.97 && (i % w) + 2 < w) painted[i + 2] = 1;
        }
    if (mode === 'outline-brush')
      for (let i = 0; i < painted.length; i++)
        if (painted[i])
          for (const [dx, dy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ]) {
            const x = (i % w) + dx,
              y = Math.floor(i / w) + dy,
              n = y * w + x;
            if (x >= 0 && y >= 0 && x < w && y < h && !painted[n]) write(n, outline);
          }
    for (let i = 0; i < painted.length; i++) if (painted[i]) write(i, fg);
    return out;
  }
  if (mode === 'outline-shape') {
    const seen = new Uint8Array(mask.length),
      stack = [];
    for (let i = 0; i < mask.length; i++)
      if (mask[i] && base[i * 4 + 3]) {
        seen[i] = 1;
        stack.push(i);
      }
    for (let k = 0; k < stack.length; k++) {
      const i = stack[k];
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const x = (i % w) + dx,
          y = Math.floor(i / w) + dy,
          n = y * w + x;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (base[n * 4 + 3]) {
          if (!seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        } else write(n, fg);
      }
    }
    return out;
  }
  let mix = null;
  if (mode.startsWith('mix-')) {
    const colors = new Map();
    for (let i = 0; i < mask.length; i++)
      if (mask[i] && base[i * 4 + 3]) {
        const c = [...base.subarray(i * 4, i * 4 + 3)],
          key = c.join(',');
        const entry = colors.get(key);
        if (entry) entry.weight++;
        else colors.set(key, { c, weight: 1 });
      }
    let total = 0,
      a = 0,
      b = 0,
      c = 0;
    for (const entry of colors.values()) {
      const weight = config.proportional ? entry.weight : 1;
      total += weight;
      if (mode === 'mix-hsv') {
        const v = rgbToHsv(...entry.c);
        a += Math.cos((v[0] * Math.PI) / 180) * weight * v[1];
        b += Math.sin((v[0] * Math.PI) / 180) * weight * v[1];
        c += v[2] * weight;
      } else {
        a += entry.c[0] * weight;
        b += entry.c[1] * weight;
        c += entry.c[2] * weight;
      }
    }
    if (total)
      mix =
        mode === 'mix-hsv'
          ? hsvToRgb((Math.atan2(b, a) * 180) / Math.PI, Math.hypot(a, b) / total, c / total)
          : [a / total, b / total, c / total];
  }
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || !base[i * 4 + 3]) continue;
    const c = [...base.subarray(i * 4, i * 4 + 4)];
    const hsv = rgbToHsv(...c);
    if (mode === 'desaturate') c.splice(0, 3, ...hsvToRgb(hsv[0], 0, hsv[2]));
    else if (mode === 'colorize')
      c.splice(0, 3, ...hsvToRgb(rgbToHsv(...fg)[0], rgbToHsv(...fg)[1], hsv[2]));
    else if (mode.startsWith('shift-')) {
      const sign = config.negative ? -1 : 1;
      if (mode === 'shift-hue') hsv[0] += strength * 360 * sign;
      if (mode === 'shift-saturation') hsv[1] += strength * sign;
      if (mode === 'shift-value') hsv[2] += strength * sign;
      c.splice(0, 3, ...hsvToRgb(...hsv));
    } else if (mix) c.splice(0, 3, ...mix);
    write(i, c);
  }
  return out;
}
export function extractMasked(p, frame, layer, mask, merge = false) {
  if (!maskBounds(mask, p.w, p.h)) throw Error('未选中像素。');
  const src = merge
      ? composite({ ...p, layers: p.layers.slice(0, layer + 1) }, frame)
      : readCel(p.frames[frame].cels[layer]),
    cel = new Uint8ClampedArray(src.length);
  for (let i = 0; i < mask.length; i++) if (mask[i]) cel.set(src.subarray(i * 4, i * 4 + 4), i * 4);
  const out = addRasterLayer(p, merge ? '魔法合并' : '魔法提取', { [frame]: cel });
  if (!merge)
    for (let i = 0; i < mask.length; i++)
      if (mask[i]) editCel(out.frames[frame], layer).fill(0, i * 4, i * 4 + 4);
  return out;
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
export function loopLayers(p, periods, duration = 120) {
  integer(duration, 20, 10000, '帧时长');
  if (periods.length !== p.layers.length) throw Error('每个图层都需要一个周期。');
  let count = 1;
  for (const n of periods) {
    integer(n, 1, p.frames.length, '图层周期');
    count = (count / gcd(count, n)) * n;
    if (count > 240) throw Error('组合循环超过 240 帧，请使用较短的图层周期。');
  }
  ensureCapacity(p, p.layers.length, count);
  const out = {
    ...p,
    layers: p.layers.map((l) => ({ ...l })),
    frames: Array.from({ length: count }, (_, f) => ({
      duration,
      cels: p.layers.map((_, l) => cloneCel(p.frames[f % periods[l]].cels[l])),
    })),
  };
  if (out.tags)
    out.tags = out.tags
      .filter((t) => t.from < out.frames.length)
      .map((t) => ({ ...t, to: Math.min(t.to, out.frames.length - 1) }));
  return validate(
    out.storage === 'packed' || out.w * out.h * out.layers.length * out.frames.length > MAX_PIXELS
      ? compactProject(out)
      : out,
    { reusePixels: true },
  );
}
export function importAnimation(
  p,
  source,
  {
    sourceLayer = -1,
    first = 0,
    last = source.frames.length - 1,
    start = 0,
    count = source.frames.length,
    x = 0,
    y = 0,
    endX = 0,
    endY = 0,
    path = 'static',
    amplitude = 8,
    cycles = 1,
    duration = 120,
    crop = null,
  } = {},
) {
  validate(source);
  integer(sourceLayer, -1, source.layers.length - 1, '来源图层');
  integer(first, 0, source.frames.length - 1, '起始帧');
  integer(last, first, source.frames.length - 1, '结束帧');
  integer(start, 0, 239, '放置帧');
  integer(count, 1, 240, '生成帧数');
  integer(duration, 20, 10000, '帧时长');
  for (const n of [x, y, endX, endY])
    integer(n, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, '移动位置');
  if (
    !['static', 'linear', 'sine'].includes(path) ||
    !Number.isFinite(amplitude) ||
    Math.abs(amplitude) > Number.MAX_SAFE_INTEGER ||
    !Number.isFinite(cycles) ||
    cycles < 0 ||
    cycles > 20
  )
    throw Error('动画轨迹参数无效');
  const total = Math.max(p.frames.length, start + count);
  ensureCapacity(p, p.layers.length + 1, total);
  const out = clone(p);
  while (out.frames.length < total)
    out.frames.push({
      duration,
      cels: p.layers.map(() =>
        p.storage === 'packed' ? emptyCel(p.w * p.h * 4) : new Uint8ClampedArray(p.w * p.h * 4),
      ),
    });
  out.layers.push({ name: '动画 · ' + source.name.slice(0, 120), visible: true, opacity: 255 });
  out.frames.forEach((f) =>
    f.cels.push(
      p.storage === 'packed' ? emptyCel(p.w * p.h * 4) : new Uint8ClampedArray(p.w * p.h * 4),
    ),
  );
  for (let i = 0; i < count; i++) {
    const f = first + (i % (last - first + 1)),
      t = count === 1 ? 0 : i / (count - 1),
      offset = path === 'sine' ? amplitude * Math.sin((i / count) * Math.PI * 2 * cycles) : 0,
      dx = Math.round(x + (path === 'static' ? 0 : (endX - x) * t)),
      dy = Math.round(y + (path === 'static' ? 0 : (endY - y) * t) + offset),
      src = sourceLayer < 0 ? composite(source, f) : readCel(source.frames[f].cels[sourceLayer]),
      pixels = crop ? new Uint8ClampedArray(src.length) : src;
    if (crop) {
      for (let cy = crop.y; cy < crop.y + crop.h; cy++)
        for (let cx = crop.x; cx < crop.x + crop.w; cx++)
          if (cx >= 0 && cy >= 0 && cx < source.w && cy < source.h) {
            const n = (cy * source.w + cx) * 4;
            pixels.set(src.subarray(n, n + 4), n);
          }
    }
    const raster = placeRaster({ w: source.w, h: source.h, data: pixels }, p.w, p.h, dx, dy);
    out.frames[start + i].cels[out.layers.length - 1] =
      out.storage === 'packed' ? packCel(raster) : raster;
  }
  return validate(
    out.storage === 'packed' || out.w * out.h * out.layers.length * out.frames.length > MAX_PIXELS
      ? compactProject(out)
      : out,
    { reusePixels: true },
  );
}
export function shadeNormals(
  diffuse,
  normal,
  {
    azimuth = 315,
    elevation = 55,
    ambient = 0.25,
    diffuseStrength = 0.8,
    specular = 0.25,
    hardness = 32,
    lightColor = '#ffffff',
    ambientColor = '#ffffff',
    flipY = false,
    specularMap = null,
  } = {},
) {
  for (const v of [azimuth, elevation, ambient, diffuseStrength, specular, hardness])
    if (!Number.isFinite(v)) throw Error('光照参数无效');
  if (
    (normal && normal.length !== diffuse.length) ||
    (specularMap && specularMap.length !== diffuse.length)
  )
    throw Error('贴图尺寸必须相同');
  const a = (azimuth * Math.PI) / 180,
    e = (elevation * Math.PI) / 180,
    l = [Math.cos(a) * Math.cos(e), -Math.sin(a) * Math.cos(e), Math.sin(e)],
    hn = Math.hypot(l[0], l[1], l[2] + 1) || 1,
    half = [l[0] / hn, l[1] / hn, (l[2] + 1) / hn],
    lc = rgba(lightColor),
    ac = rgba(ambientColor),
    out = new Uint8ClampedArray(diffuse.length);
  for (let i = 0; i < diffuse.length; i += 4) {
    if (!diffuse[i + 3]) continue;
    let n =
      normal && normal[i + 3]
        ? [
            normal[i] / 127.5 - 1,
            (normal[i + 1] / 127.5 - 1) * (flipY ? -1 : 1),
            normal[i + 2] / 127.5 - 1,
          ]
        : [0, 0, 1];
    const len = Math.hypot(...n) || 1;
    n = n.map((v) => v / len);
    const ndl = Math.max(
        0,
        n.reduce((s, v, k) => s + v * l[k], 0),
      ),
      spec =
        ndl > 0
          ? Math.pow(
              Math.max(
                0,
                n.reduce((s, v, k) => s + v * half[k], 0),
              ),
              clamp(hardness, 1, 256),
            ) *
            clamp(specular, 0, 2) *
            (specularMap ? specularMap[i] / 255 : 1)
          : 0;
    for (let c = 0; c < 3; c++)
      out[i + c] =
        diffuse[i + c] *
          ((clamp(ambient, 0, 1) * ac[c]) / 255 +
            (ndl * clamp(diffuseStrength, 0, 2) * lc[c]) / 255) +
        spec * lc[c];
    out[i + 3] = diffuse[i + 3];
  }
  return out;
}
