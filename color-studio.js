import { createRenderScheduler } from './render-scheduler.js';
import { updateRanges } from './controls.js';
import { paletteStore, parsePalette, paletteGpl, extractPalette } from './palettes.js';
export function hsvToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return '#' + f(5) + f(3) + f(1);
}
export function hexToHsv(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255),
    v = Math.max(r, g, b),
    d = v - Math.min(r, g, b);
  const h = d === 0 ? 0 : v === r ? ((g - b) / d) % 6 : v === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, v ? d / v : 0, v];
}
export function colorStudio(root, host) {
  const library = paletteStore();
  let [h, s, v] = hexToHsv(host.color()),
    previous = host.color(),
    recent = [];
  try {
    recent = JSON.parse(localStorage.getItem('pixel-studio-recent-colors') || '[]')
      .filter((c) => /^#[0-9a-f]{6}$/i.test(c))
      .slice(0, 12);
  } catch {}
  root.innerHTML = `<div class="color-studio"><canvas id="color-wheel" aria-label="色环和饱和度明度方块"></canvas><div class="color-pair"><button id="color-previous" title="切换到上一个颜色">上一个</button><button id="color-current">当前颜色</button></div><label class="hex-row">HEX<input id="hex-color" maxlength="7" aria-label="十六进制颜色"></label><div class="color-tabs"><button id="mode-hsv" class="active">HSV</button><button id="mode-rgb">RGB</button></div><div id="color-sliders"></div><p class="palette-heading">配色建议</p><div id="color-harmony" class="color-strip"></div><p class="palette-heading">最近使用</p><div id="color-recent" class="color-strip"></div><div class="palette-title"><select id="palette-library" aria-label="色板库"></select><button id="palette-new" aria-label="新建色板">＋</button></div><div id="palette-colors" class="palette"></div><div class="palette-actions"><button id="palette-add">＋ 当前颜色</button><button id="palette-remove">移除此色</button><button id="palette-rename">重命名</button><button id="palette-extract">提取画布色</button><button id="palette-import">导入色板</button><button id="palette-export">导出 GPL</button><button id="palette-json">导出 JSON</button><button id="palette-delete">删除色板</button></div><input id="palette-file" type="file" accept=".json,.gpl" hidden><p class="help">色板保存在此设备。支持 JSON / GIMP GPL，每个色板最多 256 色。</p></div>`;
  const $ = (q) => root.querySelector(q),
    wheel = $('#color-wheel'),
    ctx = wheel.getContext('2d');
  let mode = 'hsv',
    drag = null;
  const active = () => library.items.find((p) => p.id === library.active);
  function save() {
    try {
      localStorage.setItem('pixel-studio-palette-library', JSON.stringify(library));
      host.palette([...active().colors]);
    } catch {
      host.toast('色板未能保存，请检查设备存储');
    }
  }
  function remember() {
    const c = host.color();
    recent = [c, ...recent.filter((x) => x !== c)].slice(0, 12);
    try {
      localStorage.setItem('pixel-studio-recent-colors', JSON.stringify(recent));
    } catch {}
    strips();
  }
  function swatches(target, colors) {
    const key = colors.join(',');
    if (target.dataset.colors === key) return;
    target.dataset.colors = key;
    while (target.children.length > colors.length) target.lastElementChild.remove();
    colors.forEach((color, i) => {
      let button = target.children[i];
      if (!button) {
        button = document.createElement('button');
        button.className = 'swatch';
        button.onclick = () => set(button.dataset.color, true);
        target.append(button);
      }
      button.dataset.color = color;
      button.style.background = color;
      button.setAttribute('aria-label', '颜色 ' + color);
    });
  }
  function strips() {
    swatches($('#color-recent'), recent);
    swatches(
      $('#color-harmony'),
      [-30, 0, 30, 150, 180, 210].map((offset) => hsvToHex((h + offset + 360) % 360, s, v)),
    );
  }
  const ring = document.createElement('canvas');
  let ringDensity = 0;
  function draw() {
    const d = devicePixelRatio || 1;
    if (ringDensity !== d) {
      ringDensity = d;
      wheel.width = wheel.height = ring.width = ring.height = Math.round(260 * d);
      const ringContext = ring.getContext('2d');
      ringContext.setTransform(d, 0, 0, d, 0, 0);
      for (let a = 0; a < 360; a++) {
        ringContext.beginPath();
        ringContext.strokeStyle = `hsl(${a} 100% 50%)`;
        ringContext.lineWidth = 24;
        ringContext.arc(130, 130, 112, ((a - 0.5) * Math.PI) / 180, ((a + 1) * Math.PI) / 180);
        ringContext.stroke();
      }
    }
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, 260, 260);
    ctx.drawImage(ring, 0, 0, 260, 260);
    ctx.fillStyle = hsvToHex(h, 1, 1);
    ctx.fillRect(70, 70, 120, 120);
    let grad = ctx.createLinearGradient(70, 0, 190, 0);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(1, '#fff0');
    ctx.fillStyle = grad;
    ctx.fillRect(70, 70, 120, 120);
    grad = ctx.createLinearGradient(0, 70, 0, 190);
    grad.addColorStop(0, '#0000');
    grad.addColorStop(1, '#000');
    ctx.fillStyle = grad;
    ctx.fillRect(70, 70, 120, 120);
    for (const [x, y] of [
      [130 + 112 * Math.cos((h * Math.PI) / 180), 130 + 112 * Math.sin((h * Math.PI) / 180)],
      [70 + s * 120, 70 + (1 - v) * 120],
    ]) {
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  let syncedColor = host.color();
  const visuals = createRenderScheduler(syncNow);
  function sync() {
    visuals.request();
  }
  function syncNow() {
    if (!root.isConnected) return;
    const color = host.color();
    syncedColor = color;
    $('#hex-color').value = color;
    $('#color-current').style.background = color;
    $('#color-previous').style.background = previous;
    const values =
      mode === 'hsv'
        ? [Math.round(h), Math.round(s * 100), Math.round(v * 100)]
        : [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    root.querySelectorAll('[data-channel]').forEach((e, i) => {
      e.value = values[i];
      e.nextElementSibling.value = values[i];
    });
    draw();
    strips();
    updateRanges(root);
  }
  function set(c, discrete = false) {
    if (discrete) previous = host.color();
    [h, s, v] = hexToHsv(c);
    host.setColor(c);
    sync();
    if (discrete) remember();
  }
  function sliders() {
    const labels = mode === 'hsv' ? ['色相 H', '饱和 S', '明度 V'] : ['红 R', '绿 G', '蓝 B'];
    $('#color-sliders').innerHTML = labels
      .map(
        (label, i) =>
          `<label class="color-channel"><span>${label}</span><input type="range" data-channel="${i}" min="0" max="${mode === 'rgb' ? 255 : i === 0 ? 359 : 100}" aria-label="${label}"><output></output></label>`,
      )
      .join('');
    root.querySelectorAll('[data-channel]').forEach((input) => {
      input.onpointerdown = () => (previous = host.color());
      input.oninput = () => {
        const values = [...root.querySelectorAll('[data-channel]')].map((e) => +e.value);
        if (mode === 'hsv') {
          [h, s, v] = [values[0], values[1] / 100, values[2] / 100];
          host.setColor(hsvToHex(h, s, v));
          sync();
        } else set('#' + values.map((n) => n.toString(16).padStart(2, '0')).join(''));
      };
      input.onchange = remember;
    });
    sync();
  }
  function redrawPalette() {
    const select = $('#palette-library');
    select.replaceChildren();
    library.items.forEach((p) => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      select.append(option);
    });
    select.value = library.active;
    swatches($('#palette-colors'), active().colors);
    save();
  }
  function move(e) {
    if (!drag) return;
    const r = wheel.getBoundingClientRect(),
      x = ((e.clientX - r.left) * 260) / r.width,
      y = ((e.clientY - r.top) * 260) / r.height;
    if (drag === 'hue') h = ((Math.atan2(y - 130, x - 130) * 180) / Math.PI + 360) % 360;
    else {
      s = Math.max(0, Math.min(1, (x - 70) / 120));
      v = 1 - Math.max(0, Math.min(1, (y - 70) / 120));
    }
    host.setColor(hsvToHex(h, s, v));
    sync();
  }
  wheel.onpointerdown = (e) => {
    const r = wheel.getBoundingClientRect(),
      x = ((e.clientX - r.left) * 260) / r.width,
      y = ((e.clientY - r.top) * 260) / r.height,
      dist = Math.hypot(x - 130, y - 130);
    drag =
      x >= 70 && x <= 190 && y >= 70 && y <= 190 ? 'sv' : dist >= 96 && dist <= 130 ? 'hue' : null;
    if (drag) {
      previous = host.color();
      if (e.isTrusted) wheel.setPointerCapture(e.pointerId);
      move(e);
    }
  };
  wheel.onpointermove = move;
  wheel.onpointerup = () => {
    visuals.flush();
    if (drag) remember();
    drag = null;
  };
  wheel.onpointercancel = () => {
    drag = null;
  };
  $('#hex-color').onchange = (e) =>
    /^#[0-9a-f]{6}$/i.test(e.target.value) ? set(e.target.value.toLowerCase(), true) : sync();
  $('#color-previous').onclick = () => set(previous, true);
  for (const m of ['hsv', 'rgb'])
    $('#mode-' + m).onclick = () => {
      mode = m;
      for (const n of ['hsv', 'rgb']) $('#mode-' + n).classList.toggle('active', n === m);
      sliders();
    };
  $('#palette-library').onchange = (e) => {
    library.active = e.target.value;
    redrawPalette();
  };
  async function add(name, colors) {
    if (library.items.length >= 100) {
      host.toast('最多保存 100 个色板');
      return;
    }
    library.active = crypto.randomUUID();
    library.items.push({ id: library.active, name, colors });
    redrawPalette();
  }
  $('#palette-new').onclick = async () => {
    const name = await host.ask({ title: '新建色板', value: '我的色板' });
    if (name) add(name, []);
  };
  $('#palette-add').onclick = () => {
    if (active().colors.length >= 256) return host.toast('这个色板已有 256 色');
    if (!active().colors.includes(host.color())) active().colors.push(host.color());
    redrawPalette();
  };
  $('#palette-remove').onclick = () => {
    active().colors = active().colors.filter((c) => c !== host.color());
    redrawPalette();
  };
  $('#palette-rename').onclick = async () => {
    const name = await host.ask({ title: '色板名称', value: active().name });
    if (name) {
      active().name = name;
      redrawPalette();
    }
  };
  $('#palette-delete').onclick = async () => {
    if (library.items.length === 1) return host.toast('请至少保留一个色板');
    if (
      await host.ask({
        title: '删除这个色板？',
        description: active().name,
        confirm: '删除色板',
        danger: true,
      })
    ) {
      library.items = library.items.filter((p) => p.id !== library.active);
      library.active = library.items[0].id;
      redrawPalette();
    }
  };
  $('#palette-extract').onclick = () => {
    const colors = extractPalette(host.pixels());
    if (colors.length) add('画布提色 · ' + (library.items.length + 1), colors);
    else host.toast('画布中还没有可提取的颜色');
  };
  $('#palette-import').onclick = () => $('#palette-file').click();
  $('#palette-file').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (file.size > 1048576) throw Error('色板文件需小于 1 MB');
      const p = parsePalette(await file.text(), file.name);
      add(p.name, p.colors);
    } catch (err) {
      host.toast(err.message);
    }
  };
  function exportFile(format) {
    if (!active().colors.length) return host.toast('请先添加颜色');
    const blob = new Blob(
        [format === 'gpl' ? paletteGpl(active()) : JSON.stringify(active(), null, 2)],
        { type: 'text/plain' },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = active().name.replace(/[\\/:*?"<>|]/g, '_') + '.' + format;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  $('#palette-export').onclick = () => exportFile('gpl');
  $('#palette-json').onclick = () => exportFile('json');
  sliders();
  redrawPalette();
  return {
    syncExternal() {
      if (host.color() === syncedColor || drag) return;
      previous = syncedColor;
      [h, s, v] = hexToHsv(host.color());
      sync();
    },
  };
}
