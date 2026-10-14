import { readCel, compactProject } from './cel-storage.js';
import { loadPixelFont, renderPixelText } from './pixel-type.js';
import { rectangleQuad, warpPixels } from './perspective.js';
import { outlinePixels } from './pixel-outline.js';
import { transformPixels } from './editor-transform.js';
import { blank, clone, validate, rgba } from './engine.js';
import { LIMITS, projectUsage } from './limits.js';
import {
  addLayer,
  moveLayer,
  deleteLayer,
  editFrames,
  setDurations,
  layerLocked,
} from './animation-edit.js';
import { duplicateLayer, dropLayer, mergeLayers, mergeUp } from './layer-actions.js';
import { expandCanvas } from './canvas-resize.js';
import {
  createScene,
  ensureSourceIds,
  pathNode,
  uid,
  linearCurve,
  SCENE_LIMITS,
} from './procedural-model.js';
import { createObject, bakeScene, bakePlan } from './procedural.js';
import { drawBatch, assertBox } from './editor-drawing.js';
import { EDITOR_TOOLS, validateInput } from './editor-schema.js';

const fail = (code, message) => {
  throw Object.assign(Error(message), { code });
};
const abort = (signal) => {
  if (signal?.aborted) fail('CANCELLED', '操作已取消，未提交修改');
};
function references(p) {
  if (!p.procedural) return;
  const frame = (id) => p.frames.some((f) => f.id === id);
  if (
    !frame(p.procedural.baseFrameId) ||
    p.procedural.objects.some(
      (o) =>
        !frame(o.source.frameId) ||
        o.source.layerIds.some((id) => !p.layers.some((l) => l.id === id)),
    )
  )
    fail('SOURCE_IN_USE', '图层或帧正被动画引用，请先删除对应动画对象或调整来源');
}
function fields(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail('INVALID_INPUT', `此操作仅接受：${allowed.join(', ')}`);
}
function layerEdits(p, operations) {
  let focus;
  for (const o of operations) {
    fields(
      o,
      {
        add: ['action', 'name', 'parent', 'group'],
        update: [
          'action',
          'layer',
          'name',
          'visible',
          'locked',
          'alphaLock',
          'opacity',
          'blend',
          'clipping',
        ],
        reorder: ['action', 'layer', 'target', 'placement'],
        merge_up: ['action', 'layer'],
        merge_down: ['action', 'layer'],
        merge_group: ['action', 'layer'],
        duplicate: ['action', 'layer'],
        delete: ['action', 'layer'],
        move: ['action', 'layer', 'parent'],
      }[o.action],
    );
    if (o.action !== 'add' && !p.layers[o.layer]) throw Error('图层索引无效');
    if (
      o.action !== 'add' &&
      layerLocked(p, o.layer) &&
      !(
        o.action === 'update' &&
        o.locked === false &&
        Object.keys(o).every((k) => ['action', 'layer', 'locked'].includes(k))
      )
    )
      throw Error('请先解锁图层及其父级');
    if (o.action === 'add') {
      if (o.parent !== undefined && o.parent !== -1 && !p.layers[o.parent]?.group)
        throw Error('父级必须是图层组');
      if (o.parent >= 0 && layerLocked(p, o.parent)) throw Error('父级图层组已锁定');
      focus = addLayer(p, o.parent ?? -1, o.group ?? false);
      if (o.name !== undefined) p.layers[focus].name = o.name;
    } else if (o.action === 'update') {
      for (const k of ['name', 'visible', 'locked', 'alphaLock', 'opacity', 'blend', 'clipping'])
        if (o[k] !== undefined) p.layers[o.layer][k] = o[k];
      focus = o.layer;
    } else if (o.action === 'duplicate') focus = duplicateLayer(p, o.layer);
    else if (o.action === 'delete') focus = deleteLayer(p, o.layer);
    else if (o.action === 'reorder') focus = dropLayer(p, o.layer, o.target, o.placement);
    else if (o.action === 'merge_up') focus = mergeUp(p, o.layer);
    else if (o.action === 'merge_down' || o.action === 'merge_group')
      focus = mergeLayers(p, o.layer, o.action === 'merge_group');
    else {
      if (o.parent === undefined) throw Error('移动图层需要 parent');
      if (o.parent >= 0 && (!p.layers[o.parent]?.group || layerLocked(p, o.parent)))
        throw Error('目标必须是未锁定的图层组');
      focus = moveLayer(p, o.layer, o.parent);
    }
  }
  return { layer: focus };
}
function frameEdits(p, operations) {
  let frame;
  for (const o of operations) {
    fields(o, [
      'action',
      'from',
      'to',
      ...(o.action === 'duration' ? ['duration'] : o.action === 'move' ? ['destination'] : []),
    ]);
    if (o.action === 'duration') {
      setDurations(p, o.from, o.to ?? o.from, o.duration);
      frame = o.from;
    } else {
      if (o.action === 'move' && o.destination === undefined) throw Error('移动帧需要 destination');
      frame = editFrames(p, o.action, o.from, o.to ?? o.from, o.destination);
    }
  }
  return { frame };
}
function animationEdits(p, args, activeFrame) {
  if (args.baseFrame !== undefined && !p.frames[args.baseFrame]) throw Error('来源帧索引无效');
  const scene = (p.procedural ||= createScene(p, args.baseFrame ?? activeFrame));
  if (args.baseFrame !== undefined && scene.baseFrameId !== p.frames[args.baseFrame].id) {
    if (scene.objects.length) throw Error('已有动画对象时不能更换场景底图');
    scene.baseFrameId = p.frames[args.baseFrame].id;
  }
  if (args.settings) {
    Object.assign(scene, args.settings);
    if (args.settings.duration !== undefined && !args.settings.range)
      scene.range = [0, scene.duration];
  }
  if (args.lights !== undefined)
    scene.lights = args.lights.map((light) => ({
      ...structuredClone(light),
      ...(light.path && {
        path: light.path.map((n) => ({ ...pathNode(n.x, n.y), ...structuredClone(n) })),
      }),
    }));
  for (const op of args.objects || []) {
    if (op.action === 'delete') fields(op, ['action', 'id']);
    if (op.action === 'create' && op.id !== undefined) throw Error('新对象 ID 由画室分配');
    let o = scene.objects.find((x) => x.id === op.id);
    if (op.action === 'create') {
      if (!op.sourceLayers || !op.name) throw Error('新对象需要名称和来源图层');
      let mask = null;
      if (op.region) {
        assertBox(p, op.region);
        mask = new Uint8Array(p.w * p.h);
        for (let y = op.region.y; y < op.region.y + op.region.height; y++)
          mask.fill(1, y * p.w + op.region.x, y * p.w + op.region.x + op.region.width);
      }
      o = createObject(p, scene, op.sourceLayers, mask, op.name);
      scene.objects.push(o);
    } else {
      if (!o) throw Error('动画对象不存在，请重新读取作品');
      if (
        o.locked &&
        !(
          op.action === 'update' &&
          op.locked === false &&
          Object.keys(op).every((k) => ['action', 'id', 'locked'].includes(k))
        )
      )
        throw Error('请先解锁动画对象');
      if (op.action === 'delete') {
        for (const light of scene.lights || [])
          if (light.targets?.includes(o.id)) {
            light.targets = light.targets.filter((id) => id !== o.id);
            if (!light.targets.length) light.enabled = false;
          }
        scene.objects.splice(scene.objects.indexOf(o), 1);
        continue;
      }
      if (op.sourceLayers || op.region) throw Error('更新对象来源请删除后重新创建');
    }
    for (const k of ['name', 'origin', 'progress', 'visible', 'enabled', 'locked', 'appearance'])
      if (op[k] !== undefined) o[k] = structuredClone(op[k]);
    if (op.origin && op.action === 'create' && !op.path)
      o.path = [pathNode(op.origin.x, op.origin.y)];
    if (op.path) o.path = op.path.map((n) => ({ ...pathNode(n.x, n.y), ...structuredClone(n) }));
    if (op.tracks) Object.assign(o.tracks, structuredClone(op.tracks));
    if (op.motion) Object.assign(o.motion, op.motion);
    if (op.clips)
      o.clips = op.clips.map((c) => ({
        id: uid(),
        enabled: true,
        intensity: 1,
        curve: linearCurve(),
        ...structuredClone(c),
        blend: ['rotate', 'shake'].includes(c.type) ? 'add' : 'multiply',
        params: { angle: 0, x: 1, y: 1, opacity: 1, amplitude: 0, frequency: 1, ...c.params },
      }));
  }
}

