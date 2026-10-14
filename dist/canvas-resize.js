import { readCel, emptyPackedCel, emptyCel, packCel } from './cel-storage.js';
import { LIMITS } from './limits.js';
import { canvasPixels } from './pixel-budget.js';
import { validate, cloneLayer } from './engine.js';
import { moveSceneCanvas } from './procedural-model.js';

// Percent describes the resulting canvas size; the anchor locates the untouched artwork.
export function proportionalExpansion(project, percent, anchor = [0.5, 0.5]) {
  if (!Number.isFinite(percent) || percent < 100 || percent > 800)
    throw Error('画布比例请输入 100%–800%。');
  if (anchor.length !== 2 || anchor.some((n) => ![0, 0.5, 1].includes(n)))
    throw Error('请选择原图的固定位置。');
  const dx = Math.round((project.w * percent) / 100) - project.w,
    dy = Math.round((project.h * percent) / 100) - project.h;
  const left = Math.floor(dx * anchor[0]),
    top = Math.floor(dy * anchor[1]);
  return { left, right: dx - left, top, bottom: dy - top };
}

export function expansionSize(project, sides) {
  const values = ['left', 'right', 'top', 'bottom'].map((key) => sides[key] ?? 0);
  if (values.some((n) => !Number.isSafeInteger(n) || n < 0))
    throw Error('每个方向请输入非负整数像素。');
  const [left, right, top, bottom] = values;
  const w = project.w + left + right,
    h = project.h + top + bottom;
  canvasPixels(w, h);
  const pixels = w * h * project.layers.length * project.frames.length;
  return {
    w,
    h,
    left,
    right,
    top,
    bottom,
    pixels,
    bytes: pixels * 4,
    changed: values.some(Boolean),
  };
}

/** Allocate only after all dimensions/capacity pass. Existing pixels are never resampled. */
export function expandCanvas(project, sides) {
  const next = expansionSize(project, sides);
  if (!next.changed) throw Error('请至少扩展一个方向。');
  const compact = project.storage === 'packed' || next.pixels > LIMITS.pixels;
  const expanded = new Map();
  let allocated = 0;
  const charge = (bytes) => {
    allocated += bytes;
    if (allocated > LIMITS.projectBytes) throw Error('扩展后的实际像素存储超过 256 MiB 预算');
  };
  const frames = project.frames.map((frame) => ({
    ...frame,
    cels: frame.cels.map((input) => {
      if (compact && expanded.has(input)) return expanded.get(input);
      if (compact && emptyPackedCel(input) && input.data[1] === 0)
        return emptyCel(next.w * next.h * 4);
      const source = readCel(input);
      const pixels = new Uint8ClampedArray(next.w * next.h * 4);
      for (let y = 0; y < project.h; y++)
        pixels.set(
          source.subarray(y * project.w * 4, (y + 1) * project.w * 4),
          ((y + next.top) * next.w + next.left) * 4,
        );
      const output = compact ? packCel(pixels) : pixels;
      charge(compact ? output.data.byteLength : output.byteLength);
      if (compact) expanded.set(input, output);
      return output;
    }),
  }));
  return validate({
    ...project,
    ...(compact ? { storage: 'packed' } : {}),
    ...(project.procedural
      ? { procedural: moveSceneCanvas(project.procedural, next.w, next.h, next.left, next.top) }
      : {}),
    w: next.w,
    h: next.h,
    frames,
    layers: project.layers.map((layer) => {
      const nextLayer = cloneLayer(layer);
      if (layer.mask) {
        charge(next.w * next.h);
        nextLayer.mask = new Uint8ClampedArray(next.w * next.h).fill(255);
        for (let y = 0; y < project.h; y++)
          nextLayer.mask.set(
            layer.mask.subarray(y * project.w, (y + 1) * project.w),
            (y + next.top) * next.w + next.left,
          );
      }
      return nextLayer;
    }),
    ...(project.tags ? { tags: project.tags.map((tag) => ({ ...tag })) } : {}),
  });
}
