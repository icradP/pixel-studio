import { effectClip, EFFECT_NAMES } from './scene-effects.js';
import { uid, pathNode } from './procedural-model.js';
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const field = (id, label, value, min, max, step = 0.1) =>
  `<label>${label}<input id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
export function batchEffectsPanel(body, { scene, selected, edit, toast, targets: chosen }) {
  const s = scene(),
    o = s.objects.find((v) => v.id === selected),
    a = o?.appearance || { start: 0, end: s.duration, fadeIn: 0, fadeOut: 0 };
  body.innerHTML = `<p class="help">勾选一个或多个对象；每次应用是一次可撤销操作。</p><div class="scene-two"><button id="fx-all">全选可编辑对象</button><button id="fx-none">清空选择</button></div><div class="scene-source-list">${s.objects.map((v) => `<label><input data-fx-target="${esc(v.id)}" type="checkbox" ${(chosen.size ? chosen.has(v.id) : v.id === selected) && !v.locked ? 'checked' : ''} ${v.locked ? 'disabled' : ''}>${esc(v.name)}${v.locked ? ' · 已锁定' : ''}</label>`).join('')}</div><h3>出现与消失</h3><div class="scene-two">${field('fx-start', '出现 / 秒', a.start, 0, s.duration)}${field('fx-end', '消失 / 秒', a.end, 0, s.duration)}${field('fx-in', '淡入时长 / 秒', a.fadeIn, 0, s.duration)}${field('fx-out', '淡出时长 / 秒', a.fadeOut, 0, s.duration)}</div><button id="fx-visibility" class="primary panel-wide">应用出现与消失</button><button id="fx-always" class="panel-wide">恢复全程显示</button><h3>区间特效</h3><label>效果<select id="fx-type">${['rainbow', 'tint', 'blink', 'hide', 'fadeIn', 'fadeOut'].map((k) => `<option value="${k}">${EFFECT_NAMES[k]}</option>`).join('')}</select></label><div class="scene-two">${field('fx-effect-start', '效果开始 / 秒', 0, 0, s.duration)}${field('fx-effect-end', '效果结束 / 秒', s.duration, 0, s.duration)}<label>渐变起色<input id="fx-color" type="color" value="#ff83c9"></label><label>渐变终色<input id="fx-color-to" type="color" value="#76deff"></label>${field('fx-cycles', '彩虹循环次数', 1, 0.1, 20)}${field('fx-frequency', '闪烁频率 / Hz', 2, 0.1, 20)}</div><label>效果强度<input id="fx-strength" type="range" min="0" max="1" step=".05" value=".65"></label><button id="fx-add" class="primary panel-wide">添加到所选对象</button><p class="help">淡入在开始前隐藏，淡出在结束后保持隐藏。彩虹与染色在效果区间外恢复原色。</p>`;
  const $ = (sel) => body.querySelector(sel),
    n = (id) => Number($('#' + id).value);
  const targets = () =>
    [...body.querySelectorAll('[data-fx-target]:checked')].map((el) => el.dataset.fxTarget);
  const apply = (fn) => {
    const ids = targets();
    chosen.clear();
    ids.forEach((id) => chosen.add(id));
    if (!ids.length) return toast('请至少勾选一个未锁定的对象');
    edit((next) => {
      for (const v of next.objects)
        if (ids.includes(v.id)) {
          if (v.locked) throw Error('请先解锁对象');
          fn(v);
        }
    });
  };
  $('#fx-all').onclick = () =>
    body.querySelectorAll('[data-fx-target]:not(:disabled)').forEach((el) => (el.checked = true));
  $('#fx-none').onclick = () =>
    body.querySelectorAll('[data-fx-target]').forEach((el) => (el.checked = false));
  $('#fx-visibility').onclick = () => {
    const value = {
      start: n('fx-start'),
      end: n('fx-end'),
      fadeIn: n('fx-in'),
      fadeOut: n('fx-out'),
    };
    apply((v) => (v.appearance = { ...value }));
  };
  $('#fx-always').onclick = () => apply((v) => delete v.appearance);
  $('#fx-add').onclick = () => {
    const clip = effectClip(uid(), $('#fx-type').value, n('fx-effect-start'), n('fx-effect-end'));
    clip.intensity = n('fx-strength');
    Object.assign(clip.params, {
      color: $('#fx-color').value,
      colorTo: $('#fx-color-to').value,
      frequency: n('fx-frequency'),
      cycles: n('fx-cycles'),
    });
    apply((v) => v.clips.push({ ...structuredClone(clip), id: uid() }));
  };
}
export function lightsPanel(body, { scene, project, edit, selectedLight, setSelectedLight }) {
  const s = scene(),
    p = project(),
    lights = s.lights || [],
    l = lights.find((v) => v.id === selectedLight) || lights[0];
  body.innerHTML = `<p class="help">光照只改变颜色，保留透明区域。最多 8 盏灯，可设置光色、移动路径和明暗节奏。</p><button id="light-add" class="primary panel-wide" ${lights.length >= 8 ? 'disabled' : ''}>＋ 添加光源</button><div class="scene-effect-list">${lights.map((v) => `<button data-light="${esc(v.id)}" class="${l?.id === v.id ? 'active' : ''}">${esc(v.name)}</button>`).join('')}</div><div id="light-fields"></div>`;
  const $ = (sel) => body.querySelector(sel);
  $('#light-add').onclick = () => {
    const id = uid();
    setSelectedLight(id);
    edit((n) => {
      n.lights ||= [];
      n.lights.push({
        id,
        name: `光源 ${n.lights.length + 1}`,
        enabled: true,
        x: p.w / 2,
        y: p.h / 2,
        radius: Math.max(16, p.w / 3),
        intensity: 0.6,
        color: '#a3dbff',
        colorTo: '#ff8dc8',
        start: 0,
        end: s.duration,
        pulse: 0.4,
        frequency: 1,
        phase: 0,
        colorCycle: false,
      });
    });
  };
  body.querySelectorAll('[data-light]').forEach(
    (b) =>
      (b.onclick = () => {
        setSelectedLight(b.dataset.light);
        lightsPanel(body, {
          scene,
          project,
          edit,
          selectedLight: b.dataset.light,
          setSelectedLight,
        });
      }),
  );
  if (!l) return;
  const end = l.path?.[1] || l;
  $('#light-fields').innerHTML =
    `<label>名称<input id="light-name" maxlength="80" value="${esc(l.name)}"></label><label class="switch">开启光源<input id="light-enabled" type="checkbox" ${l.enabled ? 'checked' : ''}></label><div class="scene-two">${field('light-x', '位置 X', l.x, -16384, 16384, 1)}${field('light-y', '位置 Y', l.y, -16384, 16384, 1)}${field('light-radius', '光照半径 / px', l.radius, 1, 2048, 1)}${field('light-intensity', '亮度', l.intensity, 0, 4, 0.05)}<label>光色<input id="light-color" type="color" value="${l.color}"></label><label>变化光色<input id="light-colorTo" type="color" value="${l.colorTo || l.color}"></label>${field('light-start', '开启 / 秒', l.start, 0, s.duration)}${field('light-end', '关闭 / 秒', l.end, 0, s.duration)}${field('light-pulse', '明暗幅度', l.pulse || 0, 0, 1, 0.05)}${field('light-frequency', '明暗频率 / Hz', l.frequency ?? 1, 0, 20, 0.1)}</div><label class="switch">循环变换光色<input id="light-colorCycle" type="checkbox" ${l.colorCycle ? 'checked' : ''}></label><details><summary>动态光源路径</summary><p class="help">从当前位置到终点，再返回起点，随场景时长循环。</p><div class="scene-two">${field('light-to-x', '终点 X', end.x, -16384, 16384, 1)}${field('light-to-y', '终点 Y', end.y, -16384, 16384, 1)}</div><button id="light-path">应用往返路径</button><button id="light-static">固定光源位置</button></details><button id="light-delete" class="danger panel-wide">移除光源</button>`;
  const change = (fn) => edit((n) => fn(n.lights.find((v) => v.id === l.id)));
  for (const key of [
    'name',
    'enabled',
    'x',
    'y',
    'radius',
    'intensity',
    'color',
    'colorTo',
    'start',
    'end',
    'pulse',
    'frequency',
    'colorCycle',
  ])
    $('#light-' + key).onchange = (e) => {
      const value =
        e.target.type === 'checkbox'
          ? e.target.checked
          : e.target.type === 'number'
            ? +e.target.value
            : e.target.value;
      change((v) => {
        v[key] = value;
        if (key === 'x' || key === 'y') delete v.path;
      });
    };
  $('#light-path').onclick = () => {
    const x = +$('#light-to-x').value,
      y = +$('#light-to-y').value;
    change((v) => (v.path = [pathNode(v.x, v.y), pathNode(x, y), pathNode(v.x, v.y)]));
  };
  $('#light-static').onclick = () => change((v) => delete v.path);
  $('#light-delete').onclick = () =>
    edit((n) => (n.lights = n.lights.filter((v) => v.id !== l.id)));
}
