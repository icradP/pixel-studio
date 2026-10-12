import { LIMITS } from './limits.js';
import { validate } from './engine.js';

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
  if (values.some((n) => !Number.isInteger(n) || n < 0 || n > LIMITS.dimension))
    throw Error('每个方向请输入 0–1024 的整数像素。');
  const [left, right, top, bottom] = values;
  const w = project.w + left + right,
    h = project.h + top + bottom;
  if (w > LIMITS.dimension || h > LIMITS.dimension)
    throw Error(`扩展后为 ${w} × ${h}，画布最大为 ${LIMITS.dimension} × ${LIMITS.dimension}。`);
  const pixels = w * h * project.layers.length * project.frames.length;
  if (pixels > LIMITS.pixels) throw Error('扩展后超过 800 万总像素，请减少边距、帧或图层。');
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
  const frames = project.frames.map((frame) => ({
    ...frame,
    cels: frame.cels.map((source) => {
      const pixels = new Uint8ClampedArray(next.w * next.h * 4);
      for (let y = 0; y < project.h; y++)
        pixels.set(
          source.subarray(y * project.w * 4, (y + 1) * project.w * 4),
          ((y + next.top) * next.w + next.left) * 4,
        );
      return pixels;
    }),
  }));
  return validate({
    ...project,
    w: next.w,
    h: next.h,
    frames,
    layers: project.layers.map((layer) => ({ ...layer })),
    ...(project.tags ? { tags: project.tags.map((tag) => ({ ...tag })) } : {}),
  });
}
