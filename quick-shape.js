import { line } from './engine.js';
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const shapeDelay = (value) =>
  Number.isFinite(value) ? Math.max(200, Math.min(3000, Math.round(value / 50) * 50)) : 800;
// Retain only the newest stylus sample for geometric previews, including the
// final sample on release. Freehand strokes still consume every input sample.
export class ShapePreview {
  constructor(
    draw,
    request = (fn) => requestAnimationFrame(fn),
    cancel = (id) => cancelAnimationFrame(id),
  ) {
    this.draw = draw;
    this.request = request;
    this.cancel = cancel;
    this.id = null;
    this.sample = null;
  }
  push(sample) {
    this.sample = sample;
    if (this.id === null)
      this.id = this.request(() => {
        this.id = null;
        this.flush();
      });
  }
  flush() {
    if (this.id !== null) this.cancel(this.id);
    this.id = null;
    const sample = this.sample;
    this.sample = null;
    if (sample) this.draw(sample);
  }
  clear() {
    if (this.id !== null) this.cancel(this.id);
    this.id = null;
    this.sample = null;
  }
}
function lineDistance(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    n = dx * dx + dy * dy;
  if (!n) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / n));
  return distance(p, { x: a.x + dx * t, y: a.y + dy * t });
}
function simplify(points, epsilon) {
  if (points.length < 3) return points;
  let largest = 0,
    index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = lineDistance(points[i], points[0], points.at(-1));
    if (d > largest) {
      largest = d;
      index = i;
    }
  }
  return largest > epsilon
    ? [
        ...simplify(points.slice(0, index + 1), epsilon).slice(0, -1),
        ...simplify(points.slice(index), epsilon),
      ]
    : [points[0], points.at(-1)];
}
function ellipsePoints(ellipse, anchor, count) {
  const { cx, cy, rx, ry, start } = ellipse;
  return Array.from({ length: count + 1 }, (_, i) => {
    if (!i || i === count) return { ...anchor };
    const t = start + (i / count) * Math.PI * 2;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });
}
export function recognizeShape(raw, startPixel) {
  if (raw.length < 2) return null;
  // Freehand stamps floor the pointer position. Keep that exact pixel as the
  // origin while retaining subpixel differences for smooth geometric fitting.
  const anchor = startPixel || { x: Math.floor(raw[0].x), y: Math.floor(raw[0].y) },
    points = raw
      .filter((p, i) => !i || distance(p, raw[i - 1]) > 0.1)
      .map((p) => ({ x: anchor.x + p.x - raw[0].x, y: anchor.y + p.y - raw[0].y }));
  points[0] = { ...anchor };
  if (points.length < 2) return null;
  const x0 = Math.min(...points.map((p) => p.x)),
    x1 = Math.max(...points.map((p) => p.x)),
    y0 = Math.min(...points.map((p) => p.y)),
    y1 = Math.max(...points.map((p) => p.y)),
    w = x1 - x0,
    h = y1 - y0,
    diag = Math.hypot(w, h);
  if (diag < 5) return null;
  const first = points[0],
    last = points.at(-1),
    chord = distance(first, last),
    length = points.slice(1).reduce((n, p, i) => n + distance(p, points[i]), 0);
  if (
    chord > diag * 0.6 &&
    length / chord < 1.2 &&
    points.every((p) => lineDistance(p, first, last) < Math.max(1, diag * 0.07))
  )
    return { kind: 'line', name: '直线', points: [first, last], anchor: first };
  if (chord > Math.max(3, diag * 0.24)) return null;
  const corners = simplify([...points, first], Math.max(1, diag * 0.045)).slice(0, -1);
  if (corners.length > 2 && distance(corners[0], corners.at(-1)) < diag * 0.12) corners.pop();
  if (corners.length === 4) {
    const edges = corners.map((p, i) => ({
      x: corners[(i + 1) % 4].x - p.x,
      y: corners[(i + 1) % 4].y - p.y,
    }));
    const orthogonal = edges.every((a, i) => {
      const b = edges[(i + 1) % 4];
      return Math.abs(a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y)) < 0.4;
    });
    if (orthogonal) {
      const angle = Math.atan2(edges[0].y, edges[0].x),
        c = Math.cos(angle),
        s = Math.sin(angle),
        local = corners.map((p) => ({
          x: (p.x - first.x) * c + (p.y - first.y) * s,
          y: -(p.x - first.x) * s + (p.y - first.y) * c,
        })),
        width = Math.max(...local.map((p) => p.x)) - Math.min(...local.map((p) => p.x)),
        height =
          (Math.max(...local.map((p) => p.y)) - Math.min(...local.map((p) => p.y))) *
          Math.sign(local[2].y);
      return {
        kind: 'rectangle',
        name: '矩形',
        anchor: first,
        points: [
          [0, 0],
          [width, 0],
          [width, height],
          [0, height],
          [0, 0],
        ].map(([x, y]) => ({ x: first.x + x * c - y * s, y: first.y + x * s + y * c })),
      };
    }
  }
  if (w > 2 && h > 2) {
    const cx = (x0 + x1) / 2,
      cy = (y0 + y1) / 2,
      error =
        points.reduce(
          (n, p) => n + Math.abs(Math.hypot((p.x - cx) / (w / 2), (p.y - cy) / (h / 2)) - 1),
          0,
        ) / points.length;
    if (error < 0.13 && corners.length >= 5) {
      const circle = Math.abs(w - h) / Math.max(w, h) < 0.16,
        rx = circle ? (w + h) / 4 : w / 2,
        ry = circle ? rx : h / 2,
        start = Math.atan2((first.y - cy) / ry, (first.x - cx) / rx),
        // Move the fitted center so its perimeter passes through the first
        // painted pixel, rather than projecting that pixel onto a new perimeter.
        ellipse = {
          cx: first.x - rx * Math.cos(start),
          cy: first.y - ry * Math.sin(start),
          rx,
          ry,
          start,
        };
      return {
        kind: circle ? 'circle' : 'ellipse',
        name: circle ? '圆形' : '椭圆',
        anchor: first,
        ellipse,
        reference: {
          x: ellipse.cx - rx * Math.cos(start),
          y: ellipse.cy - ry * Math.sin(start),
        },
        points: ellipsePoints(ellipse, first, 64),
      };
    }
  }
  if (corners.length >= 3 && corners.length <= 8)
    return {
      kind: 'polygon',
      name: corners.length + ' 边形',
      anchor: first,
      points: [...corners, corners[0]],
    };
  return null;
}
export function adjustShape(shape, hold, current) {
  const anchor = shape.anchor,
    reference =
      shape.reference ||
      shape.points.reduce((a, p) => (distance(p, anchor) > distance(a, anchor) ? p : a), anchor),
    vx = reference.x - anchor.x,
    vy = reference.y - anchor.y,
    dx = vx + current.x - hold.x,
    dy = vy + current.y - hold.y,
    base = Math.hypot(vx, vy) || 1,
    scale = Math.max(0.05, Math.min(20, Math.hypot(dx, dy) / base)),
    angle = Math.atan2(dy, dx) - Math.atan2(vy, vx),
    c = Math.cos(angle),
    s = Math.sin(angle);
  let points = shape.points;
  if (shape.ellipse) {
    const { rx, ry } = shape.ellipse,
      count = Math.max(
        24,
        Math.min(2048, Math.ceil(Math.PI * Math.sqrt(8 * Math.max(rx, ry) * scale))),
      );
    points = ellipsePoints(shape.ellipse, anchor, count);
  }
  return points.map((p) => {
    const x = p.x - anchor.x,
      y = p.y - anchor.y;
    return {
      x: Math.round(anchor.x + scale * (x * c - y * s)),
      y: Math.round(anchor.y + scale * (x * s + y * c)),
    };
  });
}
export function traceShape(points, w, h, padding, visit) {
  const seen = new Set();
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = b.x - a.x,
      dy = b.y - a.y;
    let lo = 0,
      hi = 1,
      skip = false;
    for (const [p, q] of [
      [-dx, a.x + padding],
      [dx, w - 1 + padding - a.x],
      [-dy, a.y + padding],
      [dy, h - 1 + padding - a.y],
    ]) {
      if (!p) {
        if (q < 0) skip = true;
        continue;
      }
      const t = q / p;
      if (p < 0) lo = Math.max(lo, t);
      else hi = Math.min(hi, t);
    }
    if (skip || lo > hi) continue;
    line(
      Math.round(a.x + dx * lo),
      Math.round(a.y + dy * lo),
      Math.round(a.x + dx * hi),
      Math.round(a.y + dy * hi),
      (x, y) => {
        const key = (y + padding) * (w + padding * 2) + x + padding;
        if (seen.has(key)) return;
        seen.add(key);
        visit(x, y);
      },
    );
  }
}
