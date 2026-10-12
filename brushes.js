// Brush settings and pixel coverage are shared by the canvas, library previews and tests.
export const MAGIC_MODES = [
  ['outline-brush', '描边笔刷'],
  ['graffiti', '涂鸦滴落'],
  ['outline-shape', '轮廓描边'],
  ['colorize', '着色'],
  ['desaturate', '去色'],
  ['shift-hue', '色相偏移'],
  ['shift-saturation', '饱和度偏移'],
  ['shift-value', '明度偏移'],
  ['mix-rgb', 'RGB 混色'],
  ['mix-hsv', 'HSV 混色'],
  ['lift', '提取到新图层'],
  ['merge', '向下采集合并'],
  ['select', '涂抹选择'],
  ['select-erase', '涂抹减选'],
];
export const BRUSH_GROUPS = [
  ['pixel', '像素', '▣'],
  ['dither', '抖色', '▧'],
  ['magic', '魔法', '✦'],
  ['user', '我的', '◇'],
];
const defaultMask = Array.from({ length: 64 }, (_, i) => ([27, 28, 35, 36].includes(i) ? 1 : 0));
const number = (value, fallback, min, max) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const hex = (value, fallback) => (/^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : fallback);
export function normalizeBrush(value = {}, fallback = {}) {
  const b = { ...fallback, ...value },
    d = { ...fallback.dither, ...value.dither },
    m = { ...fallback.magic, ...value.magic };
  return {
    id: typeof b.id === 'string' ? b.id.slice(0, 100) : 'pixel-hard',
    name: typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 40) : '像素铅笔',
    group: ['pixel', 'dither', 'magic', 'user'].includes(b.group) ? b.group : 'user',
    size: Math.round(number(b.size, 1, 1, 32)),
    pressure: b.pressure !== false,
    shape: ['square', 'round', 'custom'].includes(b.shape) ? b.shape : 'square',
    mask:
      Array.isArray(b.mask) && b.mask.length === 64
        ? b.mask.map((v) => (v ? 1 : 0))
        : [...defaultMask],
    dither: {
      enabled: d.enabled === true,
      pattern: ['bayer', 'diagonal'].includes(d.pattern) ? d.pattern : 'bayer',
      density: Math.round(number(d.density, 8, 1, 16)),
      scale: Math.round(number(d.scale, 1, 1, 4)),
      invert: d.invert === true,
      secondary: d.secondary === true,
      secondaryColor: hex(d.secondaryColor, '#445268'),
    },
    magic: {
      enabled: m.enabled === true,
      mode: MAGIC_MODES.some(([id]) => id === m.mode) ? m.mode : 'outline-brush',
      outline: hex(m.outline, '#18283e'),
      strength: number(m.strength, 0.2, 0.01, 1),
      negative: m.negative === true,
      proportional: m.proportional === true,
      indexed: m.indexed === true,
    },
  };
}
export const BRUSH_PRESETS = [
  { id: 'pixel-hard', name: '像素铅笔', group: 'pixel', size: 1 },
  { id: 'pixel-round', name: '圆头像素', group: 'pixel', size: 5, shape: 'round' },
  { id: 'pixel-custom', name: '自定义笔尖', group: 'pixel', size: 8, shape: 'custom' },
  ...[
    [4, '轻调 · 25%'],
    [8, '棋盘 · 50%'],
    [12, '浓调 · 75%'],
  ].map(([density, name]) => ({
    id: `dither-${density}`,
    name,
    group: 'dither',
    size: 12,
    dither: { enabled: true, density },
  })),
  {
    id: 'dither-diagonal',
    name: '斜线织纹',
    group: 'dither',
    size: 12,
    dither: { enabled: true, pattern: 'diagonal', density: 8 },
  },
  ...MAGIC_MODES.map(([mode, name]) => ({
    id: 'magic-' + mode,
    name,
    group: 'magic',
    size: 8,
    magic: { enabled: true, mode },
  })),
].map((b) => normalizeBrush(b));

export function createBrushLibrary(saved, legacy = {}) {
  const stored = saved?.version === 1 && Array.isArray(saved.brushes) ? saved.brushes : [];
  const brushes = BRUSH_PRESETS.map((preset) => {
    const value = stored.find((b) => b && b.id === preset.id);
    return normalizeBrush(
      { ...value, id: preset.id, name: preset.name, group: preset.group },
      preset,
    );
  });
  if (!stored.length) {
    for (const brush of brushes) brush.pressure = legacy.pressure !== false;
    const custom = brushes.find((b) => b.id === 'pixel-custom');
    custom.mask = normalizeBrush({ mask: legacy.mask }).mask;
  }
  const ids = new Set(brushes.map((b) => b.id));
  for (const value of stored) {
    if (brushes.length >= BRUSH_PRESETS.length + 48) break;
    if (
      !value ||
      typeof value.id !== 'string' ||
      !/^user-[\w-]{1,90}$/.test(value.id) ||
      ids.has(value.id)
    )
      continue;
    brushes.push(normalizeBrush({ ...value, group: 'user' }));
    ids.add(value.id);
  }
  return { version: 1, active: ids.has(saved?.active) ? saved.active : 'pixel-hard', brushes };
}

const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function ditherPixel(x, y, config) {
  const xx = Math.floor(x / config.scale),
    yy = Math.floor(y / config.scale);
  const mod = (n, d) => ((n % d) + d) % d;
  const rank =
    config.pattern === 'diagonal' ? mod(xx + yy, 4) * 4 : bayer[mod(yy, 4) * 4 + mod(xx, 4)];
  const on = rank < config.density;
  return config.invert ? !on : on;
}

/** Texture phase is anchored to canvas pixels, independent of stroke direction/size. */
export function stampBrush({
  pixels,
  w,
  h,
  x,
  y,
  size,
  brush,
  color,
  secondary,
  selection = null,
  mask = null,
  erase = false,
}) {
  const half = Math.floor(size / 2),
    dither = brush.dither;
  for (let yy = 0; yy < size; yy++)
    for (let xx = 0; xx < size; xx++) {
      if (
        brush.shape === 'round' &&
        Math.hypot(xx - (size - 1) / 2, yy - (size - 1) / 2) > size / 2
      )
        continue;
      if (
        brush.shape === 'custom' &&
        !brush.mask[Math.floor((yy / size) * 8) * 8 + Math.floor((xx / size) * 8)]
      )
        continue;
      const px = x + xx - half,
        py = y + yy - half;
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const index = py * w + px;
      if (selection && !selection[index]) continue;
      const foreground = !dither.enabled || ditherPixel(px, py, dither);
      if (!foreground && (!dither.secondary || mask || erase)) continue;
      if (mask) mask[index] = 1;
      else pixels.set(erase ? [0, 0, 0, 0] : foreground ? color : secondary, index * 4);
    }
}

export function brushHint(brush) {
  if (brush.magic.enabled) {
    const mode = brush.magic.mode;
    if (mode === 'lift') return '涂过的像素提取到新图层；抬笔后生效。';
    if (mode === 'merge') return '采集下方可见像素到新图层；抬笔后生效。';
    if (mode === 'select' || mode === 'select-erase')
      return '用笔触增加或减去选区，不改变像素颜色。';
    if (!['outline-brush', 'graffiti'].includes(mode))
      return '在已有像素上涂画以处理颜色或轮廓；透明区域保持透明。';
    return '随笔触生成效果，也可用于直线和几何形状。';
  }
  return brush.dither.enabled
    ? '纹理对齐画布网格；重复涂画保持相同点阵。'
    : '硬边像素笔触，保留每一颗像素的清晰边界。';
}
