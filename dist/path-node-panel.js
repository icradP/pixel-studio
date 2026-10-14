import { insertPathNode, subdividePath } from './node-editing.js';

export function pathNodePanel(container, path, { commit, toast, editCanvas }) {
  let selected = Math.max(
    0,
    Math.min(path.length - 1, Number(container.dataset.pathNodeIndex) || 0),
  );
  const root = document.createElement('details');
  root.className = 'path-node-panel';
  root.innerHTML =
    '<summary>路径节点与精度</summary><label>选择节点<select class="node-index"></select></label><div class="scene-two"><label>X<input class="node-x" type="number" step="0.1"></label><label>Y<input class="node-y" type="number" step="0.1"></label></div><div class="scene-two"><button class="node-add">在后方添加节点</button><button class="node-delete">删除节点</button></div><label>批量节点间隔 / 像素<input class="node-spacing" type="number" value="16" min="0.1" step="0.1"></label><button class="node-batch">按间隔添加节点</button><button class="node-canvas">在画布调整节点与手柄</button><p class="help">添加节点保持原曲线形状，最多 64 点。删除节点会重新连接相邻点。</p>';
  container.append(root);
  const anchor = container.querySelector('#scene-current-time');
  if (anchor) anchor.before(root);
  const q = (s) => root.querySelector(s),
    run = (fn) => {
      try {
        const next = fn();
        commit(next);
        path = structuredClone(next);
        selected = Math.min(selected, path.length - 1);
        render();
      } catch (e) {
        toast(e.message);
      }
    };
  function render() {
    q('.node-index').replaceChildren(
      ...path.map((_, i) => new Option(`节点 ${i + 1}`, String(i), false, i === selected)),
    );
    q('.node-x').value = path[selected]?.x ?? 0;
    q('.node-y').value = path[selected]?.y ?? 0;
    q('.node-add').disabled = path.length >= 64;
    q('.node-delete').disabled = path.length <= 2;
  }
  q('.node-index').onchange = (e) => {
    selected = +e.target.value;
    container.dataset.pathNodeIndex = String(selected);
    render();
  };
  q('.node-spacing').value = container.dataset.nodeSpacing || '16';
  q('.node-spacing').onchange = (e) => {
    container.dataset.nodeSpacing = e.target.value;
  };
  for (const key of ['x', 'y'])
    q('.node-' + key).onchange = (e) =>
      run(() => {
        const next = structuredClone(path),
          value = Number(e.target.value);
        if (!Number.isFinite(value)) throw Error('请输入有效坐标');
        const n = next[selected],
          delta = value - n[key];
        n[key] = value;
        n.in[key] += delta;
        n.out[key] += delta;
        return next;
      });
  q('.node-add').onclick = () =>
    run(() => {
      if (path.length === 1) {
        const next = structuredClone(path[0]),
          step = Number(q('.node-spacing').value);
        if (!(step > 0)) throw Error('请输入有效的节点间隔');
        next.x += step;
        next.in.x += step;
        next.out.x += step;
        return [...structuredClone(path), next];
      }
      return insertPathNode(path, Math.min(selected, path.length - 2));
    });
  q('.node-delete').onclick = () => run(() => path.filter((_, i) => i !== selected));
  q('.node-batch').onclick = () => run(() => subdividePath(path, +q('.node-spacing').value));
  q('.node-canvas').onclick = editCanvas;
  render();
}
