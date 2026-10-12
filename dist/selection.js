import { maskBounds } from './plugin-core.js';

export function ellipseMask(w, h, a, b) {
  const out = new Uint8Array(w * h),
    x0 = Math.min(a.x, b.x),
    y0 = Math.min(a.y, b.y),
    rx = (Math.abs(a.x - b.x) + 1) / 2,
    ry = (Math.abs(a.y - b.y) + 1) / 2,
    cx = x0 + rx,
    cy = y0 + ry;
  for (let y = Math.max(0, y0); y < Math.min(h, y0 + ry * 2); y++)
    for (let x = Math.max(0, x0); x < Math.min(w, x0 + rx * 2); x++)
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) out[y * w + x] = 1;
  return out;
}
export function polygonMask(w, h, points) {
  const out = new Uint8Array(w * h);
  if (points.length < 3) return out;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i],
          b = points[j];
        if (
          a.y > y + 0.5 !== b.y > y + 0.5 &&
          x + 0.5 < ((b.x - a.x) * (y + 0.5 - a.y)) / (b.y - a.y) + a.x
        )
          inside = !inside;
      }
      if (inside) out[y * w + x] = 1;
    }
  return out;
}

export function combineSelection(previous, next, mode = 'replace') {
  if (!previous || mode === 'replace')
    return mode === 'subtract' && !previous ? null : new Uint8Array(next);
  const out = new Uint8Array(previous.length);
  for (let i = 0; i < out.length; i++)
    out[i] =
      mode === 'subtract' ? (previous[i] && !next[i] ? 1 : 0) : previous[i] || next[i] ? 1 : 0;
  return out.some(Boolean) ? out : null;
}

// Compare premultiplied colors so invisible RGB values cannot split transparent areas.
export function wandSelection(pixels, w, h, x, y, { tolerance = 20, contiguous = true } = {}) {
  const mask = new Uint8Array(w * h);
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return mask;
  const seed = (y * w + x) * 4,
    alpha = pixels[seed + 3] / 255,
    threshold = Math.max(0, Math.min(100, tolerance)) * 2.55;
  const matches = (i) => {
    const a = pixels[i * 4 + 3] / 255;
    let d = Math.abs((a - alpha) * 255);
    for (let c = 0; c < 3; c++)
      d = Math.max(d, Math.abs(pixels[i * 4 + c] * a - pixels[seed + c] * alpha));
    return d <= threshold + 1e-8;
  };
  if (!contiguous) {
    for (let i = 0; i < mask.length; i++) if (matches(i)) mask[i] = 1;
    return mask;
  }
  const seen = new Uint8Array(w * h),
    queue = new Int32Array(w * h);
  let head = 0,
    tail = 1;
  queue[0] = y * w + x;
  seen[queue[0]] = 1;
  while (head < tail) {
    const n = queue[head++];
    if (!matches(n)) continue;
    mask[n] = 1;
    for (const v of [
      n % w ? n - 1 : -1,
      n % w < w - 1 ? n + 1 : -1,
      n >= w ? n - w : -1,
      n < w * (h - 1) ? n + w : -1,
    ])
      if (v >= 0 && !seen[v]) {
        seen[v] = 1;
        queue[tail++] = v;
      }
  }
  return mask;
}

export function transformPoint(x, y, t) {
  const c = Math.cos(t.angle),
    s = Math.sin(t.angle);
  return { x: t.cx + x * c - y * s, y: t.cy + x * s + y * c };
}
export function transformHandles(t, scale = 1) {
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => transformPoint((x * t.width) / 2, (y * t.height) / 2, t));
  return {
    corners,
    rotation: transformPoint(0, -t.height / 2 - 32 / scale, t),
    top: transformPoint(0, -t.height / 2, t),
  };
}
export function initialTransform(mask, w, h) {
  const b = maskBounds(mask, w, h);
  return b
    ? {
        cx: b.x + b.w / 2,
        cy: b.y + b.h / 2,
        width: b.w,
        height: b.h,
        angle: 0,
        flipX: false,
        flipY: false,
        copy: false,
      }
    : null;
}

// Inverse nearest-neighbor sampling: scaling up has no holes, and overlap reads
// the original cel. Source-over compositing preserves unselected destination art.
export function transformSelection(base, w, h, mask, t) {
  const bounds = maskBounds(mask, w, h);
  if (!bounds) throw Error('请先创建选区');
  if (
    ![t.cx, t.cy, t.width, t.height, t.angle].every(Number.isFinite) ||
    t.width < 1 ||
    t.height < 1 ||
    t.width > 1024 ||
    t.height > 1024
  )
    throw Error('变换尺寸范围：1–1024 像素');
  const output = new Uint8ClampedArray(base),
    selected = new Uint8Array(w * h);
  if (!t.copy) for (let i = 0; i < mask.length; i++) if (mask[i]) output.fill(0, i * 4, i * 4 + 4);
  const c = Math.cos(t.angle),
    s = Math.sin(t.angle),
    corners = transformHandles(t).corners;
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x)))),
    x1 = Math.min(w, Math.ceil(Math.max(...corners.map((p) => p.x))));
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y)))),
    y1 = Math.min(h, Math.ceil(Math.max(...corners.map((p) => p.y))));
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - t.cx,
        dy = y + 0.5 - t.cy,
        u = (dx * c + dy * s) / t.width + 0.5,
        v = (-dx * s + dy * c) / t.height + 0.5;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      let sx = Math.floor(u * bounds.w),
        sy = Math.floor(v * bounds.h);
      if (t.flipX) sx = bounds.w - 1 - sx;
      if (t.flipY) sy = bounds.h - 1 - sy;
      const source = (bounds.y + sy) * w + bounds.x + sx;
      if (!mask[source]) continue;
      const dest = y * w + x;
      selected[dest] = 1;
      const from = source * 4,
        to = dest * 4,
        a = base[from + 3] / 255,
        b = output[to + 3] / 255,
        total = a + b * (1 - a);
      if (!total) {
        output.fill(0, to, to + 4);
        continue;
      }
      for (let k = 0; k < 3; k++)
        output[to + k] = (base[from + k] * a + output[to + k] * b * (1 - a)) / total;
      output[to + 3] = total * 255;
    }
  return { pixels: output, mask: selected };
}
