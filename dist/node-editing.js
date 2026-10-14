import { curveValue, pathTable } from './procedural-path.js';

const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
// De Casteljau subdivision preserves the existing Bézier exactly.
export function insertPathNode(path, index, t = 0.5) {
  if (path.length >= 64) throw Error('路径最多 64 个节点，请增大间隔');
  if (!path[index + 1] || !(t > 0 && t < 1)) throw Error('请选择有后续节点的路径段');
  const out = structuredClone(path),
    a = out[index],
    b = out[index + 1],
    p = mix(a, a.out, t),
    q = mix(a.out, b.in, t),
    r = mix(b.in, b, t),
    u = mix(p, q, t),
    v = mix(q, r, t),
    n = mix(u, v, t);
  a.out = p;
  b.in = r;
  out.splice(index + 1, 0, { ...n, in: u, out: v });
  return out;
}
export function subdividePath(path, spacing) {
  if (!(spacing > 0) || !Number.isFinite(spacing)) throw Error('节点间隔必须大于 0');
  const counts = path
    .slice(1)
    .map((_, i) => Math.max(1, Math.ceil(pathTable(path.slice(i, i + 2)).length / spacing)));
  if (1 + counts.reduce((a, b) => a + b, 0) > 64) throw Error('超过 64 个路径节点，请增大间隔');
  let out = structuredClone(path),
    at = 0;
  for (const count of counts) {
    for (let remaining = count; remaining > 1; remaining--) {
      out = insertPathNode(out, at, 1 / remaining);
      at++;
    }
    at++;
  }
  return out;
}
export function insertCurveKey(keys, t) {
  if (keys.length >= 128) throw Error('曲线最多 128 个节点');
  if (keys.some((k) => Math.abs(k.t - t) < 0.00001)) return structuredClone(keys);
  return [...structuredClone(keys), { t, v: curveValue(keys, t) }].sort((a, b) => a.t - b.t);
}
export function subdivideCurve(keys, spacing, end = 1) {
  if (!(spacing > 0) || !Number.isFinite(spacing) || !(end > 0)) throw Error('节点间隔必须大于 0');
  if (Math.ceil(end / spacing) + 1 > 128) throw Error('超过 128 个曲线节点，请增大间隔');
  let out = structuredClone(keys);
  for (let i = 0; i * spacing < end; i++) out = insertCurveKey(out, i * spacing);
  return insertCurveKey(out, end);
}
