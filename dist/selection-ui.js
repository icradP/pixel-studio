import { floatingPanel, closeIcon } from './floating.js';
import { animateSurface } from './motion.js';
import { rectangleMask, maskBounds } from './plugin-core.js';
import {
  combineSelection,
  wandSelection,
  ellipseMask,
  polygonMask,
  initialTransform,
  transformSelection,
  transformHandles,
} from './selection.js';
import { composite, rgba } from './engine.js';

export function createSelectionController(host) {
  let lastWand = null,
    edit = null,
    gesture = null,
    mode = 'replace',
    tolerance = 20,
    contiguous = true,
    sampleMerged = false,
    uniform = true,
    snapAngle = false;
  const bar = document.createElement('section');
  bar.id = 'selection-bar';
  bar.setAttribute('aria-label', '选区操作');
  bar.setAttribute('role', 'dialog');
  bar.hidden = true;
  bar.innerHTML = `<div class="selection-row"><strong id="selection-caption">选择</strong><button data-select-tool="wand">自动 · 魔棒</button><button data-select-tool="lasso">手绘</button><button data-select-tool="select">矩形</button><button data-select-tool="ellipse-select">椭圆</button><select id="selection-mode" aria-label="选区组合"><option value="replace">替换选区</option><option value="add">添加选区</option><option value="subtract">减去选区</option></select><button id="selection-transform">移动与变换</button><button id="selection-clear">清除</button></div><div id="selection-actions" class="selection-row"><button id="selection-invert">反转</button><button id="selection-copy">拷贝并变换</button><button id="selection-fill">颜色填充</button><button id="selection-store">存储选区</button><button id="selection-load">加载选区</button></div><div id="wand-options" class="selection-row"><label>容差 <input id="wand-tolerance" type="range" min="0" max="100" value="20"><output id="wand-tolerance-value">20%</output></label><label><input id="wand-contiguous" type="checkbox" checked>相邻区域</label><label><input id="wand-merged" type="checkbox">参考可见图层</label></div><div id="transform-options"><div class="selection-row"><label>X<input id="transform-x" type="number" min="-1024" max="1024"></label><label>Y<input id="transform-y" type="number" min="-1024" max="1024"></label><label>宽<input id="transform-width" type="number" min="1" max="1024"></label><label>高<input id="transform-height" type="number" min="1" max="1024"></label><label>角度<input id="transform-angle" type="number" min="-360" max="360"></label><label class="selection-check"><input id="transform-uniform" type="checkbox" checked>等比</label><label class="selection-check"><input id="transform-snap" type="checkbox">15° 吸附</label></div><div class="selection-row"><button id="transform-copy" aria-pressed="false">复制变换</button><button id="transform-flip-x">水平翻转</button><button id="transform-flip-y">垂直翻转</button><button id="transform-cancel">取消变换</button><button id="transform-apply" class="primary">应用变换</button><span class="selection-hint">拖选区移动 · 拖角点缩放 · 拖圆柄旋转</span></div></div>`;
  const contents = bar.innerHTML;
  bar.innerHTML =
    '<header class="selection-head"><strong>选区工具</strong><button id="selection-dock" aria-label="自动排列选区工具" title="自动排列">⊞</button><button id="selection-collapse" aria-label="收起或展开选区工具" aria-expanded="true">−</button><button id="selection-dismiss" aria-label="隐藏选区工具">×</button></header><div class="selection-body">' +
    contents +
    '</div>';
  document.body.append(bar);
  const q = (s) => bar.querySelector(s);
  q('#selection-dismiss').innerHTML = closeIcon;
  let hiddenByUser = false,
    wasVisible = false,
    manualPosition = false,
    layoutPending = false;
  const float = floatingPanel(bar, {
    titleHandle: q('.selection-head'),
    collapseButton: q('#selection-collapse'),
    autoPlace: false,
    onMove: () => {
      manualPosition = true;
      document.body.style.removeProperty('--floating-bottom-reserve');
    },
  });
  function hide() {
    hiddenByUser = true;
    wasVisible = false;
    bar.inert = true;
    void animateSurface(bar, false).then(() => {
      if (hiddenByUser) bar.hidden = true;
    });
    if (bar.contains(document.activeElement))
      document.querySelector(`#tool-${host.tool()}`)?.focus({ preventScroll: true });
    document.body.classList.remove('selection-open');
    document.body.style.removeProperty('--floating-bottom-reserve');
  }
  q('#selection-dismiss').onclick = hide;
  // A wide canvas uses the free space between palettes. Narrow screens reserve
  // a bottom shelf so palette footers and selection actions stay reachable.
  function dock() {
    layoutPending = false;
    if (bar.hidden || manualPosition) return;
    const stage = document.querySelector('#stage').getBoundingClientRect(),
      left = innerWidth < 550 ? 12 : 82,
      right = innerWidth - 12;
    let gaps = [[left, right]];
    for (const el of document.querySelectorAll(
      '.studio-window:not([data-closing]),.plugin-float:not([data-closing])',
    )) {
      if (el.hidden || el.classList.contains('float-collapsed')) continue;
      const a = el.offsetLeft - 10,
        b = a + el.offsetWidth + 20;
      gaps = gaps.flatMap(([x, y]) =>
        b <= x || a >= y
          ? [[x, y]]
          : [
              [x, Math.max(x, a)],
              [Math.min(y, b), y],
            ],
      );
    }
    const best = gaps.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0] || [left, left],
      shelf = best[1] - best[0] < 340,
      area = shelf ? [left, right] : best,
      width = Math.min(bar.classList.contains('float-collapsed') ? 230 : 760, area[1] - area[0]);
    bar.style.width = width + 'px';
    bar.style.left = area[0] + (area[1] - area[0] - width) / 2 + 'px';
    bar.style.setProperty(
      '--window-available-height',
      Math.max(120, Math.min(stage.height - 24, innerHeight * 0.48)) + 'px',
    );
    const top = Math.max(80, stage.bottom - bar.offsetHeight - 12);
    bar.style.top = top + 'px';
    bar.style.bottom = 'auto';
    if (shelf)
      document.body.style.setProperty(
        '--floating-bottom-reserve',
        Math.max(12, innerHeight - top + 12) + 'px',
      );
    else document.body.style.removeProperty('--floating-bottom-reserve');
  }
  function scheduleDock() {
    if (layoutPending) return;
    layoutPending = true;
    requestAnimationFrame(dock);
  }
  q('#selection-dock').onclick = () => {
    manualPosition = false;
    scheduleDock();
  };
  document.addEventListener('pixel-studio-windows', scheduleDock);
  window.addEventListener('resize', scheduleDock);
  window.visualViewport?.addEventListener('resize', scheduleDock);
  new ResizeObserver(scheduleDock).observe(document.querySelector('#stage'));
  new ResizeObserver(scheduleDock).observe(bar);
  const snapshot = () => host.snapshot(),
    hasMask = () => !!maskBounds(host.selection(), snapshot().project.w, snapshot().project.h);
  const setMask = (mask) => {
    host.setSelection(mask);
  };
  function fields() {
    if (!edit) return;
    const t = edit.t;
    q('#transform-x').value = Math.round(t.cx - t.width / 2);
    q('#transform-y').value = Math.round(t.cy - t.height / 2);
    q('#transform-width').value = Math.round(t.width);
    q('#transform-height').value = Math.round(t.height);
    q('#transform-angle').value = Math.round((t.angle * 180) / Math.PI);
    q('#transform-copy').setAttribute('aria-pressed', t.copy);
  }
  function update() {
    if (edit && edit.context !== snapshot().context) {
      edit = null;
      gesture = null;
      setMask(null);
      host.toast('已取消未应用的变换：当前帧或图层已改变');
    }
    const selected = hasMask(),
      tool = host.tool();
    const available =
      selected || ['select', 'wand', 'lasso', 'ellipse-select'].includes(tool) || edit;
    bar.hidden = hiddenByUser || !available;
    bar.inert = bar.hidden;
    if (!bar.hidden && !wasVisible) {
      float.clamp();
      float.raise();
      void animateSurface(bar, true);
    }
    wasVisible = !bar.hidden;
    q('#wand-options').hidden = tool !== 'wand' || !!edit;
    q('#transform-options').hidden = !edit;
    q('#selection-actions').hidden = !!edit;
    q('#selection-mode').hidden = !!edit;
    q('#selection-transform').hidden = !!edit;
    q('#selection-transform').disabled = !selected;
    q('#selection-caption').textContent = edit ? '变换' : selected ? '已选择' : '选择';
    bar.classList.toggle('transforming', !!edit);
    document.body.classList.toggle('selection-open', !bar.hidden);
    bar
      .querySelectorAll('[data-select-tool]')
      .forEach((b) => b.setAttribute('aria-pressed', b.dataset.selectTool === tool));
    fields();
    if (bar.hidden) document.body.style.removeProperty('--floating-bottom-reserve');
    else scheduleDock();
  }
  function preview() {
    if (!edit) return;
    const p = snapshot().project;
    edit.preview = transformSelection(edit.base, p.w, p.h, edit.mask, edit.t);
    fields();
    host.render();
  }
  function start() {
    const s = snapshot(),
      p = s.project,
      mask = host.selection(),
      t = initialTransform(mask, p.w, p.h);
    if (!t) {
      host.toast('先框选或用魔棒选择像素');
      return false;
    }
    if (!p.layers[s.layer].visible) {
      host.toast('先显示当前图层再变换');
      return false;
    }
    edit = {
      context: s.context,
      base: new Uint8ClampedArray(p.frames[s.frame].cels[s.layer]),
      mask: new Uint8Array(mask),
      t,
      original: { ...t },
      modified: false,
    };
    preview();
    update();
    return true;
  }
  function finish(apply) {
    if (!edit) return;
    const current = edit;
    edit = null;
    gesture = null;
    if (apply && current.modified) host.commit(current.preview.pixels, current.preview.mask);
    else setMask(current.mask);
    update();
    host.render();
  }
  function begin(e, p, tool) {
    if (edit) {
      const t = edit.t,
        scale = host.scale(),
        handles = transformHandles(t, scale),
        distance = (v) => Math.hypot(v.x - p.x, v.y - p.y) * scale;
      let kind = 'move',
        corner = -1;
      if (distance(handles.rotation) < 19) kind = 'rotate';
      else {
        corner = handles.corners.findIndex((v) => distance(v) < 17);
        if (corner >= 0) kind = 'scale';
        else {
          const dx = p.x - t.cx,
            dy = p.y - t.cy,
            x = dx * Math.cos(t.angle) + dy * Math.sin(t.angle),
            y = -dx * Math.sin(t.angle) + dy * Math.cos(t.angle);
          if (Math.abs(x) > t.width / 2 + 10 / scale || Math.abs(y) > t.height / 2 + 10 / scale)
            return true;
        }
      }
      gesture = {
        kind,
        corner,
        start: p,
        t: { ...t },
        modified: edit.modified,
        anchor: corner >= 0 ? handles.corners[(corner + 2) % 4] : null,
      };
      return true;
    }
    if (!['select', 'wand', 'lasso', 'ellipse-select'].includes(tool)) return false;
    const s = snapshot(),
      w = s.project.w,
      h = s.project.h;
    if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) return true;
    if (tool === 'select' && mode === 'replace' && hasMask()) {
      const b = maskBounds(host.selection(), w, h);
      if (p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h && start())
        return begin(e, p, tool);
    }
    gesture = {
      kind: tool,
      points: [p],
      start: { x: Math.floor(p.x), y: Math.floor(p.y) },
      before: host.selection() ? new Uint8Array(host.selection()) : null,
    };
    if (tool === 'wand') {
      lastWand = { context: s.context, p: { ...p }, before: gesture.before };
      const pixels = sampleMerged
        ? composite(s.project, s.frame)
        : s.project.frames[s.frame].cels[s.layer];
      setMask(
        combineSelection(
          gesture.before,
          wandSelection(pixels, w, h, p.x, p.y, { tolerance, contiguous }),
          mode,
        ),
      );
    } else
      setMask(
        combineSelection(
          gesture.before,
          tool === 'lasso'
            ? new Uint8Array(w * h)
            : rectangleMask(w, h, gesture.start, gesture.start),
          mode,
        ),
      );
    host.render();
    update();
    return true;
  }
  function move(e, p) {
    if (!gesture) return;
    const g = gesture;
    if (['select', 'ellipse-select', 'lasso'].includes(g.kind)) {
      const s = snapshot(),
        end = { x: Math.floor(p.x), y: Math.floor(p.y) };
      if (g.kind === 'lasso') {
        g.points.push(p);
        if (g.points.length > 256) g.points = g.points.filter((_, i) => i % 2 === 0);
      }
      const mask =
        g.kind === 'lasso'
          ? polygonMask(s.project.w, s.project.h, g.points)
          : (g.kind === 'ellipse-select' ? ellipseMask : rectangleMask)(
              s.project.w,
              s.project.h,
              g.start,
              end,
            );
      setMask(combineSelection(g.before, mask, mode));
      host.render();
      return;
    }
    if (g.kind === 'wand' || !edit) return;
    if (g.kind === 'move') {
      edit.t = {
        ...g.t,
        cx: g.t.cx + Math.round(p.x - g.start.x),
        cy: g.t.cy + Math.round(p.y - g.start.y),
      };
    }
    if (g.kind === 'rotate') {
      let angle =
        g.t.angle +
        Math.atan2(p.y - g.t.cy, p.x - g.t.cx) -
        Math.atan2(g.start.y - g.t.cy, g.start.x - g.t.cx);
      if (snapAngle) angle = (Math.round(angle / (Math.PI / 12)) * Math.PI) / 12;
      edit.t = { ...g.t, angle };
    }
    if (g.kind === 'scale') {
      const signs = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ][g.corner],
        dx = p.x - g.anchor.x,
        dy = p.y - g.anchor.y,
        c = Math.cos(g.t.angle),
        s = Math.sin(g.t.angle);
      let width = Math.max(1, Math.min(1024, Math.round((dx * c + dy * s) * signs[0]))),
        height = Math.max(1, Math.min(1024, Math.round((-dx * s + dy * c) * signs[1])));
      if (uniform) {
        const ratio = Math.max(width / g.t.width, height / g.t.height),
          limit = Math.min(1024 / g.t.width, 1024 / g.t.height);
        width = Math.max(1, Math.round(g.t.width * Math.min(limit, ratio)));
        height = Math.max(1, Math.round(g.t.height * Math.min(limit, ratio)));
      }
      const ox = (signs[0] * width) / 2,
        oy = (signs[1] * height) / 2;
      edit.t = {
        ...g.t,
        width,
        height,
        cx: g.anchor.x + ox * c - oy * s,
        cy: g.anchor.y + ox * s + oy * c,
      };
    }
    edit.modified = true;
    preview();
  }
  function end(cancel = false) {
    if (!gesture) return;
    if (edit) {
      if (cancel) {
        edit.t = gesture.t;
        edit.modified = gesture.modified;
        preview();
      }
    } else if (cancel) setMask(gesture.before);
    gesture = null;
    update();
    host.render();
  }
  function draw(ctx, scale) {
    if (!edit) return false;
    const t = edit.t,
      h = transformHandles(t, scale);
    ctx.save();
    ctx.strokeStyle = '#63b8ff';
    ctx.lineWidth = 1.5 / scale;
    ctx.setLineDash([5 / scale, 3 / scale]);
    ctx.beginPath();
    h.corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(h.top.x, h.top.y);
    ctx.lineTo(h.rotation.x, h.rotation.y);
    ctx.stroke();
    for (const p of [...h.corners, h.rotation]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 / scale, 0, Math.PI * 2);
      ctx.fillStyle = '#f4f9ff';
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    return true;
  }
  bar.querySelectorAll('[data-select-tool]').forEach(
    (b) =>
      (b.onclick = () => {
        finish(false);
        host.selectTool(b.dataset.selectTool);
        update();
      }),
  );
  q('#selection-mode').onchange = (e) => (mode = e.target.value);
  q('#selection-clear').onclick = () => {
    lastWand = null;
    finish(false);
    setMask(null);
    update();
    host.render();
  };
  q('#selection-transform').onclick = start;
  q('#transform-cancel').onclick = () => finish(false);
  q('#transform-apply').onclick = () => finish(true);
  function resampleWand() {
    const s = snapshot();
    if (!lastWand || edit || lastWand.context !== s.context || host.tool() !== 'wand') return;
    const p = s.project,
      pixels = sampleMerged ? composite(p, s.frame) : p.frames[s.frame].cels[s.layer];
    setMask(
      combineSelection(
        lastWand.before,
        wandSelection(pixels, p.w, p.h, lastWand.p.x, lastWand.p.y, { tolerance, contiguous }),
        mode,
      ),
    );
    update();
    host.render();
  }
  q('#wand-tolerance').oninput = (e) => {
    tolerance = Number(e.target.value);
    q('#wand-tolerance-value').textContent = tolerance + '%';
    resampleWand();
  };
  q('#wand-contiguous').onchange = (e) => {
    contiguous = e.target.checked;
    resampleWand();
  };
  q('#wand-merged').onchange = (e) => {
    sampleMerged = e.target.checked;
    resampleWand();
  };
  q('#transform-uniform').onchange = (e) => (uniform = e.target.checked);
  q('#transform-snap').onchange = (e) => (snapAngle = e.target.checked);
  for (const axis of ['x', 'y', 'width', 'height', 'angle'])
    q('#transform-' + axis).oninput = (e) => {
      if (!edit || e.target.value === '') return;
      const value = Number(e.target.value);
      if (!e.target.checkValidity() || !Number.isFinite(value)) {
        fields();
        return;
      }
      const t = edit.t;
      if (axis === 'x') t.cx = value + t.width / 2;
      else if (axis === 'y') t.cy = value + t.height / 2;
      else if (axis === 'angle') t.angle = (value * Math.PI) / 180;
      else {
        const other = axis === 'width' ? 'height' : 'width';
        if (uniform)
          t[other] = Math.max(1, Math.min(1024, Math.round((t[other] * value) / t[axis])));
        t[axis] = value;
      }
      edit.modified = true;
      preview();
    };
  for (const [id, key] of [
    ['transform-copy', 'copy'],
    ['transform-flip-x', 'flipX'],
    ['transform-flip-y', 'flipY'],
  ])
    q('#' + id).onclick = () => {
      if (!edit) return;
      edit.t[key] = !edit.t[key];
      edit.modified = true;
      preview();
    };
  q('#selection-invert').onclick = () => {
    const p = snapshot().project,
      mask = host.selection() || new Uint8Array(p.w * p.h);
    setMask(Uint8Array.from(mask, (v) => (v ? 0 : 1)));
    update();
    host.render();
  };
  q('#selection-copy').onclick = () => {
    if (start()) {
      edit.t.copy = true;
      edit.modified = true;
      preview();
    }
  };
  q('#selection-fill').onclick = () => {
    if (!hasMask()) return;
    const s = snapshot(),
      pixels = new Uint8ClampedArray(s.project.frames[s.frame].cels[s.layer]),
      mask = host.selection();
    for (let i = 0; i < mask.length; i++) if (mask[i]) pixels.set(rgba(host.color()), i * 4);
    host.commit(pixels, mask);
  };
  q('#selection-store').onclick = () => {
    if (!hasMask()) {
      host.toast('先创建选区');
      return;
    }
    try {
      const p = snapshot().project;
      localStorage.setItem(
        'pixel-studio-selection',
        JSON.stringify({ w: p.w, h: p.h, mask: Array.from(host.selection()).join('') }),
      );
      host.toast('选区已存储在此设备');
    } catch {
      host.toast('无法存储选区');
    }
  };
  q('#selection-load').onclick = () => {
    try {
      const saved = JSON.parse(localStorage.getItem('pixel-studio-selection') || 'null'),
        p = snapshot().project;
      if (!saved || saved.w !== p.w || saved.h !== p.h || saved.mask.length !== p.w * p.h)
        throw Error();
      setMask(Uint8Array.from(saved.mask, (v) => (v === '1' ? 1 : 0)));
      update();
      host.render();
    } catch {
      host.toast('没有与当前画布尺寸一致的已存选区');
    }
  };
  return {
    toggle() {
      if (!bar.hidden && !hiddenByUser && !bar.classList.contains('float-collapsed')) hide();
      else this.show();
    },
    show() {
      hiddenByUser = false;
      float.collapse(false);
      update();
      float.raise();
    },
    begin,
    move,
    end,
    draw,
    update,
    start,
    finish,
    get transforming() {
      return !!edit;
    },
    get preview() {
      return edit?.preview.pixels || null;
    },
    clear() {
      finish(false);
      setMask(null);
      update();
    },
    escape() {
      if (edit) finish(false);
      else {
        setMask(null);
        update();
        host.render();
      }
    },
  };
}
