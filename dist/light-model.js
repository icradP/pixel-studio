export function keyPosition(keys, time, fallback) {
  if (!keys?.length) return fallback;
  if (time <= keys[0].t) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    if (time > keys[i].t) continue;
    const a = keys[i - 1],
      b = keys[i],
      u = (time - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  }
  return keys.at(-1);
}
export function putPosition(light, t, point) {
  const keys = (light.positionKeys ||= []),
    existing = keys.find((k) => Math.abs(k.t - t) < 1e-6);
  if (existing) Object.assign(existing, point);
  else keys.push({ t, x: point.x, y: point.y });
  keys.sort((a, b) => a.t - b.t);
}
export function translateLight(light, dx, dy) {
  light.x += dx;
  light.y += dy;
  for (const n of light.path || [])
    for (const p of [n, n.in, n.out]) {
      p.x += dx;
      p.y += dy;
    }
  for (const p of light.positionKeys || []) {
    p.x += dx;
    p.y += dy;
  }
}
export function validRegion(r, w, h) {
  if (r == null) return true;
  if (
    r.w !== w ||
    r.h !== h ||
    !Array.isArray(r.runs) ||
    !r.runs.length ||
    r.runs.length > 131072 ||
    r.runs.length % 2
  )
    return false;
  let end = -1;
  for (let i = 0; i < r.runs.length; i += 2) {
    const a = r.runs[i],
      n = r.runs[i + 1];
    if (!Number.isInteger(a) || !Number.isInteger(n) || a <= end || n < 1 || a + n > w * h)
      return false;
    end = a + n - 1;
  }
  return true;
}
export function regionContains(region, index) {
  if (!region) return true;
  const runs = region.runs;
  let lo = 0,
    hi = runs.length / 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1,
      start = runs[mid * 2];
    if (index < start) hi = mid;
    else if (index >= start + runs[mid * 2 + 1]) lo = mid + 1;
    else return true;
  }
  return false;
}
