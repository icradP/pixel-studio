import { readCel, packed, emptyPackedCel } from './cel-storage.js';
import { adjustedRgb } from './layer-effects.js';

// Sample directly into the tiny preview, without allocating a full-size copy,
// full-size ImageData and a full-size canvas for each row.
export function layerPreview(p, frame, index, edge = 72) {
  const scale = Math.min(1, edge / Math.max(p.w, p.h));
  const width = Math.max(1, Math.round(p.w * scale)),
    height = Math.max(1, Math.round(p.h * scale));
  const data = new Uint8ClampedArray(width * height * 4),
    cel = p.frames[frame].cels[index];
  if (emptyPackedCel(cel)) return { width, height, data };
  const pixels = readCel(cel),
    layer = p.layers[index],
    mask = layer.maskEnabled !== false && layer.mask;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at =
        Math.min(p.h - 1, Math.floor(((y + 0.5) * p.h) / height)) * p.w +
        Math.min(p.w - 1, Math.floor(((x + 0.5) * p.w) / width));
      const j = (y * width + x) * 4;
      data.set(pixels.subarray(at * 4, at * 4 + 4), j);
      if (layer.adjustments && data[j + 3])
        data.set(adjustedRgb(data.subarray(j, j + 3), layer.adjustments), j);
      if (mask) data[j + 3] = Math.round((data[j + 3] * mask[at]) / 255);
    }
  return { width, height, data };
}
export function createLayerPreviewCache(maxBytes = 2 * 1024 * 1024) {
  // Keys never hold old full-size cels or masks alive after edits/history eviction.
  const identities = new WeakMap(),
    entries = new Map();
  let sequence = 0,
    bytes = 0;
  const identity = (value) => {
    if (!value) return 0;
    if (!identities.has(value)) identities.set(value, ++sequence);
    return identities.get(value);
  };
  return {
    get(p, frame, index, revision) {
      const cel = p.frames[frame].cels[index],
        l = p.layers[index];
      const key = JSON.stringify([
        identity(cel),
        identity(l.mask),
        p.w,
        p.h,
        l.adjustments,
        l.maskEnabled,
        !packed(cel) || l.mask ? revision : 0,
      ]);
      const old = entries.get(key);
      if (old) {
        entries.delete(key);
        entries.set(key, old);
        return old;
      }
      const preview = layerPreview(p, frame, index);
      entries.set(key, preview);
      bytes += preview.data.byteLength;
      while (bytes > maxBytes && entries.size) {
        const first = entries.keys().next().value;
        bytes -= entries.get(first).data.byteLength;
        entries.delete(first);
      }
      return preview;
    },
    clear() {
      entries.clear();
      bytes = 0;
    },
    get bytes() {
      return bytes;
    },
  };
}
