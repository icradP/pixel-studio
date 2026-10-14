import { clamp } from './procedural-model.js';
import { CURVES } from './procedural-path.js';
import { insertCurveKey, subdivideCurve } from './node-editing.js';
// The graph is normalized: horizontal time, vertical progress/strength. It never edits geometry.
export function curveEditor(
  container,
  initial,
  {
    commit,
    preview = () => {},
    cancel = () => {},
    label = '路径进度',
    toast = () => {},
    monotonic = false,
  },
) {
  let keys = structuredClone(initial),
    selected = 0,
    drag = null;
  container.innerHTML = `<div class="scene-curve-presets"></div><svg class="scene-curve" viewBox="0 0 280 160" aria-label="${label}曲线：横轴时间，纵轴数值"><path class="scene-curve-grid" d="M20 12V140H264M20 76H264M142 12V140"/><path class="scene-curve-line"/><g></g><text x="244" y="156">时间</text><text x="20" y="10">${label}</text></svg><p class="help">拖动圆点调节；双击空白添加点。方向键微调选中的点。</p><div class="scene-two"><label>时间 %<input class="curve-time" type="number" min="0" max="100" step="1"></label><label>${label} %<input class="curve-value" type="number" min="0" max="100" step="1"></label></div><div class="scene-two"><button class="curve-add">添加节点</button><button class="curve-remove">删除此点</button></div><label>批量节点间隔 / %<input class="curve-spacing" type="number" min="1" max="100" step="0.1" value="10"></label><button class="curve-batch">按间隔添加节点</button><p class="curve-status" role="status"></p>`;
  const q = (s) => container.querySelector(s),
    svg = q('svg'),
    group = q('g');
  for (const [id, name] of [
    ['linear', '匀速'],
    ['ease', '缓入缓出'],
    ['accelerate', '加速'],
    ['decelerate', '减速'],
    ['fall', '停留后下落'],
    ['return', '往返'],
  ]) {
    if (monotonic && id === 'return') continue;
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = () => {
      keys = structuredClone(CURVES[id]);
      selected = 0;
      commit(keys);
      render();
    };
    q('.scene-curve-presets').append(b);
  }
  function render() {
    q('.scene-curve-line').setAttribute(
      'd',
      keys.map((k, i) => `${i ? 'L' : 'M'}${20 + k.t * 244} ${140 - k.v * 128}`).join(' '),
    );
    group.replaceChildren();
    keys.forEach((k, i) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', 20 + k.t * 244);
      c.setAttribute('cy', 140 - k.v * 128);
      c.setAttribute('r', i === selected ? 6 : 4.5);
      c.dataset.key = i;
      c.setAttribute('tabindex', '0');
      c.setAttribute('role', 'button');
      c.setAttribute(
        'aria-label',
        `曲线点 ${i + 1}：时间 ${Math.round(k.t * 100)}%，${label} ${Math.round(k.v * 100)}%`,
      );
      group.append(c);
    });
    q('.curve-time').value = Math.round(keys[selected].t * 100);
    q('.curve-value').value = Math.round(keys[selected].v * 100);
    q('.curve-time').disabled = selected === 0 || selected === keys.length - 1;
    q('.curve-remove').disabled =
      keys.length <= 2 || selected === 0 || selected === keys.length - 1;
  }
  function value(e) {
    const r = svg.getBoundingClientRect();
    return {
      t: clamp((((e.clientX - r.left) * 280) / r.width - 20) / 244, 0, 1),
      v: clamp((140 - ((e.clientY - r.top) * 160) / r.height) / 128, 0, 1),
    };
  }
  function set(t, v) {
    if (!Number.isFinite(t) || !Number.isFinite(v)) return;
    keys[selected] = {
      t:
        selected === 0
          ? 0
          : selected === keys.length - 1
            ? 1
            : clamp(t, keys[selected - 1].t + 0.005, keys[selected + 1].t - 0.005),
      v: monotonic
        ? selected === 0
          ? 0
          : selected === keys.length - 1
            ? 1
            : clamp(v, keys[selected - 1].v, keys[selected + 1].v)
        : clamp(v, 0, 1),
    };
    render();
  }
  svg.onpointerdown = (e) => {
    const i = e.target.dataset.key;
    if (i === undefined) return;
    selected = +i;
    drag = structuredClone(keys);
    if (e.isTrusted) svg.setPointerCapture(e.pointerId);
    e.preventDefault();
    render();
  };
  svg.onclick = (e) => {
    if (e.target.dataset.key !== undefined) {
      selected = +e.target.dataset.key;
      render();
    }
  };
  svg.onpointermove = (e) => {
    if (!drag) return;
    const p = value(e);
    set(p.t, p.v);
    preview(keys);
  };
  svg.onpointerup = () => {
    if (!drag) return;
    drag = null;
    commit(keys);
  };
  svg.onpointercancel = svg.onlostpointercapture = () => {
    if (!drag) return;
    keys = drag;
    drag = null;
    cancel();
    render();
  };
  svg.ondblclick = (e) => {
    if (e.target.dataset.key !== undefined || keys.length >= 128) return;
    const p = value(e);
    if (keys.some((k) => Math.abs(k.t - p.t) < 0.01)) return;
    if (monotonic) {
      const next = keys.findIndex((k) => k.t > p.t);
      p.v = clamp(p.v, keys[next - 1]?.v || 0, keys[next]?.v ?? 1);
    }
    keys.push(p);
    keys.sort((a, b) => a.t - b.t);
    selected = keys.indexOf(p);
    commit(keys);
    render();
  };
  svg.onkeydown = (e) => {
    const i = e.target.dataset.key;
    if (i === undefined || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key))
      return;
    e.preventDefault();
    e.stopPropagation();
    selected = +i;
    const p = keys[selected];
    set(
      p.t + (e.key === 'ArrowRight' ? 0.01 : e.key === 'ArrowLeft' ? -0.01 : 0),
      p.v + (e.key === 'ArrowUp' ? 0.01 : e.key === 'ArrowDown' ? -0.01 : 0),
    );
    commit(keys);
    group.children[selected].focus();
  };
  for (const selector of ['.curve-time', '.curve-value'])
    q(selector).onchange = () => {
      set(+q('.curve-time').value / 100, +q('.curve-value').value / 100);
      commit(keys);
    };
  q('.curve-remove').onclick = () => {
    keys.splice(selected, 1);
    selected = Math.max(0, selected - 1);
    commit(keys);
    render();
  };
  const changeNodes = (fn) => {
    try {
      keys = fn();
      selected = Math.min(selected, keys.length - 1);
      commit(keys);
      render();
      q('.curve-status').textContent = `${keys.length} 个节点`;
    } catch (e) {
      q('.curve-status').textContent = e.message;
      toast(e.message);
    }
  };
  q('.curve-add').onclick = () =>
    changeNodes(() => {
      const i = Math.min(selected, keys.length - 2);
      return insertCurveKey(keys, (keys[i].t + keys[i + 1].t) / 2);
    });
  q('.curve-batch').onclick = () =>
    changeNodes(() => subdivideCurve(keys, +q('.curve-spacing').value / 100));
  render();
  return () => {
    svg.onpointercancel();
    svg.onpointerdown =
      svg.onpointermove =
      svg.onpointerup =
      svg.onpointercancel =
      svg.onlostpointercapture =
        null;
  };
}