/** Transport-independent API. Host owns UI, history, storage, and the live revision. */
export function createEditorAPI(host) {
  let running = null;
  const snapshot = () => host.snapshot();
  function guard(revision, signal) {
    abort(signal);
    const s = snapshot();
    if (s.revision !== revision) fail('STALE_REVISION', '作品或选区已改变，请重新读取作品再操作');
    if (s.busy) fail('EDITOR_BUSY', s.busy);
    return s;
  }
  function documentState() {
    const s = snapshot(),
      p = s.project;
    return {
      apiVersion: 1,
      documentId: s.id,
      revision: s.revision,
      name: p.name,
      width: p.w,
      height: p.h,
      activeFrame: s.frame,
      activeLayer: s.layer,
      busy: s.busy || null,
      operation: running?.name || null,
      layers: p.layers.map((l, index) => ({
        index,
        id: l.id || null,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        group: !!l.group,
        level: l.level || 0,
        locked: layerLocked(p, index),
        ownLocked: !!l.locked,
        alphaLock: !!l.alphaLock,
        blend: l.blend || 0,
        clipping: !!l.clipping,
        mask: !!l.mask,
        adjustments: structuredClone(l.adjustments || {}),
      })),
      frames: p.frames.map((f, index) => ({ index, id: f.id || null, duration: f.duration })),
      selection: host.selectionInfo?.() || { active: !!s.selection },
      animation: p.procedural ? structuredClone(p.procedural) : null,
      history: { canUndo: s.history.canUndo, canRedo: s.history.canRedo, bytes: s.history.bytes },
      limits: {
        ...LIMITS,
        animation: SCENE_LIMITS,
        toolInputBytes: 2_000_000,
        drawingVisits: 4_000_000,
      },
      usage: projectUsage(p),
    };
  }
  async function execute(name, args = {}, { signal } = {}) {
    const definition = EDITOR_TOOLS.find((t) => t.name === name);
    if (!definition) fail('UNKNOWN_TOOL', '未知编辑器操作');
    if (JSON.stringify(args).length > 2_000_000)
      fail('INPUT_TOO_LARGE', '单次工具参数超过 2 MB，请拆分操作');
    validateInput(args, definition.inputSchema);
    abort(signal);
    if (name === 'pixel_get_document') return documentState();
    if (running) fail('EDITOR_BUSY', '另一个编辑器操作正在执行');
    const start = { ...guard(args.expectedRevision, signal) },
      controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    running = { name, controller };
    host.activity?.({ name, title: definition.title, running: true });
    let failure;
    try {
      const check = () => guard(start.revision, controller.signal);
      let details = {},
        focus = {},
        next,
        sceneOnly = false;
      if (name === 'pixel_create_document') {
        next = blank(args.width, args.height, args.name);
        if (!(await host.create(next, check)))
          fail('SAVE_FAILED', '创建作品失败，请先保存当前作品');
      } else if (name === 'pixel_history') {
        check();
        if (!start.history[args.direction === 'undo' ? 'canUndo' : 'canRedo'])
          fail('NO_HISTORY', '没有可用的历史记录');
        host.history(args.direction);
      } else if (name === 'pixel_save') {
        check();
        if (!(await host.save())) fail('SAVE_FAILED', '本地保存失败，请导出备份');
        details = { saved: true, savedRevision: start.revision };
      } else if (name === 'pixel_preview' || name === 'pixel_export') {
        const media = await import('./editor-media.js');
        check();
        if (name === 'pixel_preview') return await media.preview(start.project, args, host, check);
        details = await media.exportDocument(start.project, args, host, check);
      } else if (name === 'pixel_bake_animation') {
        if (!start.project.procedural) throw Error('作品还没有程序化动画');
        const options = {
          mode: args.mode || 'composite',
          objectIds: args.objectIds || null,
          frameCount: args.frameCount,
          fps: args.fps,
          replace: args.replace || false,
          signal: controller.signal,
        };
        const plan = bakePlan(start.project, start.project.procedural, options);
        details = {
          layers: plan.layers,
          frames: plan.frames,
          bytes: plan.bytes,
          logicalBytes: plan.logicalBytes,
          compact: plan.compact,
          bytesAreEstimate: plan.compact,
          samples: plan.samples.length,
        };
        if (args.dryRun) return { revision: start.revision, dryRun: true, ...details };
        const result = await bakeScene(
          start.project,
          start.project.procedural,
          options,
          (done, total) => {
            check();
            host.activity?.({ name, title: definition.title, running: true, done, total });
          },
        );
        next = result.project;
        focus = { frame: result.frame, layer: result.layer };
        details.frameRange = [result.frame, result.frame + plan.samples.length - 1];
        check();
        host.commit(next, { focus, exitAnimation: true });
      } else {
        if (name === 'pixel_expand_canvas') next = expandCanvas(start.project, args);
        else {
          // Animation changes share pixel buffers. All other writes own a project copy until commit.
          sceneOnly =
            name === 'pixel_edit_animation' &&
            !!start.project.procedural &&
            [...start.project.layers, ...start.project.frames].every((v) => v.id);
          next = sceneOnly
            ? { ...start.project, procedural: structuredClone(start.project.procedural) }
            : clone(start.project);
          if (name === 'pixel_edit_layers') focus = layerEdits(next, args.operations);
          else if (name === 'pixel_edit_frames') focus = frameEdits(next, args.operations);
          else if (name === 'pixel_draw') {
            if (
              start.selection &&
              args.selection !== 'all' &&
              (args.frame !== start.frame || args.layer !== start.layer)
            )
              throw Error('使用当前选区时，请指定当前帧和图层，或显式设置 selection=all');
            details = drawBatch(next, args, args.selection === 'all' ? null : start.selection);
            if (!details.pixelWrites)
              return { revision: start.revision, changed: false, ...details };
            focus = { frame: args.frame, layer: args.layer };
          } else if (name === 'pixel_transform') {
            focus = { frame: args.frame, layer: transformPixels(next, args, start) };
          } else if (name === 'pixel_add_text' || name === 'pixel_add_outline') {
            if (!next.frames[args.frame]) throw Error('帧索引无效');
            let pixels, label;
            if (name === 'pixel_add_text') {
              const font = host.pixelFont || (await loadPixelFont());
              check();
              const text = renderPixelText(font, args.text, {
                direction: args.direction,
                spacing: args.spacing,
                color: rgba(args.color),
              });
              const quad =
                args.quad ||
                rectangleQuad(
                  args.x,
                  args.y,
                  ((text.width * (args.size || 16)) / 16) * (args.scaleX || 1),
                  ((text.height * (args.size || 16)) / 16) * (args.scaleY || 1),
                  args.rotation || 0,
                );
              pixels = warpPixels(text.pixels, text.width, text.height, next.w, next.h, quad, args);
              label = '文字 · ' + args.text.slice(0, 60);
            } else {
              if (
                !next.layers[args.layer] ||
                next.layers[args.layer].group ||
                layerLocked(next, args.layer)
              )
                throw Error('请选择未锁定的像素图层');
              if (
                start.selection &&
                args.selection !== 'all' &&
                (args.frame !== start.frame || args.layer !== start.layer)
              )
                throw Error('当前选区只能用于当前帧和图层');
              pixels = outlinePixels(
                readCel(next.frames[args.frame].cels[args.layer]),
                next.w,
                next.h,
                {
                  width: args.width,
                  position: args.position,
                  color: rgba(args.color),
                  mask: args.selection === 'all' ? null : start.selection,
                },
              );
              label = '像素描边';
            }
            if (!pixels.some((v, i) => i % 4 === 3 && v)) throw Error('内容位于画布之外或为空');
            const layer = addLayer(next, -1, false);
            next.layers[layer].name = label;
            next.frames[args.frame].cels[layer] = pixels;
            focus = { frame: args.frame, layer };
          } else if (name === 'pixel_edit_animation') {
            ensureSourceIds(next);
            animationEdits(next, args, start.frame);
          }
        }
        ensureSourceIds(next);
        if (next.storage === 'packed' && !sceneOnly) next = compactProject(next);
        validate(next, { reusePixels: true });
        references(next);
        check();
        host.commit(next, {
          sceneOnly,
          focus,
          preserveSelection: name === 'pixel_draw' && args.selection !== 'all',
        });
      }
      return { ...details, document: { ...documentState(), operation: null } };
    } catch (e) {
      if (controller.signal.aborted) e.code = 'CANCELLED';
      failure = e.message;
      throw e;
    } finally {
      signal?.removeEventListener('abort', cancel);
      running = null;
      host.activity?.({
        name,
        title: definition.title,
        running: false,
        message: failure || '已完成',
      });
    }
  }
  return {
    execute,
    getDocument: documentState,
    cancel: () => running?.controller.abort(),
    tools: EDITOR_TOOLS,
  };
}
