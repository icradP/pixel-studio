import { expansionSize } from './canvas-resize.js';
import { composite } from './engine.js';
import { mebibytes, LIMITS } from './limits.js';
import { createRenderScheduler } from './render-scheduler.js';

export function createExpansionPanel(root, host) {
  root.innerHTML = `<p class="panel-intro">给下一笔留出空间</p><canvas id="expand-preview" width="320" height="180" aria-label="扩展后的画布预览"></canvas><div class="expand-legend"><span>原画布</span><span>新增透明区域</span></div><form id="expand-form"><div class="expand-directions">${[
    ['top', '向上', '↑'],
    ['left', '向左', '←'],
    ['right', '向右', '→'],
    ['bottom', '向下', '↓'],
  ]
    .map(
      ([key, name, arrow]) =>
        `<label class="expand-${key}"><span>${arrow} ${name}</span><input id="expand-${key}" name="${key}" aria-label="${name}扩展像素" type="number" min="0" max="512" step="1" value="0" required><small>px</small></label>`,
    )
    .join(
      '',
    )}<span class="expand-center" aria-hidden="true">▧</span></div><div class="expand-quick"><button type="button" data-expand-all="8">四周 +8</button><button type="button" data-expand-all="16">四周 +16</button><button type="reset">重置</button></div><div class="expand-summary"><strong id="expand-size"></strong><span id="expand-memory"></span></div><p id="expand-status" role="status"></p></form><p class="help">所有帧、所有图层一同扩展。已有像素保持原始大小，新增区域透明；应用后可以撤销。当前选区会清除。</p><p class="help">最大 512 × 512，所有帧与图层共用 800 万像素预算。</p>`;
  const surface = root.parentElement,
    footer = document.createElement('footer');
  footer.className = 'window-footer expand-footer';
  footer.innerHTML =
    '<button type="submit" form="expand-form" id="expand-apply" class="primary panel-wide">扩展画布</button>';
  footer.prepend(root.querySelector('.expand-summary'), root.querySelector('#expand-status'));
  surface.append(footer);
  const q = (selector) => surface.querySelector(selector),
    fields = ['left', 'right', 'top', 'bottom'];
  const sides = () =>
    Object.fromEntries(
      fields.map((key) => [
        key,
        q('#expand-' + key).value === '' ? NaN : Number(q('#expand-' + key).value),
      ]),
    );
  const source = document.createElement('canvas');
  let sourceKey = '',
    valid = false;
  const preview = createRenderScheduler(update);
  function update() {
    if (!root.isConnected) return;
    const { project, frame, key } = host.snapshot(),
      p = sides();
    if (sourceKey !== key) {
      sourceKey = key;
      source.width = project.w;
      source.height = project.h;
      source
        .getContext('2d')
        .putImageData(new ImageData(composite(project, frame), project.w, project.h), 0, 0);
    }
    let next;
    try {
      next = expansionSize(project, p);
      valid = next.changed;
      q('#expand-status').textContent = next.changed
        ? `原图将向右移 ${next.left} px、向下移 ${next.top} px。`
        : '设置任意方向的新增像素。';
      q('#expand-status').classList.remove('error');
      q('#expand-size').textContent = `${project.w} × ${project.h} → ${next.w} × ${next.h}`;
      q('#expand-memory').textContent =
        `${mebibytes(next.bytes)} · 像素预算 ${Math.round((next.pixels / LIMITS.pixels) * 100)}%`;
    } catch (error) {
      valid = false;
      q('#expand-status').textContent = error.message;
      q('#expand-status').classList.add('error');
      q('#expand-size').textContent = '请调整扩展尺寸';
      q('#expand-memory').textContent = '';
      next = { w: project.w, h: project.h, left: 0, top: 0 };
    }
    q('#expand-apply').disabled = !valid;
    const canvas = q('#expand-preview'),
      ctx = canvas.getContext('2d'),
      scale = Math.min(284 / next.w, 144 / next.h),
      x = (canvas.width - next.w * scale) / 2,
      y = (canvas.height - next.h * scale) / 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#72baff30';
    ctx.fillRect(x, y, next.w * scale, next.h * scale);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      source,
      x + next.left * scale,
      y + next.top * scale,
      project.w * scale,
      project.h * scale,
    );
    ctx.strokeStyle = '#ffffffb0';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      x + next.left * scale,
      y + next.top * scale,
      project.w * scale,
      project.h * scale,
    );
    ctx.strokeStyle = '#72baff';
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(x, y, next.w * scale, next.h * scale);
    ctx.setLineDash([]);
  }
  q('#expand-form').oninput = () => {
    q('#expand-apply').disabled = true;
    preview.request();
  };
  q('#expand-form').onreset = () => preview.request();
  root.querySelectorAll('[data-expand-all]').forEach(
    (button) =>
      (button.onclick = () => {
        for (const key of fields) q('#expand-' + key).value = button.dataset.expandAll;
        update();
      }),
  );
  q('#expand-form').onsubmit = (event) => {
    event.preventDefault();
    preview.cancel();
    update();
    if (!valid) return;
    try {
      host.apply(sides());
      host.close();
    } catch (error) {
      q('#expand-status').textContent = error.message;
      q('#expand-status').classList.add('error');
    }
  };
  update();
  return { sync: () => preview.request() };
}
