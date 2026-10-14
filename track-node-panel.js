import { insertCurveKey, subdivideCurve } from './node-editing.js';

export function trackNodePanel(container, initial, { duration, fields, commit, toast }) {
  let tracks = structuredClone(initial),
    key = fields.some((f) => f[0] === container.dataset.trackField)
      ? container.dataset.trackField
      : fields[0][0],
    selected = Number(container.dataset.trackNodeIndex) || 0;
  const root = document.createElement('details');
  root.className = 'track-node-panel';
  root.innerHTML =
    '<summary>属性关键帧节点</summary><label>属性<select class="track-field"></select></label><label>节点<select class="track-node"></select></label><div class="scene-two"><label>时间 / 秒<input class="track-time" type="number" min="0" step="0.001"></label><label>数值<input class="track-value" type="number" step="0.01"></label></div><div class="scene-two"><button class="track-add">添加节点</button><button class="track-delete">删除节点</button></div><label>批量节点间隔 / 秒<input class="track-spacing" type="number" min="0.001" step="0.01" value="0.2"></label><button class="track-batch">按间隔添加节点</button><p class="help">先选择节点调整时间与数值。新增与批量节点沿用当前曲线，可撤销。</p>';
  container.append(root);
  const anchor = container.querySelector('#scene-remove-object,#light-delete');
  if (anchor) anchor.before(root);
  const q = (s) => root.querySelector(s);
  q('.track-field').replaceChildren(...fields.map(([id, name]) => new Option(name, id)));
  q('.track-spacing').value = container.dataset.trackSpacing || '0.2';
  q('.track-spacing').onchange = (e) => {
    container.dataset.trackSpacing = e.target.value;
  };
  function render() {
    const keys = tracks[key] || [],
      field = fields.find((f) => f[0] === key);
    selected = Math.max(0, Math.min(selected, keys.length - 1));
    q('.track-node').replaceChildren(
      ...keys.map(
        (k, i) => new Option(`${i + 1} · ${k.t.toFixed(3)} s`, String(i), false, i === selected),
      ),
    );
    q('.track-time').max = duration;
    q('.track-time').value = keys[selected]?.t ?? 0;
    q('.track-value').value = keys[selected]?.v ?? field[2];
    q('.track-value').min = field[3];
    q('.track-value').max = field[4];
    q('.track-delete').disabled = !keys.length;
    q('.track-field').value = key;
  }
  const run = (fn) => {
    try {
      const next = structuredClone(tracks);
      fn(next);
      commit(next, key);
      tracks = next;
      render();
    } catch (e) {
      toast(e.message);
    }
  };
  q('.track-field').onchange = (e) => {
    key = e.target.value;
    selected = 0;
    container.dataset.trackField = key;
    container.dataset.trackNodeIndex = '0';
    render();
  };
  q('.track-node').onchange = (e) => {
    selected = +e.target.value;
    container.dataset.trackNodeIndex = String(selected);
    render();
  };
  for (const control of ['time', 'value'])
    q('.track-' + control).onchange = () =>
      run((n) => {
        const t = +q('.track-time').value,
          v = +q('.track-value').value,
          field = fields.find((f) => f[0] === key);
        if (
          !Number.isFinite(t) ||
          !Number.isFinite(v) ||
          t < 0 ||
          t > duration ||
          v < field[3] ||
          v > field[4]
        )
          throw Error('节点时间或数值超出范围');
        n[key] ||= [];
        if (n[key].some((k, i) => i !== selected && Math.abs(k.t - t) < 1e-5))
          throw Error('此时刻已有节点');
        n[key][selected] = { t, v };
        n[key].sort((a, b) => a.t - b.t);
        selected = n[key].findIndex((k) => k.t === t);
      });
  q('.track-add').onclick = () =>
    run((n) => {
      const keys = (n[key] ||= []),
        t = keys.length ? (keys[selected].t + (keys[selected + 1]?.t ?? duration)) / 2 : 0;
      if (keys.some((k) => Math.abs(k.t - t) < 1e-5))
        throw Error('请修改时间或选择前一个节点再添加');
      n[key] = keys.length
        ? insertCurveKey(keys, t)
        : [{ t, v: fields.find((f) => f[0] === key)[2] }];
      selected = n[key].findIndex((k) => k.t === t);
    });
  q('.track-delete').onclick = () => run((n) => n[key].splice(selected, 1));
  q('.track-batch').onclick = () =>
    run((n) => {
      const keys = n[key]?.length ? n[key] : [{ t: 0, v: fields.find((f) => f[0] === key)[2] }];
      n[key] = subdivideCurve(keys, +q('.track-spacing').value, duration);
    });
  render();
}
