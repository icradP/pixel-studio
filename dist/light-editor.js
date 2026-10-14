import { lightState } from './scene-effects.js';
import { putPosition, translateLight } from './light-model.js';
import { setTransformKey, fitPath } from './procedural-path.js';

export function createLightEditor(host) {
  let gesture = null,
    mode = 'move',
    animate = false;
  const current = () => host.scene()?.lights?.find((l) => l.id === host.selected());
  return {
    get active() {
      return !!gesture;
    },
    get mode() {
      return mode;
    },
    get animate() {
      return animate;
    },
    setAnimate(value) {
      animate = value;
    },
    setMode(value) {
      mode = value;
      host.render();
    },
    begin(p, scale) {
      const s = host.scene(),
        selected = current(),
        time = host.time();
      let light = selected,
        kind = mode;
      const near = (q) => Math.hypot(q.x - p.x, q.y - p.y) < 18 / scale;
      if (selected && ['area', 'path'].includes(mode)) {
        // Explicit canvas drawing modes start anywhere, not just on a handle.
      } else {
        const state = selected && lightState(selected, time, s.duration);
        if (
          selected &&
          selected.coverage !== 'global' &&
          near({ x: state.x + state.radius, y: state.y })
        )
          kind = 'radius';
        else {
          light = [...(s.lights || [])]
            .reverse()
            .find((l) => near(lightState(l, time, s.duration)));
          if (!light) return false;
          kind = 'move';
          host.select(light.id);
        }
      }
      const before = structuredClone(s);
      gesture = {
        before,
        start: p,
        light: light.id,
        kind,
        raw: [p],
        state: lightState(light, time, s.duration),
      };
      return true;
    },
    move(p) {
      if (!gesture) return;
      const g = gesture,
        next = structuredClone(g.before),
        l = next.lights.find((l) => l.id === g.light),
        dx = p.x - g.start.x,
        dy = p.y - g.start.y,
        time = host.time();
      if (g.kind === 'move') {
        if (animate) {
          if (!l.positionKeys?.length) putPosition(l, 0, lightState(l, 0, next.duration));
          putPosition(l, time, { x: g.state.x + dx, y: g.state.y + dy });
        } else translateLight(l, dx, dy);
      } else if (g.kind === 'radius') {
        const radius = Math.max(1, Math.min(2048, Math.hypot(p.x - g.state.x, p.y - g.state.y)));
        if (animate) {
          const tracks = { radius: (l.radiusKeys ||= []) };
          if (!tracks.radius.length) setTransformKey(tracks, 'radius', 0, l.radius);
          setTransformKey(tracks, 'radius', time, radius);
        } else {
          l.radius = radius;
          delete l.radiusKeys;
        }
      } else if (g.kind === 'area') {
        const project = host.project(),
          x = Math.max(0, Math.min(project.w - 1, Math.floor(Math.min(g.start.x, p.x)))),
          y = Math.max(0, Math.min(project.h - 1, Math.floor(Math.min(g.start.y, p.y))));
        l.area = {
          x,
          y,
          w: Math.max(1, Math.min(project.w, Math.ceil(Math.max(g.start.x, p.x))) - x),
          h: Math.max(1, Math.min(project.h, Math.ceil(Math.max(g.start.y, p.y))) - y),
        };
        delete l.region;
      } else if (g.kind === 'path') {
        if (Math.hypot(p.x - g.raw.at(-1).x, p.y - g.raw.at(-1).y) > 1 / host.scale())
          g.raw.push(p);
        if (g.raw.length > 1024) g.raw = g.raw.filter((_, i) => i % 2 === 0);
        l.path = fitPath(g.raw, Math.max(0.5, 1.5 / host.scale()));
        delete l.positionKeys;
      }
      host.preview(next);
    },
    end(cancel = false) {
      if (!gesture) return false;
      gesture = null;
      mode = 'move';
      host.commit(cancel);
      return true;
    },
    draw(ctx, scale) {
      const s = host.scene();
      ctx.save();
      ctx.lineWidth = 1.5 / scale;
      ctx.font = `${12 / scale}px system-ui`;
      for (const l of s.lights || []) {
        const a = lightState(l, host.time(), s.duration),
          active = l.id === host.selected();
        ctx.strokeStyle = active ? '#ffe6a0' : '#cbd3e1';
        ctx.fillStyle = '#25272e';
        ctx.beginPath();
        ctx.arc(a.x, a.y, 8 / scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = l.enabled ? l.color : '#777';
        ctx.beginPath();
        ctx.arc(a.x, a.y, 4 / scale, 0, Math.PI * 2);
        ctx.fill();
        if (!active) continue;
        ctx.fillStyle = '#fff0c0';
        ctx.fillText(l.name, a.x + 13 / scale, a.y - 12 / scale);
        ctx.setLineDash([5 / scale, 4 / scale]);
        if (l.coverage !== 'global') {
          ctx.beginPath();
          ctx.arc(a.x, a.y, a.radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillRect(a.x + a.radius - 5 / scale, a.y - 5 / scale, 10 / scale, 10 / scale);
        }
        if (l.area) ctx.strokeRect(l.area.x, l.area.y, l.area.w, l.area.h);
        if (l.region) {
          ctx.fillStyle = '#ffe6a025';
          for (let i = 0; i < l.region.runs.length; i += 2) {
            let start = l.region.runs[i];
            const end = start + l.region.runs[i + 1];
            while (start < end) {
              const n = Math.min(end - start, l.region.w - (start % l.region.w));
              ctx.fillRect(start % l.region.w, Math.floor(start / l.region.w), n, 1);
              start += n;
            }
          }
        }
        ctx.setLineDash([]);
        const path = l.positionKeys?.length ? l.positionKeys : l.path || [];
        ctx.beginPath();
        path.forEach((p, i) => {
          if (!i) ctx.moveTo(p.x, p.y);
          else if (p.in && path[i - 1].out)
            ctx.bezierCurveTo(path[i - 1].out.x, path[i - 1].out.y, p.in.x, p.in.y, p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        for (const p of path) ctx.fillRect(p.x - 3 / scale, p.y - 3 / scale, 6 / scale, 6 / scale);
      }
      ctx.restore();
    },
  };
}
