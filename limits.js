export const LIMITS = Object.freeze({
  dimension: 512,
  layers: 32,
  frames: 240,
  pixels: 8_000_000,
  historyEntries: 30,
  historyBytes: 64 * 1024 * 1024,
  previewBytes: 32 * 1024 * 1024,
  importBytes: 60 * 1024 * 1024,
});

export function projectUsage(project) {
  const area = project.w * project.h;
  const layers = project.layers.length,
    frames = project.frames.length;
  const pixels = area * layers * frames;
  return {
    pixels,
    bytes: pixels * 4,
    ratio: Math.max(pixels / LIMITS.pixels, layers / LIMITS.layers, frames / LIMITS.frames),
    moreLayers: Math.max(
      0,
      Math.min(LIMITS.layers, Math.floor(LIMITS.pixels / area / frames)) - layers,
    ),
    moreFrames: Math.max(
      0,
      Math.min(LIMITS.frames, Math.floor(LIMITS.pixels / area / layers)) - frames,
    ),
  };
}

export const mebibytes = (bytes) =>
  (bytes / 1024 / 1024).toFixed(bytes > 0 && bytes < 1024 * 1024 ? 3 : 1) + ' MiB';
