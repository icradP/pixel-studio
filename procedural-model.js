import { validRegion } from './light-model.js';
// Versioned, pixel-free animation metadata. Source references survive layer/frame reordering.
export const SCENE_LIMITS = Object.freeze({
  objects: 32,
  nodes: 64,
  keys: 128,
  clips: 64,
  bytes: 4 * 1024 * 1024,
});
export const uid = () => crypto.randomUUID();
export const sceneBytes = (scene) => (scene ? JSON.stringify(scene).length * 2 : 0);
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const linearCurve = () => [
  { t: 0, v: 0 },
  { t: 1, v: 1 },
];
export const pathNode = (x, y) => ({ x, y, in: { x, y }, out: { x, y } });
export function ensureSourceIds(project) {
  for (const item of [...project.layers, ...project.frames]) item.id ||= uid();
}
export function createScene(project, frame) {
  ensureSourceIds(project);
  return {
    version: 1,
    id: uid(),
    name: '动画场景',
    duration: 2,
    fps: 12,
    range: [0, 2],
    loop: true,
    baseFrameId: project.frames[frame].id,
    objects: [],
    bakes: [],
  };
}
export function encodeRegion(mask, w, h) {
  if (!mask) return null;
  if (mask.length !== w * h) throw Error('选区尺寸与画布不一致');
  const runs = [];
  for (let i = 0; i < mask.length;) {
    if (!mask[i]) {
      i++;
      continue;
    }
    const start = i;
    while (i < mask.length && mask[i]) i++;
    runs.push(start, i - start);
  }
  if (!runs.length) throw Error('请先选择有内容的区域');
  if (runs.length > 131072) throw Error('选区过于复杂，请简化选区后创建对象');
  return { w, h, runs };
}
export function regionMask(region, w, h) {
  if (!region) return null;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < region.runs.length; i += 2)
    mask.fill(1, region.runs[i], region.runs[i] + region.runs[i + 1]);
  return mask;
}
export function regionsOverlap(a, b) {
  if (!a || !b) return true;
  let i = 0,
    j = 0;
  while (i < a.runs.length && j < b.runs.length) {
    const x = a.runs[i],
      y = b.runs[j];
    if (Math.max(x, y) < Math.min(x + a.runs[i + 1], y + b.runs[j + 1])) return true;
    if (x + a.runs[i + 1] < y + b.runs[j + 1]) i += 2;
    else j += 2;
  }
  return false;
}
export function assertSourceAvailable(scene, source, except) {
  for (const object of scene.objects) {
    if (object.id === except || object.source.frameId !== source.frameId) continue;
    if (
      source.layerIds.some((id) => object.source.layerIds.includes(id)) &&
      regionsOverlap(source.region, object.source.region)
    )
      throw Error(`来源与「${object.name}」重叠，请使用不同图层或不重叠的选区`);
  }
}
const finite = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;
const identifier = (v) => typeof v === 'string' && v.length > 0 && v.length <= 100;
const list = (v, max) => Array.isArray(v) && v.length <= max;
const point = (p) =>
  p &&
  finite(p.x, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) &&
  finite(p.y, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
function curve(keys, time, min, max, endpoints = false) {
  if (!list(keys, SCENE_LIMITS.keys)) return false;
  let last = -1;
  for (const k of keys) {
    if (!k || !finite(k.t, 0, time) || k.t <= last || !finite(k.v, min, max)) return false;
    last = k.t;
  }
  return !endpoints || (keys.length >= 2 && keys[0].t === 0 && keys.at(-1).t === 1);
}
export function validateScene(scene, project) {
  if (!scene) return;
  const fail = () => {
    throw Error('程序化动画数据无效或超出容量限制');
  };
  if (
    scene.version !== 1 ||
    !identifier(scene.id) ||
    typeof scene.name !== 'string' ||
    scene.name.length > 160 ||
    !finite(scene.duration, 0.1, 60) ||
    !Number.isInteger(scene.fps) ||
    !finite(scene.fps, 1, 50) ||
    !list(scene.range, 2) ||
    scene.range.length !== 2 ||
    !finite(scene.range[0], 0, scene.duration) ||
    !finite(scene.range[1], scene.range[0] + 0.001, scene.duration) ||
    typeof scene.loop !== 'boolean' ||
    !identifier(scene.baseFrameId) ||
    !list(scene.objects, SCENE_LIMITS.objects) ||
    !list(scene.bakes, 16)
  )
    fail();
  for (const items of [project.layers, project.frames]) {
    const ids = items.filter((i) => i.id !== undefined).map((i) => i.id);
    if (ids.some((id) => !identifier(id)) || new Set(ids).size !== ids.length) fail();
  }
  if (scene.lights !== undefined) {
    if (!list(scene.lights, 8)) fail();
    const ids = new Set();
    for (const l of scene.lights) {
      if (
        !l ||
        !identifier(l.id) ||
        ids.has(l.id) ||
        typeof l.name !== 'string' ||
        l.name.length > 80 ||
        typeof l.enabled !== 'boolean' ||
        !point(l) ||
        !finite(l.radius, 1, 2048) ||
        !finite(l.intensity, 0, 4) ||
        !/^#[0-9a-f]{6}$/i.test(l.color) ||
        !/^#[0-9a-f]{6}$/i.test(l.colorTo || l.color) ||
        !finite(l.start, 0, 60) ||
        !finite(l.end, l.start + 0.001, 60) ||
        !finite(l.pulse ?? 0, 0, 1) ||
        !finite(l.frequency ?? 1, 0, 20) ||
        !finite(l.phase ?? 0, -100, 100) ||
        (l.colorCycle !== undefined && typeof l.colorCycle !== 'boolean') ||
        !curve(l.keys || [], 60, 0, 4) ||
        !curve(l.radiusKeys || [], 60, 1, 2048) ||
        !curve(l.intensityKeys || [], 60, 0, 4) ||
        (l.coverage !== undefined && !['radial', 'global'].includes(l.coverage)) ||
        (l.targets !== undefined &&
          (!list(l.targets, SCENE_LIMITS.objects) ||
            new Set(l.targets).size !== l.targets.length ||
            l.targets.some((id) => !scene.objects.some((o) => o.id === id)))) ||
        !validRegion(l.region, project.w, project.h) ||
        (l.area !== undefined &&
          (!l.area ||
            !['x', 'y', 'w', 'h'].every((k) => Number.isInteger(l.area[k])) ||
            l.area.x < 0 ||
            l.area.y < 0 ||
            l.area.w < 1 ||
            l.area.h < 1 ||
            l.area.x + l.area.w > project.w ||
            l.area.y + l.area.h > project.h)) ||
        (l.positionKeys !== undefined &&
          (!list(l.positionKeys, SCENE_LIMITS.keys) ||
            l.positionKeys.some(
              (k, i) => !point(k) || !finite(k.t, 0, 60) || (i && k.t <= l.positionKeys[i - 1].t),
            ))) ||
        (l.path !== undefined &&
          (!list(l.path, 64) ||
            !l.path.length ||
            l.path.some((n) => !point(n) || !point(n.in) || !point(n.out))))
      )
        fail();
      ids.add(l.id);
    }
  }
  const ids = new Set();
  for (const o of scene.objects) {
    if (
      !o ||
      !identifier(o.id) ||
      ids.has(o.id) ||
      typeof o.name !== 'string' ||
      !o.name.trim() ||
      o.name.length > 80 ||
      !point(o.origin) ||
      !o.source ||
      !identifier(o.source.frameId) ||
      !list(o.source.layerIds, project.layers.length) ||
      !o.source.layerIds.length ||
      o.source.layerIds.some((id) => !identifier(id)) ||
      new Set(o.source.layerIds).size !== o.source.layerIds.length ||
      !list(o.path, SCENE_LIMITS.nodes) ||
      !o.path.length ||
      o.path.some((p) => !point(p) || !point(p.in) || !point(p.out)) ||
      !curve(o.progress, 1, 0, 1, true) ||
      !o.motion ||
      !finite(o.motion.start, 0, 60) ||
      !finite(o.motion.end, o.motion.start + 0.001, 60) ||
      !Number.isInteger(o.motion.repeat) ||
      !finite(o.motion.repeat, 1, 20) ||
      typeof o.motion.orient !== 'boolean' ||
      ['visible', 'locked', 'enabled'].some((k) => typeof o[k] !== 'boolean') ||
      !o.tracks ||
      !list(o.clips, SCENE_LIMITS.clips)
    )
      fail();
    ids.add(o.id);
    if (o.appearance !== undefined) {
      const a = o.appearance;
      if (
        !a ||
        !finite(a.start, 0, 60) ||
        !finite(a.end, a.start + 0.001, 60) ||
        !finite(a.fadeIn, 0, a.end - a.start) ||
        !finite(a.fadeOut, 0, a.end - a.start)
      )
        fail();
    }
    const r = o.source.region;
    if (r != null) {
      if (
        r.w !== project.w ||
        r.h !== project.h ||
        !list(r.runs, 131072) ||
        !r.runs.length ||
        r.runs.length % 2
      )
        fail();
      let end = -1;
      for (let i = 0; i < r.runs.length; i += 2) {
        const a = r.runs[i],
          n = r.runs[i + 1];
        if (
          !Number.isInteger(a) ||
          !Number.isInteger(n) ||
          a <= end ||
          n < 1 ||
          a + n > project.w * project.h
        )
          fail();
        end = a + n - 1;
      }
    }
    for (const [key, min, max] of [
      ['rotation', -36000, 36000],
      ['scaleX', 0.05, 20],
      ['scaleY', 0.05, 20],
      ['opacity', 0, 1],
    ])
      if (!curve(o.tracks[key], 60, min, max)) fail();
    const clipIds = new Set();
    for (const c of o.clips) {
      if (
        !identifier(c.id) ||
        clipIds.has(c.id) ||
        ![
          'rotate',
          'stretch',
          'squash',
          'fade',
          'shake',
          'fadeIn',
          'fadeOut',
          'hide',
          'blink',
          'rainbow',
          'tint',
        ].includes(c.type) ||
        !finite(c.start, 0, 60) ||
        !finite(c.end, c.start + 0.001, 60) ||
        typeof c.enabled !== 'boolean' ||
        !finite(c.intensity, 0, 2) ||
        !curve(c.curve, 1, 0, 1, true) ||
        !c.params ||
        c.blend !== (['rotate', 'shake'].includes(c.type) ? 'add' : 'multiply') ||
        !finite(c.params.angle, -3600, 3600) ||
        !finite(c.params.x, 0.05, 4) ||
        !finite(c.params.y, 0.05, 4) ||
        !finite(c.params.opacity, 0, 1) ||
        !finite(c.params.amplitude, 0, 256) ||
        !finite(c.params.frequency, 0, 50)
      )
        fail();
      if (c.params.color !== undefined && !/^#[0-9a-f]{6}$/i.test(c.params.color)) fail();
      if (c.params.colorTo !== undefined && !/^#[0-9a-f]{6}$/i.test(c.params.colorTo)) fail();
      if (c.params.cycles !== undefined && !finite(c.params.cycles, 0, 20)) fail();
      clipIds.add(c.id);
    }
    assertSourceAvailable(scene, o.source, o.id);
  }
  for (const b of scene.bakes) {
    if (
      !identifier(b.id) ||
      !['objects', 'composite'].includes(b.mode) ||
      !list(b.frameIds, 240) ||
      !list(b.layerIds, project.layers.length) ||
      !b.frameIds.length ||
      b.layerIds.length < 2 ||
      new Set(b.frameIds).size !== b.frameIds.length ||
      new Set(b.layerIds).size !== b.layerIds.length ||
      [...b.frameIds, ...b.layerIds].some((id) => !identifier(id))
    )
      fail();
  }
  if (sceneBytes(scene) > SCENE_LIMITS.bytes) fail();
}
export function moveSceneCanvas(scene, w, h, left, top) {
  if (!scene) return undefined;
  const next = structuredClone(scene);
  for (const o of next.objects) {
    o.origin.x += left;
    o.origin.y += top;
    for (const n of o.path)
      for (const p of [n, n.in, n.out]) {
        p.x += left;
        p.y += top;
      }
    const r = o.source.region;
    if (r) {
      const mask = new Uint8Array(w * h);
      for (let i = 0; i < r.runs.length; i += 2)
        for (let p = r.runs[i]; p < r.runs[i] + r.runs[i + 1]; p++)
          mask[(Math.floor(p / r.w) + top) * w + (p % r.w) + left] = 1;
      o.source.region = encodeRegion(mask, w, h);
    }
  }
  for (const light of next.lights || []) {
    light.x += left;
    light.y += top;
    for (const p of light.positionKeys || []) {
      p.x += left;
      p.y += top;
    }
    if (light.area) {
      light.area.x += left;
      light.area.y += top;
    }
    if (light.region) {
      const r = light.region,
        mask = new Uint8Array(w * h);
      for (let i = 0; i < r.runs.length; i += 2)
        for (let p = r.runs[i]; p < r.runs[i] + r.runs[i + 1]; p++)
          mask[(Math.floor(p / r.w) + top) * w + (p % r.w) + left] = 1;
      light.region = encodeRegion(mask, w, h);
    }
    for (const n of light.path || [])
      for (const p of [n, n.in, n.out]) {
        p.x += left;
        p.y += top;
      }
  }
  return next;
}
