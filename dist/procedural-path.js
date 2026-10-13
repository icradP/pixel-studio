import { clamp, pathNode, SCENE_LIMITS } from './procedural-model.js';
export function curveValue(keys, t, fallback = 0) {
  if (!keys.length) return fallback;
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 1; i < keys.length; i++)
    if (t <= keys[i].t) {
      const a = keys[i - 1],
        b = keys[i],
        u = (t - a.t) / (b.t - a.t);
      return a.v + (b.v - a.v) * u;
    }
  return keys.at(-1).v;
}
export function setKey(keys, t, v) {
  const i = keys.findIndex((k) => Math.abs(k.t - t) < 0.00001);
  if (i >= 0) keys[i] = { t, v };
  else {
    if (keys.length >= SCENE_LIMITS.keys) throw Error('关键帧数量已达上限');
    keys.push({ t, v });
    keys.sort((a, b) => a.t - b.t);
  }
}
// A first pose at a later time interpolates from the original drawing at t = 0.
export function setTransformKey(tracks, key, t, v) {
  const keys = tracks[key];
  if (!keys.length && t > 0) setKey(keys, 0, key === 'rotation' ? 0 : 1);
  setKey(keys, t, v);
}
export function bezier(a, b, t) {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * a.out.x + 3 * u * t * t * b.in.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * a.out.y + 3 * u * t * t * b.in.y + t * t * t * b.y,
  };
}
const paths = new WeakMap();
export function pathTable(nodes) {
  if (paths.has(nodes)) return paths.get(nodes);
  const table = [{ ...nodes[0], distance: 0 }],
    first = nodes[0];
  let prev = first,
    distance = 0;
  for (let i = 1; i < nodes.length; i++)
    for (let j = 1; j <= 32; j++) {
      const p = bezier(nodes[i - 1], nodes[i], j / 32);
      distance += Math.hypot(p.x - prev.x, p.y - prev.y);
      table.push({ ...p, distance });
      prev = p;
    }
  const value = { table, length: distance };
  paths.set(nodes, value);
  return value;
}
export function pathPoint(nodes, progress) {
  const { table, length } = pathTable(nodes),
    d = clamp(progress, 0, 1) * length;
  if (!length) return { ...nodes[0], angle: 0 };
  let lo = 1,
    hi = table.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (table[mid].distance < d) lo = mid + 1;
    else hi = mid;
  }
  const a = table[lo - 1],
    b = table[lo],
    u = (d - a.distance) / (b.distance - a.distance || 1);
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}
function simplify(points, epsilon) {
  if (points.length < 3) return points;
  const a = points[0],
    b = points.at(-1),
    dx = b.x - a.x,
    dy = b.y - a.y,
    n = dx * dx + dy * dy;
  let max = epsilon,
    index = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i],
      t = n ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / n, 0, 1) : 0,
      d = Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  return index < 0
    ? [a, b]
    : [
        ...simplify(points.slice(0, index + 1), epsilon).slice(0, -1),
        ...simplify(points.slice(index), epsilon),
      ];
}
export function fitPath(raw, epsilon = 1) {
  let points = simplify(raw, epsilon);
  if (points.length > SCENE_LIMITS.nodes)
    points = Array.from(
      { length: SCENE_LIMITS.nodes },
      (_, i) => points[Math.round((i * (points.length - 1)) / (SCENE_LIMITS.nodes - 1))],
    );
  return points.map((p, i) => {
    const prev = points[Math.max(0, i - 1)],
      next = points[Math.min(points.length - 1, i + 1)],
      dx = (next.x - prev.x) / 6,
      dy = (next.y - prev.y) / 6;
    return {
      ...pathNode(p.x, p.y),
      in: { x: p.x - dx, y: p.y - dy },
      out: { x: p.x + dx, y: p.y + dy },
    };
  });
}
export const CURVES = {
  linear: [
    { t: 0, v: 0 },
    { t: 1, v: 1 },
  ],
  ease: [
    { t: 0, v: 0 },
    { t: 0.25, v: 0.1 },
    { t: 0.75, v: 0.9 },
    { t: 1, v: 1 },
  ],
  accelerate: [
    { t: 0, v: 0 },
    { t: 0.5, v: 0.15 },
    { t: 1, v: 1 },
  ],
  decelerate: [
    { t: 0, v: 0 },
    { t: 0.5, v: 0.85 },
    { t: 1, v: 1 },
  ],
  fall: [
    { t: 0, v: 0 },
    { t: 0.45, v: 0.4 },
    { t: 0.7, v: 0.4 },
    { t: 1, v: 1 },
  ],
  return: [
    { t: 0, v: 0 },
    { t: 0.5, v: 1 },
    { t: 1, v: 0 },
  ],
  pulse: [
    { t: 0, v: 0 },
    { t: 0.5, v: 1 },
    { t: 1, v: 0 },
  ],
};
