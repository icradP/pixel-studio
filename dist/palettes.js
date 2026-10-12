export const RAIN = [
  '#101e2c',
  '#203846',
  '#365363',
  '#587482',
  '#8da7ac',
  '#cad4c6',
  '#fff0cd',
  '#ffffff',
  '#342b42',
  '#654365',
  '#a76384',
  '#ef87a0',
  '#ffc1b9',
  '#ed805b',
  '#be4a4b',
  '#713a49',
  '#253d37',
  '#3b6654',
  '#6e9d71',
  '#a9cfad',
  '#ebcc73',
  '#ba944a',
  '#795c32',
  '#473a2b',
  '#182c50',
  '#274978',
  '#427aaa',
  '#70b6d1',
  '#aae0e4',
  '#655b9a',
  '#9585b7',
  '#c8b0cc',
];
export const DEFAULT_PALETTES = [
  { id: 'rain', name: '雨巷 · 霓虹', colors: RAIN },
  {
    id: 'skin',
    name: '肤色 · 暖光',
    colors: [
      '#2b1b22',
      '#513039',
      '#704247',
      '#92575a',
      '#b87570',
      '#cf9381',
      '#e4ae91',
      '#f4c7a2',
      '#ffe0b8',
      '#fff0d4',
      '#d59295',
      '#f4b2b0',
      '#facfc4',
      '#bc899e',
      '#895d79',
      '#5e435f',
    ],
  },
  {
    id: 'forest',
    name: '森林 · 大地',
    colors: [
      '#152c27',
      '#244336',
      '#365b40',
      '#4e7750',
      '#75a760',
      '#a4c378',
      '#d2df9b',
      '#edf0c1',
      '#342b25',
      '#594332',
      '#826143',
      '#af875b',
      '#d4af78',
      '#eed5a2',
      '#426775',
      '#8db9bf',
    ],
  },
  {
    id: 'pastel',
    name: '粉彩 · 晴空',
    colors: [
      '#564b78',
      '#8872a5',
      '#b6a2d8',
      '#ddc5ec',
      '#a96283',
      '#d687a2',
      '#efb3ba',
      '#faddcf',
      '#a87f59',
      '#d6b16d',
      '#f3d894',
      '#fff2c9',
      '#55898d',
      '#7fb8b0',
      '#afd7ca',
      '#dbeee1',
    ],
  },
  {
    id: 'gray',
    name: '灰阶 · 明暗',
    colors: Array.from(
      { length: 16 },
      (_, i) => '#' + (i * 17).toString(16).padStart(2, '0').repeat(3),
    ),
  },
];
export function parsePalette(text, filename = 'palette.json') {
  let name = filename.replace(/\.[^.]+$/, ''),
    colors = [];
  if (text.trimStart().startsWith('GIMP Palette')) {
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('Name:')) name = line.slice(5).trim();
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)(?:\s|$)/);
      if (m) {
        const rgb = m.slice(1, 4).map(Number);
        if (rgb.some((n) => n > 255)) throw Error('GPL 色值必须为 0–255');
        colors.push('#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join(''));
      }
    }
  } else {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw Error('请选择 JSON 或 GIMP GPL 色板');
    }
    colors = Array.isArray(value) ? value : value.colors;
    name = Array.isArray(value) ? name : value.name || name;
  }
  if (
    !Array.isArray(colors) ||
    !colors.length ||
    colors.length > 256 ||
    colors.some((c) => typeof c !== 'string' || !/^#[0-9a-f]{6}$/i.test(c))
  )
    throw Error('色板需要 1–256 个 #RRGGBB 颜色');
  return {
    name: String(name).slice(0, 80),
    colors: [...new Set(colors.map((c) => c.toLowerCase()))],
  };
}
export function paletteGpl(p) {
  return (
    'GIMP Palette\nName: ' +
    p.name.replace(/[\r\n]/g, ' ') +
    '\nColumns: 8\n# Pixel Studio\n' +
    p.colors
      .map(
        (c) =>
          [1, 3, 5]
            .map((i) =>
              parseInt(c.slice(i, i + 2), 16)
                .toString()
                .padStart(3, ' '),
            )
            .join(' ') +
          '\t' +
          c,
      )
      .join('\n') +
    '\n'
  );
}
export function extractPalette(data, limit = 32) {
  const colors = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 64) continue;
    const key =
      '#' + Array.from(data.subarray(i, i + 3), (v) => v.toString(16).padStart(2, '0')).join('');
    colors.set(key, (colors.get(key) || 0) + 1);
  }
  return [...colors]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([c]) => c);
}
export function paletteStore() {
  try {
    const p = JSON.parse(localStorage.getItem('pixel-studio-palette-library') || 'null');
    if (p && Array.isArray(p.items) && p.items.length && p.items.length <= 100) {
      p.items = p.items.map((item) => {
        const parsed = item.colors.length
          ? parsePalette(JSON.stringify(item))
          : { name: String(item.name).slice(0, 80), colors: [] };
        return { ...parsed, id: String(item.id).slice(0, 100) };
      });
      if (!p.items.some((i) => i.id === p.active)) p.active = p.items[0].id;
      return p;
    }
  } catch {}
  return { active: 'rain', items: DEFAULT_PALETTES.map((p) => ({ ...p, colors: [...p.colors] })) };
}
export function activePalette() {
  const store = paletteStore();
  return store.items.find((p) => p.id === store.active).colors;
}
