import { readCel } from './cel-storage.js';
import { layerLocked } from './animation-edit.js';
import { initialTransform, transformSelection } from './selection.js';
import { assertBox } from './editor-drawing.js';

export function transformPixels(p, args, active) {
  const layer = p.layers[args.layer],
    cel = readCel(p.frames[args.frame]?.cels[args.layer]);
  if (!layer || layer.group || !cel) throw Error('请选择有效的像素图层和帧');
  if (layerLocked(p, args.layer) || layer.alphaLock) throw Error('变换前请解锁图层及透明度');
  if (args.region && args.selection === 'current')
    throw Error('region 与 selection=current 不能同时使用');
  let mask;
  if (!args.region && args.selection !== 'all' && active.selection) {
    if (args.frame !== active.frame || args.layer !== active.layer)
      throw Error('当前选区只能用于当前帧和图层');
    mask = active.selection;
  } else {
    mask = new Uint8Array(p.w * p.h);
    if (args.region) {
      assertBox(p, args.region);
      const { x, y, width, height } = args.region;
      for (let row = y; row < y + height; row++) mask.fill(1, row * p.w + x, row * p.w + x + width);
    } else for (let i = 0; i < mask.length; i++) mask[i] = cel[i * 4 + 3] ? 1 : 0;
  }
  const t = initialTransform(mask, p.w, p.h);
  if (!t) throw Error('图层或选区为空');
  const x = args.x ?? t.cx - t.width / 2,
    y = args.y ?? t.cy - t.height / 2;
  t.width = args.width ?? t.width;
  t.height = args.height ?? t.height;
  t.cx = x + t.width / 2;
  t.cy = y + t.height / 2;
  t.angle = ((args.rotation ?? 0) * Math.PI) / 180;
  t.flipX = args.flipX ?? false;
  t.flipY = args.flipY ?? false;
  t.copy = args.copy ?? false;
  if (args.quad) t.quad = args.quad;
  p.frames[args.frame].cels[args.layer] = transformSelection(cel, p.w, p.h, mask, t).pixels;
}
