import { storageBytes } from './cel-storage.js';
import { PLANE_BYTES, PROJECT_BYTES } from './pixel-budget.js';
export const LIMITS = Object.freeze({
  planeBytes: PLANE_BYTES,
  projectBytes: PROJECT_BYTES,
  frames: 240,
  pixels: 8_000_000,
  historyEntries: 30,
  historyBytes: 64 * 1024 * 1024,
  selectionHistoryEntries: 30,
  selectionHistoryBytes: 4 * 1024 * 1024,
  previewBytes: 32 * 1024 * 1024,
  referenceWindows: 6,
  referenceDimension: 2048,
  referencePixels: 1_048_576,
  exportPixels: 16_777_216,
  projectFileBytes: 384 * 1024 * 1024,
  importBytes: 60 * 1024 * 1024,
});

export function projectUsage(project) {
  const area = project.w * project.h;
  const layers = project.layers.length,
    frames = project.frames.length;
  const pixels = area * layers * frames;
  const bytes = project.frames[0]?.cels ? storageBytes(project) : pixels * 4,
    compact = project.storage === 'packed';
  return {
    pixels,
    bytes,
    logicalBytes: pixels * 4,
    compact,
    ratio: Math.max(bytes / LIMITS.projectBytes, frames / LIMITS.frames),
    moreLayers: null,
    moreFrames: Math.max(0, LIMITS.frames - frames),
  };
}

export const mebibytes = (bytes) =>
  bytes > 0 && bytes < 1024
    ? bytes + ' B'
    : (bytes / 1024 / 1024).toFixed(bytes > 0 && bytes < 1024 * 1024 ? 3 : 1) + ' MiB';
