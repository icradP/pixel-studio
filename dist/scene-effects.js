import { curveValue, pathPoint } from './procedural-path.js';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const EFFECT_NAMES = {
  rotate: '旋转',
  stretch: '拉伸',
  squash: '触地压扁',
  fade: '透明度',
  shake: '震动',
  fadeIn: '淡入',
  fadeOut: '淡出并消失',
  hide: '暂时隐藏',
  blink: '闪烁',
  rainbow: '彩虹变色',
  tint: '渐变染色',
};
export const EFFECT_DEFAULTS = {
  angle: 180,
  x: 1.2,
  y: 1.5,
  opacity: 0,
  amplitude: 3,
  frequency: 2,
  color: '#ff83c9',
  colorTo: '#76deff',
  cycles: 1,
};
export function effectClip(id, type, start, end) {
  return {
    id,
    type,
    start,
    end,
    enabled: true,
    intensity: 1,
    curve: [
      { t: 0, v: 0 },
      { t: 1, v: 1 },
    ],
    blend: ['rotate', 'shake'].includes(type) ? 'add' : 'multiply',
    params: { ...EFFECT_DEFAULTS },
  };
}
export function rgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
export function rainbow(phase) {
  const h = (((phase % 1) + 1) % 1) * 6;
  return [0, 4, 2].map((k) => 255 * clamp(Math.abs(((h + k) % 6) - 3) - 1, 0, 1));
}
export function appearanceOpacity(o, t) {
  const a = o.appearance;
  if (!a || !o.enabled) return 1;
  if (t < a.start || t >= a.end) return 0;
  return Math.min(
    a.fadeIn ? clamp((t - a.start) / a.fadeIn, 0, 1) : 1,
    a.fadeOut ? clamp((a.end - t) / a.fadeOut, 0, 1) : 1,
  );
}
export function extraEffects(o, t) {
  let opacity = appearanceOpacity(o, t);
  const colors = [];
  if (!o.enabled) return { opacity, colors };
  for (const c of o.clips) {
    if (!c.enabled) continue;
    const u = clamp((t - c.start) / (c.end - c.start), 0, 1),
      weight = clamp(c.intensity, 0, 1),
      active = t >= c.start && t < c.end;
    if (c.type === 'fadeIn') opacity *= 1 - weight + weight * curveValue(c.curve, u);
    if (c.type === 'fadeOut') opacity *= 1 - weight * curveValue(c.curve, u);
    if (!active) continue;
    if (c.type === 'hide') opacity *= 1 - weight;
    if (c.type === 'blink')
      opacity *=
        1 -
        weight +
        weight *
          (Math.floor((t - c.start) * (c.params.frequency ?? 2) * 2) % 2 ? c.params.opacity : 1);
    if (c.type === 'rainbow' || c.type === 'tint') {
      const v = curveValue(c.curve, u),
        a = rgb(c.params.color || '#ff83c9'),
        b = rgb(c.params.colorTo || '#76deff');
      colors.push({
        color:
          c.type === 'rainbow'
            ? rainbow(v * (c.params.cycles ?? 1))
            : a.map((n, i) => n + (b[i] - n) * v),
        weight,
      });
    }
  }
  return { opacity, colors };
}
export function lightState(light, t, duration) {
  const u = clamp(t / duration, 0, 1),
    pos = light.path?.length ? pathPoint(light.path, u) : light;
  const a = rgb(light.color),
    b = rgb(light.colorTo || light.color),
    mix = light.colorCycle ? (1 - Math.cos(u * Math.PI * 2)) / 2 : 0;
  const modulation =
    1 -
    (light.pulse || 0) *
      (0.5 - 0.5 * Math.cos(t * (light.frequency ?? 1) * Math.PI * 2 + (light.phase || 0)));
  return {
    x: pos.x,
    y: pos.y,
    radius: light.radius,
    color: a.map((v, i) => v + (b[i] - v) * mix),
    strength: light.intensity * modulation * curveValue(light.keys || [], t, 1),
  };
}
// Screen blend changes RGB only. Transparent artwork stays transparent; no full-canvas scratch per light.
export function applyLights(pixels, w, h, scene, t) {
  for (const light of scene.lights || []) {
    if (!light.enabled || t < light.start || t >= light.end) continue;
    const s = lightState(light, t, scene.duration);
    if (s.strength <= 0) continue;
    const x0 = Math.max(0, Math.floor(s.x - s.radius)),
      x1 = Math.min(w, Math.ceil(s.x + s.radius)),
      y0 = Math.max(0, Math.floor(s.y - s.radius)),
      y1 = Math.min(h, Math.ceil(s.y + s.radius));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        if (!pixels[i + 3]) continue;
        const d = Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y) / s.radius;
        if (d >= 1) continue;
        const strength = clamp(s.strength * (1 - d) * (1 - d), 0, 1);
        for (let c = 0; c < 3; c++)
          pixels[i + c] = 255 - (255 - pixels[i + c]) * (1 - (s.color[c] / 255) * strength);
      }
  }
  return pixels;
}
