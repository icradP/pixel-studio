import { compactProject } from './cel-storage.js';
import { composite } from './engine.js';

export function prepareSave(project) {
  const p = project.storage === 'packed' ? compactProject(project) : project;
  const pixels = composite(p, 0),
    scale = Math.min(1, 256 / Math.max(p.w, p.h)),
    width = Math.max(1, Math.round(p.w * scale)),
    height = Math.max(1, Math.round(p.h * scale)),
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at =
        (Math.min(p.h - 1, Math.floor((y + 0.5) / scale)) * p.w +
          Math.min(p.w - 1, Math.floor((x + 0.5) / scale))) *
        4;
      data.set(pixels.subarray(at, at + 4), (y * width + x) * 4);
    }
  return { project: p, width, height, data };
}
