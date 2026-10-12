import { cloneLayer } from './engine.js';
import { LIMITS, projectUsage } from './limits.js';
import { parentLayer, subtreeEnd, reorderLayer } from './animation-edit.js';

export function duplicateLayer(project, index) {
  const end = subtreeEnd(project, index),
    count = end - index;
  if (
    project.layers.length + count > LIMITS.layers ||
    projectUsage(project).pixels + project.w * project.h * project.frames.length * count >
      LIMITS.pixels
  )
    throw Error('复制后超出图层或像素容量上限');
  const layers = project.layers.slice(index, end).map((layer, i) => ({
    ...cloneLayer(layer),
    ...(i ? {} : { name: layer.name.slice(0, 157) + ' 副本' }),
  }));
  project.layers.splice(end, 0, ...layers);
  project.frames.forEach((frame) =>
    frame.cels.splice(
      end,
      0,
      ...frame.cels.slice(index, end).map((cel) => new Uint8ClampedArray(cel)),
    ),
  );
  return end;
}
export function reorderBeside(project, index, target) {
  if (index === target) return index;
  if (parentLayer(project, index) !== parentLayer(project, target))
    throw Error('拖动排序请在同一组内；跨组使用图层菜单的「移至图层组」');
  const item = project.layers[index],
    destination = project.layers[target],
    direction = target > index ? 1 : -1;
  while (true) {
    const at = project.layers.indexOf(item),
      other = project.layers.indexOf(destination);
    if ((direction > 0 && at > other) || (direction < 0 && at < other)) break;
    const next = reorderLayer(project, at, direction);
    if (next === at) break;
  }
  return project.layers.indexOf(item);
}
