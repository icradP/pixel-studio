// Projective mapping from the unit square to a convex quadrilateral, nearest-neighbor sampling.
export function quadMatrix(q) {
  if (
    !Array.isArray(q) ||
    q.length !== 4 ||
    q.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        Math.abs(p.x) > 16384 ||
        Math.abs(p.y) > 16384,
    )
  )
    throw Error('透视角点无效');
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i],
      b = q[(i + 1) % 4],
      c = q[(i + 2) % 4],
      cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 0.01 || (sign && sign * cross < 0)) throw Error('透视网格不能交叉或折叠');
    sign = cross;
  }
  const [a, b, c, d] = q,
    dx1 = b.x - c.x,
    dx2 = d.x - c.x,
    dy1 = b.y - c.y,
    dy2 = d.y - c.y;
  const dx3 = a.x - b.x + c.x - d.x,
    dy3 = a.y - b.y + c.y - d.y,
    det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det,
    h = (dx1 * dy3 - dx3 * dy1) / det;
  return [
    b.x - a.x + g * b.x,
    d.x - a.x + h * d.x,
    a.x,
    b.y - a.y + g * b.y,
    d.y - a.y + h * d.y,
    a.y,
    g,
    h,
    1,
  ];
}
export function inverseMatrix(m) {
  const [a, b, c, d, e, f, g, h, i] = m,
    A = e * i - f * h,
    B = c * h - b * i,
    C = b * f - c * e,
    D = f * g - d * i,
    E = a * i - c * g,
    F = c * d - a * f,
    G = d * h - e * g,
    H = b * g - a * h,
    I = a * e - b * d;
  const det = a * A + b * D + c * G;
  if (Math.abs(det) < 1e-10) throw Error('透视网格面积过小');
  return [A, B, C, D, E, F, G, H, I].map((n) => n / det);
}
export function mapPoint(m, x, y) {
  const z = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / z, y: (m[3] * x + m[4] * y + m[5]) / z };
}
export function rectangleQuad(x, y, width, height, angle = 0) {
  const a = (angle * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a),
    cx = x + width / 2,
    cy = y + height / 2;
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => ({
    x: cx + ((u * width) / 2) * c - ((v * height) / 2) * s,
    y: cy + ((u * width) / 2) * s + ((v * height) / 2) * c,
  }));
}
export function warpPixels(source, sw, sh, w, h, quad, { flipX = false, flipY = false } = {}) {
  const inv = inverseMatrix(quadMatrix(quad)),
    out = new Uint8ClampedArray(w * h * 4);
  const x0 = Math.max(0, Math.floor(Math.min(...quad.map((p) => p.x)))),
    x1 = Math.min(w, Math.ceil(Math.max(...quad.map((p) => p.x))));
  const y0 = Math.max(0, Math.floor(Math.min(...quad.map((p) => p.y)))),
    y1 = Math.min(h, Math.ceil(Math.max(...quad.map((p) => p.y))));
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const p = mapPoint(inv, x + 0.5, y + 0.5);
      if (p.x < 0 || p.y < 0 || p.x >= 1 || p.y >= 1) continue;
      let sx = Math.min(sw - 1, Math.floor(p.x * sw)),
        sy = Math.min(sh - 1, Math.floor(p.y * sh));
      if (flipX) sx = sw - 1 - sx;
      if (flipY) sy = sh - 1 - sy;
      const i = (sy * sw + sx) * 4;
      out.set(source.subarray(i, i + 4), (y * w + x) * 4);
    }
  return out;
}
export function drawPerspectiveGrid(ctx, quad, divisions = 4) {
  const m = quadMatrix(quad);
  ctx.beginPath();
  for (let i = 0; i <= divisions; i++) {
    const v = i / divisions;
    for (const [a, b] of [
      [mapPoint(m, v, 0), mapPoint(m, v, 1)],
      [mapPoint(m, 0, v), mapPoint(m, 1, v)],
    ]) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
  }
  ctx.stroke();
}
