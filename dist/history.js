import { storageBytes } from './cel-storage.js';
import { LIMITS } from './limits.js';
import { clone } from './engine.js';
import { sceneBytes } from './procedural-model.js';

const projectBytes = (project) => storageBytes(project) + sceneBytes(project.procedural);

/** Snapshots are owned by history until restored; both stacks share one memory budget. */
export function createHistory({
  maxEntries = LIMITS.historyEntries,
  maxBytes = LIMITS.historyBytes,
} = {}) {
  const undo = [],
    redo = [];
  let bytes = 0;
  const entry = (project) => ({ project, bytes: projectBytes(project) });
  const sceneEntry = (scene) => ({
    scene: structuredClone(scene),
    sceneOnly: true,
    bytes: sceneBytes(scene),
  });
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
      next = previous.sceneOnly ? sceneEntry(current.procedural) : entry(clone(current));
    bytes += next.bytes - previous.bytes;
    target.push(next);
    trim(target);
    return previous.sceneOnly ? { ...current, procedural: previous.scene } : previous.project;
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
    checkpointScene(scene) {
      for (const item of redo) bytes -= item.bytes;
      redo.length = 0;
      const item = sceneEntry(scene);
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
