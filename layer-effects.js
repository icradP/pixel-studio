// Blend IDs and byte compositing match the public Aseprite implementation.
// RGB blend functions use the W3C definitions, quantized as Aseprite does.
export const BLEND_MODES = [
  '正常',
  '正片叠底',
  '滤色',
  '叠加',
  '变暗',
  '变亮',
  '颜色减淡',
  '颜色加深',
  '强光',
  '柔光',
  '差值',
  '排除',
  '色相',
  '饱和度',
  '颜色',
  '明度',
  '加法 · 发光',
  '减法',
  '除法',
];
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const sat = (c) => Math.max(...c) - Math.min(...c);
function setLum(c, l) {
  const d = l - lum(c);
  let a = c.map((v) => v + d);
  l = lum(a);
  const n = Math.min(...a),
    x = Math.max(...a);
  if (n < 0) a = a.map((v) => l + ((v - l) * l) / (l - n));
  if (x > 1) a = a.map((v) => l + ((v - l) * (1 - l)) / (x - l));
  return a;
}
function setSat(c, s) {
  const order = [0, 1, 2].sort((a, b) => c[a] - c[b]),
    [lo, mid, hi] = order,
    a = [0, 0, 0];
  if (c[hi] > c[lo]) {
    a[mid] = ((c[mid] - c[lo]) * s) / (c[hi] - c[lo]);
    a[hi] = s;
  }
  return a;
}
export function blendRgb(b, s, mode = 0) {
  if (mode === 12) return setLum(setSat(s, sat(b)), lum(b));
  if (mode === 13) return setLum(setSat(b, sat(s)), lum(b));
  if (mode === 14) return setLum(s, lum(b));
  if (mode === 15) return setLum(b, lum(s));
  return b.map((v, i) => {
    const a = s[i];
    switch (mode) {
      case 1:
        return v * a;
      case 2:
        return v + a - v * a;
      case 3:
        return v <= 0.5 ? 2 * v * a : 1 - 2 * (1 - v) * (1 - a);
      case 4:
        return Math.min(v, a);
      case 5:
        return Math.max(v, a);
      case 6:
        return v === 0 ? 0 : a === 1 ? 1 : Math.min(1, v / (1 - a));
      case 7:
        return v === 1 ? 1 : a === 0 ? 0 : 1 - Math.min(1, (1 - v) / a);
      case 8:
        return a <= 0.5 ? 2 * v * a : 1 - 2 * (1 - v) * (1 - a);
      case 9: {
        const d = v <= 0.25 ? ((16 * v - 12) * v + 4) * v : Math.sqrt(v);
        return a <= 0.5 ? v - (1 - 2 * a) * v * (1 - v) : v + (2 * a - 1) * (d - v);
      }
      case 10:
        return Math.abs(v - a);
      case 11:
        return v + a - 2 * v * a;
      case 16:
        return Math.min(1, v + a);
      case 17:
        return Math.max(0, v - a);
      case 18:
        return a === 0 ? 1 : Math.min(1, v / a);
      default:
        return a;
    }
  });
}
// Byte rounding and two-stage alpha weighting match Aseprite's current
// blender; this keeps imported/exported semi-transparent layers consistent.
const mul8 = (a, b) => {
  const n = a * b + 128;
  return ((n >> 8) + n) >> 8;
};
function blendBytes(back, fore, mode) {
  const rgb = blendRgb(
    back.map((v) => v / 255),
    fore.map((v) => v / 255),
    mode,
  );
  return back.map((b, i) => {
    const s = fore[i],
      hard = (b, s) => (s < 128 ? mul8(b, 2 * s) : b + (2 * s - 255) - mul8(b, 2 * s - 255));
    switch (mode) {
      case 1:
        return mul8(b, s);
      case 2:
        return b + s - mul8(b, s);
      case 3:
        return hard(s, b);
      case 6:
        return b === 0 ? 0 : b >= 255 - s ? 255 : Math.floor((b * 255 + (255 - s) / 2) / (255 - s));
      case 7:
        return b === 255 ? 255 : 255 - b >= s ? 0 : 255 - Math.floor(((255 - b) * 255 + s / 2) / s);
      case 8:
        return hard(b, s);
      case 11:
        return b + s - 2 * mul8(b, s);
      case 18:
        return b === 0 ? 0 : b >= s ? 255 : Math.floor((b * 255 + s / 2) / s);
      default:
        return mode >= 12 && mode <= 15
          ? Math.trunc(clamp(rgb[i]) * 255)
          : Math.round(clamp(rgb[i]) * 255);
    }
  });
}
export function blendPixels(out, src, opacity = 255, mode = 0, atop = false) {
  for (let i = 0; i < out.length; i += 4) {
    const sa = mul8(src[i + 3], opacity),
      ba = out[i + 3];
    if (!sa || (atop && !ba)) continue;
    if (!ba) {
      out.set(src.subarray(i, i + 3), i);
      out[i + 3] = sa;
      continue;
    }
    const alpha = sa + ba - mul8(sa, ba);
    if (!mode) {
      for (let c = 0; c < 3; c++)
        out[i + c] = atop
          ? out[i + c] + mul8(src[i + c] - out[i + c], sa)
          : out[i + c] + Math.trunc(((src[i + c] - out[i + c]) * sa) / alpha);
      if (!atop) out[i + 3] = alpha;
      continue;
    }
    const back = [out[i], out[i + 1], out[i + 2]],
      fore = [src[i], src[i + 1], src[i + 2]],
      mixed = mode ? blendBytes(back, fore, mode) : fore;
    for (let c = 0; c < 3; c++) {
      if (atop) {
        out[i + c] = back[c] + mul8(mixed[c] - back[c], sa);
        continue;
      }
      const normal = back[c] + Math.trunc(((fore[c] - back[c]) * sa) / alpha);
      if (!mode) {
        out[i + c] = normal;
        continue;
      }
      const blended = back[c] + Math.trunc(((mixed[c] - back[c]) * sa) / alpha),
        first = normal + mul8(blended - normal, ba);
      out[i + c] = first + mul8(blended - first, mul8(ba, sa));
    }
    if (!atop) out[i + 3] = alpha;
  }
  return out;
}
export function adjustedRgb(rgb, a = {}) {
  let c = Array.from(rgb, (v) => v / 255);
  if (a.hue) {
    const max = Math.max(...c),
      min = Math.min(...c),
      d = max - min;
    let h =
      d === 0
        ? 0
        : max === c[0]
          ? ((c[1] - c[2]) / d + 6) % 6
          : max === c[1]
            ? (c[2] - c[0]) / d + 2
            : (c[0] - c[1]) / d + 4;
    h = (h + a.hue / 60 + 6) % 6;
    const x = d * (1 - Math.abs((h % 2) - 1));
    c = (
      h < 1
        ? [d, x, 0]
        : h < 2
          ? [x, d, 0]
          : h < 3
            ? [0, d, x]
            : h < 4
              ? [0, x, d]
              : h < 5
                ? [x, 0, d]
                : [d, 0, x]
    ).map((v) => v + min);
  }
  const l = lum(c),
    s = (a.saturation ?? 100) / 100,
    k = 1 + (a.contrast || 0) / 100,
    bright = (a.brightness || 0) / 100;
  return c.map((v) => 255 * clamp((l + (v - l) * s - 0.5) * k + 0.5 + bright));
}
export function layerPixels(p, frame, index, { opacity = false } = {}) {
  const l = p.layers[index],
    src = p.frames[frame].cels[index],
    out = new Uint8ClampedArray(src),
    mask = l.maskEnabled !== false ? l.mask : null,
    a = l.adjustments;
  for (let i = 0; i < out.length; i += 4) {
    if (a && out[i + 3]) out.set(adjustedRgb(out.subarray(i, i + 3), a), i);
    if (mask) out[i + 3] = Math.round((out[i + 3] * mask[i / 4]) / 255);
    if (opacity) out[i + 3] = Math.round((out[i + 3] * l.opacity) / 255);
  }
  return out;
}
export function clippingBase(p, index) {
  const l = p.layers[index],
    level = l?.level || 0;
  for (let i = index - 1; i >= 0; i--) {
    const q = p.layers[i],
      d = q.level || 0;
    if (d < level) return -1;
    if (d > level) continue;
    if (q.group) return -1;
    if (!q.clipping) return i;
  }
  return -1;
}
export function renderComposite(p, frame) {
  const length = p.w * p.h * 4;
  let index = 0;
  function render(level, out = new Uint8ClampedArray(length), visible = true) {
    let pending = null;
    const flush = () => {
      if (pending) blendPixels(out, pending.pixels, 255, pending.mode);
      pending = null;
    };
    while (index < p.layers.length && (p.layers[index].level || 0) >= level) {
      const k = index++,
        l = p.layers[k],
        on = visible && l.visible;
      if (l.group && l.isolated === false) {
        flush();
        render((l.level || 0) + 1, out, on);
        continue;
      }
      let src;
      if (l.group) {
        src = render((l.level || 0) + 1);
        for (let i = 3; i < length; i += 4)
          src[i] = on ? Math.round((src[i] * l.opacity) / 255) : 0;
      } else {
        src = layerPixels(p, frame, k, { opacity: true });
        if (!on) src.fill(0);
      }
      if (l.clipping) {
        if (pending && !pending.group) blendPixels(pending.pixels, src, 255, l.blend || 0, true);
      } else {
        flush();
        pending = { pixels: src, mode: l.blend || 0, group: !!l.group };
      }
    }
    flush();
    return out;
  }
  return render(0);
}
export function applyMask(p, index) {
  const l = p.layers[index];
  if (!l.mask) return;
  for (const f of p.frames)
    for (let i = 0; i < l.mask.length; i++)
      f.cels[index][i * 4 + 3] = Math.round((f.cels[index][i * 4 + 3] * l.mask[i]) / 255);
  delete l.mask;
  delete l.maskEnabled;
}
// Native ASE does not have this editor's live masks/adjustments/clipping stack.
// Bake masks and adjustments per cel, and merge only each clipped stack.
export function prepareAse(p) {
  const remove = new Set(),
    layers = p.layers.map((l) => {
      const q = { ...l };
      for (const k of ['mask', 'maskEnabled', 'adjustments', 'alphaLock', 'clipping']) delete q[k];
      return q;
    }),
    frames = p.frames.map((f, fi) => {
      const baked = new Set(),
        cels = p.layers.map((l, i) =>
          l.group ? new Uint8ClampedArray(f.cels[i]) : layerPixels(p, fi, i),
        );
      for (let i = 0; i < p.layers.length; i++)
        if (p.layers[i].clipping) {
          remove.add(i);
          const base = clippingBase(p, i);
          if (base < 0) continue;
          if (!baked.has(base)) {
            baked.add(base);
            const alpha = p.layers[base].opacity;
            for (let j = 3; j < cels[base].length; j += 4)
              cels[base][j] = Math.round((cels[base][j] * alpha) / 255);
          }
          if (p.layers[i].visible && p.layers[base].visible)
            blendPixels(cels[base], cels[i], p.layers[i].opacity, p.layers[i].blend || 0, true);
        }
      return { ...f, cels };
    });
  // Apply base opacity once per frame even when a stack has several clips.
  for (let i = 0; i < p.layers.length; i++)
    if (p.layers[i].clipping) {
      const base = clippingBase(p, i);
      if (base >= 0) layers[base].opacity = 255;
    }
  return {
    ...p,
    layers: layers.filter((_, i) => !remove.has(i)),
    frames: frames.map((f) => ({ ...f, cels: f.cels.filter((_, i) => !remove.has(i)) })),
  };
}
