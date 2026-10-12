export const LINEAR_CURVE = [0, 0.25, 0.5, 0.75, 1];
export function normalizeCurve(curve) {
  if (!Array.isArray(curve) || curve.length !== 5) return [...LINEAR_CURVE];
  const out = [0];
  for (let i = 1; i < 4; i++)
    out.push(Math.max(out[i - 1], Math.min(1, Number.isFinite(curve[i]) ? curve[i] : i / 4)));
  out.push(1);
  return out;
}
export function pressureResponse(value, curve = LINEAR_CURVE) {
  const p = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5)),
    i = Math.min(3, Math.floor(p * 4)),
    t = p * 4 - i;
  return curve[i] + (curve[i + 1] - curve[i]) * t;
}
export function strokeOpacity(e, opacity, pressure, curve) {
  return opacity * (pressure && e.pointerType === 'pen' ? pressureResponse(e.pressure, curve) : 1);
}
// Every point is blended against the start of the stroke, not the last stamp.
// Overlapping brush stamps use maximum coverage, so 30% stays 30% per stroke.
export function paintPixel(
  out,
  base,
  index,
  rgb,
  alpha,
  { erase = false, alphaLock = false, coverage = null } = {},
) {
  const value = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  if (coverage) {
    if (value <= coverage[index]) return;
    coverage[index] = value;
  }
  const i = index * 4,
    a = Math.max(0, Math.min(1, alpha)),
    ba = base[i + 3] / 255;
  if (!value || (alphaLock && !ba)) return;
  if (erase) {
    out.set(base.subarray(i, i + 4), i);
    if (!alphaLock) out[i + 3] = Math.round(base[i + 3] * (1 - a));
    if (!out[i + 3]) out.fill(0, i, i + 4);
    return;
  }
  if (alphaLock) {
    for (let c = 0; c < 3; c++) out[i + c] = Math.round(base[i + c] + (rgb[c] - base[i + c]) * a);
    out[i + 3] = base[i + 3];
    return;
  }
  const combined = a + ba * (1 - a);
  for (let c = 0; c < 3; c++)
    out[i + c] = combined ? Math.round((rgb[c] * a + base[i + c] * ba * (1 - a)) / combined) : 0;
  out[i + 3] = Math.round(255 * combined);
}
export function paintMask(out, base, index, value, alpha, coverage) {
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  if (coverage) {
    if (a <= coverage[index]) return;
    coverage[index] = a;
  }
  out[index] = base[index] + ((value - base[index]) * a) / 255;
}
export function mixPaintEffect(base, effect, opacity, alphaLock = false) {
  const out = new Uint8ClampedArray(base);
  for (let i = 0; i < base.length; i += 4) {
    const ba = base[i + 3] / 255,
      ea = effect[i + 3] / 255,
      a = ba * (1 - opacity) + ea * opacity;
    if (alphaLock && !ba) continue;
    for (let c = 0; c < 3; c++)
      out[i + c] = alphaLock
        ? base[i + c] + (effect[i + c] - base[i + c]) * opacity
        : a
          ? (base[i + c] * ba * (1 - opacity) + effect[i + c] * ea * opacity) / a
          : 0;
    out[i + 3] = alphaLock ? base[i + 3] : a * 255;
  }
  return out;
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function gradientAmount(x, y, start, end, options) {
  const dx = end.x - start.x,
    dy = end.y - start.y,
    length = dx * dx + dy * dy;
  let t =
    length < 0.00001
      ? 0
      : options.type === 'radial'
        ? Math.hypot(x - start.x, y - start.y) / Math.sqrt(length)
        : ((x - start.x) * dx + (y - start.y) * dy) / length;
  t = Math.max(0, Math.min(1, t));
  const levels = options.steps || 0;
  if (levels >= 2) {
    const v = t * (levels - 1),
      threshold = options.dither
        ? (BAYER[(Math.floor(y) & 3) * 4 + (Math.floor(x) & 3)] + 0.5) / 16
        : 0.5;
    t = (Math.floor(v) + (v % 1 > threshold ? 1 : 0)) / (levels - 1);
  }
  return Math.max(0, Math.min(1, t));
}
export function applyGradient(
  base,
  w,
  h,
  start,
  end,
  options,
  { selection = null, alphaLock = false, mask = false } = {},
) {
  const out = new Uint8ClampedArray(base),
    a = options.from,
    b = options.to;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const index = y * w + x;
      if (selection && !selection[index]) continue;
      const t = gradientAmount(x, y, start, end, options),
        rgb = a.map((v, k) => v + (b[k] - v) * t),
        alpha = (options.opacity ?? 1) * (options.transparent ? 1 - t : 1);
      if (mask) paintMask(out, base, index, 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2], alpha);
      else paintPixel(out, base, index, rgb, alpha, { alphaLock });
    }
  return out;
}
