import { normalizeBrush } from './brushes.js';

// Paint and erase share the library, but remember their own tip, size and opacity.
export function createToolBrushes(library, saved = {}) {
  let mode = 'pencil';
  const valid = (id) => library.brushes.some((b) => b.id === id);
  const eraser = { active: valid(saved?.active) ? saved.active : 'pixel-hard', overrides: {} };
  for (const b of library.brushes)
    eraser.overrides[b.id] = normalizeBrush(saved?.overrides?.[b.id] || {}, b);
  const active = () => (mode === 'eraser' ? eraser.active : library.active);
  const brush = (id) => {
    const original = library.brushes.find((b) => b.id === id) || library.brushes[0];
    if (mode !== 'eraser') return original;
    eraser.overrides[original.id] ||= normalizeBrush(original);
    return normalizeBrush(
      {
        ...eraser.overrides[original.id],
        id: original.id,
        name: original.name,
        group: original.group,
      },
      original,
    );
  };
  return {
    get mode() {
      return mode;
    },
    get state() {
      return eraser;
    },
    current: () => brush(active()),
    brushes: () => library.brushes.map((b) => brush(b.id)),
    switch(next, transfer = false) {
      const previous = brush(active());
      mode = next === 'eraser' ? 'eraser' : 'pencil';
      if (transfer) {
        this.select(previous.id);
        this.update(previous);
      }
    },
    select(id) {
      if (!valid(id)) return;
      if (mode === 'eraser') eraser.active = id;
      else library.active = id;
    },
    update(patch) {
      const current = brush(active());
      const next = normalizeBrush(patch, current);
      if (mode === 'eraser') eraser.overrides[current.id] = next;
      else library.brushes[library.brushes.indexOf(current)] = next;
    },
  };
}
