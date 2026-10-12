import { BRUSH_GROUPS, MAGIC_MODES, brushHint, stampBrush, mixStrokeOpacity } from './brushes.js';
import { rgba, line } from './engine.js';
import { magicPixels } from './plugin-core.js';
import { updateRanges } from './controls.js';
import { createRenderScheduler } from './render-scheduler.js';

const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const range = (id, title, min, max, value, unit = '') =>
  `<label>${title}<output for="${id}" class="row-value">${value}${unit}</output><input id="${id}" aria-label="${title}" type="range" min="${min}" max="${max}" value="${value}" data-unit="${unit}"></label>`;
const check = (id, label, value) =>
  `<label class="switch">${label}<input id="${id}" type="checkbox" ${value ? 'checked' : ''}></label>`;

function seed(w, h, brush) {
  const pixels = new Uint8ClampedArray(w * h * 4);
  if (brush.magic.enabled && !['outline-brush', 'graffiti'].includes(brush.magic.mode)) {
    const colors = ['#df917e', '#afbacf', '#87bdb5', '#848cc3'];
    for (let y = Math.floor(h * 0.2); y < h * 0.8; y++)
      for (let x = 12; x < w - 12; x++)
        pixels.set(
          rgba(colors[Math.min(3, Math.floor(((x - 12) / (w - 24)) * 4))]),
          (y * w + x) * 4,
        );
  }
  return pixels;
}
function applySample(base, pixels, mask, w, h, brush, color, palette) {
  if (!brush.magic.enabled) return pixels;
  if (['select', 'select-erase', 'lift', 'merge'].includes(brush.magic.mode)) {
    const out = new Uint8ClampedArray(base);
    for (let i = 0; i < mask.length; i++) if (mask[i]) out.set(rgba('#83c5ff'), i * 4);
    return out;
  }
  return mixStrokeOpacity(
    base,
    magicPixels(base, w, h, mask, brush.magic, color, palette),
    brush.opacity,
  );
}
function paint(canvas, pixels) {
  canvas.getContext('2d').putImageData(new ImageData(pixels, canvas.width, canvas.height), 0, 0);
}
function sampleStroke(canvas, brush, color, palette) {
  const w = canvas.width,
    h = canvas.height,
    base = seed(w, h, brush),
    pixels = new Uint8ClampedArray(base),
    mask = new Uint8Array(w * h);
  let previous;
  for (let x = 14; x < w - 14; x++) {
    const y = Math.round(h * 0.5 + Math.sin(((x / w) * 2.8 - 0.6) * Math.PI) * h * 0.19);
    const stamp = (px, py) =>
      stampBrush({
        pixels,
        base,
        w,
        h,
        x: px,
        y: py,
        size: Math.min(20, brush.size),
        brush,
        color: rgba(color),
        secondary: rgba(brush.dither.secondaryColor),
        mask: brush.magic.enabled ? mask : null,
      });
    if (previous) line(previous.x, previous.y, x, y, stamp);
    else stamp(x, y);
    previous = { x, y };
  }
  paint(canvas, applySample(base, pixels, mask, w, h, brush, color, palette));
}

