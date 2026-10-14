import { line } from './engine.js';
import { layerLocked } from './animation-edit.js';

export function assertBox(p, box) {
  if (box.x + box.width > p.w || box.y + box.height > p.h) throw Error('像素区域超出画布');
}
const rgba = (hex) =>
  [1, 3, 5, 7].map((i) => (i === 7 && hex.length === 7 ? 255 : parseInt(hex.slice(i, i + 2), 16)));

/** Integer source coordinates and bounded work. Polygon coverage avoids double alpha on edges. */
export function drawBatch(p, args, selection) {
  const l = p.layers[args.layer],
    cel = p.frames[args.frame]?.cels[args.layer];
  if (!l || !cel || l.group) throw Error('请选择有效的像素图层与帧');
  if (layerLocked(p, args.layer)) throw Error('图层或父级已锁定');
  const estimated = args.commands.reduce(
    (n, c) =>
      n +
      (c.width
        ? c.width * c.height
        : c.points
          ? p.w * p.h + c.points.length * p.h
          : c.type === 'line'
            ? Math.max(p.w, p.h)
            : 1),
    0,
  );
  if (estimated > 4_000_000) throw Error('单批绘制超过 400 万像素访问，请拆分批次');
  let work = 0,
    writes = 0,
    x0 = p.w,
    y0 = p.h,
    x1 = -1,
    y1 = -1;
  const checkPoint = ({ x, y }) => {
    if (x >= p.w || y >= p.h) throw Error('像素坐标超出画布');
  };
  const paint = (x, y, color) => {
    if (++work > 4_000_000) throw Error('单批绘制超过 400 万像素访问，请拆分批次');
    const pixel = y * p.w + x,
      i = pixel * 4;
    if (selection && !selection[pixel]) return;
    if (l.alphaLock && !cel[i + 3]) return;
    const out = [...color];
    if (args.blend === 'over' || l.alphaLock) {
      const a = color[3] / 255,
        b = cel[i + 3] / 255;
      const alpha = l.alphaLock ? 1 : a + b * (1 - a);
      for (let k = 0; k < 3; k++)
        out[k] = alpha
          ? Math.round((color[k] * a + cel[i + k] * (l.alphaLock ? 1 : b) * (1 - a)) / alpha)
          : 0;
      out[3] = l.alphaLock ? cel[i + 3] : Math.round(alpha * 255);
    }
    if (out.every((v, k) => v === cel[i + k])) return;
    cel.set(out, i);
    writes++;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const c of args.commands) {
    const coverage = c.type === 'polygon' ? new Uint8Array(p.w * p.h) : null;
    const color = c.color ? rgba(c.color) : null,
      visit = (x, y) => {
        if (coverage) {
          const i = y * p.w + x;
          if (coverage[i]) return;
          coverage[i] = 1;
        }
        paint(x, y, color);
      };
    if (c.type === 'pixel') {
      checkPoint(c);
      visit(c.x, c.y);
    } else if (c.type === 'line') {
      checkPoint(c.from);
      checkPoint(c.to);
      line(c.from.x, c.from.y, c.to.x, c.to.y, visit);
    } else if (c.type === 'polygon') {
      c.points.forEach(checkPoint);
      if (c.fill !== false) {
        const minY = Math.min(...c.points.map((p) => p.y)),
          maxY = Math.max(...c.points.map((p) => p.y));
        for (let y = minY; y <= maxY; y++) {
          const crossings = [];
          c.points.forEach((a, i) => {
            const b = c.points[(i + 1) % c.points.length];
            if (a.y > y + 0.5 !== b.y > y + 0.5)
              crossings.push(a.x + ((y + 0.5 - a.y) * (b.x - a.x)) / (b.y - a.y));
          });
          crossings.sort((a, b) => a - b);
          for (let i = 0; i < crossings.length; i += 2)
            for (let x = Math.ceil(crossings[i]); x <= Math.floor(crossings[i + 1]); x++)
              visit(x, y);
        }
      }
      c.points.forEach((a, i) => {
        const b = c.points[(i + 1) % c.points.length];
        line(a.x, a.y, b.x, b.y, visit);
      });
    } else {
      assertBox(p, c);
      if (c.type === 'patch') {
        if (c.indices.length !== c.width * c.height || c.indices.some((i) => i >= c.palette.length))
          throw Error('像素块索引数量或调色板索引无效');
        const palette = c.palette.map(rgba);
        c.indices.forEach((v, i) =>
          paint(c.x + (i % c.width), c.y + Math.floor(i / c.width), palette[v]),
        );
      } else {
        const rx = c.width / 2,
          ry = c.height / 2;
        const inside = (x, y) => ((x + 0.5 - rx) / rx) ** 2 + ((y + 0.5 - ry) / ry) ** 2 <= 1;
        for (let y = 0; y < c.height; y++)
          for (let x = 0; x < c.width; x++) {
            if (c.type === 'rect') {
              if (c.fill !== false || !x || !y || x === c.width - 1 || y === c.height - 1)
                visit(c.x + x, c.y + y);
            } else if (
              inside(x, y) &&
              (c.fill !== false ||
                !inside(x - 1, y) ||
                !inside(x + 1, y) ||
                !inside(x, y - 1) ||
                !inside(x, y + 1))
            )
              visit(c.x + x, c.y + y);
          }
      }
    }
  }
  return {
    pixelWrites: writes,
    bounds: writes ? { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 } : null,
  };
}
