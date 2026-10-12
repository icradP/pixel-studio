import { BLEND_MODES, clippingBase, applyMask } from './layer-effects.js';

const range = (id, label, value, min, max, unit = '%') =>
  `<label>${label}<output for="${id}" id="${id}-value" class="row-value">${value}${unit}</output><input id="${id}" aria-label="${label}" type="range" min="${min}" max="${max}" value="${value}"></label>`;
export function layerEffects(root, host) {
  const p = host.project(),
    i = host.layer(),
    l = p.layers[i],
    c = document.createElement('section');
  c.className = 'paint-section layer-effects';
  root.querySelector('#opacity').closest('label').after(c);
  const base = clippingBase(p, i),
    a = l.adjustments || {};
  c.innerHTML = `<label>混合模式<select id="layer-blend" ${l.group && l.isolated === false ? 'disabled' : ''}>${BLEND_MODES.map((v, i) => `<option value="${i}">${v}</option>`).join('')}</select></label>${l.group ? '' : `<label class="switch">锁定透明度<input id="alpha-lock" type="checkbox" ${l.alphaLock ? 'checked' : ''}></label><label class="switch">剪贴到下方图层<input id="layer-clipping" type="checkbox" ${l.clipping ? 'checked' : ''} ${base < 0 && !l.clipping ? 'disabled' : ''}></label><p class="help">剪贴使用同组下方像素图层的轮廓；锁定透明度可在原有像素内上色。</p><h3>图层遮罩</h3>${l.mask ? `<div class="mask-summary"><canvas id="layer-mask-thumb" width="${p.w}" height="${p.h}" aria-label="当前遮罩预览"></canvas><span>${host.maskEditing() ? '正在编辑遮罩' : '遮罩已附加'}<small>所有动画帧共用</small></span></div><div class="animation-two"><button id="mask-edit" aria-pressed="${host.maskEditing()}">${host.maskEditing() ? '返回像素绘画' : '绘制遮罩'}</button><button id="mask-toggle">${l.maskEnabled === false ? '启用遮罩' : '停用遮罩'}</button><button id="mask-black">黑色 · 隐藏</button><button id="mask-white">白色 · 显示</button><button id="mask-invert">反转遮罩</button><button id="mask-apply">应用遮罩</button><button id="mask-delete">移除遮罩</button></div><p class="help">黑色隐藏、白色恢复、灰色半透明。可用笔刷、橡皮和渐变绘制。移除遮罩恢复原图；应用遮罩后仍可撤销。</p>` : `<button id="mask-add" class="panel-wide">＋ ${host.selection() ? '从当前选区创建遮罩' : '添加白色遮罩'}</button>`}<details class="layer-adjustments"><summary>颜色调整</summary>${range('adjust-hue', '色相', a.hue || 0, -180, 180, '°')}${range('adjust-saturation', '饱和度', a.saturation ?? 100, 0, 200)}${range('adjust-brightness', '亮度', a.brightness || 0, -100, 100)}${range('adjust-contrast', '对比度', a.contrast || 0, -100, 100)}<button id="adjust-reset" class="panel-wide">重置颜色调整</button><p class="help">调整整层所有帧，原始像素保留。拖动后松手应用。</p></details>`}`;
  const q = (s) => c.querySelector(s),
    run = (fn) => {
      try {
        host.edit(fn);
      } catch (e) {
        host.toast(e.message);
      }
    };
  q('#layer-blend').value = l.blend || 0;
  q('#layer-blend').onchange = (e) => {
    const mode = Number(e.target.value);
    run((p) => {
      if (mode) p.layers[i].blend = mode;
      else delete p.layers[i].blend;
    });
  };
  if (l.group) return;
  q('#alpha-lock').onchange = (e) => {
    const v = e.target.checked;
    run((p) => (p.layers[i].alphaLock = v));
  };
  q('#layer-clipping').onchange = (e) => {
    const v = e.target.checked;
    run((p) => (p.layers[i].clipping = v));
  };
  if (l.mask) {
    const pixels = new Uint8ClampedArray(p.w * p.h * 4);
    l.mask.forEach((v, j) => pixels.set([v, v, v, 255], j * 4));
    q('#layer-mask-thumb')
      .getContext('2d')
      .putImageData(new ImageData(pixels, p.w, p.h), 0, 0);
    q('#mask-edit').onclick = () => host.editMask(!host.maskEditing());
    q('#mask-toggle').onclick = () =>
      run((p) => (p.layers[i].maskEnabled = p.layers[i].maskEnabled === false));
    q('#mask-black').onclick = () => {
      host.setColor('#000000');
      host.editMask(true);
    };
    q('#mask-white').onclick = () => {
      host.setColor('#ffffff');
      host.editMask(true);
    };
    q('#mask-invert').onclick = () =>
      run((p) => (p.layers[i].mask = p.layers[i].mask.map((v) => 255 - v)));
    q('#mask-delete').onclick = () =>
      run((p) => {
        delete p.layers[i].mask;
        delete p.layers[i].maskEnabled;
      });
    q('#mask-apply').onclick = () =>
      run((p) => {
        if (p.layers[i].maskEnabled === false) throw Error('请先启用遮罩再应用');
        applyMask(p, i);
      });
  } else
    q('#mask-add').onclick = () => {
      const selection = host.selection();
      run((p) => {
        p.layers[i].mask = selection
          ? Uint8ClampedArray.from(selection, (v) => (v ? 255 : 0))
          : new Uint8ClampedArray(p.w * p.h).fill(255);
        p.layers[i].maskEnabled = true;
      });
    };
  for (const key of ['hue', 'saturation', 'brightness', 'contrast']) {
    const input = q('#adjust-' + key);
    input.oninput = (e) =>
      (q('#adjust-' + key + '-value').textContent = e.target.value + (key === 'hue' ? '°' : '%'));
    input.onchange = (e) => {
      const v = Number(e.target.value);
      run((p) => (p.layers[i].adjustments = { ...p.layers[i].adjustments, [key]: v }));
    };
  }
  q('#adjust-reset').onclick = () => run((p) => delete p.layers[i].adjustments);
}
export function gradientSettings(root, host) {
  const o = host.get();
  root.innerHTML = `<p class="panel-intro">在画布上按住并拖动，确定渐变方向与范围。松手完成，可撤销。</p><label>渐变形状<select id="gradient-type"><option value="linear">线性渐变</option><option value="radial">径向渐变</option></select></label><div class="gradient-colors"><label>起点颜色<input id="gradient-from" type="color" value="${o.from}"></label><button id="gradient-swap" aria-label="交换渐变颜色">⇄</button><label>终点颜色<input id="gradient-to" type="color" value="${o.to}"></label></div><button id="gradient-current" class="panel-wide">起点使用当前画笔颜色</button><label class="switch">渐变到透明<input id="gradient-transparent" type="checkbox" ${o.transparent ? 'checked' : ''}></label>${range('gradient-opacity', '渐变不透明度', Math.round(o.opacity * 100), 1, 100)}<label>像素色阶<select id="gradient-steps"><option value="0">连续颜色</option><option value="2">2 色阶</option><option value="4">4 色阶</option><option value="8">8 色阶</option><option value="16">16 色阶</option><option value="32">32 色阶</option></select></label><label class="switch">色阶之间抖色<input id="gradient-dither" type="checkbox" ${o.dither ? 'checked' : ''}></label><div id="gradient-ramp" aria-label="渐变颜色预览"></div><button id="gradient-use" class="panel-wide primary">使用渐变工具</button><p class="help">像素渐变只改变当前帧，遮罩渐变作用于该层所有帧。遵守选区和透明度锁定；双指用于移动画布。</p>`;
  const q = (s) => root.querySelector(s),
    ramp = () => {
      const o = host.get();
      q('#gradient-ramp').style.background =
        `linear-gradient(90deg,${o.from},${o.transparent ? 'transparent' : o.to})`;
    };
  q('#gradient-type').value = o.type;
  q('#gradient-steps').value = o.steps;
  for (const key of ['type', 'from', 'to', 'steps', 'transparent', 'dither', 'opacity'])
    q('#gradient-' + key).oninput = (e) => {
      host.set({
        [key]: ['transparent', 'dither'].includes(key)
          ? e.target.checked
          : key === 'steps'
            ? Number(e.target.value)
            : key === 'opacity'
              ? Number(e.target.value) / 100
              : e.target.value,
      });
      if (key === 'opacity') q('#gradient-opacity-value').textContent = e.target.value + '%';
      ramp();
    };
  q('#gradient-swap').onclick = () => {
    const o = host.get();
    host.set({ from: o.to, to: o.from });
    gradientSettings(root, host);
  };
  q('#gradient-current').onclick = () => {
    host.set({ from: host.color() });
    gradientSettings(root, host);
  };
  q('#gradient-use').onclick = host.use;
  ramp();
}
