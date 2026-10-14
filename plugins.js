import { readCel } from './cel-storage.js';
import { importKind } from './file-import.js';
import { blank, clone, composite, deserialize } from './engine.js';
import { readAse } from './ase.js';
import { floatingPanel } from './floating.js';
import {
  isoBox,
  placeRaster,
  addRasterLayer,
  snapMask,
  maskBounds,
  moveSelected,
  extractMasked,
  loopLayers,
  importAnimation,
  shadeNormals,
} from './plugin-core.js';

import { PLUGINS, pluginEnabled } from './plugin-registry.js';
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
function togglePlugin(id, value) {
  let state = {};
  try {
    state = JSON.parse(localStorage.getItem('pixel-studio-plugins') || '{}');
  } catch {}
  try {
    localStorage.setItem('pixel-studio-plugins', JSON.stringify({ ...state, [id]: value }));
  } catch {}
}
export function openPlugins(host, initialPlugin = null) {
  let state = host.snapshot(),
    p = clone(state.project),
    library = !initialPlugin;
  let active = initialPlugin || 'iso',
    proposal = null,
    source = null,
    normalAsset = null,
    previewTimer = null,
    playing = false,
    previewFrame = 0,
    closed = false;
  document.querySelector('#plugins-dialog[data-closing]')?.remove();
  const d = document.createElement('aside');
  d.id = 'plugins-dialog';
  d.className = 'plugin-float';
  d.setAttribute('role', 'dialog');
  d.setAttribute('aria-label', '插件设置浮窗');
  d.innerHTML = `<header class="plugins-header" id="plugin-drag-handle"><button id="plugin-library" aria-label="返回插件列表">‹</button><div><small>像素画室 · 扩展</small><h2 id="plugins-title">插件工作台</h2></div><button id="plugin-pin" aria-label="固定当前插件到快捷工具栏">＋</button><button id="plugin-collapse" aria-label="收缩插件浮窗" aria-expanded="true">−</button><button id="plugins-close" aria-label="关闭插件浮窗">×</button></header><div class="plugins-body"><nav aria-label="插件列表">${PLUGINS.map((item) => `<div class="plugin-card"><button data-plugin="${item.id}"><span class="plugin-symbol">${item.symbol}</span><span><strong>${item.name}</strong><small>${item.english}</small></span></button><button data-pin="${item.id}" aria-label="固定${item.name}到快捷工具栏">＋</button><span data-plugin-drag="${item.id}" title="拖到左侧快捷工具栏" aria-label="拖动${item.name}到快捷工具栏">⠿</span></div>`).join('')}<p class="plugin-library-help">点 ＋ 固定到左栏，也可拖动 ⠿ 到左侧工具栏。点插件名称打开设置；拖动浮窗标题可调整位置。</p></nav><section class="plugin-workspace"><div class="plugin-heading"><div><h3 id="plugin-name"></h3><p id="plugin-description"></p></div><label class="switch plugin-switch">启用<input id="plugin-enabled" type="checkbox"></label></div><div class="plugin-columns"><div class="plugin-visual"><div class="plugin-preview" id="plugin-preview"></div><div class="plugin-preview-caption"><span id="plugin-info"></span><button id="plugin-play" hidden>播放预览</button></div><p id="plugin-status" role="status"></p></div><form id="plugin-form" onsubmit="return false"></form></div><a id="plugin-source" target="_blank" rel="noopener">原插件与作者 ↗</a><p class="plugin-attribution">画室独立实现 · 本地运行</p></section></div><footer class="plugins-footer"><div><button id="plugin-preview-button">预览</button><button id="plugin-apply" class="primary" disabled>应用</button></div></footer>`;

  document.body.append(d);
  const q = (s) => d.querySelector(s),
    form = q('#plugin-form'),
    apply = q('#plugin-apply'),
    status = q('#plugin-status');
  const number = (key, label, value, min, max) =>
    `<label>${esc(label)}<input aria-label="${esc(label)}" name="${key}" type="number" value="${value}" min="${min}" max="${max}" required></label>`;
  const color = (key, label, value) =>
    `<label class="plugin-color">${label}<input name="${key}" type="color" value="${value}"></label>`;
  const check = (key, label, value = false) =>
    `<label class="switch">${label}<input name="${key}" type="checkbox" ${value ? 'checked' : ''}></label>`;
  const select = (key, label, options, value) =>
    `<label>${esc(label)}<select aria-label="${esc(label)}" name="${key}">${options.map(([id, name]) => `<option value="${id}" ${String(value) === String(id) ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>`;
  const layerOptions = () => p.layers.map((l, i) => [i, l.name]);
  const stopPreview = () => {
    playing = false;
    clearTimeout(previewTimer);
    q('#plugin-play').textContent = '播放预览';
  };
  const draw = (raster, mask = null) => {
    const canvas = document.createElement('canvas');
    canvas.width = raster.w;
    canvas.height = raster.h;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.w, raster.h), 0, 0);
    if (mask) {
      ctx.fillStyle = '#48a9ff60';
      for (let i = 0; i < mask.length; i++)
        if (mask[i]) ctx.fillRect(i % raster.w, Math.floor(i / raster.w), 1, 1);
    }
    q('#plugin-preview').replaceChildren(canvas);
  };
  const showProject = (project, f = state.frame, mask = null) =>
    draw(
      {
        w: project.w,
        h: project.h,
        data: composite(project, Math.min(f, project.frames.length - 1)),
      },
      mask,
    );
  const invalidate = () => {
    proposal = null;
    apply.disabled = true;
    stopPreview();
    q('#plugin-play').hidden = true;
    status.textContent = '参数改变后，轻点「生成预览」。';
  };
  const close = () => floating.close();
  const floating = floatingPanel(d, {
    titleHandle: q('#plugin-drag-handle'),
    collapseButton: q('#plugin-collapse'),
    closeButton: q('#plugins-close'),
    onClose: () => {
      closed = true;
      stopPreview();
      document.removeEventListener('pixel-studio-context', sync);
      host.closed?.();
    },
  });
  function sync() {
    if (closed || host.busy()) return;
    const latest = host.snapshot();
    if (state.context === latest.context) return;
    const structure =
      p.layers.length !== latest.project.layers.length ||
      p.frames.length !== latest.project.frames.length ||
      p.w !== latest.project.w ||
      p.h !== latest.project.h;
    state = latest;
    p = clone(state.project);
    invalidate();
    if (structure) build();
    else {
      showProject(p, state.frame, state.selection);
      q('#plugin-info').textContent = p.w + ' × ' + p.h + ' · 当前画布';
    }
    status.textContent = '画布已更新，请重新预览。';
  }
  document.addEventListener('pixel-studio-context', sync);
  d.addEventListener('pointerenter', sync);
  function pins() {
    d.querySelectorAll('[data-pin]').forEach((b) => {
      const pinned = host.pinned(b.dataset.pin);
      b.textContent = pinned ? '✓' : '＋';
      b.setAttribute('aria-pressed', pinned);
    });
    q('#plugin-pin').textContent = host.pinned(active) ? '✓' : '＋';
    q('#plugin-pin').setAttribute('aria-pressed', host.pinned(active));
  }
  function layout() {
    d.classList.toggle('plugin-library-open', library);
    q('#plugin-library').hidden = library;
    q('#plugin-pin').hidden = library;
    q('#plugins-title').textContent = library
      ? '插件工作台'
      : PLUGINS.find((a) => a.id === active).name;
    pins();
  }
  q('#plugin-library').onclick = () => {
    library = true;
    layout();
  };
  q('#plugin-pin').onclick = () => {
    host.pin(active, !host.pinned(active));
    pins();
  };
  d.querySelectorAll('[data-pin]').forEach(
    (b) =>
      (b.onclick = () => {
        host.pin(b.dataset.pin, !host.pinned(b.dataset.pin));
        pins();
      }),
  );
  let dragPin = null;
  d.querySelectorAll('[data-plugin-drag]').forEach((handle) => {
    handle.onpointerdown = (e) => {
      e.preventDefault();
      dragPin = { id: handle.dataset.pluginDrag, x: e.clientX, y: e.clientY };
      if (e.isTrusted) handle.setPointerCapture(e.pointerId);
    };
    handle.onpointermove = (e) => {
      if (!dragPin) return;
      if (!dragPin.ghost && Math.hypot(e.clientX - dragPin.x, e.clientY - dragPin.y) > 8) {
        const ghost = document.createElement('span');
        ghost.className = 'plugin-drag-ghost';
        ghost.textContent = PLUGINS.find((p) => p.id === dragPin.id).symbol;
        document.body.append(ghost);
        dragPin.ghost = ghost;
        document.querySelector('#tools').classList.add('pin-drop-target');
      }
      if (dragPin.ghost) {
        dragPin.ghost.style.left = e.clientX + 'px';
        dragPin.ghost.style.top = e.clientY + 'px';
      }
    };
    const finish = (e) => {
      if (!dragPin) return;
      const r = document.querySelector('#tools').getBoundingClientRect();
      if (
        e.type !== 'pointercancel' &&
        dragPin.ghost &&
        e.clientX >= r.left - 20 &&
        e.clientX <= r.right + 30 &&
        e.clientY >= r.top - 30 &&
        e.clientY <= r.bottom + 30
      ) {
        host.pin(dragPin.id, true);
        pins();
      }
      dragPin.ghost?.remove();
      dragPin = null;
      document.querySelector('#tools').classList.remove('pin-drop-target');
    };
    handle.onpointerup = handle.onpointercancel = finish;
  });
  const read = () => {
    const values = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      values[el.name] =
        el.type === 'checkbox'
          ? el.checked
          : el.type === 'number' || el.type === 'range'
            ? Number(el.value)
            : el.value;
    }
    return values;
  };
  function build() {
    layout();
    invalidate();
    const info = PLUGINS.find((a) => a.id === active);
    q('#plugin-name').textContent = info.name;
    q('#plugin-description').textContent = info.description;
    q('#plugin-source').href = info.url;
    q('#plugin-enabled').checked = pluginEnabled(active);
    d.querySelectorAll('[data-plugin]').forEach((b) =>
      b.setAttribute('aria-pressed', b.dataset.plugin === active),
    );
    if (active === 'iso')
      form.innerHTML = `<div class="plugin-fields">${number('left', '左边长度', Math.min(12, Math.max(1, Math.floor((p.w - 1) / 5))), 1, 100)}${number('right', '右边长度', Math.min(12, Math.max(1, Math.floor((p.w - 1) / 5))), 1, 100)}${number('height', '高度', Math.min(18, Math.max(1, p.h - 26)), 1, 250)}${select(
        'corner',
        '角点宽度',
        [
          [2, '2 px'],
          [3, '3 px'],
        ],
        2,
      )}</div><div class="plugin-colors">${color('top', '顶面', '#b4cdea')}${color('leftColor', '左面', '#617fae')}${color('rightColor', '右面', '#3d567f')}${color('stroke', '描边', '#18283e')}${color('highlight', '高光', '#e2f0ff')}</div>${check('wire', '只生成线框')}${select(
        'output',
        '输出位置',
        [
          ['layer', '当前帧新增图层'],
          ['project', '新建匹配尺寸作品'],
        ],
        'layer',
      )}<p class="help">采用 2:1 等距斜边，盒子自动放在画布中央。</p>`;
    if (active === 'snap') {
      const b = maskBounds(state.selection, p.w, p.h);
      form.innerHTML = `<p class="help">${b ? `已有选区：${b.x}, ${b.y} · ${b.w} × ${b.h}` : '还没有选区，先返回画布拖出一个矩形。'}</p><button type="button" id="selection-draw" class="panel-wide">返回画布框选</button><button type="button" id="plugin-selection-clear" class="panel-wide">取消选区</button><div class="plugin-fields">${number('cellW', '网格宽度', 16, 1, Math.max(p.w, p.h))}${number('cellH', '网格高度', 16, 1, Math.max(p.w, p.h))}${number('offsetX', '网格 X 偏移', 0, -Math.max(p.w, p.h), Math.max(p.w, p.h))}${number('offsetY', '网格 Y 偏移', 0, -Math.max(p.w, p.h), Math.max(p.w, p.h))}</div>${select(
        'action',
        '操作',
        [
          ['snap', '选区向外吸附网格'],
          ['move', '移动选区像素'],
          ['copy', '复制选区像素'],
          ['extract', '提取选区到新图层'],
        ],
        'snap',
      )}<div class="plugin-fields">${number('dx', 'X 位移', 0, -Math.max(p.w, p.h), Math.max(p.w, p.h))}${number('dy', 'Y 位移', 0, -Math.max(p.w, p.h), Math.max(p.w, p.h))}</div><p class="help">吸附会将不规则选区转换为覆盖它的矩形，边缘限制在画布内。选区也会约束普通笔刷。</p>`;
      q('#selection-draw').onclick = async () => {
        host.selectTool();
        status.textContent = '直接在画布框选，再返回此处预览。';
      };
      q('#plugin-selection-clear').onclick = async () => {
        host.setSelection(null);
        sync();
      };
    }
    if (active === 'animation') {
      form.innerHTML = `${select(
        'action',
        '动画工具',
        [
          ['import', '导入 / 合成动画'],
          ['loop', '多图层完整循环'],
        ],
        'import',
      )}<section id="animation-import"><button type="button" id="animation-source" class="panel-wide">选择 .aseprite / .pixel 文件</button><input id="animation-file" type="file" hidden><p id="animation-source-info" class="help">未选择时使用当前作品作为来源。</p><div id="animation-source-fields"></div><div class="plugin-fields">${number('start', '放入第几帧', state.frame + 1, 1, 240)}${number('count', '生成帧数', p.frames.length, 1, 240)}</div>${select(
        'path',
        '移动方式',
        [
          ['static', '静止'],
          ['linear', '直线移动'],
          ['sine', '正弦起伏'],
        ],
        'static',
      )}<div class="plugin-fields">${number('x', '起点 X', 0, -Math.max(p.w, p.h), Math.max(p.w, p.h))}${number('y', '起点 Y', 0, -Math.max(p.w, p.h), Math.max(p.w, p.h))}${number('endX', '终点 X', 0, -Math.max(p.w, p.h), Math.max(p.w, p.h))}${number('endY', '终点 Y', 0, -Math.max(p.w, p.h), Math.max(p.w, p.h))}${number('amplitude', '起伏幅度', 8, 0, Math.max(p.w, p.h))}${number('cycles', '起伏周期', 1, 0, 20)}</div>${check('crop', '仅使用当前选区（当前作品来源）', false)}</section><section id="animation-loop" hidden><p class="help">按每层前 N 帧循环，使用最小公倍数生成完整循环。</p>${p.layers.map((l, i) => number('period' + i, l.name, p.frames.length, 1, p.frames.length)).join('')}</section>${number('duration', '新增帧 / 循环帧时长（ms）', 120, 20, 10000)}<p class="help">导入会新增图层；原有帧保留自己的时长。支持来源图层、帧范围与当前选区，当前文件格式不保留 Aseprite 标签。</p>`;
      const sourceFields = () => {
        const s = source || p;
        q('#animation-source-fields').innerHTML =
          select(
            'sourceLayer',
            '来源图层',
            [[-1, '可见图层合成'], ...s.layers.map((l, i) => [i, l.name])],
            -1,
          ) +
          `<div class="plugin-fields">${number('first', '来源起始帧', 1, 1, s.frames.length)}${number('last', '来源结束帧', s.frames.length, 1, s.frames.length)}</div>`;
        q('#animation-source-info').textContent =
          s.name + ' · ' + s.w + ' × ' + s.h + ' · ' + s.frames.length + ' 帧';
      };
      sourceFields();
      form.elements.action.onchange = () => {
        q('#animation-import').hidden = form.elements.action.value === 'loop';
        q('#animation-loop').hidden = form.elements.action.value !== 'loop';
        invalidate();
      };
      q('#animation-source').onclick = () => q('#animation-file').click();
      q('#animation-file').onchange = async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
          const kind = await importKind(file);
          if (kind === 'image') throw Error('动画来源请选择 .aseprite、.ase 或 .pixel 项目。');
          let warnings = [];
          if (kind === 'ase') {
            const parsed = await readAse(await file.arrayBuffer());
            source = parsed.project;
            warnings = parsed.warnings;
          } else source = deserialize(await file.text());
          sourceFields();
          form.elements.count.value = source.frames.length;
          invalidate();
          status.textContent = warnings.length
            ? '已载入；' + warnings.join('；')
            : '已载入动画，可以设置路径并预览。';
        } catch (e) {
          status.textContent = e.message;
        }
      };
    }
    if (active === 'normal') {
      form.innerHTML = `${select('diffuseLayer', '颜色图层', layerOptions(), state.layer)}${select('normalLayer', '法线图层', [[-1, '平面法线'], ...layerOptions()], -1)}<button type="button" id="normal-file-button" class="panel-wide">导入法线 PNG</button><input id="normal-file" type="file" accept=".png,.webp" hidden>${select('specularLayer', '高光遮罩', [[-1, '无（统一高光）'], ...layerOptions()], -1)}<div class="plugin-fields">${number('azimuth', '光源方向（度）', 315, 0, 360)}${number('elevation', '光源仰角（度）', 55, -90, 90)}${number('ambient', '环境光（%）', 25, 0, 100)}${number('diffuseStrength', '漫反射（%）', 80, 0, 200)}${number('specular', '高光强度（%）', 25, 0, 200)}${number('hardness', '高光硬度', 32, 1, 256)}</div><div class="plugin-colors">${color('lightColor', '光源颜色', '#ffffff')}${color('ambientColor', '环境颜色', '#ffffff')}</div>${check('flipY', '翻转法线绿色通道（Y）')}${check('allFrames', '应用全部动画帧')}<p class="help">使用 Blinn–Phong 光照。法线图透明处使用平面法线；生成独立图层，原颜色与法线不改动。</p>`;
      q('#normal-file-button').onclick = () => q('#normal-file').click();
      q('#normal-file').onchange = async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const url = URL.createObjectURL(file);
        try {
          if (file.size > 20 * 1024 * 1024) throw Error('法线图片超过 20 MB');
          const img = new Image();
          img.src = url;
          await img.decode();
          if (img.naturalWidth !== p.w || img.naturalHeight !== p.h)
            throw Error(`法线图需要与画布同尺寸：${p.w} × ${p.h}`);
          const canvas = document.createElement('canvas');
          canvas.width = p.w;
          canvas.height = p.h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          normalAsset = ctx.getImageData(0, 0, p.w, p.h).data;
          const option = document.createElement('option');
          option.value = '-2';
          option.textContent = '已导入：' + file.name;
          form.elements.normalLayer.querySelector('[value="-2"]')?.remove();
          form.elements.normalLayer.append(option);
          form.elements.normalLayer.value = '-2';
          invalidate();
          status.textContent = '法线图已载入，仅用于本次光照。';
        } catch (e) {
          status.textContent = e.message;
        } finally {
          URL.revokeObjectURL(url);
        }
      };
    }
    showProject(p, state.frame, state.selection);
    q('#plugin-info').textContent = p.w + ' × ' + p.h + ' · 当前作品';
    updateEnabled();
  }
  function updateEnabled() {
    const enabled = pluginEnabled(active);
    form.inert = !enabled;
    form.classList.toggle('plugin-disabled', !enabled);
    q('#plugin-preview-button').disabled = !enabled;
    if (!enabled) {
      invalidate();
      status.textContent = '此插件已停用。';
    }
  }
  function calculate() {
    if (host.busy()) {
      status.textContent = '先结束笔画或应用 / 取消选区变换。';
      return;
    }
    sync();
    if (!pluginEnabled(active)) return;
    stopPreview();
    proposal = null;
    apply.disabled = true;
    if (!form.reportValidity()) return;
    const v = read();
    try {
      if (active === 'iso') {
        const raster = isoBox({ ...v, corner: Number(v.corner) });
        if (v.output === 'project') {
          const result = blank(raster.w, raster.h, '等距盒子');
          result.frames[0].cels[0] = raster.data;
          proposal = { kind: 'new', project: result };
        } else {
          if (raster.w > p.w || raster.h > p.h)
            throw Error(`盒子为 ${raster.w} × ${raster.h}，请缩小尺寸或选择「新建匹配尺寸作品」。`);
          const cel = placeRaster(
            raster,
            p.w,
            p.h,
            Math.floor((p.w - raster.w) / 2),
            Math.floor((p.h - raster.h) / 2),
          );
          proposal = {
            kind: 'project',
            project: addRasterLayer(p, '等距盒子', { [state.frame]: cel }),
          };
        }
      }
      if (active === 'snap') {
        if (v.action === 'snap')
          proposal = { kind: 'selection', selection: snapMask(state.selection, p.w, p.h, v) };
        else if (v.action === 'extract')
          proposal = {
            kind: 'project',
            project: extractMasked(p, state.frame, state.layer, state.selection),
          };
        else {
          const result = clone(p);
          result.frames[state.frame].cels[state.layer] = moveSelected(
            readCel(p.frames[state.frame].cels[state.layer]),
            p.w,
            p.h,
            state.selection,
            v.dx,
            v.dy,
            v.action === 'copy',
          );
          const next = new Uint8Array(p.w * p.h);
          for (let i = 0; i < state.selection.length; i++)
            if (state.selection[i]) {
              const x = (i % p.w) + v.dx,
                y = Math.floor(i / p.w) + v.dy;
              if (x >= 0 && y >= 0 && x < p.w && y < p.h) next[y * p.w + x] = 1;
            }
          proposal = { kind: 'project', project: result, selection: next };
        }
      }
      if (active === 'animation') {
        if (v.action === 'loop')
          proposal = {
            kind: 'project',
            project: loopLayers(
              p,
              p.layers.map((_, i) => v['period' + i]),
              v.duration,
            ),
          };
        else {
          if (v.crop && source) throw Error('当前选区只适用于当前作品来源。');
          if (v.crop && !maskBounds(state.selection, p.w, p.h))
            throw Error('请先在画布中创建选区。');
          proposal = {
            kind: 'project',
            project: importAnimation(p, source || p, {
              ...v,
              sourceLayer: Number(v.sourceLayer),
              first: v.first - 1,
              last: v.last - 1,
              start: v.start - 1,
              crop: v.crop ? maskBounds(state.selection, p.w, p.h) : null,
            }),
          };
        }
      }
      if (active === 'normal') {
        const layer = Number(v.diffuseLayer),
          normal = Number(v.normalLayer),
          specular = Number(v.specularLayer),
          cels = {};
        for (let f = 0; f < p.frames.length; f++) {
          if (!v.allFrames && f !== state.frame) continue;
          cels[f] = shadeNormals(
            readCel(p.frames[f].cels[layer]),
            normal === -2 ? normalAsset : normal < 0 ? null : readCel(p.frames[f].cels[normal]),
            {
              ...v,
              ambient: v.ambient / 100,
              diffuseStrength: v.diffuseStrength / 100,
              specular: v.specular / 100,
              specularMap: specular < 0 ? null : readCel(p.frames[f].cels[specular]),
            },
          );
        }
        proposal = { kind: 'project', project: addRasterLayer(p, '法线光照', cels) };
      }
      const result = proposal.project || p;
      previewFrame = active === 'animation' ? 0 : Math.min(state.frame, result.frames.length - 1);
      showProject(result, previewFrame, proposal.kind === 'selection' ? proposal.selection : null);
      q('#plugin-info').textContent =
        result.w +
        ' × ' +
        result.h +
        ' · ' +
        result.layers.length +
        ' 图层 · ' +
        result.frames.length +
        ' 帧';
      q('#plugin-play').hidden = result.frames.length < 2;
      status.textContent =
        proposal.kind === 'selection'
          ? '选区预览已更新，应用后回到画布。'
          : '预览已准备好，应用后可撤销。';
      apply.disabled = false;
    } catch (e) {
      proposal = null;
      status.textContent = e.message;
    }
  }
  q('#plugin-play').onclick = () => {
    if (playing) {
      stopPreview();
      return;
    }
    playing = true;
    q('#plugin-play').textContent = '暂停预览';
    const tick = () => {
      if (!playing || closed) return;
      const result = proposal?.project || p;
      showProject(result, previewFrame);
      previewTimer = setTimeout(() => {
        previewFrame = (previewFrame + 1) % result.frames.length;
        tick();
      }, result.frames[previewFrame].duration);
    };
    tick();
  };
  form.addEventListener('input', invalidate);
  form.addEventListener('change', invalidate);
  q('#plugin-preview-button').onclick = calculate;
  q('#plugin-enabled').onchange = (e) => {
    togglePlugin(active, e.target.checked);
    updateEnabled();
  };
  d.querySelectorAll('[data-plugin]').forEach(
    (b) =>
      (b.onclick = () => {
        if (b.dataset.plugin === 'magic') {
          close();
          host.brushes();
          return;
        }
        active = b.dataset.plugin;
        library = false;
        build();
      }),
  );
  apply.onclick = async () => {
    if (host.busy()) {
      status.textContent = '先结束笔画或应用 / 取消选区变换。';
      return;
    }
    sync();
    if (!proposal) return;
    try {
      apply.disabled = true;
      if (proposal.kind === 'selection') host.setSelection(proposal.selection);
      else if (proposal.kind === 'new') await host.newProject(proposal.project);
      else host.commit(proposal.project, proposal.selection);
      if (!closed) {
        sync();
        invalidate();
        status.textContent = '已应用到作品，可继续绘画或调整参数。';
      }
    } catch (e) {
      status.textContent = e.message;
      apply.disabled = false;
    }
  };
  build();
  return {
    close,
    expand() {
      floating.collapse(false);
      floating.raise();
    },
    element: d,
    initialPlugin,
  };
}
