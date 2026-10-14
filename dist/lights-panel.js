import { uid, pathNode, encodeRegion } from './procedural-model.js';
import { lightState } from './scene-effects.js';
import { putPosition } from './light-model.js';
import { setTransformKey } from './procedural-path.js';
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const field = (id, label, value, min, max, step = 0.1) =>
  `<label>${label}<input id="light-${id}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
export function lightsPanel(body, api) {
  const { scene, project, edit, selectedLight, setSelectedLight, canvas, selection, toast, time } =
    api;
  const s = scene(),
    p = project(),
    lights = s.lights || [],
    l = lights.find((v) => v.id === selectedLight) || lights[0];
  const $ = (selector) => body.querySelector(selector);
  body.innerHTML = `<p class="help">拖动画布上的灯芯移动，拖动圆圈右侧方柄调整半径。播放头与灯光轨道共用。</p><button id="light-add" class="primary panel-wide" ${lights.length >= 8 ? 'disabled' : ''}>＋ 添加光源</button><div class="scene-effect-list">${lights.map((v) => `<button data-light="${esc(v.id)}" class="${l?.id === v.id ? 'active' : ''}">${esc(v.name)}</button>`).join('')}</div><div id="light-fields"></div>`;
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
        radius: Math.min(2048, Math.max(16, p.w / 3)),
        intensity: 0.6,
        color: '#a3dbff',
        colorTo: '#ff8dc8',
        start: 0,
        end: s.duration,
        pulse: 0,
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
        lightsPanel(body, { ...api, selectedLight: b.dataset.light });
      }),
  );
  if (!l) return;
  const state = lightState(l, time(), s.duration),
    end = l.path?.[1] || l;
  $('#light-fields').innerHTML =
    `<label>名称<input id="light-name" maxlength="80" value="${esc(l.name)}"></label><label class="switch">开启光源<input id="light-enabled" type="checkbox" ${l.enabled ? 'checked' : ''}></label><label class="switch">记录当前位置关键帧<input id="light-record" type="checkbox" ${canvas.animate ? 'checked' : ''}></label><p class="help">关闭时拖动整体路径；开启时在播放头位置记录移动、半径或亮度。当前 ${time().toFixed(3)} 秒。</p><div class="scene-two"><button id="light-draw-path">在画布画路径</button><button id="light-key-add">记录当前灯光</button><button id="light-key-remove">删除此时刻关键帧</button><button id="light-static">固定在当前位置</button></div><div class="scene-two">${field('x', '位置 X', +state.x.toFixed(2), -16384, 16384, 1)}${field('y', '位置 Y', +state.y.toFixed(2), -16384, 16384, 1)}${field('radius', '光照半径 / px', +state.radius.toFixed(2), 1, 2048, 1)}${field('intensity', '亮度', +state.intensity.toFixed(2), 0, 4, 0.05)}<label>光色<input id="light-color" type="color" value="${l.color}"></label><label>变化光色<input id="light-colorTo" type="color" value="${l.colorTo || l.color}"></label>${field('start', '开启 / 秒', l.start, 0, s.duration)}${field('end', '关闭 / 秒', l.end, 0, s.duration)}${field('pulse', '明暗幅度', l.pulse || 0, 0, 1, 0.05)}${field('frequency', '明暗频率 / Hz', l.frequency ?? 1, 0, 20)}</div><label class="switch">循环变换光色<input id="light-colorCycle" type="checkbox" ${l.colorCycle ? 'checked' : ''}></label><h3>影响范围</h3><label>光照分布<select id="light-coverage"><option value="radial">圆形光照衰减</option><option value="global">全局均匀光照</option></select></label><div class="scene-two"><button id="light-area">在画布框选区块</button><button id="light-selection" ${selection() ? '' : 'disabled'}>使用绘画选区</button><button id="light-area-clear">恢复全画布范围</button></div><p class="help">${l.region ? '已限定绘画选区' : l.area ? `限定区块 ${l.area.x}, ${l.area.y} · ${l.area.w} × ${l.area.h}` : '未限制位置范围'}。框选区块固定在画布；仅照亮勾选对象时，光照只改变这些对象的表面。</p><details><summary>指定受光对象</summary><p class="help">不勾选时影响整个合成画面。</p>${s.objects.map((o) => `<label><input type="checkbox" data-light-target="${esc(o.id)}" ${l.targets?.includes(o.id) ? 'checked' : ''}>${esc(o.name)}</label>`).join('') || '<p class="help">场景暂无绘画对象。</p>'}</details><details><summary>往返路径设置</summary><div class="scene-two">${field('to-x', '终点 X', end.x, -16384, 16384, 1)}${field('to-y', '终点 Y', end.y, -16384, 16384, 1)}</div><button id="light-path">应用往返路径</button></details><button id="light-delete" class="danger panel-wide">移除光源</button>`;
  const change = (fn) => edit((n) => fn(n.lights.find((v) => v.id === l.id)));
  $('#light-record').onchange = (e) => canvas.setAnimate(e.target.checked);
  $('#light-coverage').value = l.coverage || 'radial';
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
    'coverage',
  ])
    $('#light-' + key).onchange = (e) => {
      const value =
        e.target.type === 'checkbox'
          ? e.target.checked
          : e.target.type === 'number'
            ? +e.target.value
            : e.target.value;
      change((v) => {
        if (canvas.animate && ['x', 'y'].includes(key)) {
          if (!v.positionKeys?.length) putPosition(v, 0, lightState(v, 0, s.duration));
          putPosition(v, time(), { x: state.x, y: state.y, [key]: value });
        } else if (canvas.animate && ['radius', 'intensity'].includes(key)) {
          const property = key === 'radius' ? 'radiusKeys' : 'intensityKeys',
            tracks = { value: (v[property] ||= []) };
          if (!tracks.value.length) setTransformKey(tracks, 'value', 0, v[key]);
          setTransformKey(tracks, 'value', time(), value);
        } else {
          v[key] = value;
          if (key === 'x' || key === 'y') {
            delete v.path;
            delete v.positionKeys;
          }
          if (key === 'radius') delete v.radiusKeys;
        }
      });
    };
  $('#light-area').onclick = () => {
    setSelectedLight(l.id);
    canvas.setMode('area');
    toast('在画布拖出照明区块，抬手应用');
  };
  $('#light-draw-path').onclick = () => {
    setSelectedLight(l.id);
    canvas.setMode('path');
    toast('在画布画出灯光运动路径，抬手应用');
  };
  $('#light-selection').onclick = () =>
    change((v) => {
      v.region = encodeRegion(selection(), p.w, p.h);
      delete v.area;
    });
  $('#light-area-clear').onclick = () =>
    change((v) => {
      delete v.area;
      delete v.region;
    });
  body.querySelectorAll('[data-light-target]').forEach(
    (b) =>
      (b.onchange = () => {
        const ids = [...body.querySelectorAll('[data-light-target]:checked')].map(
          (b) => b.dataset.lightTarget,
        );
        change((v) => (v.targets = ids));
      }),
  );
  $('#light-key-add').onclick = () =>
    change((v) => {
      putPosition(v, time(), state);
      const tracks = { radius: (v.radiusKeys ||= []), intensity: (v.intensityKeys ||= []) };
      setTransformKey(tracks, 'radius', time(), state.radius);
      setTransformKey(tracks, 'intensity', time(), state.intensity);
    });
  $('#light-key-remove').onclick = () =>
    change((v) => {
      for (const key of ['positionKeys', 'radiusKeys', 'intensityKeys', 'keys'])
        if (v[key]) v[key] = v[key].filter((k) => Math.abs(k.t - time()) > 1e-6);
    });
  $('#light-path').onclick = () => {
    const x = +$('#light-to-x').value,
      y = +$('#light-to-y').value;
    change((v) => {
      v.path = [pathNode(v.x, v.y), pathNode(x, y), pathNode(v.x, v.y)];
      delete v.positionKeys;
    });
  };
  $('#light-static').onclick = () =>
    change((v) => {
      v.x = state.x;
      v.y = state.y;
      v.radius = state.radius;
      delete v.path;
      delete v.positionKeys;
      delete v.radiusKeys;
    });
  $('#light-delete').onclick = () =>
    edit((n) => (n.lights = n.lights.filter((v) => v.id !== l.id)));
}
