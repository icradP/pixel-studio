// Finger contacts come from the complete TouchEvent list on Safari. Contact
// width is deliberately irrelevant: a thumb is not reliably smaller than a palm.
export function pinchCamera(base, start, current) {
  const ratio =
    Math.max(0.25, Math.min(60, (base.scale * current.distance) / start.distance)) / base.scale;
  let da = current.angle - start.angle;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  const ox = start.x - base.x,
    oy = start.y - base.y;
  return {
    scale: base.scale * ratio,
    angle: base.angle + da,
    x: current.x - ratio * (ox * Math.cos(da) - oy * Math.sin(da)),
    y: current.y - ratio * (ox * Math.sin(da) + oy * Math.cos(da)),
  };
}
export function pair(points) {
  const [a, b] = points;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}
export class FingerSession {
  constructor(
    actions,
    {
      clock = () => performance.now(),
      later = (fn, ms) => setTimeout(fn, ms),
      clear = (t) => clearTimeout(t),
    } = {},
  ) {
    this.a = actions;
    this.clock = clock;
    this.later = later;
    this.clear = clear;
    this.reset();
  }
  reset() {
    if (this.timer != null) this.clear(this.timer);
    this.timer = null;
    this.active = false;
    this.points = new Map();
    this.origins = new Map();
    this.max = 0;
    this.moved = false;
    this.drawing = false;
    this.locked = false;
    this.pairIds = '';
  }
  update(points, { cancel = false } = {}) {
    if (cancel) {
      if (this.drawing) this.a.end(true);
      this.reset();
      this.a.gestureEnd?.();
      return;
    }
    if (!this.active && !points.length) return;
    if (!this.active) {
      this.active = true;
      this.started = this.clock();
    }
    const old = this.points;
    this.points = new Map(points.map((p) => [p.id, p]));
    for (const p of points) {
      if (!this.origins.has(p.id)) this.origins.set(p.id, { x: p.x, y: p.y });
      const o = this.origins.get(p.id);
      if (Math.hypot(p.x - o.x, p.y - o.y) > 7) this.moved = true;
    }
    this.max = Math.max(this.max, points.length);
    if (points.length >= 2) {
      this.locked = true;
      if (this.timer != null) {
        this.clear(this.timer);
        this.timer = null;
      }
      if (this.drawing) {
        this.a.end(true);
        this.drawing = false;
      }
      const ids = points
        .slice(0, 2)
        .map((p) => p.id)
        .join(',');
      if (ids !== this.pairIds) {
        this.pairIds = ids;
        this.a.gestureStart(pair(points));
      } else this.a.gestureMove(pair(points));
      return;
    }
    this.pairIds = '';
    if (!points.length) {
      if (this.timer != null) {
        this.clear(this.timer);
        this.timer = null;
        if (!this.locked && this.a.canDraw()) {
          const p = [...old.values()][0];
          if (p) {
            this.a.begin(p);
            this.drawing = true;
          }
        }
      }
      if (this.drawing) this.a.end(false);
      const tap = !this.moved && this.clock() - this.started < 400,
        max = this.max;
      this.reset();
      this.a.gestureEnd?.();
      if (tap && max === 2) this.a.undo();
      else if (tap && max === 3) this.a.redo();
      return;
    }
    if (this.locked) return; // A remaining finger after a pinch must never become a stroke.
    const p = points[0];
    if (this.drawing) {
      this.a.move(p);
      return;
    }
    if (this.timer == null && this.a.canDraw())
      this.timer = this.later(() => {
        this.timer = null;
        if (this.active && !this.locked && this.points.size === 1) {
          this.a.begin([...this.points.values()][0]);
          this.drawing = true;
        }
      }, 110);
  }
}
