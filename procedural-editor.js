import {
  createScene,
  ensureSourceIds,
  uid,
  clamp,
  validateScene,
  SCENE_LIMITS,
  sceneBytes,
} from './procedural-model.js';
import {
  createObject,
  compileScene,
  evaluateScene,
  objectState,
  objectCorners,
  bakePlan,
  bakeScene,
} from './procedural.js';
import { fitPath, curveValue, setTransformKey, CURVES } from './procedural-path.js';
import { curveEditor } from './procedural-curve.js';
import { floatingPanel } from './floating.js';
import { showDialog, hideDialog } from './dialogs.js';
import { mebibytes } from './limits.js';
import { composite } from './engine.js';
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const COLORS = ['#85cfff', '#f5b27d', '#b7de8a', '#e9a5e5', '#92ded1', '#e4cf84'];
const effectNames = {
  rotate: '旋转',
  stretch: '拉伸',
  squash: '触地压扁',
  fade: '透明度',
  shake: '震动',
};
const round = (n) => Math.round(n * 1000) / 1000;
export function createProceduralEditor(host) {
  let active = false,
    time = 0,
    selected = null,
    mode = 'select',
    solo = null,
    draft = null,
    gesture = null,
    playing = false,
    raf = 0,
    clock = 0,
    originTime = 0,
    compiled = null,
    compileKey = '',
    lastScene = null,
    lastRevision = -1,
    sourceSelection = null,
    panelState = null,
    panelCleanup = null,
    panelEditing = false,
    timelineCancel = null,
    inspector = null,
    float = null,
    error = '',
    range = [0, 1],
    rangeFirst = null,
    busy = false;
  const root = document.createElement('section');
  root.id = 'scene-timeline';
  root.hidden = true;
  root.setAttribute('aria-label', '程序化动画时间轴');
  root.innerHTML = `<header class="scene-toolbar"><strong>动作画室</strong><button id="scene-add">＋ 对象</button><div class="scene-tools">${[
    ['select', '选对象'],
    ['draw', '画路径'],
    ['edit', '控点'],
    ['transform', '变换'],
    ['range', '时间点'],
  ]
    .map(([id, name]) => `<button data-scene-mode="${id}" aria-pressed="false">${name}</button>`)
    .join(
      '',
    )}</div><button id="scene-curve">进度曲线</button><button id="scene-effects">区间效果</button><button id="scene-settings" aria-label="场景设置">设置</button><button id="scene-bake" class="primary">烘焙</button><button id="scene-exit">返回绘画</button></header><div class="scene-transport"><button id="scene-undo" aria-label="撤销动画编辑">↶</button><button id="scene-redo" aria-label="重做动画编辑">↷</button><button id="scene-prev" aria-label="程序动画上一帧">‹</button><button id="scene-play" aria-label="播放程序动画">▶</button><button id="scene-next" aria-label="程序动画下一帧">›</button><output id="scene-time">0.000 s</output><input id="scene-scrub" type="range" aria-label="场景播放头" min="0" max="2" step="0.083333" value="0"><button id="scene-loop" aria-pressed="true">循环</button><span id="scene-range-label"></span></div><div id="scene-warning" role="status" hidden></div><div id="scene-tracks"></div><div id="scene-empty">从图层或选区创建对象，再在画布上画出运动路径。</div>`;
  document.body.append(root);
  const q = (s) => root.querySelector(s),
    scene = () => draft || host.project().procedural,
    object = () => scene()?.objects.find((o) => o.id === selected),
    snap = (t) => clamp(Math.round(t * scene().fps) / scene().fps, 0, scene().duration);
  const safely = (fn) => {
    try {
      return fn();
    } catch (e) {
      host.toast(e.message);
      return null;
    }
  };
  function setMode(next) {
    mode = next;
    rangeFirst = null;
    root
      .querySelectorAll('[data-scene-mode]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sceneMode === mode)));
    host.render();
  }
  function sources() {
    const s = scene();
    return JSON.stringify([
      host.artRevision(),
      s.baseFrameId,
      s.objects.map((o) => [o.id, o.source]).sort((a, b) => a[0].localeCompare(b[0])),
    ]);
  }
  function prepare() {
    const key = sources();
    if (key === compileKey) return compiled;
    compileKey = key;
    try {
      compiled = compileScene(host.project(), scene());
      error = '';
    } catch (e) {
      compiled = null;
      error = e.message;
    }
    q('#scene-warning').hidden = !error;
    q('#scene-warning').textContent = error;
    q('#scene-bake').disabled = !!error || !scene().objects.length;
    return compiled;
  }
  function edit(fn) {
    pause();
    const next = structuredClone(host.project().procedural);
    try {
      fn(next);
      validateScene(next, host.project());
      draft = null;
      if (JSON.stringify(next) !== JSON.stringify(host.project().procedural))
        host.commitScene(next);
    } catch (e) {
      draft = null;
      host.toast(e.message);
      renderRows();
      host.render();
    }
  }
  function editObject(fn) {
    const o = object();
    if (!o) return host.toast('请先选择一个对象');
    if (o.locked) {
      draft = null;
      host.render();
      return host.toast('对象已锁定，请先解锁');
    }
    edit((s) =>
      fn(
        s.objects.find((v) => v.id === selected),
        s,
      ),
    );
  }
  function curveCommit(fn) {
    panelEditing = true;
    try {
      editObject(fn);
    } finally {
      panelEditing = false;
    }
  }
  function preview(next) {
    if (object()?.locked) return;
    draft = next;
    host.render();
    updateClock();
  }
  function commitDraft(cancel = false) {
    const next = draft;
    draft = null;
    if (next && !cancel)
      safely(() => {
        validateScene(next, host.project());
        host.commitScene(next);
      });
    else {
      renderRows();
      host.render();
    }
  }
  function select(id, render = true) {
    selected = id;
    solo = null;
    rangeFirst = null;
    if (render) {
      renderRows();
      if (panelState && ['object', 'curve', 'effects'].includes(panelState.kind)) renderPanel();
    }
    host.render();
  }
  function updateClock() {
    const s = scene();
    if (!s) return;
    q('#scene-time').value = time.toFixed(3) + ' s';
    q('#scene-scrub').value = time;
    q('#scene-range-label').textContent = `区间 ${range[0].toFixed(2)}–${range[1].toFixed(2)} s`;
    root.style.setProperty('--scene-playhead', `${(time / s.duration) * 100}%`);
    if (panelState?.kind === 'object' && inspector && object()) {
      const heading = inspector.querySelector('#scene-current-time');
      if (heading) heading.textContent = `当前时刻 · ${time.toFixed(3)} s`;
      inspector.querySelectorAll('[data-scene-value]').forEach((input) => {
        if (input === document.activeElement) return;
        const key = input.dataset.sceneValue;
        input.value = round(curveValue(object().tracks[key], time, key === 'rotation' ? 0 : 1));
      });
    }
  }
  function seek(t) {
    pause();
    time = snap(t);
    updateClock();
    host.render();
  }
  function pause() {
    playing = false;
    cancelAnimationFrame(raf);
    raf = 0;
    q('#scene-play').textContent = '▶';
    q('#scene-play').setAttribute('aria-label', '播放程序动画');
  }
  function play() {
    if (playing) {
      pause();
      return;
    }
    if (!prepare()) return host.toast(error);
    const s = scene(),
      start = Math.round(s.range[0] * s.fps) / s.fps,
      end = Math.round(s.range[1] * s.fps) / s.fps;
    if (end <= start) return host.toast('播放区间至少包含一帧');
    if (time < start || time >= end) time = start;
    playing = true;
    clock = performance.now();
    originTime = time;
    q('#scene-play').textContent = 'Ⅱ';
    q('#scene-play').setAttribute('aria-label', '暂停程序动画');
    const tick = (now) => {
      if (!playing || !active) return;
      let t = originTime + (now - clock) / 1000;
      if (t >= end) {
        if (s.loop) t = start + ((t - start) % (end - start));
        else {
          time = Math.max(start, end - 1 / s.fps);
          pause();
          updateClock();
          host.render();
          return;
        }
      }
      const next = Math.floor((t + 1e-8) * s.fps) / s.fps;
      if (next !== time) {
        time = next;
        updateClock();
        host.render();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  function dragInterval(element, oId, clipId, e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    pause();
    selected = oId;
    const o = object();
    if (o.locked) return host.toast('对象已锁定');
    const lane = element.closest('.scene-lane'),
      box = lane.getBoundingClientRect(),
      before = structuredClone(scene()),
      item = clipId ? o.clips.find((c) => c.id === clipId) : o.motion,
      initial = { start: item.start, end: item.end },
      x = e.clientX,
      edge = e.target.dataset.edge;
    draft = structuredClone(before);
    element.setPointerCapture(e.pointerId);
    const finish = (cancel) => {
      timelineCancel = null;
      element.onpointermove =
        element.onpointerup =
        element.onpointercancel =
        element.onlostpointercapture =
          null;
      commitDraft(cancel);
      if (!cancel && clipId) openPanel('effects', clipId);
    };
    element.onpointermove = (event) => {
      const target = draft.objects.find((v) => v.id === oId),
        c = clipId ? target.clips.find((v) => v.id === clipId) : target.motion,
        delta = ((event.clientX - x) / box.width) * scene().duration,
        min = 1 / scene().fps;
      if (edge === 'start') c.start = clamp(snap(initial.start + delta), 0, c.end - min);
      else if (edge === 'end')
        c.end = clamp(snap(initial.end + delta), c.start + min, scene().duration);
      else {
        const span = initial.end - initial.start;
        c.start = clamp(snap(initial.start + delta), 0, Math.max(0, scene().duration - span));
        c.end = c.start + span;
      }
      element.style.left = (c.start / scene().duration) * 100 + '%';
      element.style.width = ((c.end - c.start) / scene().duration) * 100 + '%';
      host.render();
    };
    element.onpointerup = () => finish(false);
    timelineCancel = element.onpointercancel = element.onlostpointercapture = () => finish(true);
  }
  function renderRows() {
    const s = scene();
    if (!s) return;
    q('#scene-empty').hidden = !!s.objects.length;
    q('#scene-scrub').max = s.duration;
    q('#scene-scrub').step = 1 / s.fps;
    q('#scene-loop').setAttribute('aria-pressed', s.loop);
    const tracks = q('#scene-tracks'),
      scroll = tracks.scrollTop;
    tracks.replaceChildren();
    const ruler = document.createElement('div');
    ruler.className = 'scene-ruler';
    ruler.innerHTML = `<span>对象 / 秒</span><div>${Array.from({ length: 5 }, (_, i) => `<span>${round((s.duration * i) / 4)}</span>`).join('')}</div>`;
    tracks.append(ruler);
    q('#scene-undo').disabled = !host.history().canUndo;
    q('#scene-redo').disabled = !host.history().canRedo;
    for (const [index, o] of [...s.objects.entries()].reverse()) {
      const row = document.createElement('div');
      row.className = 'scene-track' + (selected === o.id ? ' selected' : '');
      row.dataset.object = o.id;
      row.style.setProperty('--object-color', COLORS[index % COLORS.length]);
      row.innerHTML = `<div class="scene-track-label"><button class="scene-object-name" aria-label="选择动画对象 ${esc(o.name)}">${esc(o.name)}</button><button data-object-action="visible" aria-label="${o.visible ? '隐藏' : '显示'}动画对象 ${esc(o.name)}" aria-pressed="${o.visible}">${o.visible ? '◉' : '○'}</button><button data-object-action="locked" aria-label="${o.locked ? '解锁' : '锁定'}动画对象 ${esc(o.name)}" aria-pressed="${o.locked}">${o.locked ? '▣' : '▢'}</button><button data-object-action="enabled" aria-label="${o.enabled ? '停用' : '启用'}对象动画 ${esc(o.name)}" aria-pressed="${o.enabled}">↝</button></div><div class="scene-lane" aria-label="${esc(o.name)}的时间轨道"><div class="scene-selected-range"></div><button class="scene-motion" aria-label="${esc(o.name)}运动区间"><span data-edge="start"></span><small>运动</small><span data-edge="end"></span></button><div class="scene-playhead"></div></div>`;
      const lane = row.querySelector('.scene-lane'),
        motion = row.querySelector('.scene-motion');
      const place = (el, c) => {
        el.style.left = (c.start / s.duration) * 100 + '%';
        el.style.width = ((c.end - c.start) / s.duration) * 100 + '%';
      };
      place(motion, o.motion);
      motion.onpointerdown = (e) => dragInterval(motion, o.id, null, e);
      row.querySelector('.scene-object-name').onclick = () => {
        select(o.id);
        openPanel('object');
      };
      row.querySelectorAll('[data-object-action]').forEach(
        (b) =>
          (b.onclick = () =>
            edit((n) => {
              const v = n.objects.find((v) => v.id === o.id);
              v[b.dataset.objectAction] = !v[b.dataset.objectAction];
            })),
      );
      lane.onpointerdown = (e) => {
        if (e.target !== lane && e.target.className !== 'scene-selected-range') return;
        e.preventDefault();
        pause();
        selected = o.id;
        const r = lane.getBoundingClientRect(),
          at = (x) => snap(((x - r.left) / r.width) * s.duration),
          start = at(e.clientX);
        time = start;
        range = [start, Math.min(s.duration, start + 1 / s.fps)];
        lane.setPointerCapture(e.pointerId);
        const drawRange = () => {
          const el = row.querySelector('.scene-selected-range');
          el.style.left = (range[0] / s.duration) * 100 + '%';
          el.style.width = ((range[1] - range[0]) / s.duration) * 100 + '%';
          updateClock();
          host.render();
        };
        drawRange();
        lane.onpointermove = (event) => {
          const end = at(event.clientX);
          range = [Math.min(start, end), Math.max(start, end)];
          drawRange();
        };
        lane.onpointerup = () => {
          lane.onpointermove = lane.onpointerup = lane.onpointercancel = null;
          if (range[1] - range[0] < 1 / s.fps)
            range = [Math.max(0, start - 1 / s.fps), Math.min(s.duration, start + 1 / s.fps)];
          renderRows();
          updateClock();
        };
        lane.onpointercancel = () => {
          lane.onpointermove = lane.onpointerup = lane.onpointercancel = null;
          renderRows();
        };
      };
      if (selected === o.id) {
        row.classList.add('expanded');
        o.clips.forEach((c, i) => {
          const el = document.createElement('button');
          el.className = 'scene-clip' + (c.enabled ? '' : ' disabled');
          el.dataset.clip = c.id;
          el.style.top = 32 + i * 25 + 'px';
          el.innerHTML = `<span data-edge="start"></span><small>${effectNames[c.type]}</small><span data-edge="end"></span>`;
          el.setAttribute(
            'aria-label',
            `${effectNames[c.type]}区间 ${c.start.toFixed(2)}–${c.end.toFixed(2)} 秒`,
          );
          place(el, c);
          el.onpointerdown = (e) => dragInterval(el, o.id, c.id, e);
          lane.append(el);
        });
        lane.style.minHeight = Math.max(40, 36 + o.clips.length * 25) + 'px';
        for (const [key, keys] of Object.entries(o.tracks))
          for (const k of keys) {
            const b = document.createElement('button');
            b.className = 'scene-key';
            b.style.left = (k.t / s.duration) * 100 + '%';
            b.textContent = '◆';
            b.setAttribute('aria-label', `${key}关键帧 ${k.t.toFixed(3)} 秒`);
            b.onclick = (e) => {
              e.stopPropagation();
              seek(k.t);
              openPanel('object');
            };
            lane.append(b);
          }
        const r = row.querySelector('.scene-selected-range');
        r.style.left = (range[0] / s.duration) * 100 + '%';
        r.style.width = ((range[1] - range[0]) / s.duration) * 100 + '%';
      }
      tracks.append(row);
    }
    tracks.scrollTop = scroll;
    updateClock();
  }
  function openPanel(kind, clipId) {
    pause();
    panelState = { kind, clipId };
    if (!inspector) {
      inspector = document.createElement('aside');
      inspector.id = 'scene-inspector';
      inspector.className = 'studio-window scene-inspector';
      inspector.setAttribute('aria-label', '动画对象设置');
      inspector.innerHTML =
        '<header class="window-head"><h2></h2><button class="window-collapse" aria-label="折叠动画设置"></button><button class="window-close" aria-label="关闭动画设置"></button></header><div class="window-body"></div>';
      document.body.append(inspector);
      float = floatingPanel(inspector, {
        titleHandle: inspector.querySelector('header'),
        collapseButton: inspector.querySelector('.window-collapse'),
        closeButton: inspector.querySelector('.window-close'),
        onClose: () => {
          panelCleanup?.();
          panelCleanup = null;
          if (!gesture && !timelineCancel) {
            draft = null;
            host.render();
          }
          // The exiting surface stays visible for its animation, but owns no live control IDs.
          for (const el of [inspector, ...inspector.querySelectorAll('[id]')])
            el.removeAttribute('id');
          inspector = null;
          float = null;
          panelState = null;
        },
      });
    }
    renderPanel();
    float?.raise();
    float?.clamp();
  }
  function renderPanel() {
    if (!inspector || !panelState) return;
    panelCleanup?.();
    panelCleanup = null;
    const body = inspector.querySelector('.window-body'),
      top = body.scrollTop,
      s = scene(),
      o = object(),
      kind = panelState.kind;
    inspector.querySelector('h2').textContent = {
      create: '创建动画对象',
      object: o?.name || '对象',
      curve: '运动进度',
      effects: '区间效果',
      scene: '场景设置',
      bake: '烘焙到逐帧动画',
    }[kind];
    const $ = (selector) => body.querySelector(selector),
      on = (selector, fn) => ($(selector).onclick = fn);
    if (kind === 'create') {
      const p = host.project();
      body.innerHTML = `<label>对象名称<input id="scene-object-name" maxlength="80" value="对象 ${s.objects.length + 1}"></label><p class="help">来源：场景底图帧。勾选一个或多个图层；图层组会包含组内内容。</p><div class="scene-source-list">${p.layers.map((l, i) => `<label><input type="checkbox" data-source-layer="${i}" ${i === host.layer() ? 'checked' : ''}><span style="padding-left:${(l.level || 0) * 10}px">${l.group ? '▸ ' : ''}${esc(l.name)}</span></label>`).join('')}</div><label class="switch">仅使用当前选区<input id="scene-use-selection" type="checkbox" ${sourceSelection ? 'checked' : 'disabled'}></label><p class="help">创建引用，不改动源像素。对象内部保留来源效果；场景把对象按轨道顺序叠加在剩余底图上。重复来源会被阻止。</p><button id="scene-create" class="primary panel-wide">创建对象</button>`;
      on('#scene-create', () =>
        safely(() => {
          const indices = [...body.querySelectorAll('[data-source-layer]:checked')].map(
              (b) => +b.dataset.sourceLayer,
            ),
            mask = $('#scene-use-selection').checked ? sourceSelection : null,
            name = $('#scene-object-name').value;
          host.editProject((p) => {
            ensureSourceIds(p);
            const next = createObject(p, p.procedural, indices, mask, name);
            p.procedural.objects.push(next);
            selected = next.id;
          });
          setMode('draw');
          openPanel('object');
        }),
      );
    } else if (kind === 'object' && o) {
      const state = objectState(o, time);
      body.innerHTML = `<label>名称<input id="scene-rename" maxlength="80" value="${esc(o.name)}"></label><div class="scene-two"><button id="scene-solo" aria-pressed="${solo === o.id}">单对象预览</button><button id="scene-rename-source">重新指定来源</button><button id="scene-order-up">向前一层</button><button id="scene-order-down">向后一层</button></div><div class="scene-two"><label>运动开始 / 秒<input id="motion-start" type="number" min="0" max="${s.duration}" step="${1 / s.fps}" value="${round(o.motion.start)}"></label><label>运动结束 / 秒<input id="motion-end" type="number" min="0" max="${s.duration}" step="${1 / s.fps}" value="${round(o.motion.end)}"></label></div><label>沿路径重复次数<input id="motion-repeat" type="number" min="1" max="20" value="${o.motion.repeat}"></label><label class="switch">朝向随路径转动<input id="motion-orient" type="checkbox" ${o.motion.orient ? 'checked' : ''}></label><div class="scene-two"><button id="scene-extend">延伸路径</button><button id="scene-simplify">简化路径</button></div><h3 id="scene-current-time">当前时刻 · ${time.toFixed(3)} s</h3><p class="help">修改下列数值会在当前时刻写入关键帧；画布上的圆柄旋转、方柄拉伸、菱形移动轴心。</p><div class="scene-two">${[
        ['rotation', '旋转 °', -36000, 36000, 1, 0],
        ['scaleX', '横向比例', 0.05, 20, 0.05, 1],
        ['scaleY', '纵向比例', 0.05, 20, 0.05, 1],
        ['opacity', '不透明度', 0, 1, 0.05, 1],
      ]
        .map(
          ([key, label, min, max, step, fallback]) =>
            `<label>${label}<input data-scene-value="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${round(curveValue(o.tracks[key], time, fallback))}"></label>`,
        )
        .join(
          '',
        )}</div><div class="scene-two"><button id="scene-key-add">记录当前姿态</button><button id="scene-key-remove">删除此时刻关键帧</button></div><p class="help">预览位置 ${state.x.toFixed(1)}, ${state.y.toFixed(1)} · ${o.path.length} 个路径控制点</p><button id="scene-remove-object" class="danger panel-wide">移除动画对象</button>`;
      $('#scene-rename').onchange = (e) =>
        editObject((v) => (v.name = e.target.value.trim().slice(0, 80) || v.name));
      on('#scene-solo', () => {
        solo = solo === o.id ? null : o.id;
        renderPanel();
        host.render();
      });
      on('#scene-rename-source', () => {
        panelState = { kind: 'source' };
        sourcePanel(body, o);
      });
      for (const [selector, delta] of [
        ['#scene-order-up', 1],
        ['#scene-order-down', -1],
      ])
        on(selector, () =>
          editObject((v, n) => {
            const i = n.objects.indexOf(v),
              j = clamp(i + delta, 0, n.objects.length - 1);
            n.objects.splice(i, 1);
            n.objects.splice(j, 0, v);
          }),
        );
      for (const part of ['start', 'end', 'repeat'])
        $('#motion-' + part).onchange = (e) =>
          editObject((v) => (v.motion[part] = Number(e.target.value)));
      $('#motion-orient').onchange = (e) => editObject((v) => (v.motion.orient = e.target.checked));
      on('#scene-extend', () => {
        setMode('extend');
        float?.close();
        host.toast('从路径末端继续画，抬笔完成延伸');
      });
      on('#scene-simplify', () =>
        editObject((v) => {
          if (v.path.length > 2)
            v.path = fitPath(
              v.path.map(({ x, y }) => ({ x, y })),
              2,
            );
        }),
      );
      body
        .querySelectorAll('[data-scene-value]')
        .forEach(
          (input) =>
            (input.onchange = (e) =>
              editObject((v) =>
                setTransformKey(v.tracks, input.dataset.sceneValue, time, Number(e.target.value)),
              )),
        );
      on('#scene-key-add', () =>
        editObject((v) => {
          for (const [key, fallback] of [
            ['rotation', 0],
            ['scaleX', 1],
            ['scaleY', 1],
            ['opacity', 1],
          ])
            setTransformKey(v.tracks, key, time, curveValue(v.tracks[key], time, fallback));
        }),
      );
      on('#scene-key-remove', () =>
        editObject((v) => {
          for (const key of Object.keys(v.tracks))
            v.tracks[key] = v.tracks[key].filter((k) => Math.abs(k.t - time) > 0.0001);
        }),
      );
      on('#scene-remove-object', async () => {
        if (
          await host.ask({
            title: `移除「${o.name}」的动画？`,
            description: '原始绘画和已有烘焙帧保留。可以撤销。',
            confirm: '移除对象',
          })
        )
          editObject((v, n) => {
            n.objects = n.objects.filter((item) => item.id !== v.id);
            selected = n.objects[0]?.id;
          });
      });
    } else if (kind === 'curve' && o) {
      body.innerHTML =
        '<p class="help">横轴是运动区间内的时间，纵轴是沿路径的进度。调整速度不会改变路径。</p><div id="scene-curve-editor"></div>';
      panelCleanup = curveEditor($('#scene-curve-editor'), o.progress, {
        commit: (keys) => curveCommit((v) => (v.progress = structuredClone(keys))),
        preview: (keys) => {
          const n = structuredClone(host.project().procedural);
          n.objects.find((v) => v.id === o.id).progress = structuredClone(keys);
          preview(n);
        },
        cancel: () => {
          draft = null;
          host.render();
        },
      });
    } else if (kind === 'effects' && o) {
      effectPanel(body, o, panelState.clipId);
    } else if (kind === 'scene') {
      const p = host.project();
      body.innerHTML = `<label>场景名称<input id="scene-name" maxlength="160" value="${esc(s.name)}"></label><div class="scene-two"><label>总时长 / 秒<input id="scene-duration" type="number" min="0.1" max="60" step="0.1" value="${s.duration}"></label><label>帧率<input id="scene-fps" type="number" min="1" max="50" value="${s.fps}"></label><label>播放起点 / 秒<input id="scene-range-start" type="number" min="0" step="${1 / s.fps}" value="${s.range[0]}"></label><label>播放终点 / 秒<input id="scene-range-end" type="number" min="0" step="${1 / s.fps}" value="${s.range[1]}"></label></div><label>场景底图来源帧<select id="scene-base">${p.frames.map((f, i) => `<option value="${esc(f.id || '')}" ${s.baseFrameId === f.id ? 'selected' : ''}>第 ${i + 1} 帧</option>`).join('')}</select></label><button id="scene-save-settings" class="primary panel-wide">应用场景设置</button><p class="help">播放与烘焙按帧对齐，区间包含起点、不重复终点。对象的关键帧使用秒；调整帧率不改变运动速度。</p><p class="help">${s.objects.length} / ${SCENE_LIMITS.objects} 个对象 · 动作数据 ${mebibytes(sceneBytes(s))} / 4 MiB · 预览缓存 ${mebibytes(prepare()?.bytes || 0)} / 32 MiB。烘焙仍遵守整个作品的图层、帧与像素容量限制。</p>`;
      on('#scene-save-settings', () =>
        edit((n) => {
          n.name = $('#scene-name').value.slice(0, 160);
          n.duration = +$('#scene-duration').value;
          n.fps = +$('#scene-fps').value;
          n.range = [+$('#scene-range-start').value, +$('#scene-range-end').value];
          n.baseFrameId = $('#scene-base').value;
          time = Math.min(time, n.duration);
          range = [0, n.duration];
        }),
      );
    } else if (kind === 'bake') {
      bakePanel(body);
    } else if (kind === 'source' && o) {
      sourcePanel(body, o);
    } else body.innerHTML = '<p class="help">从时间轴或画布选择对象后继续。</p>';
    if (o?.locked && ['object', 'curve', 'effects', 'source'].includes(kind)) {
      for (const control of body.querySelectorAll('input,select,button'))
        if (control.id !== 'scene-solo' && !control.hasAttribute('data-edit-effect'))
          control.disabled = true;
      for (const graph of body.querySelectorAll('.scene-curve')) {
        graph.style.pointerEvents = 'none';
        graph
          .querySelectorAll('[tabindex]')
          .forEach((point) => point.setAttribute('tabindex', '-1'));
      }
    }
    body.scrollTop = top;
    float?.clamp();
  }
  function sourcePanel(body, o) {
    const p = host.project();
    inspector.querySelector('h2').textContent = '重新指定来源';
    body.innerHTML = `<p class="help">重新选择来源，保留路径、时间和效果。对象轴心更新到新来源中心。</p><label>来源帧<select id="scene-source-frame">${p.frames.map((f, i) => `<option value="${i}" ${f.id === o.source.frameId ? 'selected' : ''}>第 ${i + 1} 帧</option>`).join('')}</select></label><div class="scene-source-list">${p.layers.map((l, i) => `<label><input type="checkbox" data-source-layer="${i}" ${o.source.layerIds.includes(l.id) ? 'checked' : ''}><span>${esc(l.name)}</span></label>`).join('')}</div><label class="switch">仅使用当前选区<input id="scene-source-selection" type="checkbox" ${sourceSelection ? 'checked' : 'disabled'}></label><button id="scene-replace-source" class="primary panel-wide">更新来源引用</button>`;
    body.querySelector('#scene-replace-source').onclick = () =>
      safely(() => {
        if (o.locked) throw Error('请先解锁对象');
        const indices = [...body.querySelectorAll('[data-source-layer]:checked')].map(
            (b) => +b.dataset.sourceLayer,
          ),
          f = +body.querySelector('#scene-source-frame').value,
          mask = body.querySelector('#scene-source-selection').checked ? sourceSelection : null;
        host.editProject((p) => {
          ensureSourceIds(p);
          const old = p.procedural.objects.find((v) => v.id === o.id),
            created = createObject(
              p,
              {
                ...p.procedural,
                baseFrameId: p.frames[f].id,
                objects: p.procedural.objects.filter((v) => v.id !== o.id),
              },
              indices,
              mask,
              o.name,
            );
          old.source = created.source;
          old.origin = created.origin;
        });
        openPanel('object');
      });
  }
  function effectPanel(body, o, clipId) {
    const s = scene(),
      clip = o.clips.find((c) => c.id === clipId),
      $ = (sel) => body.querySelector(sel);
    body.innerHTML = `<p class="help">作用区间 ${range[0].toFixed(2)}–${range[1].toFixed(2)} s。在轨道空白拖选，或使用「时间点」点击路径上的两点。</p><div class="scene-effect-types">${Object.entries(
      effectNames,
    )
      .map(([type, name]) => `<button data-add-effect="${type}">＋ ${name}</button>`)
      .join(
        '',
      )}</div><p class="help">旋转与震动相加；拉伸、压扁和透明度相乘。区间外恢复基础轨道，不互相覆盖。</p><div class="scene-effect-list">${o.clips.map((c) => `<button data-edit-effect="${c.id}" class="${c.id === clipId ? 'active' : ''}">${effectNames[c.type]} · ${c.start.toFixed(2)}–${c.end.toFixed(2)} s</button>`).join('')}</div><div id="scene-effect-fields"></div>`;
    body.querySelectorAll('[data-add-effect]').forEach(
      (b) =>
        (b.onclick = () => {
          const id = uid(),
            type = b.dataset.addEffect;
          panelState.clipId = id;
          editObject((v) => {
            if (v.clips.length >= SCENE_LIMITS.clips) throw Error('效果区间数量已达上限');
            const start = clamp(range[0], 0, s.duration - 1 / s.fps),
              end = clamp(range[1], start + 1 / s.fps, s.duration);
            v.clips.push({
              id,
              type,
              start,
              end,
              enabled: true,
              intensity: 1,
              curve: structuredClone(type === 'fade' ? CURVES.linear : CURVES.pulse),
              blend: ['rotate', 'shake'].includes(type) ? 'add' : 'multiply',
              params: {
                angle: 180,
                x: type === 'squash' ? 1.5 : 1.2,
                y: type === 'squash' ? 0.55 : 1.5,
                opacity: 0,
                amplitude: 3,
                frequency: 8,
              },
            });
          });
        }),
    );
    body
      .querySelectorAll('[data-edit-effect]')
      .forEach((b) => (b.onclick = () => openPanel('effects', b.dataset.editEffect)));
    if (!clip) return;
    const fields = $('#scene-effect-fields');
    fields.innerHTML = `<h3>${effectNames[clip.type]}</h3><label class="switch">启用此效果<input id="effect-enabled" type="checkbox" ${clip.enabled ? 'checked' : ''}></label><div class="scene-two"><label>开始 / 秒<input id="effect-start" type="number" min="0" max="${s.duration}" step="${1 / s.fps}" value="${round(clip.start)}"></label><label>结束 / 秒<input id="effect-end" type="number" min="0" max="${s.duration}" step="${1 / s.fps}" value="${round(clip.end)}"></label></div><label>强度<input id="effect-intensity" type="range" min="0" max="2" step="0.05" value="${clip.intensity}"></label><div class="scene-two">${{
      rotate: [['angle', '旋转角度', -3600, 3600, 1]],
      stretch: [
        ['x', '横向比例', 0.05, 4, 0.05],
        ['y', '纵向比例', 0.05, 4, 0.05],
      ],
      squash: [
        ['x', '横向比例', 0.05, 4, 0.05],
        ['y', '纵向比例', 0.05, 4, 0.05],
      ],
      fade: [['opacity', '目标不透明度', 0, 1, 0.05]],
      shake: [
        ['amplitude', '振幅 / 像素', 0, 256, 0.5],
        ['frequency', '频率 / Hz', 0, 50, 0.5],
      ],
    }[clip.type]
      .map(
        ([key, name, min, max, step]) =>
          `<label>${name}<input data-effect-param="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${clip.params[key]}"></label>`,
      )
      .join(
        '',
      )}</div><div id="effect-curve"></div><div class="scene-two"><button id="effect-copy">复制区间</button><button id="effect-remove" class="danger">删除区间</button></div>`;
    const change = (fn) => editObject((v) => fn(v.clips.find((c) => c.id === clip.id)));
    $('#effect-intensity').oninput = (e) => {
      const next = structuredClone(host.project().procedural);
      next.objects.find((v) => v.id === o.id).clips.find((c) => c.id === clip.id).intensity =
        +e.target.value;
      preview(next);
    };
    $('#effect-intensity').onpointercancel = () => {
      draft = null;
      renderPanel();
      host.render();
    };
    $('#effect-enabled').onchange = (e) => change((c) => (c.enabled = e.target.checked));
    for (const key of ['start', 'end', 'intensity'])
      $('#effect-' + key).onchange = (e) => change((c) => (c[key] = +e.target.value));
    fields
      .querySelectorAll('[data-effect-param]')
      .forEach(
        (input) =>
          (input.onchange = (e) =>
            change((c) => (c.params[input.dataset.effectParam] = +e.target.value))),
      );
    $('#effect-copy').onclick = () => {
      const id = uid();
      panelState.clipId = id;
      editObject((v) => v.clips.push({ ...structuredClone(clip), id }));
    };
    $('#effect-remove').onclick = () => {
      panelState.clipId = null;
      editObject((v) => (v.clips = v.clips.filter((c) => c.id !== clip.id)));
    };
    panelCleanup = curveEditor($('#effect-curve'), clip.curve, {
      label: '效果强度',
      commit: (keys) =>
        curveCommit((v) => (v.clips.find((c) => c.id === clip.id).curve = structuredClone(keys))),
      preview: (keys) => {
        const next = structuredClone(host.project().procedural);
        next.objects.find((v) => v.id === o.id).clips.find((c) => c.id === clip.id).curve =
          structuredClone(keys);
        preview(next);
      },
      cancel: () => {
        draft = null;
        host.render();
      },
    });
  }
  function bakePanel(body) {
    const s = scene(),
      $ = (sel) => body.querySelector(sel);
    body.innerHTML = `<p class="help">将区间 ${s.range[0].toFixed(2)}–${s.range[1].toFixed(2)} s 转为逐帧像素。路径和控制点不会进入结果。</p><label>输出方式<select id="scene-bake-mode"><option value="objects">分对象 · 独立图层组</option><option value="composite">完整合成帧</option></select></label><label>保存位置<select id="scene-bake-policy"><option value="new">新建烘焙组和帧 · 保留所有精修</option><option value="replace" ${s.bakes.length ? '' : 'disabled'}>替换上次生成内容 · 保留额外精修层</option></select></label><p id="scene-bake-capacity" class="help"></p><button id="scene-bake-confirm" class="primary panel-wide">生成像素帧</button><p class="help">默认保留源绘画、旧烘焙和人工修改。新结果进入现有时间轴，可继续用画笔精修。要保留可编辑动作，请保存 .pixel 工程。</p><div class="scene-two"><button id="scene-export-gif" ${s.bakes.length ? '' : 'disabled'}>上次烘焙 · GIF</button><button id="scene-export-sheet" ${s.bakes.length ? '' : 'disabled'}>上次烘焙 · 精灵图</button></div><p class="help">这些导出仅包含上次烘焙的帧，并包含该帧上的人工精修。传统文件保留像素结果，动作数据保存在 .pixel 中。</p>`;
    const options = () => ({
      mode: $('#scene-bake-mode').value,
      replace: $('#scene-bake-policy').value === 'replace',
    });
    const estimate = () => {
      try {
        const plan = bakePlan(host.project(), s, options());
        $('#scene-bake-capacity').textContent =
          `${plan.samples.length} 个采样帧 · 完成后 ${plan.layers} 层 / ${plan.frames} 帧 · 像素占用 ${mebibytes(plan.bytes)}`;
        $('#scene-bake-confirm').disabled = false;
      } catch (e) {
        $('#scene-bake-capacity').textContent = e.message;
        $('#scene-bake-confirm').disabled = true;
      }
    };
    $('#scene-bake-mode').onchange = $('#scene-bake-policy').onchange = estimate;
    estimate();
    $('#scene-bake-confirm').onclick = async () => {
      const opts = options();
      if (
        opts.replace &&
        !(await host.ask({
          title: '覆盖上次烘焙？',
          description:
            '将替换上次生成的像素和烘焙图层设置，这些层内的人工修改也会被覆盖。额外添加的精修层保留。可撤销整个操作。',
          confirm: '确认覆盖',
          danger: true,
        }))
      )
        return;
      pause();
      busy = true;
      const d = document.createElement('dialog');
      d.id = 'scene-bake-progress';
      d.innerHTML =
        '<h2>正在生成动画帧</h2><progress max="1" value="0"></progress><p></p><button>取消烘焙</button>';
      document.body.append(d);
      const controller = new AbortController();
      d.querySelector('button').onclick = () => controller.abort();
      d.oncancel = (e) => {
        e.preventDefault();
        controller.abort();
      };
      await showDialog(d);
      try {
        const result = await bakeScene(
          host.project(),
          s,
          { ...opts, signal: controller.signal },
          (n, total) => {
            d.querySelector('progress').value = n / total;
            d.querySelector('p').textContent = `${n} / ${total} 帧`;
          },
        );
        await hideDialog(d);
        leave();
        host.commitBake(result);
        host.toast('烘焙完成，可在现有时间轴逐帧精修；原始动作仍可编辑');
      } catch (e) {
        host.toast(e.message);
      } finally {
        busy = false;
        await hideDialog(d);
        d.remove();
      }
    };
    const baked = () => {
      const p = host.project(),
        last = p.procedural.bakes.at(-1),
        frames = last.frameIds.map((id) => p.frames.find((f) => f.id === id));
      if (frames.some((f) => !f)) throw Error('上次烘焙帧已删除，请先重新生成');
      return { ...p, tags: [], procedural: undefined, frames };
    };
    $('#scene-export-gif').onclick = async () => {
      try {
        const { encodeGif } = await import('./gif.js');
        host.download(encodeGif(baked()), '-场景.gif', 'image/gif');
      } catch (e) {
        host.toast(e.message);
      }
    };
    $('#scene-export-sheet').onclick = () =>
      safely(() => {
        const p = baked();
        if (p.w * p.frames.length > 16384) throw Error('精灵图过宽，请用 GIF 或缩短烘焙区间');
        const canvas = document.createElement('canvas');
        canvas.width = p.w * p.frames.length;
        canvas.height = p.h;
        const ctx = canvas.getContext('2d');
        p.frames.forEach((_, i) =>
          ctx.putImageData(new ImageData(composite(p, i), p.w, p.h), i * p.w, 0),
        );
        canvas.toBlob((b) => {
          if (b) host.download(b, '-场景.png', 'image/png');
        });
      });
  }
  function handles(o, s, texture, scale) {
    const corners = objectCorners(o, s, texture),
      mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
      top = mid(corners[0], corners[1]),
      bottom = mid(corners[2], corners[3]),
      a = (s.rotation * Math.PI) / 180;
    return {
      origin: { x: s.x, y: s.y },
      rotate: { x: top.x + (Math.sin(a) * 22) / scale, y: top.y - (Math.cos(a) * 22) / scale },
      scaleXY: corners[2],
      scaleX: mid(corners[1], corners[2]),
      scaleY: bottom,
      opacity: { x: bottom.x, y: bottom.y + 26 / scale },
    };
  }
  function samples(o, scale) {
    const length = o.path.reduce(
        (n, p, i) => (i ? n + Math.hypot(p.x - o.path[i - 1].x, p.y - o.path[i - 1].y) : n),
        0,
      ),
      count = clamp(Math.round((length * scale) / 46) + 1, 3, 13);
    return Array.from({ length: count }, (_, i) => {
      const t = snap((i / (count - 1)) * scene().duration),
        s = objectState(o, t);
      return { x: s.x, y: s.y, time: t };
    });
  }
  function hit(o, p) {
    const tex = prepare()?.objects.get(o.id);
    if (!tex?.w || !o.visible) return false;
    const s = objectState(o, time),
      a = (s.rotation * Math.PI) / 180,
      c = Math.cos(a),
      n = Math.sin(a),
      dx = p.x - s.x,
      dy = p.y - s.y,
      x = Math.floor((dx * c + dy * n) / s.scaleX + o.origin.x - tex.x),
      y = Math.floor((-dx * n + dy * c) / s.scaleY + o.origin.y - tex.y);
    return x >= 0 && y >= 0 && x < tex.w && y < tex.h && tex.pixels[(y * tex.w + x) * 4 + 3] > 0;
  }
  function begin(e, p) {
    if (!active || busy) return;
    pause();
    const o = object(),
      scale = host.scale(),
      near = (q) => Math.hypot(q.x - p.x, q.y - p.y) < 10 / scale;
    if (o && mode === 'range') {
      const sample = samples(o, scale).find(near);
      if (sample) {
        time = sample.time;
        if (rangeFirst === null) {
          rangeFirst = time;
          host.toast('已选起点，再点一个圆形时间点确定区间');
        } else {
          range = [Math.min(rangeFirst, time), Math.max(rangeFirst, time)];
          rangeFirst = null;
          openPanel('effects');
        }
        updateClock();
        renderRows();
        host.render();
        return;
      }
    }
    if (o && !o.locked && ['draw', 'extend'].includes(mode)) {
      gesture = {
        kind: 'path',
        start: p,
        raw: [mode === 'extend' ? { ...o.path.at(-1) } : { ...o.origin }, p],
        before: structuredClone(scene()),
        id: o.id,
      };
      host.render();
      return;
    }
    if (o && !o.locked && mode === 'edit') {
      for (let i = 0; i < o.path.length; i++)
        for (const part of ['node', 'in', 'out']) {
          const q = part === 'node' ? o.path[i] : o.path[i][part];
          if (!near(q)) continue;
          gesture = {
            kind: 'node',
            index: i,
            part,
            start: p,
            before: structuredClone(scene()),
            id: o.id,
          };
          draft = structuredClone(scene());
          return;
        }
    }
    if (o && !o.locked && mode === 'transform') {
      const tex = prepare()?.objects.get(o.id),
        s = objectState(o, time);
      if (tex?.w) {
        for (const [kind, point] of Object.entries(handles(o, s, tex, scale)))
          if (near(point)) {
            gesture = {
              kind,
              start: p,
              before: structuredClone(scene()),
              id: o.id,
              state: s,
              handle: point,
            };
            draft = structuredClone(scene());
            return;
          }
      }
    }
    const picked = [...scene().objects].reverse().find((v) => hit(v, p));
    if (picked) {
      select(picked.id);
      if (!picked.locked) {
        gesture = { kind: 'move', start: p, before: structuredClone(scene()), id: picked.id };
        draft = structuredClone(scene());
      }
    } else if (o) {
      const sample = samples(o, scale).find(near);
      if (sample) seek(sample.time);
    }
  }
  function translatePath(path, dx, dy) {
    for (const n of path)
      for (const p of [n, n.in, n.out]) {
        p.x += dx;
        p.y += dy;
      }
  }
  function move(e, p) {
    if (!gesture) return;
    p = { x: clamp(p.x, -4096, 8192), y: clamp(p.y, -4096, 8192) };
    const g = gesture,
      dx = p.x - g.start.x,
      dy = p.y - g.start.y;
    if (g.kind === 'path') {
      if (Math.hypot(p.x - g.raw.at(-1).x, p.y - g.raw.at(-1).y) > 1 / host.scale()) {
        g.raw.push(p);
        if (g.raw.length > 2048) g.raw = g.raw.filter((_, i) => i % 2 === 0);
      }
      host.render();
      return;
    }
    draft = structuredClone(g.before);
    const o = draft.objects.find((v) => v.id === g.id),
      old = g.before.objects.find((v) => v.id === g.id);
    if (g.kind === 'move') translatePath(o.path, dx, dy);
    else if (g.kind === 'node') {
      const n = o.path[g.index];
      if (g.part === 'node')
        for (const q of [n, n.in, n.out]) {
          q.x += dx;
          q.y += dy;
        }
      else {
        n[g.part].x += dx;
        n[g.part].y += dy;
      }
    } else if (g.kind === 'opacity')
      setTransformKey(
        o.tracks,
        'opacity',
        time,
        clamp(curveValue(old.tracks.opacity, time, 1) + (dx * host.scale()) / 80, 0, 1),
      );
    else {
      const s = g.state,
        a = (s.rotation * Math.PI) / 180,
        c = Math.cos(a),
        n = Math.sin(a);
      if (g.kind === 'origin') {
        o.origin.x += (dx * c + dy * n) / s.scaleX;
        o.origin.y += (-dx * n + dy * c) / s.scaleY;
        translatePath(o.path, dx, dy);
      }
      if (g.kind === 'rotate') {
        const delta =
          Math.atan2(p.y - s.y, p.x - s.x) - Math.atan2(g.start.y - s.y, g.start.x - s.x);
        setTransformKey(
          o.tracks,
          'rotation',
          time,
          clamp(curveValue(old.tracks.rotation, time, 0) + (delta * 180) / Math.PI, -36000, 36000),
        );
      }
      if (g.kind.startsWith('scale')) {
        const sx = (g.start.x - s.x) * c + (g.start.y - s.y) * n,
          sy = -(g.start.x - s.x) * n + (g.start.y - s.y) * c,
          nx = (p.x - s.x) * c + (p.y - s.y) * n,
          ny = -(p.x - s.x) * n + (p.y - s.y) * c;
        if (g.kind !== 'scaleY' && Math.abs(sx) > 0.001)
          setTransformKey(
            o.tracks,
            'scaleX',
            time,
            clamp(curveValue(old.tracks.scaleX, time, 1) * Math.abs(nx / sx), 0.05, 20),
          );
        if (g.kind !== 'scaleX' && Math.abs(sy) > 0.001)
          setTransformKey(
            o.tracks,
            'scaleY',
            time,
            clamp(curveValue(old.tracks.scaleY, time, 1) * Math.abs(ny / sy), 0.05, 20),
          );
      }
    }
    host.render();
  }
  function end(cancel = false) {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    if (g.kind === 'path' && !cancel && g.raw.length > 2) {
      draft = structuredClone(g.before);
      const o = draft.objects.find((v) => v.id === g.id),
        nodes = fitPath(g.raw, Math.max(0.5, 1.5 / host.scale()));
      if (mode === 'extend') {
        o.path = [...o.path, ...nodes.slice(1)];
        if (o.path.length > 64) o.path = fitPath(o.path, 2);
      } else o.path = nodes;
      setMode('edit');
    }
    if (draft && JSON.stringify(draft) === JSON.stringify(g.before)) draft = null;
    commitDraft(cancel);
    host.render();
  }
  function draw(ctx, scale) {
    if (!active) return;
    const c = prepare();
    if (!c) return;
    const o = object();
    if (!o) return;
    const s = objectState(o, time),
      tex = c.objects.get(o.id),
      color = COLORS[scene().objects.indexOf(o) % COLORS.length];
    ctx.save();
    ctx.lineWidth = 1.5 / scale;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.font = `${11 / scale}px system-ui`;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(o.path[0].x, o.path[0].y);
    for (let i = 1; i < o.path.length; i++) {
      const a = o.path[i - 1],
        b = o.path[i];
      ctx.bezierCurveTo(a.out.x, a.out.y, b.in.x, b.in.y, b.x, b.y);
    }
    ctx.stroke();
    if (gesture?.kind === 'path') {
      ctx.beginPath();
      gesture.raw.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
    if (tex?.w) {
      const corners = objectCorners(o, s, tex);
      ctx.setLineDash([4 / scale, 3 / scale]);
      ctx.beginPath();
      corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(o.name + (o.locked ? ' · 锁定' : ''), corners[0].x, corners[0].y - 8 / scale);
    }
    for (const p of samples(o, scale)) {
      ctx.fillStyle = Math.abs(p.time - time) < 1 / scene().fps ? '#fff' : color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (mode === 'range' ? 5 : 3) / scale, 0, Math.PI * 2);
      ctx.fill();
      if (mode === 'range') ctx.fillText(p.time.toFixed(1), p.x + 7 / scale, p.y - 7 / scale);
    }
    if (mode === 'edit' && !o.locked)
      for (const n of o.path) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(n.in.x, n.in.y);
        ctx.lineTo(n.x, n.y);
        ctx.lineTo(n.out.x, n.out.y);
        ctx.stroke();
        for (const p of [n.in, n.out]) {
          ctx.fillStyle = '#292b32';
          ctx.fillRect(p.x - 3 / scale, p.y - 3 / scale, 6 / scale, 6 / scale);
          ctx.strokeRect(p.x - 3 / scale, p.y - 3 / scale, 6 / scale, 6 / scale);
        }
        ctx.fillStyle = color;
        ctx.fillRect(n.x - 5 / scale, n.y - 5 / scale, 10 / scale, 10 / scale);
      }
    if (mode === 'transform' && tex?.w && !o.locked) {
      for (const [kind, p] of Object.entries(handles(o, s, tex, scale))) {
        ctx.fillStyle = '#25272e';
        ctx.strokeStyle = color;
        ctx.beginPath();
        if (kind === 'rotate') ctx.arc(p.x, p.y, 6 / scale, 0, Math.PI * 2);
        else if (kind === 'origin') {
          ctx.moveTo(p.x, p.y - 7 / scale);
          ctx.lineTo(p.x + 7 / scale, p.y);
          ctx.lineTo(p.x, p.y + 7 / scale);
          ctx.lineTo(p.x - 7 / scale, p.y);
          ctx.closePath();
        } else ctx.rect(p.x - 5 / scale, p.y - 5 / scale, 10 / scale, 10 / scale);
        ctx.fill();
        ctx.stroke();
        if (kind === 'opacity') {
          ctx.fillStyle = color;
          ctx.fillText(`α ${Math.round(s.opacity * 100)}%`, p.x + 9 / scale, p.y + 4 / scale);
        }
      }
    }
    ctx.restore();
  }
  function enter() {
    if (busy) return;
    if (active) {
      leave();
      return;
    }
    sourceSelection = host.selection() ? new Uint8Array(host.selection()) : null;
    host.enter();
    if (!host.project().procedural)
      host.editProject((p) => (p.procedural = createScene(p, host.frame())));
    else if ([...host.project().layers, ...host.project().frames].some((item) => !item.id))
      host.editProject((p) => ensureSourceIds(p));
    active = true;
    draft = null;
    time = 0;
    range = [...scene().range];
    selected = scene().objects[0]?.id || null;
    lastScene = scene();
    lastRevision = host.revision();
    root.hidden = false;
    document.body.classList.add('procedural-active');
    setMode('select');
    renderRows();
    prepare();
    host.resize();
    host.render();
    if (!scene().objects.length) openPanel('create');
  }
  function leave() {
    pause();
    end(true);
    timelineCancel?.();
    active = false;
    draft = null;
    solo = null;
    root.hidden = true;
    document.body.classList.remove('procedural-active');
    float?.close();
    host.resize();
    host.render();
  }
  function sync() {
    if (!active) return;
    if (!host.project().procedural) {
      leave();
      return;
    }
    if (lastScene !== host.project().procedural || lastRevision !== host.revision()) {
      pause();
      timelineCancel?.();
      gesture = null;
      draft = null;
      lastScene = host.project().procedural;
      lastRevision = host.revision();
      time = clamp(time, 0, scene().duration);
      if (!object()) selected = scene().objects[0]?.id || null;
      renderRows();
      if (!panelEditing) renderPanel();
    }
  }
  const togglePanel = (kind) => (panelState?.kind === kind ? float?.close() : openPanel(kind));
  q('#scene-add').onclick = () => togglePanel('create');
  q('#scene-settings').onclick = () => togglePanel('scene');
  q('#scene-curve').onclick = () => togglePanel('curve');
  q('#scene-effects').onclick = () => togglePanel('effects');
  q('#scene-bake').onclick = () => togglePanel('bake');
  q('#scene-undo').onclick = () => {
    timelineCancel?.();
    end(true);
    host.undo();
  };
  q('#scene-redo').onclick = () => {
    timelineCancel?.();
    end(true);
    host.redo();
  };
  q('#scene-exit').onclick = leave;
  q('#scene-play').onclick = play;
  q('#scene-prev').onclick = () => seek(time - 1 / scene().fps);
  q('#scene-next').onclick = () => seek(time + 1 / scene().fps);
  q('#scene-scrub').oninput = (e) => seek(+e.target.value);
  q('#scene-loop').onclick = () => edit((s) => (s.loop = !s.loop));
  root.querySelectorAll('[data-scene-mode]').forEach(
    (b) =>
      (b.onclick = () => {
        setMode(b.dataset.sceneMode);
        if (mode === 'range') host.toast('圆点定位时间；点击两点选择效果区间。方点用于编辑路径。');
      }),
  );
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
  return {
    get active() {
      return active;
    },
    get time() {
      return time;
    },
    enter,
    leave,
    sync,
    begin,
    move,
    end,
    draw,
    pause,
    pixels() {
      const c = prepare();
      return c
        ? evaluateScene(c, scene(), time, { solo })
        : composite(host.project(), host.frame());
    },
    key(e) {
      if (!active) return false;
      if (e.code === 'Space') {
        e.preventDefault();
        play();
        return true;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        seek(time + (e.key === 'ArrowLeft' ? -1 : 1) / scene().fps);
        return true;
      }
      if (e.key === 'Escape' && gesture) {
        end(true);
        return true;
      }
      return false;
    },
  };
}