export function createBrushPanel(root, host, initialGroup) {
  let group = initialGroup || host.current().group,
    studio = false,
    query = '',
    scratch = null;
  const previewJob = createRenderScheduler(() => {
    if (!root.isConnected) return;
    if (studio) resetPad();
    else drawCards();
  });
  const q = (selector) => root.querySelector(selector);
  const current = () => host.current();
  const tipBrush = (brush) =>
    host.mode?.() === 'eraser' ? { ...brush, magic: { ...brush.magic, enabled: false } } : brush;
  function drawCards() {
    root.querySelectorAll('[data-brush]').forEach((button) => {
      const brush = host.brushes().find((item) => item.id === button.dataset.brush);
      if (brush)
        sampleStroke(button.querySelector('canvas'), tipBrush(brush), '#e4e8f2', host.palette());
    });
  }
  function library() {
    studio = false;
    root.scrollTop = 0;
    root.classList.remove('brush-studio-view');
    root.innerHTML = `<div class="brush-library-head"><div><small>${host.mode?.() === 'eraser' ? 'ERASE' : 'PAINT'}</small><strong>${host.mode?.() === 'eraser' ? '橡皮笔刷库' : '画笔库'}</strong></div><button id="brush-new" aria-label="复制当前笔刷为新笔刷">＋</button><button id="brush-configure" aria-label="配置当前笔刷">调校</button></div><div class="brush-search"><input id="brush-search" type="search" aria-label="搜索笔刷" placeholder="搜索笔刷名称" value="${esc(query)}"></div><div class="brush-library-split"><nav class="brush-groups" aria-label="笔刷分类">${BRUSH_GROUPS.map(([id, name, icon]) => `<button data-brush-group="${id}" aria-pressed="${id === group}"><span aria-hidden="true">${icon}</span>${name}</button>`).join('')}</nav><div class="brush-list" role="group" aria-label="笔刷列表"></div></div><div class="brush-library-foot"><span id="brush-current"></span><small>轻点选择 · 再点调校</small></div>`;
    q('#brush-new').onclick = duplicate;
    q('#brush-configure').onclick = configure;
    root.querySelectorAll('[data-brush-group]').forEach(
      (button) =>
        (button.onclick = () => {
          group = button.dataset.brushGroup;
          query = '';
          library();
        }),
    );
    q('#brush-search').oninput = (event) => {
      query = event.target.value;
      list();
    };
    list();
  }
  function list() {
    const brushes = host
      .brushes()
      .filter((b) =>
        query.trim()
          ? b.name.toLowerCase().includes(query.trim().toLowerCase())
          : b.group === group,
      );
    q('.brush-list').innerHTML = brushes.length
      ? brushes
          .map(
            (brush) =>
              `<button class="brush-card" data-brush="${brush.id}" aria-label="选择${esc(brush.name)}" aria-pressed="${brush.id === current().id}"><span class="brush-card-name">${esc(brush.name)}<small>${brush.size} px</small></span><canvas width="210" height="42" aria-hidden="true"></canvas><span class="brush-card-kind">${brush.magic.enabled ? 'MAGIC PENCIL' : brush.dither.enabled ? `${Math.round((brush.dither.density / 16) * 100)}% 覆盖` : brush.shape === 'custom' ? '8 × 8 自定义' : '硬边像素'}<i aria-hidden="true">✓</i></span></button>`,
          )
          .join('')
      : `<div class="brush-empty"><span>◇</span><strong>${query ? '没有找到这支笔' : '留给你的独特笔触'}</strong><p>${query ? '试试另一个名称。' : '选择一支笔刷，点右上角 ＋ 保存为自己的版本。'}</p></div>`;
    root.querySelectorAll('[data-brush]').forEach(
      (button) =>
        (button.onclick = () => {
          if (button.dataset.brush === current().id) {
            configure();
            return;
          }
          host.select(button.dataset.brush);
          list();
        }),
    );
    sync();
    drawCards();
  }
  async function duplicate() {
    const name = await host.ask({
      title: '新笔刷',
      value: current().name + ' 副本',
      confirm: '创建笔刷',
    });
    if (!name || !root.isConnected) return;
    if (host.duplicate(name)) {
      group = 'user';
      configure();
    }
  }
  function patch(value, persist = true) {
    host.update(value, persist);
    sync();
    previewJob.request();
  }
  function configure() {
    studio = true;
    root.scrollTop = 0;
    root.classList.add('brush-studio-view');
    const b = current();
    const original = structuredClone(b);
    root.innerHTML = `<div class="brush-studio-head"><button id="brush-back">‹ 笔刷库</button><strong id="brush-studio-name">${esc(b.name)}</strong><button id="brush-cancel">取消</button><button id="brush-done" class="primary">完成</button></div><div class="brush-pad-head"><span>试画板</span><button id="brush-pad-reset">重置笔迹</button></div><canvas id="brush-pad" width="288" height="110" aria-label="笔刷试画板"></canvas><p id="brush-hint" class="help"></p><section class="brush-section"><h3>笔触</h3>${range('size-range', '笔刷大小', 1, 32, b.size, ' px')}${range('brush-opacity', '不透明度', 1, 100, b.opacity, '%')}<label>笔尖形状<select id="brush-shape"><option value="square">方形 · 硬边像素</option><option value="round">圆形 · 硬边像素</option><option value="custom">自定义 · 8 × 8 笔尖</option></select></label>${check('pressure', '笔压控制大小', b.pressure)}<div id="brush-custom" ${b.shape !== 'custom' ? 'hidden' : ''}><div class="brush-grid">${b.mask.map((v, i) => `<button type="button" data-mask="${i}" aria-label="笔尖像素 ${i + 1}" aria-pressed="${!!v}" class="${v ? 'on' : ''}"></button>`).join('')}</div><div class="brush-chips"><button id="mask-square">实心</button><button id="mask-cross">十字</button><button id="mask-clear">清空</button></div><small class="help">轻点格子绘制笔尖，空白笔尖不会留下笔迹。</small></div></section><section class="brush-section"><h3>纹理与抖色</h3>${check('dither-enabled', '抖动绘制', b.dither.enabled)}<div id="dither-options" ${!b.dither.enabled ? 'hidden' : ''}><label>抖色纹理<select id="dither-pattern"><option value="bayer">有序点阵 · Bayer 4×4</option><option value="diagonal">斜线纹理</option></select></label>${range('dither-density', '点阵密度', 1, 16, b.dither.density)}${range('dither-scale', '纹理格子', 1, 4, b.dither.scale, ' px')}${check('dither-invert', '反转点阵', b.dither.invert)}${check('dither-secondary', '双色抖色', b.dither.secondary)}<label id="dither-color-row" class="brush-color-row">第二颜色<input id="dither-color" type="color" value="${b.dither.secondaryColor}"></label><p class="help">关闭双色时，点阵间隙保留原有像素。魔法效果仅使用前景点阵作为作用范围。</p></div></section><section class="brush-section"><h3>Magic Pencil</h3>${check('magic-enabled', '魔法效果', b.magic.enabled)}<div id="magic-options" ${!b.magic.enabled ? 'hidden' : ''}><label>笔刷效果<select id="magic-mode">${MAGIC_MODES.map(([id, title]) => `<option value="${id}">${title}</option>`).join('')}</select></label><label class="brush-color-row">描边颜色<input id="magic-outline" type="color" value="${b.magic.outline}"></label>${range('magic-strength', '效果强度', 1, 100, Math.round(b.magic.strength * 100), '%')}${check('magic-negative', '降低 / 反向', b.magic.negative)}${check('magic-proportional', '按像素数量加权混色', b.magic.proportional)}${check('magic-indexed', '贴合当前色板', b.magic.indexed)}<p class="help">试画板中的蓝色标记表示选择或提取范围；实际选区、图层操作会在画布抬笔后执行。</p></div></section><section class="brush-section brush-manage"><button id="brush-copy" class="panel-wide">保存为新笔刷 <span>＋</span></button>${b.group === 'user' ? '<button id="brush-rename" class="panel-wide">重命名笔刷</button><button id="brush-delete" class="panel-wide danger">删除这支笔刷</button>' : '<button id="brush-reset" class="panel-wide">还原此笔刷默认设置</button>'}<small>每支笔刷单独记忆参数，保存在此设备。</small></section>`;
    const sections = [...root.querySelectorAll('.brush-section')];
    const preview = document.createElement('div');
    preview.className = 'brush-studio-preview';
    root.prepend(preview);
    while (preview.nextElementSibling !== sections[0]) preview.append(preview.nextElementSibling);
    const tabs = document.createElement('div');
    tabs.className = 'segment brush-studio-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '笔刷配置分类');
    const names = [
      ['stroke', '笔触'],
      ['dither', '抖色'],
      ['magic', '魔法'],
      ['manage', '管理'],
    ];
    const activate = (index) => {
      sections.forEach((section, i) => {
        section.hidden = i !== index;
      });
      [...tabs.children].forEach((button, i) => {
        button.setAttribute('aria-selected', String(i === index));
        button.classList.toggle('active', i === index);
        button.tabIndex = i === index ? 0 : -1;
      });
      root.scrollTop = 0;
    };
    names.forEach(([id, name], i) => {
      sections[i].id = 'brush-section-' + id;
      sections[i].setAttribute('role', 'tabpanel');
      sections[i].setAttribute('aria-labelledby', 'brush-tab-' + id);
      const button = document.createElement('button');
      button.id = 'brush-tab-' + id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', sections[i].id);
      button.textContent = name;
      button.hidden = id === 'magic' && host.mode?.() === 'eraser';
      button.onclick = () => activate(i);
      button.onkeydown = (event) => {
        const available = host.mode?.() === 'eraser' ? [0, 1, 3] : [0, 1, 2, 3];
        const position = available.indexOf(i);
        const index = ['ArrowRight', 'ArrowDown'].includes(event.key)
          ? available[(position + 1) % available.length]
          : ['ArrowLeft', 'ArrowUp'].includes(event.key)
            ? available[(position + available.length - 1) % available.length]
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? 3
                : -1;
        if (index >= 0) {
          event.preventDefault();
          activate(index);
          tabs.children[index].focus();
        }
      };
      tabs.append(button);
    });
    root.prepend(q('.brush-studio-head'));
    root.insertBefore(tabs, preview);
    activate(b.magic.enabled && host.mode?.() !== 'eraser' ? 2 : b.dither.enabled ? 1 : 0);
    q('#brush-shape').value = b.shape;
    q('#dither-pattern').value = b.dither.pattern;
    q('#magic-mode').value = b.magic.mode;
    q('#brush-back').onclick = library;
    q('#brush-cancel').onclick = () => {
      host.update(original);
      library();
    };
    q('#brush-done').onclick = () => {
      host.persist();
      library();
    };
    q('#brush-pad-reset').onclick = resetPad;
    q('#brush-copy').onclick = duplicate;
    const bindRange = (id, fn) => {
      const input = q('#' + id);
      input.oninput = () => patch(fn(Number(input.value)), false);
      input.onchange = () => host.persist();
    };
    bindRange('size-range', (size) => ({ size }));
    bindRange('brush-opacity', (opacity) => ({ opacity }));
    bindRange('dither-density', (density) => ({ dither: { density } }));
    bindRange('dither-scale', (scale) => ({ dither: { scale } }));
    bindRange('magic-strength', (strength) => ({ magic: { strength: strength / 100 } }));
    q('#brush-shape').onchange = (event) => {
      patch({ shape: event.target.value });
      q('#brush-custom').hidden = current().shape !== 'custom';
    };
    q('#pressure').onchange = (event) => patch({ pressure: event.target.checked });
    for (const name of ['enabled', 'invert', 'secondary'])
      q('#dither-' + name).onchange = (event) => {
        patch({ dither: { [name]: event.target.checked } });
        q('#dither-options').hidden = !current().dither.enabled;
      };
    q('#dither-pattern').onchange = (event) => patch({ dither: { pattern: event.target.value } });
    q('#dither-color').oninput = (event) =>
      patch({ dither: { secondaryColor: event.target.value } }, false);
    q('#dither-color').onchange = () => host.persist();
    for (const name of ['enabled', 'negative', 'proportional', 'indexed'])
      q('#magic-' + name).onchange = (event) => {
        patch({ magic: { [name]: event.target.checked } });
        q('#magic-options').hidden = !current().magic.enabled;
      };
    q('#magic-mode').onchange = (event) => patch({ magic: { mode: event.target.value } });
    q('#magic-outline').oninput = (event) =>
      patch({ magic: { outline: event.target.value } }, false);
    q('#magic-outline').onchange = () => host.persist();
    const setMask = (mask) => {
      patch({ mask });
      root.querySelectorAll('[data-mask]').forEach((button) => {
        const on = !!current().mask[Number(button.dataset.mask)];
        button.classList.toggle('on', on);
        button.setAttribute('aria-pressed', String(on));
      });
    };
    root.querySelectorAll('[data-mask]').forEach(
      (button) =>
        (button.onclick = () => {
          const mask = [...current().mask];
          mask[Number(button.dataset.mask)] ^= 1;
          setMask(mask);
        }),
    );
    q('#mask-square').onclick = () => setMask(Array(64).fill(1));
    q('#mask-cross').onclick = () =>
      setMask(Array.from({ length: 64 }, (_, i) => Number(i % 8 === 3 || Math.floor(i / 8) === 3)));
    q('#mask-clear').onclick = () => setMask(Array(64).fill(0));
    if (q('#brush-reset'))
      q('#brush-reset').onclick = () => {
        host.reset();
        configure();
      };
    if (q('#brush-rename'))
      q('#brush-rename').onclick = async () => {
        const id = current().id;
        const name = await host.ask({
          title: '笔刷名称',
          value: current().name,
          confirm: '保存名称',
        });
        if (name && root.isConnected && current().id === id) {
          patch({ name });
          q('#brush-studio-name').textContent = current().name;
        }
      };
    if (q('#brush-delete'))
      q('#brush-delete').onclick = async () => {
        const id = current().id;
        if (
          await host.ask({
            title: '删除这支笔刷？',
            description: '作品中的笔迹会保留。',
            danger: true,
            confirm: '删除笔刷',
          })
        ) {
          if (!root.isConnected || current().id !== id) return;
          host.remove();
          group = 'user';
          library();
        }
      };
    installPad();
    sync();
    resetPad();
  }
  function resetPad() {
    const canvas = q('#brush-pad');
    if (!canvas) return;
    scratch = null;
    sampleStroke(canvas, tipBrush(current()), host.color(), host.palette());
  }
  function installPad() {
    const canvas = q('#brush-pad'),
      w = canvas.width,
      h = canvas.height;
    const point = (event) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: Math.floor(((event.clientX - r.left) / r.width) * w),
        y: Math.floor(((event.clientY - r.top) / r.height) * h),
      };
    };
    const move = (event) => {
      if (!scratch || event.pointerId !== scratch.id) return;
      const p = point(event),
        b = tipBrush(current());
      const n =
        b.pressure && event.pointerType === 'pen'
          ? Math.max(1, Math.round(b.size * (0.25 + 0.75 * (event.pressure || 0.5))))
          : b.size;
      line(scratch.last.x, scratch.last.y, p.x, p.y, (x, y) =>
        stampBrush({
          pixels: scratch.pixels,
          base: scratch.base,
          w,
          h,
          x,
          y,
          size: n,
          brush: b,
          color: rgba(host.color()),
          secondary: rgba(b.dither.secondaryColor),
          mask: b.magic.enabled ? scratch.mask : null,
          erase: host.mode?.() === 'eraser',
        }),
      );
      scratch.last = p;
      paint(
        canvas,
        applySample(
          scratch.base,
          scratch.pixels,
          scratch.mask,
          w,
          h,
          b,
          host.color(),
          host.palette(),
        ),
      );
    };
    canvas.onpointerdown = (event) => {
      if (event.button !== 0 || scratch) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      const base = canvas.getContext('2d').getImageData(0, 0, w, h).data;
      scratch = {
        id: event.pointerId,
        base,
        pixels: new Uint8ClampedArray(base),
        mask: new Uint8Array(w * h),
        last: point(event),
      };
      move(event);
    };
    canvas.onpointermove = move;
    canvas.onpointerup = (event) => {
      move(event);
      scratch = null;
    };
    canvas.onpointercancel = canvas.onlostpointercapture = () => {
      scratch = null;
    };
  }
  function sync() {
    if (!root.isConnected) return;
    const b = current();
    if (!studio) {
      if (q('#brush-current')) q('#brush-current').textContent = `${b.name} · ${b.size} px`;
      return;
    }
    q('#brush-hint').textContent =
      host.mode?.() === 'eraser'
        ? '橡皮使用所选笔尖与抖色纹理；不透明度决定擦除程度。'
        : brushHint(b);
    q('#size-range').value = b.size;
    q('#brush-opacity').value = b.opacity;
    q('#brush-opacity').disabled =
      host.mode?.() !== 'eraser' &&
      b.magic.enabled &&
      ['select', 'select-erase', 'lift', 'merge'].includes(b.magic.mode);
    root.querySelectorAll('input[type="range"]').forEach((input) => {
      const output = root.querySelector(`output[for="${input.id}"]`);
      output.textContent =
        input.id === 'dither-density'
          ? `${Math.round((Number(input.value) / 16) * 100)}%`
          : input.value + input.dataset.unit;
    });
    q('#dither-color-row').hidden = !b.dither.secondary;
    q('#dither-secondary').disabled = b.magic.enabled;
    updateRanges(root);
  }
  library();
  return {
    sync,
    group(value) {
      group = value;
      query = '';
      library();
    },
  };
}
