import { cloneCel, compactProject, storageBytes, packCel } from './cel-storage.js';
import { cloneLayer } from './engine.js';
import { renderComposite } from './layer-effects.js';
import { LIMITS } from './limits.js';
import { parentLayer, subtreeEnd, layerLocked } from './animation-edit.js';

export function duplicateLayer(project, index) {
  const end = subtreeEnd(project, index),
    count = end - index;
  if (
    project.storage !== 'packed' &&
    project.w * project.h * project.frames.length * (project.layers.length + count) > LIMITS.pixels
  ) {
    const compact = compactProject(project);
    if (storageBytes(compact) > LIMITS.projectBytes) throw Error('复制后超出实际内存容量预算');
    project.frames = compact.frames;
    project.storage = 'packed';
  }
  const layers = project.layers.slice(index, end).map((layer, i) => ({
    ...cloneLayer(layer),
    ...(layer.id ? { id: crypto.randomUUID() } : {}),
    ...(i ? {} : { name: layer.name.slice(0, 157) + ' 副本' }),
  }));
  project.layers.splice(end, 0, ...layers);
  project.frames.forEach((frame) =>
    frame.cels.splice(end, 0, ...frame.cels.slice(index, end).map((cel) => cloneCel(cel))),
  );
  return end;
}
export function reorderBeside(project, index, target) {
  if (index === target) return index;
  if (parentLayer(project, index) !== parentLayer(project, target))
    throw Error('拖动排序请在同一组内；跨组使用图层菜单的「移至图层组」');
  return dropLayer(project, index, target, target > index ? 'above' : 'below');
}

// A single splice per frame, regardless of distance. Layer references/IDs and
// complete subtrees travel together, including drops between different groups.
export function dropLayer(p, index, target, placement = 'above') {
  if (index === target) return index;
  const end = subtreeEnd(p, index),
    count = end - index;
  if (target >= index && target < end) throw Error('不能移入自身或子组');
  if (!p.layers[target]) throw Error('目标图层不存在');
  const parent = placement === 'inside' ? target : parentLayer(p, target);
  if (placement === 'inside' && !p.layers[target].group) throw Error('只能移入图层组');
  if (layerLocked(p, index) || (parent >= 0 && layerLocked(p, parent)))
    throw Error('请先解锁图层或目标组');
  const at = placement === 'below' ? target : subtreeEnd(p, target),
    level = parent < 0 ? 0 : (p.layers[parent].level || 0) + 1,
    delta = level - (p.layers[index].level || 0),
    group = p.layers[parent],
    moved = p.layers.splice(index, count),
    destination = at > index ? at - count : at;
  moved.forEach((l) => {
    l.level = (l.level || 0) + delta;
  });
  p.layers.splice(destination, 0, ...moved);
  for (const f of p.frames) f.cels.splice(destination, 0, ...f.cels.splice(index, count));
  if (group) group.collapsed = false;
  return destination;
}

export function mergeUp(p, index) {
  const parent = parentLayer(p, index),
    next = p.layers.findIndex((_, i) => i > index && parentLayer(p, i) === parent);
  if (next < 0) throw Error('上面没有可合并的同组图层');
  return mergeLayers(p, next);
}

export function mergeLayers(p, index, group = false) {
  const selected = p.layers[index],
    parent = parentLayer(p, index);
  if (group && !selected.group) throw Error('请选择图层组');
  const siblings = p.layers.map((_, i) => i).filter((i) => parentLayer(p, i) === parent),
    from = group ? index : siblings[siblings.indexOf(index) - 1],
    end = subtreeEnd(p, index);
  if (from === undefined) throw Error('下面没有可合并的同组图层');
  for (let i = from; i < end; i++) if (layerLocked(p, i)) throw Error('请先解锁要合并的图层');
  if (!selected.visible || !p.layers[from].visible) throw Error('请先显示要合并的图层');
  const ids = new Set(
    p.layers
      .slice(from, end)
      .map((l) => l.id)
      .filter(Boolean),
  );
  if (p.procedural?.objects.some((o) => o.source.layerIds.some((id) => ids.has(id))))
    throw Error('这些图层仍是动画对象的来源，请先复制图层再合并，以保留可编辑动画');
  const level = p.layers[from].level || 0,
    merged = {
      name: p.layers[from].name,
      visible: true,
      opacity: 255,
      level,
      ...(p.layers[from].id ? { id: p.layers[from].id } : {}),
    },
    layers = p.layers.slice(from, end).map((l) => ({ ...l, level: (l.level || 0) - level })),
    subset = {
      ...p,
      layers,
      frames: p.frames.map((f) => ({ ...f, cels: f.cels.slice(from, end) })),
    },
    nextLayers = [...p.layers.slice(0, from), merged, ...p.layers.slice(end)],
    cels = p.frames.map((_, fi) => renderComposite(subset, fi));
  // Blends/clips depending on excluded layers cannot always be represented by a
  // single normal layer. Refuse atomically instead of silently changing artwork.
  for (let fi = 0; fi < p.frames.length; fi++) {
    const before = renderComposite(p, fi),
      frame = {
        ...p.frames[fi],
        cels: [...p.frames[fi].cels.slice(0, from), cels[fi], ...p.frames[fi].cels.slice(end)],
      },
      after = renderComposite({ ...p, layers: nextLayers, frames: [frame] }, 0);
    if (before.some((v, i) => v !== after[i]))
      throw Error('当前混合或剪贴依赖其他图层，请将相关图层放入同一组后合并组');
  }
  p.layers = nextLayers;
  p.frames.forEach((f, i) =>
    f.cels.splice(from, end - from, p.storage === 'packed' ? packCel(cels[i]) : cels[i]),
  );
  if (p.procedural)
    p.procedural.bakes = p.procedural.bakes.filter((b) => !b.layerIds.some((id) => ids.has(id)));
  return from;
}
