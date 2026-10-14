import { emptyCel } from './cel-storage.js';
import {
  editFrames,
  setDurations,
  applySpeed,
  saveTag,
  copyCels,
  pasteCels,
  layerLocked,
} from './animation-edit.js';
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function createAnimationEditor(host) {
  let section = 'frames',
    a = 0,
    b = 0,
    tagIndex = -1,
    context = '',
    clipboard = null,
    previousFrame = 0;
  return function mount(container) {
    const p = host.project(),
      frame = host.frame(),
      layer = host.layer();
    if (context !== host.id()) {
      context = host.id();
      a = b = frame;
      tagIndex = -1;
    }
    if (a === b && a === previousFrame) a = b = frame;
    previousFrame = frame;
    a = Math.min(a, p.frames.length - 1);
    b = Math.max(a, Math.min(b, p.frames.length - 1));
    if (tagIndex >= (p.tags?.length || 0)) tagIndex = -1;
    const $ = (s) => container.querySelector(s),
      run = (fn) => {
        try {
          fn();
        } catch (e) {
          host.toast(e.message);
        }
      },
      edit = (fn) => host.edit(fn);
    container.innerHTML = `<div class="animation-tabs"><button data-tab="frames">帧与单元</button><button data-tab="tags">动画标签</button><button data-tab="play">播放</button></div><div id="animation-fields"></div>`;
    container.querySelectorAll('[data-tab]').forEach((button) => {
      button.classList.toggle('active', section === button.dataset.tab);
      button.onclick = () => {
        section = button.dataset.tab;
        mount(container);
      };
    });
    const fields = $('#animation-fields');
    if (section === 'frames') {
      fields.innerHTML = `<p class="help">选定帧区间，对所有图层编辑帧，或只编辑当前图层的单元。</p><div class="animation-two"><label>起始帧<input id="range-from" type="number" min="1" max="${p.frames.length}" value="${a + 1}"></label><label>结束帧<input id="range-to" type="number" min="1" max="${p.frames.length}" value="${b + 1}"></label></div><div class="button-row"><button id="range-current">当前帧</button><button id="range-tag">当前标签</button><button id="range-all">全部</button></div><label>帧时长（毫秒）<input id="duration" type="number" min="20" max="10000" value="${p.frames[a].duration}"></label><button id="duration-range" class="panel-wide">应用时长到区间</button><div class="animation-two"><button data-frame-op="duplicate">复制帧区间</button><button data-frame-op="blank">插入空白帧</button><button data-frame-op="reverse">区间倒序</button><button data-frame-op="delete" class="danger">删除帧区间</button></div><label>移动后的起始帧<input id="frame-destination" type="number" min="1" max="${p.frames.length}" value="${a + 1}"></label><button data-frame-op="move" class="panel-wide">移动帧区间</button><p class="help">插入、删除会调整标签范围；移动、倒序保留标签所在时间区间。</p><h3>单元 · ${esc(p.layers[layer].name)}</h3><div class="animation-two"><button id="copy-cels">复制区间单元</button><button id="paste-cels">从起始帧粘贴</button><button id="clear-cels" class="danger">清空区间单元</button></div><p class="help">单元操作只影响当前图层。${clipboard ? `已复制 ${clipboard.cels.length} 个单元。` : ''}播放区间由时间轴上的标签选择器决定。</p>`;
      const range = () => {
        a = Number($('#range-from').value) - 1;
        b = Number($('#range-to').value) - 1;
        if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < a || b >= p.frames.length)
          throw Error('请选择有效的帧区间');
        return [a, b];
      };
      $('#range-current').onclick = () => {
        a = b = frame;
        mount(container);
      };
      $('#range-all').onclick = () => {
        a = 0;
        b = p.frames.length - 1;
        mount(container);
      };
      $('#range-tag').onclick = () => {
        const tag = host.tag();
        if (!tag) {
          host.toast('请先在时间轴选择动画标签');
          return;
        }
        a = tag.from;
        b = tag.to;
        mount(container);
      };
      $('#duration-range').onclick = () =>
        run(() => {
          range();
          const d = Number($('#duration').value);
          edit((p) => setDurations(p, a, b, d));
        });
      container.querySelectorAll('[data-frame-op]').forEach(
        (button) =>
          (button.onclick = async () => {
            try {
              range();
              const op = button.dataset.frameOp,
                destination = Number($('#frame-destination').value) - 1;
              if (
                op === 'delete' &&
                !(await host.ask({
                  title: `删除第 ${a + 1}–${b + 1} 帧？`,
                  description: '所选区间内所有图层的内容都会删除，可以撤销。',
                  confirm: '删除帧',
                  danger: true,
                }))
              )
                return;
              edit((p) => {
                const selected = editFrames(p, op, a, b, destination);
                a = b = selected;
                host.selectFrame(selected);
              });
            } catch (e) {
              host.toast(e.message);
            }
          }),
      );
      $('#copy-cels').onclick = () =>
        run(() => {
          range();
          clipboard = copyCels(p, layer, a, b);
          mount(container);
          host.toast('已复制所选单元');
        });
      $('#paste-cels').disabled = !clipboard;
      $('#paste-cels').onclick = () =>
        run(() => {
          range();
          edit((p) => pasteCels(p, layer, a, clipboard));
        });
      $('#clear-cels').onclick = async () => {
        try {
          range();
          if (p.layers[layer].group || layerLocked(p, layer)) throw Error('请选择未锁定的像素图层');
          if (
            !(await host.ask({
              title: '清空所选单元？',
              description: '只清空当前图层在所选帧区间的像素，可撤销。',
              confirm: '清空',
              danger: true,
            }))
          )
            return;
          edit((p) => {
            for (let i = a; i <= b; i++) p.frames[i].cels[layer] = emptyCel(p.w * p.h * 4);
          });
        } catch (e) {
          host.toast(e.message);
        }
      };
    } else if (section === 'tags') {
      const t = p.tags?.[tagIndex] || {
        name: '',
        from: a,
        to: b,
        direction: 0,
        repeat: 0,
        color: '#65b8f2',
      };
      fields.innerHTML = `<label>编辑标签<select id="edit-tag"><option value="-1">＋ 新建动画标签</option>${(p.tags || []).map((t, i) => `<option value="${i}">${esc(t.name)} · ${t.from + 1}–${t.to + 1}</option>`).join('')}</select></label><label>名称<input id="tag-name" maxlength="160" value="${esc(t.name)}" placeholder="例如 idle、run、attack"></label><div class="animation-two"><label>起始帧<input id="tag-from" type="number" min="1" max="${p.frames.length}" value="${t.from + 1}"></label><label>结束帧<input id="tag-to" type="number" min="1" max="${p.frames.length}" value="${t.to + 1}"></label></div><label>播放方向<select id="tag-direction"><option value="0">正向</option><option value="1">反向</option><option value="2">往返</option><option value="3">反向往返</option></select></label><div class="animation-two"><label>重复次数<input id="tag-repeat" type="number" min="0" max="65535" value="${t.repeat}"></label><label>标签颜色<input id="tag-color" type="color" value="${t.color}"></label></div><p class="help">0 表示循环。往返的每个方向各计一次。支持重叠标签；导出 Aseprite 时保留名称、范围、颜色与方向。</p><button id="save-tag" class="panel-wide primary">${tagIndex < 0 ? '创建标签' : '保存标签'}</button><button id="remove-tag" class="panel-wide danger">删除标签</button>`;
      $('#edit-tag').value = tagIndex;
      $('#edit-tag').onchange = (e) => {
        tagIndex = +e.target.value;
        mount(container);
      };
      $('#tag-direction').value = t.direction;
      $('#save-tag').onclick = () =>
        run(() => {
          const tag = {
            name: $('#tag-name').value,
            from: Number($('#tag-from').value) - 1,
            to: Number($('#tag-to').value) - 1,
            direction: +$('#tag-direction').value,
            repeat: Number($('#tag-repeat').value),
            color: $('#tag-color').value,
          };
          edit((p) => (tagIndex = saveTag(p, tagIndex, tag)));
          host.toast('动画标签已保存');
        });
      $('#remove-tag').disabled = tagIndex < 0;
      $('#remove-tag').onclick = async () => {
        if (
          !(await host.ask({
            title: '删除这个动画标签？',
            description: '帧和像素内容会保留。',
            confirm: '删除标签',
            danger: true,
          }))
        )
          return;
        edit((p) => {
          p.tags.splice(tagIndex, 1);
          tagIndex = -1;
        });
      };
    } else {
      fields.innerHTML = `<label>整体预览倍速<input id="editor-speed" type="number" min="0.1" max="8" step="0.05" value="${host.speed()}"></label><div class="animation-two">${[0.5, 1, 1.5, 2].map((v) => `<button data-speed="${v}">${v}×</button>`).join('')}</div><p class="help">可自定义 0.1–8×，对全部帧和任意标签生效，保留每帧的时长比例。</p><button id="bake-speed" class="panel-wide">将倍速写入全部帧时长</button><p class="help">预览倍速不改变导出速度。写入帧时长后，GIF 和 Aseprite 导出也按新速度播放，并将预览恢复为 1×；操作可撤销。</p><p class="help">播放使用原作帧数和时长，不会生成补间。画面已缓存；切回后台会暂停，避免错过帧。</p>`;
      const onion = host.onion();
      fields.insertAdjacentHTML(
        'beforeend',
        `<h3>洋葱皮</h3><label class="switch">启用洋葱皮<input id="onion-enabled" type="checkbox" ${onion.enabled ? 'checked' : ''}></label><div class="animation-two"><label class="switch onion-red">前一帧<input id="onion-before" type="checkbox" ${onion.before ? 'checked' : ''}></label><label class="switch onion-green">后一帧<input id="onion-after" type="checkbox" ${onion.after ? 'checked' : ''}></label></div><label>显示范围<select id="onion-scope"><option value="all">全部可见图层</option><option value="layer">当前像素图层</option></select></label><label>洋葱皮透明度 <span id="onion-opacity-value">${Math.round(onion.opacity * 100)}%</span><input id="onion-opacity" type="range" min="5" max="80" value="${Math.round(onion.opacity * 100)}"></label><p class="help">只显示有变化的像素，红色为前帧，绿色为后帧；覆盖显示，避免被背景挡住。播放时自动隐藏。</p>`,
      );
      $('#onion-scope').value = onion.scope;
      const updateOnion = () => {
        const opacity = Number($('#onion-opacity').value) / 100;
        $('#onion-opacity-value').textContent = Math.round(opacity * 100) + '%';
        host.setOnion({
          enabled: $('#onion-enabled').checked,
          before: $('#onion-before').checked,
          after: $('#onion-after').checked,
          opacity,
          scope: $('#onion-scope').value,
        });
      };
      ['#onion-enabled', '#onion-before', '#onion-after', '#onion-scope'].forEach(
        (s) => ($(s).onchange = updateOnion),
      );
      $('#onion-opacity').oninput = updateOnion;
      $('#editor-speed').oninput = (e) => {
        const value = Number(e.target.value);
        if (value >= 0.1 && value <= 8) host.setSpeed(value);
      };
      $('#editor-speed').onchange = (e) =>
        run(() => {
          host.setSpeed(Number(e.target.value));
          e.target.value = host.speed();
        });
      container.querySelectorAll('[data-speed]').forEach(
        (button) =>
          (button.onclick = () => {
            host.setSpeed(+button.dataset.speed);
            mount(container);
          }),
      );
      $('#bake-speed').onclick = async () => {
        const speed = host.speed();
        if (
          !(await host.ask({
            title: `将 ${speed}× 写入全部帧？`,
            description: '全部帧的时长按比例换算，导出速度也会改变。可撤销。',
            confirm: '应用到全部帧',
          }))
        )
          return;
        try {
          edit((p) => applySpeed(p, speed));
          host.setSpeed(1);
          mount(container);
        } catch (e) {
          host.toast(e.message);
        }
      };
    }
  };
}
