import { addLayer, layerLocked } from './animation-edit.js';
import { layerPixels } from './layer-effects.js';
import { packCel } from './cel-storage.js';

// Copy one cel, never the whole animation. Bake its mask/adjustments so moving
// the extracted pixels cannot leave them behind under a stationary layer mask.
export function copySelectionLayer(project, frame, layer, mask) {
  const source = project.layers[layer],
    area = project.w * project.h;
  if (!source || source.group || !project.frames[frame]) throw Error('请选择像素图层和有效帧');
  if (layerLocked(project, layer)) throw Error('请先解锁图层及其父级');
  if (!mask || mask.length !== area || !mask.some(Boolean)) throw Error('请先创建选区');
  const input = layerPixels(project, frame, layer, { readonly: true }),
    pixels = new Uint8ClampedArray(area * 4);
  let visible = false;
  for (let i = 0; i < area; i++) {
    if (!mask[i]) continue;
    const at = i * 4;
    pixels[at] = input[at];
    pixels[at + 1] = input[at + 1];
    pixels[at + 2] = input[at + 2];
    pixels[at + 3] = input[at + 3];
    visible ||= !!input[at + 3];
  }
  if (!visible) throw Error('当前图层的选区内没有可拷贝的像素');
  const added = addLayer(project, layer),
    target = project.layers[added];
  target.name = source.name.slice(0, 150) + ' · 选区副本';
  target.opacity = source.opacity;
  if (source.blend) target.blend = source.blend;
  if (source.clipping) target.clipping = true;
  // Keep any existing clipping stack attached to its original base.
  let at = layer + 1;
  while (at < added && project.layers[at].clipping) at++;
  project.layers.splice(at, 0, project.layers.splice(added, 1)[0]);
  for (const f of project.frames) f.cels.splice(at, 0, f.cels.splice(added, 1)[0]);
  project.frames[frame].cels[at] = project.storage === 'packed' ? packCel(pixels) : pixels;
  return at;
}
