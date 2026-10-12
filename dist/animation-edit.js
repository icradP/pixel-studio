import { LIMITS } from './limits.js';
import { MAX_PIXELS } from './engine.js';
import { shiftTags } from './animation.js';

function range(p, a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < a || b >= p.frames.length)
    throw Error('请选择有效的帧区间');
}
function capacity(p, l, f) {
  if (l > LIMITS.layers || f > LIMITS.frames || p.w * p.h * l * f > MAX_PIXELS)
    throw Error('达到项目容量上限（32 图层、240 帧、800 万像素）');
}
export function editFrames(p, action, a, b = a, destination = 0) {
  range(p, a, b);
  const count = b - a + 1;
  if (action === 'duplicate' || action === 'blank') {
    capacity(p, p.layers.length, p.frames.length + count);
    const copies = p.frames.slice(a, b + 1).map((f) => ({
      duration: f.duration,
      cels: f.cels.map((c) =>
        action === 'blank' ? new Uint8ClampedArray(c.length) : new Uint8ClampedArray(c),
      ),
    }));
    for (let i = 0; i < count; i++) shiftTags(p, b + 1 + i);
    p.frames.splice(b + 1, 0, ...copies);
    return b + 1;
  }
  if (action === 'delete') {
    if (count === p.frames.length) throw Error('请至少保留一帧');
    for (let i = b; i >= a; i--) {
      shiftTags(p, i, true);
      p.frames.splice(i, 1);
    }
    return Math.min(a, p.frames.length - 1);
  }
  if (action === 'reverse') {
    p.frames.splice(a, count, ...p.frames.slice(a, b + 1).reverse());
    return a;
  }
  if (action === 'move') {
    if (!Number.isInteger(destination) || destination < 0 || destination > p.frames.length - count)
      throw Error('移动后的起始帧超出范围');
    const frames = p.frames.splice(a, count);
    p.frames.splice(destination, 0, ...frames);
    return destination;
  }
  throw Error('未知的帧操作');
}
export function setDurations(p, a, b, duration) {
  range(p, a, b);
  if (!Number.isInteger(duration) || duration < 20 || duration > 10000)
    throw Error('帧时长范围：20–10000 毫秒');
  for (let i = a; i <= b; i++) p.frames[i].duration = duration;
}
export function applySpeed(p, speed) {
  if (!Number.isFinite(speed) || speed < 0.1 || speed > 8) throw Error('倍速范围：0.1–8');
  const durations = p.frames.map((f) => Math.round(f.duration / speed));
  if (durations.some((d) => d < 20 || d > 10000))
    throw Error('换算后部分帧超出 20–10000 毫秒，请调整倍速');
  durations.forEach((d, i) => (p.frames[i].duration = d));
}
export function saveTag(p, index, tag) {
  if (typeof tag.name !== 'string' || !tag.name.trim() || tag.name.length > 160)
    throw Error('请输入动画标签名称');
  range(p, tag.from, tag.to);
  if (
    ![0, 1, 2, 3].includes(tag.direction) ||
    !Number.isInteger(tag.repeat) ||
    tag.repeat < 0 ||
    tag.repeat > 65535 ||
    !/^#[0-9a-f]{6}$/i.test(tag.color)
  )
    throw Error('标签方向、重复次数或颜色无效');
  p.tags ??= [];
  if (index < 0) {
    if (p.tags.length >= 1024) throw Error('动画标签数量已达上限');
    p.tags.push({ ...tag, name: tag.name.trim() });
    return p.tags.length - 1;
  }
  if (!p.tags[index]) throw Error('标签不存在');
  p.tags[index] = { ...tag, name: tag.name.trim() };
  return index;
}
export function subtreeEnd(p, i) {
  let end = i + 1;
  while (end < p.layers.length && (p.layers[end].level || 0) > (p.layers[i].level || 0)) end++;
  return end;
}
export function parentLayer(p, i) {
  const level = p.layers[i].level || 0;
  if (!level) return -1;
  for (let j = i - 1; j >= 0; j--)
    if ((p.layers[j].level || 0) === level - 1 && p.layers[j].group) return j;
  return -1;
}
export function layerLocked(p, i) {
  for (let k = i; k >= 0; k = parentLayer(p, k)) if (p.layers[k].locked) return true;
  return false;
}
export function visibleLayerOrder(p, order) {
  return order.filter((i) => {
    for (let k = parentLayer(p, i); k >= 0; k = parentLayer(p, k))
      if (p.layers[k].collapsed) return false;
    return true;
  });
}
export function addLayer(p, current, group = false) {
  capacity(p, p.layers.length + 1, p.frames.length);
  const parent = p.layers[current]?.group ? current : parentLayer(p, current),
    at = parent >= 0 ? subtreeEnd(p, parent) : p.layers.length,
    level = parent >= 0 ? (p.layers[parent].level || 0) + 1 : 0;
  const layer = {
    name: (group ? '图层组 ' : '图层 ') + (p.layers.length + 1),
    visible: true,
    opacity: 255,
    ...(level ? { level } : {}),
    ...(group
      ? { group: true, isolated: !p.layers.some((l) => l.group && l.isolated === false) }
      : {}),
  };
  p.layers.splice(at, 0, layer);
  p.frames.forEach((f) => f.cels.splice(at, 0, new Uint8ClampedArray(p.w * p.h * 4)));
  if (parent >= 0) p.layers[parent].collapsed = false;
  return at;
}
export function groupLayer(p, i) {
  capacity(p, p.layers.length + 1, p.frames.length);
  const end = subtreeEnd(p, i),
    level = p.layers[i].level || 0;
  for (let j = i; j < end; j++) p.layers[j].level = (p.layers[j].level || 0) + 1;
  p.layers.splice(i, 0, {
    name: '新图层组',
    visible: true,
    opacity: 255,
    group: true,
    isolated: !p.layers.some((l) => l.group && l.isolated === false),
    ...(level ? { level } : {}),
  });
  p.frames.forEach((f) => f.cels.splice(i, 0, new Uint8ClampedArray(p.w * p.h * 4)));
  return i;
}
export function ungroupLayer(p, i) {
  if (!p.layers[i]?.group) throw Error('请选择图层组');
  const end = subtreeEnd(p, i),
    group = p.layers[i];
  if (group.isolated !== false && (group.opacity !== 255 || group.blend))
    throw Error('请先将组透明度设为 100%、混合模式设为正常，再解散以保留画面');
  for (let j = i + 1; j < end; j++) {
    const l = p.layers[j];
    l.level = (l.level || 0) - 1;
    if (!l.level) delete l.level;
    if (!group.visible) l.visible = false;
    if (group.locked) l.locked = true;
  }
  p.layers.splice(i, 1);
  p.frames.forEach((f) => f.cels.splice(i, 1));
  return Math.min(i, p.layers.length - 1);
}
export function moveLayer(p, i, parent) {
  const end = subtreeEnd(p, i);
  if (parent >= i && parent < end) throw Error('不能移入自身或子组');
  if (parent >= 0 && !p.layers[parent]?.group) throw Error('目标必须是图层组');
  if (parent === parentLayer(p, i)) return i;
  const at = parent < 0 ? p.layers.length : subtreeEnd(p, parent),
    level = parent < 0 ? 0 : (p.layers[parent].level || 0) + 1,
    delta = level - (p.layers[i].level || 0),
    count = end - i;
  const items = p.layers.splice(i, count);
  items.forEach((l) => {
    l.level = (l.level || 0) + delta;
    if (!l.level) delete l.level;
  });
  const dest = at > i ? at - count : at;
  p.layers.splice(dest, 0, ...items);
  p.frames.forEach((f) => {
    const cels = f.cels.splice(i, count);
    f.cels.splice(dest, 0, ...cels);
  });
  if (parent >= 0) p.layers[parent > i ? parent - count : parent].collapsed = false;
  return dest;
}
export function reorderLayer(p, i, delta) {
  const parent = parentLayer(p, i),
    siblings = p.layers.map((_, k) => k).filter((k) => parentLayer(p, k) === parent),
    position = siblings.indexOf(i),
    other = siblings[position + delta];
  if (other === undefined) return i;
  const count = subtreeEnd(p, i) - i,
    at = delta > 0 ? subtreeEnd(p, other) - count : other,
    items = p.layers.splice(i, count);
  p.layers.splice(at, 0, ...items);
  p.frames.forEach((f) => {
    const cels = f.cels.splice(i, count);
    f.cels.splice(at, 0, ...cels);
  });
  return at;
}
export function deleteLayer(p, i) {
  const end = subtreeEnd(p, i);
  if (!p.layers.some((l, k) => !l.group && (k < i || k >= end)))
    throw Error('请至少保留一个像素图层');
  p.layers.splice(i, end - i);
  p.frames.forEach((f) => f.cels.splice(i, end - i));
  return Math.max(0, i - 1);
}
export function copyCels(p, layer, a, b) {
  range(p, a, b);
  if (p.layers[layer].group) throw Error('请选择像素图层');
  return {
    w: p.w,
    h: p.h,
    cels: p.frames.slice(a, b + 1).map((f) => new Uint8ClampedArray(f.cels[layer])),
  };
}
export function pasteCels(p, layer, a, clipboard) {
  if (!clipboard || clipboard.w !== p.w || clipboard.h !== p.h)
    throw Error('请先复制同尺寸画布的单元');
  if (p.layers[layer].group || layerLocked(p, layer)) throw Error('请选择未锁定的像素图层');
  if (a + clipboard.cels.length > p.frames.length) throw Error('目标帧不足，请先添加空白帧');
  clipboard.cels.forEach((c, i) => (p.frames[a + i].cels[layer] = new Uint8ClampedArray(c)));
}

// Accumulate elapsed time rather than chaining frame-duration timeouts.
export class PlaybackClock {
  constructor(now) {
    this.last = now;
    this.elapsed = 0;
  }
  advance(now, speed, duration, next) {
    this.elapsed += Math.max(0, now - this.last) * speed;
    this.last = now;
    let changed = false,
      steps = 0;
    while (this.elapsed >= duration() && steps++ < 10000) {
      this.elapsed -= duration();
      if (next() === false) return { changed, ended: true };
      changed = true;
    }
    return { changed, ended: false };
  }
}
