import { readCel } from './cel-storage.js';
import { floatingPanel } from './floating.js';
import { composite, rgba } from './engine.js';
import { blendPixels } from './layer-effects.js';
import { loadPixelFont, renderPixelText } from './pixel-type.js';
import { rectangleQuad, warpPixels, drawPerspectiveGrid, quadMatrix } from './perspective.js';
import { outlinePixels } from './pixel-outline.js';
import { createRenderScheduler } from './render-scheduler.js';

export function openArtworkPanel(host, kind = 'text') {
  const snapshot = host.snapshot(),
    p = snapshot.project,
    w = p.w,
    h = p.h,
    outline = kind === 'outline';
  const panel = document.createElement('aside');
  panel.id = 'artwork-panel';
  panel.className = 'studio-window artwork-panel';
  panel.setAttribute('aria-label', outline ? '像素描边' : '像素文字');
  panel.innerHTML = `<header class="window-head"><h2>${outline ? '像素描边' : '像素文字'}</h2><button class="window-collapse" aria-label="折叠编辑面板"></button><button class="window-close" aria-label="关闭编辑面板"></button></header><div class="window-body"><canvas id="artwork-preview" aria-label="编辑预览，可拖动文字位置和透视角点"></canvas><p id="artwork-status" class="help" role="status"></p><div id="artwork-fields"></div><button id="artwork-apply" class="primary panel-wide" disabled>添加为像素图层</button></div>`;
  document.body.append(panel);
  const $ = (sel) => panel.querySelector(sel),
    canvas = $('#artwork-preview'),
    ctx = canvas.getContext('2d');
  canvas.width = w;
  canvas.height = h;
  const base = composite(p, snapshot.frame);
  const overlay = document.createElement('canvas');
  overlay.width = w;
  overlay.height = h;
  const overlayCtx = overlay.getContext('2d');
  canvas.hidden = !outline;
  let pixels = null,
    font = null,
    quad = null,
    closed = false,
    drag = null;
  const fields = $('#artwork-fields'),
    status = $('#artwork-status');
  const num = (id, label, value, min, max, step = 1) =>
    `<label>${label}<input id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
  if (outline)
    fields.innerHTML = `<p class="help">为${snapshot.mask ? '选中区域内的像素' : '当前图层的不透明像素'}添加描边，保留原图层。</p><label>描边颜色<input id="outline-color" type="color" value="${host.color().slice(0, 7)}"></label><div class="scene-two">${num('outline-width', '宽度 / 像素', 1, 1, 32)}<label>位置<select id="outline-position"><option value="outside">外描边</option><option value="inside">内描边</option><option value="center">居中描边</option></select></label></div>`;
  else
    fields.innerHTML = `<label>文字 · 中 / 日 / 英<textarea id="text-content" rows="3" maxlength="512" placeholder="输入像素文字">你好！こんにちは！Hello!</textarea></label><div class="scene-two"><label>排版<select id="text-direction"><option value="horizontal">横排</option><option value="vertical">竖排 · 右至左</option></select></label><label>文字颜色<input id="text-color" type="color" value="${host.color().slice(0, 7)}"></label>${num('text-size', '字号 / 像素', 16, 4, 128)}${num('text-spacing', '字间距', 1, 0, 32)}${num('text-x', '位置 X', Math.round(w * 0.1), -Math.max(w, h), Math.max(w, h), 'any')}${num('text-y', '位置 Y', Math.round(h * 0.1), -Math.max(w, h), Math.max(w, h), 'any')}${num('text-scale-x', '横向缩放', 1, 0.05, 20, 'any')}${num('text-scale-y', '纵向缩放', 1, 0.05, 20, 'any')}${num('text-angle', '旋转 °', 0, -360, 360)}</div><div class="scene-two"><label class="switch">水平镜像<input id="text-flip-x" type="checkbox"></label><label class="switch">垂直镜像<input id="text-flip-y" type="checkbox"></label></div><label class="switch">透视网格 · 拖动四角<input id="text-perspective" type="checkbox"></label><div class="scene-two">${num('text-grid', '网格分段', 4, 1, 16)}<button id="text-reset">重置透视</button></div><p class="help">直接在主画布点击放置，拖动文字移动、四角缩放、上方圆点旋转。开启透视后四角独立变形。文字以点阵像素图层保存；添加后可用选区继续移动、旋转和变换。</p>`;
  const val = (id) => Number($('#' + id).value);
  function paint() {
    if (closed) return;
    try {
      if (outline)
        pixels = outlinePixels(readCel(p.frames[snapshot.frame].cels[snapshot.layer]), w, h, {
          mask: snapshot.mask,
          width: val('outline-width'),
          position: $('#outline-position').value,
          color: rgba($('#outline-color').value),
        });
      else {
        if (!font) return;
        for (const input of fields.querySelectorAll('input[type=number]'))
          if (!input.checkValidity()) throw Error('请检查数值范围');
        const text = renderPixelText(font, $('#text-content').value, {
          direction: $('#text-direction').value,
          spacing: val('text-spacing'),
          color: rgba($('#text-color').value),
        });
        quad ||= rectangleQuad(
          val('text-x'),
          val('text-y'),
          ((text.width * val('text-size')) / 16) * val('text-scale-x'),
          ((text.height * val('text-size')) / 16) * val('text-scale-y'),
          val('text-angle'),
        );
        pixels = warpPixels(text.pixels, text.width, text.height, w, h, quad, {
          flipX: $('#text-flip-x').checked,
          flipY: $('#text-flip-y').checked,
        });
      }
      overlayCtx.putImageData(new ImageData(pixels, w, h), 0, 0);
      host.render?.();
      const merged = new Uint8ClampedArray(base);
      blendPixels(merged, pixels);
      ctx.putImageData(new ImageData(merged, w, h), 0, 0);
      if (quad) {
        ctx.save();
        ctx.strokeStyle = '#80cbff';
        ctx.lineWidth = Math.max(1, w / 500);
        drawPerspectiveGrid(ctx, quad, $('#text-perspective').checked ? val('text-grid') : 1);
        for (const q of quad) {
          ctx.fillStyle = '#fff';
          ctx.fillRect(q.x - 3, q.y - 3, 6, 6);
        }
        ctx.restore();
      }
      status.textContent = outline
        ? '描边会添加到独立图层，可撤销。'
        : '16 像素点阵字库 · 最近邻缩放';
      $('#artwork-apply').disabled = !pixels.some((v, i) => i % 4 === 3 && v);
      if ($('#artwork-apply').disabled) status.textContent = '内容位于画布之外或为空，请调整位置。';
    } catch (e) {
      pixels = null;
      $('#artwork-apply').disabled = true;
      status.textContent = e.message;
    }
  }
  const job = createRenderScheduler(paint);
  fields.addEventListener('input', (e) => {
    if (
      !['text-grid', 'text-perspective', 'text-color', 'text-flip-x', 'text-flip-y'].includes(
        e.target.id,
      )
    )
      quad = null;
    job.request();
  });
  if (!outline) {
    $('#text-reset').onclick = () => {
      quad = null;
      paint();
    };
    const position = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * w) / r.width, y: ((e.clientY - r.top) * h) / r.height };
    };
    canvas.onpointerdown = (e) => {
      if (!quad || e.button !== 0) return;
      e.preventDefault();
      job.flush();
      const pos = position(e),
        radius = (14 * w) / canvas.getBoundingClientRect().width,
        corner = $('#text-perspective').checked
          ? quad.findIndex((q) => Math.hypot(q.x - pos.x, q.y - pos.y) < radius)
          : -1;
      drag = { start: pos, quad: structuredClone(quad), corner };
      if (e.isTrusted) canvas.setPointerCapture(e.pointerId);
    };
    canvas.onpointermove = (e) => {
      if (!drag) return;
      const pos = position(e),
        dx = pos.x - drag.start.x,
        dy = pos.y - drag.start.y,
        next = structuredClone(drag.quad);
      if (drag.corner >= 0) {
        next[drag.corner].x += dx;
        next[drag.corner].y += dy;
      } else
        for (const q of next) {
          q.x += dx;
          q.y += dy;
        }
      try {
        quadMatrix(next);
        quad = next;
        job.request();
      } catch {
        status.textContent = '角点不能交叉，请保持网格展开。';
      }
    };
    canvas.onpointerup = () => {
      if (drag && drag.corner < 0) {
        $('#text-x').value = Number($('#text-x').value) + quad[0].x - drag.quad[0].x;
        $('#text-y').value = Number($('#text-y').value) + quad[0].y - drag.quad[0].y;
      }
      drag = null;
      job.flush();
    };
    canvas.onpointercancel = () => {
      if (drag) quad = drag.quad;
      drag = null;
      paint();
    };
    status.textContent = '正在载入本地点阵字库…';
    loadPixelFont()
      .then((value) => {
        if (closed) return;
        font = value;
        paint();
      })
      .catch((e) => (status.textContent = e.message));
  } else paint();
  const contextChanged = () => {
    if (host.context && host.context() !== snapshot.context) floating.close();
  };
  document.addEventListener('pixel-studio-context', contextChanged);
  const floating = floatingPanel(panel, {
    titleHandle: panel.querySelector('header'),
    collapseButton: panel.querySelector('.window-collapse'),
    closeButton: panel.querySelector('.window-close'),
    onClose: () => {
      closed = true;
      document.removeEventListener('pixel-studio-context', contextChanged);
      job.cancel();
      host.render?.();
    },
  });
  $('#artwork-apply').onclick = () => {
    job.flush();
    if (!pixels) return;
    try {
      host.apply(
        pixels,
        outline
          ? '像素描边'
          : `文字 · ${$('#text-content').value.replace(/\n/g, ' ').slice(0, 60)}`,
        snapshot.context,
      );
      floating.close();
    } catch (e) {
      status.textContent = e.message;
    }
  };
  floating.raise();
  floating.clamp();
  const center = () => ({
    x: quad.reduce((n, q) => n + q.x, 0) / 4,
    y: quad.reduce((n, q) => n + q.y, 0) / 4,
  });
  function rotationHandle(scale) {
    const c = center(),
      top = { x: (quad[0].x + quad[1].x) / 2, y: (quad[0].y + quad[1].y) / 2 },
      d = Math.hypot(top.x - c.x, top.y - c.y) || 1;
    return {
      x: top.x + (((top.x - c.x) / d) * 24) / scale,
      y: top.y + (((top.y - c.y) / d) * 24) / scale,
    };
  }
  function begin(e, pos) {
    if (outline || closed || !quad) return false;
    job.flush();
    const scale = host.scale(),
      r = 12 / scale,
      rotate = rotationHandle(scale);
    const corner = quad.findIndex((q) => Math.hypot(q.x - pos.x, q.y - pos.y) < r);
    const kind =
      corner >= 0
        ? 'corner'
        : Math.hypot(rotate.x - pos.x, rotate.y - pos.y) < r
          ? 'rotate'
          : 'move';
    const inside =
      pos.x >= Math.min(...quad.map((q) => q.x)) - r &&
      pos.x <= Math.max(...quad.map((q) => q.x)) + r &&
      pos.y >= Math.min(...quad.map((q) => q.y)) - r &&
      pos.y <= Math.max(...quad.map((q) => q.y)) + r;
    if (kind === 'move' && !inside) {
      const dx = pos.x - quad[0].x,
        dy = pos.y - quad[0].y;
      quad = quad.map((q) => ({ x: q.x + dx, y: q.y + dy }));
      $('#text-x').value = val('text-x') + dx;
      $('#text-y').value = val('text-y') + dy;
    }
    drag = {
      kind,
      corner,
      start: pos,
      quad: structuredClone(quad),
      center: center(),
      x: val('text-x'),
      y: val('text-y'),
      sx: val('text-scale-x'),
      sy: val('text-scale-y'),
      angle: val('text-angle'),
    };
    paint();
    return true;
  }
  function move(e, pos) {
    if (!drag) return;
    const dx = pos.x - drag.start.x,
      dy = pos.y - drag.start.y,
      next = structuredClone(drag.quad);
    if (drag.kind === 'move')
      for (const q of next) {
        q.x += dx;
        q.y += dy;
      }
    else if (drag.kind === 'rotate') {
      const c = drag.center,
        angle =
          Math.atan2(pos.y - c.y, pos.x - c.x) - Math.atan2(drag.start.y - c.y, drag.start.x - c.x);
      for (const q of next) {
        const x = q.x - c.x,
          y = q.y - c.y;
        q.x = c.x + x * Math.cos(angle) - y * Math.sin(angle);
        q.y = c.y + x * Math.sin(angle) + y * Math.cos(angle);
      }
      $('#text-angle').value = Math.round(
        ((drag.angle + (angle * 180) / Math.PI + 540) % 360) - 180,
      );
    } else if ($('#text-perspective').checked) {
      next[drag.corner].x += dx;
      next[drag.corner].y += dy;
    } else {
      const fixed = next[(drag.corner + 2) % 4],
        q = next[drag.corner],
        vx = q.x - fixed.x,
        vy = q.y - fixed.y;
      const ratio = Math.max(
        0.05,
        Math.min(
          20 / Math.max(drag.sx, drag.sy),
          ((pos.x - fixed.x) * vx + (pos.y - fixed.y) * vy) / (vx * vx + vy * vy),
        ),
      );
      for (const q of next) {
        q.x = fixed.x + (q.x - fixed.x) * ratio;
        q.y = fixed.y + (q.y - fixed.y) * ratio;
      }
      $('#text-scale-x').value = (drag.sx * ratio).toFixed(3);
      $('#text-scale-y').value = (drag.sy * ratio).toFixed(3);
    }
    try {
      quadMatrix(next);
      quad = next;
      job.request();
    } catch {}
  }
  function end(cancel) {
    if (!drag) return;
    if (cancel) {
      quad = drag.quad;
      $('#text-scale-x').value = drag.sx;
      $('#text-scale-y').value = drag.sy;
      $('#text-angle').value = drag.angle;
    }
    const c = center();
    const width = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y),
      height = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
    $('#text-x').value = Number((c.x - width / 2).toFixed(3));
    $('#text-y').value = Number((c.y - height / 2).toFixed(3));
    drag = null;
    job.flush();
    paint();
  }
  return {
    ...floating,
    begin,
    move,
    end,
    get editing() {
      return !outline && !closed;
    },
    draw(context, scale) {
      if (outline || closed || !pixels || !quad) return;
      context.save();
      context.imageSmoothingEnabled = false;
      context.drawImage(overlay, 0, 0);
      context.strokeStyle = '#85cfff';
      context.lineWidth = 1 / scale;
      drawPerspectiveGrid(context, quad, $('#text-perspective').checked ? val('text-grid') : 1);
      const rotate = rotationHandle(scale),
        top = { x: (quad[0].x + quad[1].x) / 2, y: (quad[0].y + quad[1].y) / 2 };
      context.beginPath();
      context.moveTo(top.x, top.y);
      context.lineTo(rotate.x, rotate.y);
      context.stroke();
      for (const q of [...quad, rotate]) {
        context.beginPath();
        context.arc(q.x, q.y, 4 / scale, 0, Math.PI * 2);
        context.fillStyle = '#fff';
        context.fill();
        context.stroke();
      }
      context.restore();
    },
  };
}
