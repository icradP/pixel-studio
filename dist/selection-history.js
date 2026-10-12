// Selection gestures have their own bounded history while the selection tool is active.
import { LIMITS } from './limits.js';
export function createSelectionHistory({
  steps = LIMITS.selectionHistoryEntries,
  bytes = LIMITS.selectionHistoryBytes,
} = {}) {
  const past = [],
    future = [];
  const copy = (mask) => (mask ? new Uint8Array(mask) : null);
  const state = (mask, wand) => ({
    mask: copy(mask),
    wand: wand ? { ...wand, p: { ...wand.p }, before: copy(wand.before) } : null,
  });
  const equal = (a, b) => {
    if (a === b) return true;
    if (!a || !b) return !(a || b)?.some(Boolean);
    return a.length === b.length && a.every((value, i) => value === b[i]);
  };
  const trim = () => {
    while (
      past.length + future.length > steps ||
      [...past, ...future].reduce(
        (n, item) => n + (item.mask?.byteLength || 0) + (item.wand?.before?.byteLength || 0),
        0,
      ) > bytes
    ) {
      if (past.length) past.shift();
      else future.shift();
    }
  };
  return {
    checkpoint(before, after, { beforeWand = null } = {}) {
      if (equal(before, after)) return false;
      past.push(state(before, beforeWand));
      future.length = 0;
      trim();
      return true;
    },
    undo(current, wand = null) {
      if (!past.length) return null;
      future.push(state(current, wand));
      const restored = past.pop();
      trim();
      return restored;
    },
    redo(current, wand = null) {
      if (!future.length) return null;
      past.push(state(current, wand));
      const restored = future.pop();
      trim();
      return restored;
    },
    clear() {
      past.length = future.length = 0;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
  };
}
