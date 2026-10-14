import { readCel, packCel, emptyCel, compactProject, storageBytes } from './cel-storage.js';
import { extraEffects, applyLights } from './scene-effects.js';
import { composite, clone, validate } from './engine.js';
import { blendPixels, clippingBase } from './layer-effects.js';
import { LIMITS } from './limits.js';
import {
  assertSourceAvailable,
  ensureSourceIds,
  encodeRegion,
  regionMask,
  uid,
  pathNode,
  linearCurve,
  clamp,
  SCENE_LIMITS,
  validateScene,
} from './procedural-model.js';
import { curveValue, pathPoint } from './procedural-path.js';

export function sourceLayers(project, indices) {
  const selected = new Set();
  for (const i of indices) {
    if (!project.layers[i]) throw Error('来源图层已删除');
    if (project.layers[i].group) {
      for (
        let j = i + 1;
        j < project.layers.length &&
        (project.layers[j].level || 0) > (project.layers[i].level || 0);
        j++
      )
        if (!project.layers[j].group) selected.add(j);
    } else selected.add(i);
  }
  if (!selected.size) throw Error('请至少选择一个像素图层');
  for (const i of selected)
    if (project.layers[i].clipping && !selected.has(clippingBase(project, i)))
      throw Error('请将剪贴层和它的底层一起选入对象');
  for (let i = 0; i < project.layers.length; i++)
    if (project.layers[i].clipping && selected.has(clippingBase(project, i)) && !selected.has(i))
      throw Error('请将底层和它的所有剪贴层一起选入对象');
  return [...selected].sort((a, b) => a - b);
}
function bounds(pixels, w, h) {
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (pixels[(y * w + x) * 4 + 3]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function sourcePixels(project, source) {
  const frame = project.frames.findIndex((f) => f.id === source.frameId);
  if (frame < 0) throw Error('来源帧已删除，请重新指定来源或撤销删除');
  const indices = source.layerIds.map((id) => project.layers.findIndex((l) => l.id === id));
  if (indices.some((i) => i < 0)) throw Error('来源图层已删除，请重新指定来源或撤销删除');
  sourceLayers(project, indices);
  const chosen = new Set(indices),
    mask = regionMask(source.region, project.w, project.h),
    zero = new Uint8ClampedArray(project.w * project.h * 4);
  const cels = project.frames[frame].cels.map((cel, i) => {
    if (!chosen.has(i)) return zero;
    if (!mask) return cel;
    const next = new Uint8ClampedArray(readCel(cel));
    for (let p = 0; p < mask.length; p++) if (!mask[p]) next[p * 4 + 3] = 0;
    return next;
  });
  return composite({ ...project, frames: [{ cels }] }, 0);
}
export function createObject(project, scene, indices, selection, name) {
  if (scene.objects.length >= SCENE_LIMITS.objects) throw Error('场景最多支持 32 个对象');
  ensureSourceIds(project);
  const source = {
    frameId: scene.baseFrameId,
    layerIds: sourceLayers(project, indices).map((i) => project.layers[i].id),
    region: encodeRegion(selection, project.w, project.h),
  };
  assertSourceAvailable(scene, source);
  const box = bounds(sourcePixels(project, source), project.w, project.h);
  if (!box) throw Error('所选来源没有可见像素');
  const origin = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  return {
    id: uid(),
    name: name.trim().slice(0, 80) || '动画对象',
    source,
    origin,
    path: [pathNode(origin.x, origin.y)],
    progress: linearCurve(),
    motion: { start: 0, end: scene.duration, repeat: 1, orient: false },
    tracks: { rotation: [], scaleX: [], scaleY: [], opacity: [] },
    clips: [],
    visible: true,
    locked: false,
    enabled: true,
  };
}
export function compileScene(project, scene) {
  validateScene(scene, project);
  const base = project.frames.findIndex((f) => f.id === scene.baseFrameId);
  if (base < 0) throw Error('场景底图来源帧已删除，请重新选择底图来源');
  const w = project.w,
    h = project.h,
    area = w * h,
    objects = new Map(),
    cels = project.frames[base].cels.slice();
  let bytes = area * 12;
  const copied = new Set();
  for (const o of scene.objects) {
    const pixels = sourcePixels(project, o.source),
      box = bounds(pixels, w, h);
    if (box) {
      bytes += box.w * box.h * 4;
      if (bytes > LIMITS.previewBytes) throw Error('动画预览超过 32 MiB，请缩小对象选区或减少对象');
      const texture = new Uint8ClampedArray(box.w * box.h * 4);
      for (let y = 0; y < box.h; y++)
        texture.set(
          pixels.subarray(((box.y + y) * w + box.x) * 4, ((box.y + y) * w + box.x + box.w) * 4),
          y * box.w * 4,
        );
      objects.set(o.id, { ...box, pixels: texture });
    } else objects.set(o.id, { x: 0, y: 0, w: 0, h: 0, pixels: new Uint8ClampedArray() });
    if (o.source.frameId !== scene.baseFrameId) continue;
    const mask = regionMask(o.source.region, w, h);
    for (const id of o.source.layerIds) {
      const i = project.layers.findIndex((l) => l.id === id);
      if (!copied.has(i)) {
        cels[i] = new Uint8ClampedArray(readCel(cels[i]));
        copied.add(i);
      }
      if (!mask) cels[i].fill(0);
      else for (let p = 0; p < area; p++) if (mask[p]) cels[i][p * 4 + 3] = 0;
    }
  }
  return {
    w,
    h,
    objects,
    bytes,
    background: composite({ ...project, frames: [{ cels }] }, 0),
    output: new Uint8ClampedArray(area * 4),
    scratch: new Uint8ClampedArray(area * 4),
  };
}
export function objectState(o, t) {
  let progress = 0;
  if (o.enabled) {
    const u = clamp((t - o.motion.start) / (o.motion.end - o.motion.start), 0, 1);
    progress = curveValue(o.progress, u === 1 ? 1 : (u * o.motion.repeat) % 1);
  }
  const p = o.enabled ? pathPoint(o.path, progress) : o.origin;
  const state = {
    x: p.x,
    y: p.y,
    rotation: o.enabled ? curveValue(o.tracks.rotation, t, 0) : 0,
    scaleX: o.enabled ? curveValue(o.tracks.scaleX, t, 1) : 1,
    scaleY: o.enabled ? curveValue(o.tracks.scaleY, t, 1) : 1,
    opacity: o.enabled ? curveValue(o.tracks.opacity, t, 1) : 1,
  };
  if (o.enabled && o.motion.orient) state.rotation += ((p.angle || 0) * 180) / Math.PI;
  if (o.enabled)
    for (const c of o.clips) {
      if (!c.enabled || t < c.start || t > c.end) continue;
      const strength = c.intensity * curveValue(c.curve, (t - c.start) / (c.end - c.start));
      if (c.type === 'rotate') state.rotation += c.params.angle * strength;
      if (c.type === 'stretch' || c.type === 'squash') {
        state.scaleX *= Math.max(0.05, 1 + (c.params.x - 1) * strength);
        state.scaleY *= Math.max(0.05, 1 + (c.params.y - 1) * strength);
      }
      if (c.type === 'fade') state.opacity *= clamp(1 + (c.params.opacity - 1) * strength, 0, 1);
      if (c.type === 'shake') {
        const phase = (t - c.start) * c.params.frequency * Math.PI * 2;
        state.x += Math.sin(phase) * c.params.amplitude * strength;
        state.y += Math.sin(phase * 1.37) * c.params.amplitude * strength * 0.5;
      }
    }
  state.scaleX = clamp(state.scaleX, 0.05, 20);
  state.scaleY = clamp(state.scaleY, 0.05, 20);
  const effects = extraEffects(o, t);
  state.opacity = clamp(state.opacity * effects.opacity, 0, 1);
  state.colors = effects.colors;
  return state;
}
export function transformPoint(o, s, p) {
  const a = (s.rotation * Math.PI) / 180,
    c = Math.cos(a),
    n = Math.sin(a),
    x = (p.x - o.origin.x) * s.scaleX,
    y = (p.y - o.origin.y) * s.scaleY;
  return { x: s.x + x * c - y * n, y: s.y + x * n + y * c };
}
export function objectCorners(o, s, texture) {
  return [
    [0, 0],
    [texture.w, 0],
    [texture.w, texture.h],
    [0, texture.h],
  ].map(([x, y]) => transformPoint(o, s, { x: x + texture.x, y: y + texture.y }));
}
export function rasterObject(compiled, o, t, target = compiled.scratch) {
  target.fill(0);
  compiled.rasterBounds = null;
  const texture = compiled.objects.get(o.id),
    s = objectState(o, t);
  if (!o.visible || !texture?.w || s.opacity <= 0) return target;
  const corners = objectCorners(o, s, texture),
    w = compiled.w,
    h = compiled.h;
  const x0 = clamp(Math.floor(Math.min(...corners.map((p) => p.x))), 0, w),
    x1 = clamp(Math.ceil(Math.max(...corners.map((p) => p.x))), 0, w),
    y0 = clamp(Math.floor(Math.min(...corners.map((p) => p.y))), 0, h),
    y1 = clamp(Math.ceil(Math.max(...corners.map((p) => p.y))), 0, h);
  compiled.rasterBounds = { x0, x1, y0, y1 };
  const angle = (s.rotation * Math.PI) / 180,
    c = Math.cos(angle),
    n = Math.sin(angle);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - s.x,
        dy = y + 0.5 - s.y,
        sx = Math.floor((dx * c + dy * n) / s.scaleX + o.origin.x - texture.x + 1e-9),
        sy = Math.floor((-dx * n + dy * c) / s.scaleY + o.origin.y - texture.y + 1e-9);
      if (sx < 0 || sy < 0 || sx >= texture.w || sy >= texture.h) continue;
      const from = (sy * texture.w + sx) * 4,
        to = (y * w + x) * 4;
      target[to] = texture.pixels[from];
      target[to + 1] = texture.pixels[from + 1];
      target[to + 2] = texture.pixels[from + 2];
      for (const effect of s.colors)
        for (let k = 0; k < 3; k++)
          target[to + k] += (effect.color[k] - target[to + k]) * effect.weight;
      target[to + 3] = Math.round(texture.pixels[from + 3] * s.opacity);
    }
  return target;
}
export function evaluateScene(compiled, scene, time, { solo = null, objectIds = null } = {}) {
  const out = compiled.output;
  if (solo || objectIds) out.fill(0);
  else out.set(compiled.background);
  for (const o of scene.objects) {
    if ((solo && solo !== o.id) || (objectIds && !objectIds.includes(o.id))) continue;
    const pixels = rasterObject(compiled, o, time),
      box = compiled.rasterBounds;
    if (!box) continue;
    // Transparent canvas margins need no blending; retain the shared byte-exact compositor.
    for (let y = box.y0; y < box.y1; y++) {
      const start = (y * compiled.w + box.x0) * 4,
        end = (y * compiled.w + box.x1) * 4;
      blendPixels(out.subarray(start, end), pixels.subarray(start, end));
    }
  }
  if (!solo) applyLights(out, compiled.w, compiled.h, scene, time);
  return out;
}
export function sampleTimes(scene) {
  const first = Math.round(scene.range[0] * scene.fps),
    end = Math.round(scene.range[1] * scene.fps);
  if (end <= first) throw Error('播放区间至少包含一帧');
  return Array.from({ length: end - first }, (_, i) => ({
    time: (first + i) / scene.fps,
    duration:
      Math.round(((first + i + 1) * 1000) / scene.fps) -
      Math.round(((first + i) * 1000) / scene.fps),
  }));
}
export function bakePlan(
  project,
  scene,
  { mode = 'objects', replace = false, objectIds = null } = {},
) {
  if (
    objectIds &&
    (!objectIds.length ||
      new Set(objectIds).size !== objectIds.length ||
      objectIds.some((id) => !scene.objects.some((o) => o.id === id)))
  )
    throw Error('请选择有效且不重复的动画对象');
  const objects = objectIds ? scene.objects.filter((o) => objectIds.includes(o.id)) : scene.objects;
  const includeBackground = !objectIds;
  if (!['objects', 'composite'].includes(mode)) throw Error('未知的烘焙输出方式');
  const samples = sampleTimes(scene),
    planes = mode === 'objects' ? objects.length + (includeBackground ? 1 : 0) : 1,
    last = replace ? scene.bakes.at(-1) : null;
  if (!scene.objects.length) throw Error('请先创建动画对象');
  if (
    replace &&
    (!last ||
      last.mode !== mode ||
      JSON.stringify(last.objectIds || null) !== JSON.stringify(objectIds) ||
      last.frameIds.length !== samples.length ||
      last.layerIds.length !== planes + 1)
  )
    throw Error('替换需要与上次相同的输出方式、帧数和对象数量；请选择新建烘焙组');
  if (
    last &&
    (!last.frameIds.every((id) => project.frames.some((f) => f.id === id)) ||
      !last.layerIds.every((id) => project.layers.some((l) => l.id === id)))
  )
    throw Error('上次烘焙的图层或帧已删除，请新建烘焙组');
  if (last) {
    const indices = last.layerIds.map((id) => project.layers.findIndex((l) => l.id === id)),
      group = project.layers[indices[0]],
      frameStart = project.frames.findIndex((f) => f.id === last.frameIds[0]);
    let end = indices[0] + 1;
    while (end < project.layers.length && (project.layers[end].level || 0) > 0) end++;
    if (
      !group.group ||
      (group.level || 0) !== 0 ||
      indices
        .slice(1)
        .some(
          (index, i) =>
            index <= indices[i] ||
            index >= end ||
            project.layers[index].group ||
            project.layers[index].level !== 1,
        ) ||
      last.frameIds.some((id, i) => project.frames[frameStart + i]?.id !== id)
    )
      throw Error('上次烘焙的图层结构或帧顺序已改变，请新建烘焙组以保留精修');
  }
  const layers = project.layers.length + (replace ? 0 : planes + 1),
    frames = project.frames.length + (replace ? 0 : samples.length),
    pixels = project.w * project.h * layers * frames;
  if (layers > LIMITS.layers || frames > LIMITS.frames)
    throw Error(
      `烘焙后需要 ${layers} 层、${frames} 帧、${((pixels * 4) / 1048576).toFixed(1)} MiB；上限 32 层 / 240 帧 / 800 万总像素，请降低帧率或缩短区间`,
    );
  const compact = pixels > LIMITS.pixels || project.storage === 'packed';
  return {
    samples,
    planes,
    last,
    layers,
    frames,
    bytes: compact ? storageBytes(project) : pixels * 4,
    logicalBytes: pixels * 4,
    compact,
    objects,
    includeBackground,
    objectIds,
    mode,
    replace,
  };
}
// Yield once per frame, then commit one atomic project/history transaction.
export async function bakeScene(
  project,
  scene,
  options = {},
  progress = () => {},
  yieldFrame = () => new Promise((r) => setTimeout(r, 0)),
) {
  const plan = bakePlan(project, scene, options),
    compiled = compileScene(project, scene),
    next = plan.compact ? compactProject(clone(project)) : clone(project),
    length = project.w * project.h * 4;
  let layerIds, frameIds, start;
  if (plan.replace) {
    layerIds = plan.last.layerIds;
    frameIds = plan.last.frameIds;
    start = next.frames.findIndex((f) => f.id === frameIds[0]);
  } else {
    const groupId = uid();
    layerIds = [groupId];
    frameIds = [];
    start = next.frames.length;
    next.layers.push({
      id: groupId,
      name: `烘焙 · ${scene.name}`,
      visible: true,
      opacity: 255,
      group: true,
      isolated: true,
    });
    const names =
      plan.mode === 'objects'
        ? [...(plan.includeBackground ? ['场景底图'] : []), ...plan.objects.map((o) => o.name)]
        : [plan.objectIds ? '所选对象 · 合并' : '合成画面'];
    for (const name of names) {
      const id = uid();
      layerIds.push(id);
      next.layers.push({ id, name, level: 1, visible: true, opacity: 255 });
    }
    for (const f of next.frames)
      for (let i = 0; i < layerIds.length; i++)
        f.cels.push(plan.compact ? emptyCel(length) : new Uint8ClampedArray(length));
    for (const sample of plan.samples) {
      const id = uid();
      frameIds.push(id);
      next.frames.push({
        id,
        duration: sample.duration,
        cels: next.layers.map(() =>
          plan.compact ? emptyCel(length) : new Uint8ClampedArray(length),
        ),
      });
    }
  }
  const indices = layerIds.map((id) => next.layers.findIndex((l) => l.id === id));
  if (plan.replace) {
    next.layers[indices[0]] = {
      id: layerIds[0],
      name: `烘焙 · ${scene.name}`,
      visible: true,
      opacity: 255,
      group: true,
      isolated: true,
    };
    const names =
      plan.mode === 'objects'
        ? [...(plan.includeBackground ? ['场景底图'] : []), ...plan.objects.map((o) => o.name)]
        : [plan.objectIds ? '所选对象 · 合并' : '合成画面'];
    names.forEach((name, i) => {
      next.layers[indices[i + 1]] = {
        id: layerIds[i + 1],
        name,
        level: 1,
        visible: true,
        opacity: 255,
      };
    });
  }
  const bases = new Map();
  for (let i = 0; i < plan.samples.length; i++) {
    if (options.signal?.aborted) throw Error('已取消烘焙，原作品未改变');
    const f = next.frames.find((f) => f.id === frameIds[i]),
      sample = plan.samples[i];
    f.duration = sample.duration;
    const store = (index, pixels) => {
      if (!plan.compact) {
        f.cels[index] = new Uint8ClampedArray(pixels);
        return;
      }
      if (i % 16 === 0) bases.set(index, packCel(pixels));
      f.cels[index] = i % 16 === 0 ? bases.get(index) : packCel(pixels, bases.get(index));
    };
    if (plan.mode === 'composite')
      store(indices[1], evaluateScene(compiled, scene, sample.time, { objectIds: plan.objectIds }));
    else {
      let offset = 1;
      if (plan.includeBackground) {
        const pixels = new Uint8ClampedArray(compiled.background);
        applyLights(pixels, project.w, project.h, scene, sample.time);
        store(indices[offset++], pixels);
      }
      for (const o of plan.objects) {
        const pixels = rasterObject(compiled, o, sample.time);
        applyLights(pixels, project.w, project.h, scene, sample.time);
        store(indices[offset++], pixels);
      }
    }
    if (storageBytes(next) > LIMITS.pixels * 4)
      throw Error('无损压缩后仍超过 32 MB 实际存储预算，请缩短区间或降低帧率');
    progress(i + 1, plan.samples.length);
    await yieldFrame();
  }
  if (options.signal?.aborted) throw Error('已取消烘焙，原作品未改变');
  next.procedural = structuredClone(scene);
  if (!plan.replace) {
    next.tags ||= [];
    next.tags.push({
      name: (scene.name + ' · 烘焙').slice(0, 160),
      from: start,
      to: start + plan.samples.length - 1,
      direction: 0,
      repeat: 0,
      color: '#85cfff',
    });
  }
  if (!plan.replace)
    next.procedural.bakes.push({
      id: uid(),
      mode: plan.mode,
      layerIds,
      frameIds,
      ...(plan.objectIds ? { objectIds: plan.objectIds } : {}),
    });
  next.procedural.bakes = next.procedural.bakes.slice(-16);
  return { project: validate(next), frame: start, layer: indices[1] };
}
