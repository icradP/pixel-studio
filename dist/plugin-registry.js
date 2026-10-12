export const PLUGINS = [
  {
    id: 'iso',
    name: '等距盒子',
    english: 'ISO Box',
    symbol: '◇',
    description: '三面着色、描边高光与线框盒子。',
    url: 'https://darkwark.itch.io/isobox-for-aseprite',
  },
  {
    id: 'magic',
    name: '魔法铅笔',
    english: 'Magic Pencil',
    symbol: '✦',
    description: '描边、涂鸦、颜色处理与像素提取。',
    url: 'https://thkaspar.itch.io/magic-pencil',
  },
  {
    id: 'animation',
    name: '动画套件',
    english: 'Animation Suite',
    symbol: '▷',
    description: '合成动画、运动路径与多图层循环。',
    url: 'https://thkaspar.itch.io/animation-suite',
  },
  {
    id: 'snap',
    name: '选区吸附',
    english: 'Snap Selection',
    symbol: '⌗',
    description: '框选、网格对齐与像素精确移动。',
    url: 'https://kidmarscat.itch.io/snapselection',
  },
  {
    id: 'normal',
    name: '法线光照',
    english: 'Normal Shading',
    symbol: '◐',
    description: '方向光、环境光与镜面高光。',
    url: 'https://mooosik.itch.io/shading-extension',
  },
];
export function pluginEnabled(id) {
  try {
    return JSON.parse(localStorage.getItem('pixel-studio-plugins') || '{}')[id] !== false;
  } catch {
    return true;
  }
}
