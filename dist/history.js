import { LIMITS } from './limits.js';
import { clone } from './engine.js';

const projectBytes = (project) =>
  project.frames.reduce(
    (total, frame) => total + frame.cels.reduce((bytes, cel) => bytes + cel.byteLength, 0),
    project.layers.reduce((total, l) => total + (l.mask?.byteLength || 0), 0),
  );

/** Snapshots are owned by history until restored; both stacks share one memory budget. */
export function createHistory({
  maxEntries = LIMITS.historyEntries,
  maxBytes = LIMITS.historyBytes,
} = {}) {
  const undo = [],
    redo = [];
  let bytes = 0;
  const entry = (project) => ({ project, bytes: projectBytes(project) });
  function trim(preferred) {
    const other = preferred === undo ? redo : undo;
    while (undo.length + redo.length > maxEntries || bytes > maxBytes) {
      const stack = other.length ? other : preferred;
      bytes -= stack.shift().bytes;
    }
  }
  function move(source, target, current) {
    if (!source.length) return null;
    const previous = source.pop(),
      next = entry(clone(current));
    bytes += next.bytes - previous.bytes;
    target.push(next);
    trim(target);
    return previous.project;
  }
  return {
    get count() {
      return undo.length + redo.length;
    },
    get canUndo() {
      return undo.length > 0;
    },
    get canRedo() {
      return redo.length > 0;
    },
    get bytes() {
      return bytes;
    },
    checkpoint(snapshot) {
      for (const item of redo) bytes -= item.bytes;
      redo.length = 0;
      const item = entry(snapshot);
      undo.push(item);
      bytes += item.bytes;
      trim(undo);
    },
    undo: (current) => move(undo, redo, current),
    redo: (current) => move(redo, undo, current),
    clear() {
      undo.length = redo.length = bytes = 0;
    },
  };
}
