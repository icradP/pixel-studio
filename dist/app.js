import { encodeProjectFile, decodeProjectFile } from './project-file.js';
import { readCel, editCel, decodeCacheBytes, compactProject } from './cel-storage.js';
import { pressureResponse, applyGradient, mixPaintEffect, paintMask } from './paint.js';
import { BLEND_MODES } from './layer-effects.js';
import { layerEffects, gradientSettings } from './painting-ui.js';
import { canvasPoint } from './camera.js';
import { LIMITS, projectUsage, mebibytes } from './limits.js';
import { installControls, updateRanges } from './controls.js';
import { openProjectStore } from './project-store.js';
import { createSavePreparation } from './background-save.js';
import { createHistory } from './history.js';
import { createEditorIntegration } from './editor-integration.js';
import { createRenderScheduler } from './render-scheduler.js';
import {
  BRUSH_PRESETS,
  createBrushLibrary,
  normalizeBrush,
  stampBrush,
  mixStrokeOpacity,
} from './brushes.js';
import { createToolBrushes } from './tool-brushes.js';
import { copySelectionLayer } from './selection-layer.js';
import { duplicateLayer, dropLayer, mergeLayers, mergeUp } from './layer-actions.js';
import { itemGestures } from './item-gestures.js';
import { virtualList } from './virtual-list.js';
import { createLayerPreviewCache } from './layer-preview.js';
import { canvasPixels } from './pixel-budget.js';
import { expandCanvas } from './canvas-resize.js';
import { importKind } from './file-import.js';
import { createToolWindows, dismissTopWindow } from './floating.js';
import { createPixelRenderer } from './pixel-renderer.js';
import { createAnimationEditor } from './animation-editor.js';
import { onionPixels } from './onion.js';
import {
  PlaybackClock,
  editFrames,
  addLayer,
  groupLayer,
  ungroupLayer,
  moveLayer,
  reorderLayer,
  deleteLayer,
  parentLayer,
  subtreeEnd,
  layerLocked,
  visibleLayerOrder,
} from './animation-edit.js';
import { createTimeline, layerOrder } from './animation.js';
import { activePalette } from './palettes.js';
import { colorStudio } from './color-studio.js';
import { galleryView } from './gallery.js';
import {
  blank,
  clone,
  validate,
  composite,
  rgba,
  line,
  flood,
  demo,
  MAX_PIXELS,
} from './engine.js';
import { FingerSession, pinchCamera } from './gestures.js';
import { askDialog, showDialog, hideDialog } from './dialogs.js';
import { PLUGINS } from './plugin-registry.js';
import { rectangleMask, maskBounds, magicPixels, extractMasked } from './plugin-core.js';
import { createSelectionController } from './selection-ui.js';
import { createSelectionOverlay } from './selection-overlay.js';
import {
  recognizeShape,
  adjustShape,
  traceShape,
  ShapePreview,
  shapeDelay,
} from './quick-shape.js';
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const icons = {
  wand: 'M4 20L17 7l3 3L7 23zM15 3V1M21 5l2-2M22 12h2M10 6H7M13 10l3 3',
  select: 'M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5M7 7h10v10H7z',
  settings: 'M4 6h16M4 12h16M4 18h16M9 3v6M15 9v6M8 15v6',
  brush: 'M14 4l6 6M4 20l3-7L17 3l4 4L11 17z',
  export: 'M12 15V3m-4 4l4-4 4 4M5 11v10h14V11',
  fit: 'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M8 8h8v8H8z',
  mirror: 'M12 2v3m0 3v3m0 3v3m0 3v2M8 6L2 18h6zM16 6l6 12h-6z',
  reference: 'M3 4h18v16H3zM3 8h18M6 17l4-5 3 3 2-2 3 4',
  layers: 'M12 3L2 8l10 5 10-5zM3 12l9 5 9-5M3 16l9 5 9-5',
  timeline: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4m8 0h4M4 16h4m8 0h4',
  pencil: 'M4 20l2-6L17 3l4 4L10 18zM14 6l4 4',
  eraser: 'M3 15l9-12 9 7-8 11H8zM9 9l9 7M13 21h8',
  fill: 'M4 10l8-8 8 8-8 8zM2 21h12M20 14s-3 3-3 5a3 3 0 006 0c0-2-3-5-3-5',
  line: 'M4 20L20 4M4 17v3h3m10-16h3v3',
  rect: 'M4 5h16v14H4z',
  ellipse: 'M21 12a9 7 0 11-18 0 9 7 0 1118 0',
  pick: 'M14 3l7 7M12 5l7 7M16 8L5 19H2v-3L13 5',
  hand: 'M8 12V5a2 2 0 014 0v6-7a2 2 0 014 0v7-5a2 2 0 014 0v9c0 5-3 7-7 7-3 0-5-2-6-5L3 11a2 2 0 013-2z',
  undo: 'M8 5l-5 5 5 5M3 10h10a7 7 0 010 14',
  redo: 'M16 5l5 5-5 5M21 10H11a7 7 0 000 14',
  pen: 'M5 19l2-7L16 3l5 5-9 9zM3 21h18',
  play: 'M8 4l12 8-12 8z',
  pause: 'M7 4v16M17 4v16',
  prev: 'M17 5l-9 7 9 7zM5 5v14',
  next: 'M7 5l9 7-9 7zM19 5v14',
  first: 'M7 5v14M18 5l-8 7 8 7z',
  last: 'M17 5v14M6 5l8 7-8 7z',
  onion: 'M17 12a7 7 0 11-14 0 7 7 0 1114 0M21 12a7 7 0 01-7 7m0-14a7 7 0 017 7',
  duplicate: 'M8 8h13v13H8zM4 16H2V2h14v2M11 14h7m-3-3v7',
  plus: 'M12 4v16M4 12h16',
  gradient: 'M3 3h18v18H3zM6 5v14M9 5v14M13 5v14M18 5v14',
  more: 'M5 12h.1M12 12h.1M19 12h.1',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM15 12a3 3 0 11-6 0 3 3 0 016 0',
  hidden:
    'M3 3l18 18M9 5a11 11 0 013-0c6 0 10 7 10 7s-1 2-4 4M6 6c-3 2-4 6-4 6s4 7 10 7a12 12 0 005-1',
  trash: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
};
const svg = (n) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[n] || icons.more}"/></svg>`;
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x],
  );
$$('[data-panel]').forEach((b) => {
  if (!b.textContent && !b.querySelector('svg'))
    b.innerHTML = svg(b.dataset.panel === 'animation' ? 'more' : b.dataset.panel);
});
Object.entries({
  fit: 'fit',
  'mirror-view': 'mirror',
  'reference-add': 'reference',
  'timeline-toggle': 'timeline',
  'quick-undo': 'undo',
  'quick-redo': 'redo',
  'pencil-only': 'pen',
  first: 'first',
  prev: 'prev',
  play: 'play',
  next: 'next',
  last: 'last',
  onion: 'onion',
  'duplicate-frame': 'duplicate',
  'add-frame': 'plus',
}).forEach(([id, n]) => ($('#' + id).innerHTML = svg(n)));
let project = demo(),
  id = crypto.randomUUID(),
  frame = 0,
  layer = 2,
  tool = 'pencil',
  color = '#ef87a0',
  size = 1,
  pressure = true,
  penOnly = true,
  onion = false,
  grid = false,
  playing = false,
  playTimer,
  panelType = '',
  dirtyVersion = 0,
  savedVersion = -1;
const view = $('#view'),
  ctx = view.getContext('2d'),
  stage = $('#stage'),
  buffer = document.createElement('canvas');
let animationTimeline = null,
  selectionUI = null,
  pluginWindow = null,
  pinnedPlugins = [],
  selectionRevision = 0,
  lastSelection = null,
  holdTimer = null,
  shapeTimer = null,
  shapeHoldMs = 800,
  colorController = null,
  layerPanelKey = '',
  animationPanelKey = '';
let brushController = null,
  expansionController = null,
  requestedBrushGroup = null,
  brushSaveTimer;
try {
  pinnedPlugins = JSON.parse(localStorage.getItem('pixel-studio-pins') || '[]').filter((id) =>
    PLUGINS.some((p) => p.id === id),
  );
} catch {}
let selection = null,
  magicConfig = { enabled: false, mode: 'outline-brush', outline: '#18283e', strength: 0.2 };
let displayMode = 'auto',
  timelineOpen = true;

let camera = { scale: 4, angle: 0, x: 0, y: 0 },
  cw = 0,
  ch = 0,
  stroke = null,
  saveTimer,
  toastTimer,
  projectStore,
  saveQueue = Promise.resolve(),
  customMask = Array.from({ length: 64 }, (_, i) =>
    i === 27 || i === 28 || i === 35 || i === 36 ? 1 : 0,
  );
let multipleWindows = false;
try {
  const settings = JSON.parse(localStorage.getItem('pixel-studio-settings') || '{}');
  multipleWindows = settings.multipleWindows === true;
  penOnly = settings.inputVersion === 2 ? !!settings.penOnly : true;
  displayMode =
    settings.displayVersion === 2 && ['auto', 'smooth', 'pixel'].includes(settings.displayMode)
      ? settings.displayMode
      : 'auto';
  pressure = settings.pressure !== false;
  shapeHoldMs = shapeDelay(settings.shapeHoldMs);
  if (Array.isArray(settings.mask) && settings.mask.length === 64)
    customMask = settings.mask.map((v) => (v ? 1 : 0));
} catch {}
let savedBrushLibrary;
try {
  savedBrushLibrary = JSON.parse(localStorage.getItem('pixel-studio-brush-library') || 'null');
} catch {}
const brushLibrary = createBrushLibrary(savedBrushLibrary, { pressure, mask: customMask });
const toolBrushes = createToolBrushes(brushLibrary, savedBrushLibrary?.eraser);
const currentBrush = () => toolBrushes.current();
function applyBrushSettings() {
  const brush = currentBrush();
  size = brush.size;
  pressure = brush.pressure;
  customMask = brush.mask;
  magicConfig = { ...brush.magic, enabled: toolBrushes.mode !== 'eraser' && brush.magic.enabled };
  document.body.classList.toggle('magic-active', magicConfig.enabled);
  $('#side-opacity').disabled =
    magicConfig.enabled && ['select', 'select-erase', 'lift', 'merge'].includes(magicConfig.mode);
}
applyBrushSettings();
function persistBrushes() {
  clearTimeout(brushSaveTimer);
  try {
    localStorage.setItem(
      'pixel-studio-brush-library',
      JSON.stringify({ ...brushLibrary, eraser: toolBrushes.state }),
    );
  } catch {
    toast('笔刷库未能保存，请检查设备存储空间');
  }
}
function selectBrush(brushId) {
  if (!brushLibrary.brushes.some((brush) => brush.id === brushId)) return;
  if (stroke) finishStroke(true);
  toolBrushes.select(brushId);
  applyBrushSettings();
  persistBrushes();
  chooseTool(toolBrushes.mode);
}
function updateBrush(patch, persist = true) {
  if (stroke) finishStroke(true);
  toolBrushes.update(patch);
  applyBrushSettings();
  $('#brush-size').textContent = size + ' px';
  $('#side-size').value = size;
  $('#side-size-value').textContent = size + ' px';
  $('#side-opacity').value = currentBrush().opacity;
  $('#side-opacity-value').textContent = currentBrush().opacity + '%';
  updateRanges(document.querySelector('.size-rail'));
  if (persist) persistBrushes();
  else {
    clearTimeout(brushSaveTimer);
    brushSaveTimer = setTimeout(persistBrushes, 200);
  }
}
let palette = activePalette();
let playbackSpeed = 1,
  playClock = null,
  animationEditor = null,
  thumbKey = '',
  frameCacheKey = '',
  onionOpacity = 0.4,
  onionBefore = true,
  onionAfter = true,
  onionScope = 'all',
  warmKey = '',
  warmTimer;
let procedural = null,
  proceduralLoader = null,
  artRevision = 0;
const frameCache = new Map(),
  onionCache = new Map();
const pixelRenderer = createPixelRenderer(),
  checker = document.createElement('canvas');
let checkerKey = '';
try {
  const settings = JSON.parse(localStorage.getItem('pixel-studio-settings') || '{}');
  if (
    Number.isFinite(settings.playbackSpeed) &&
    settings.playbackSpeed >= 0.1 &&
    settings.playbackSpeed <= 8
  )
    playbackSpeed = settings.playbackSpeed;
} catch {}
function setSpeed(value) {
  if (!Number.isFinite(value) || value < 0.1 || value > 8) {
    toast('倍速范围：0.1–8');
    return;
  }
  if (playing) advancePlayback(performance.now());
  playbackSpeed = Math.round(value * 100) / 100;
  const field = $('#playback-speed');
  if (field) field.value = playbackSpeed;
  settingsSave();
}
function editProject(fn) {
  if (stroke || selectionUI?.transforming) throw Error('请先完成笔画或选区变换');
  stop();
  const before = clone(project),
    oldFrame = frame,
    oldLayer = layer;
  try {
    fn(project);
    validate(project, { reusePixels: true });
  } catch (e) {
    project = before;
    frame = oldFrame;
    layer = oldLayer;
    throw e;
  }
  checkpoint(before);
  commitProject(project, { before, checkpointed: true, focus: { frame, layer } });
}
function frameCanvas(index) {
  const key = id + ':' + dirtyVersion;
  if (frameCacheKey !== key) {
    frameCacheKey = key;
    frameCache.clear();
    onionCache.clear();
  }
  if (frameCache.has(index)) return frameCache.get(index);
  const canvas = thumb(project, index);
  while (frameCache.size && frameCache.size * project.w * project.h * 4 >= LIMITS.previewBytes)
    frameCache.delete(frameCache.keys().next().value);
  if (project.w * project.h * 4 <= LIMITS.previewBytes) frameCache.set(index, canvas);
  return canvas;
}
function warmFrames() {
  const row = $('#frames');
  if (!timelineOpen || animationTimeline?.isDetailed() || row.hidden) {
    clearTimeout(warmTimer);
    warmKey = '';
    return;
  }
  const bounds = row.getBoundingClientRect();
  const visible = [...row.children].flatMap((button, i) => {
    const r = button.getBoundingClientRect();
    return r.right >= bounds.left - 96 &&
      r.left <= bounds.right + 96 &&
      !button.querySelector('canvas')?.dataset.ready
      ? [i]
      : [];
  });
  const key = id + ':' + dirtyVersion + ':' + visible.join(',');
  if (warmKey === key) return;
  clearTimeout(warmTimer);
  warmKey = key;
  let next = 0;
  const batch = () => {
    if (warmKey !== key || stroke || !timelineOpen) return;
    if (next < visible.length) {
      const index = visible[next++];
      paintFrameThumbnail(index, frameCanvas(index));
    }
    if (next < visible.length) warmTimer = setTimeout(batch, 32);
  };
  warmTimer = setTimeout(batch, 80);
}
$('#frames').addEventListener('scroll', warmFrames, { passive: true });
function drawOnions() {
  if (!onion || playing || stroke || selectionUI?.preview) return;
  for (const delta of [-1, 1]) {
    if ((delta < 0 && !onionBefore) || (delta > 0 && !onionAfter)) continue;
    const neighbor = frame + delta;
    if (neighbor < 0 || neighbor >= project.frames.length) continue;
    const key = frame + ':' + neighbor + ':' + onionScope + ':' + layer;
    let c = onionCache.get(key);
    if (!c) {
      const pixels = onionPixels(
        project,
        frame,
        neighbor,
        onionScope === 'layer' && !project.layers[layer].group ? layer : -1,
      );
      c = document.createElement('canvas');
      paintBuffer(c, pixels);
      onionCache.set(key, c);
      if (onionCache.size > 8) onionCache.delete(onionCache.keys().next().value);
    }
    ctx.globalAlpha = onionOpacity;
    drawPreview(c);
  }
  ctx.globalAlpha = 1;
}

function toast(s) {
  clearTimeout(toastTimer);
  $('#toast').textContent = s;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => ($('#toast').hidden = true), 4200);
}
function settingsSave() {
  try {
    localStorage.setItem(
      'pixel-studio-settings',
      JSON.stringify({
        inputVersion: 2,
        displayVersion: 2,
        playbackSpeed,
        multipleWindows,
        penOnly,
        pressure,
        shapeHoldMs,
        mask: customMask,
        displayMode,
      }),
    );
  } catch {
    toast('笔刷设置未能保存，请检查浏览器存储空间');
  }
}
const history = createHistory();
function checkpoint(snapshot = clone(project)) {
  history.checkpoint(snapshot);
}
// Shared transaction boundary for interface edits, procedural editing, and AI commands.
function commitProject(
  next,
  {
    before,
    checkpointed = false,
    sceneOnly = false,
    focus = {},
    preserveSelection = false,
    exitAnimation = false,
  } = {},
) {
  if (
    !sceneOnly &&
    (next.storage === 'packed' ||
      next.w * next.h * next.layers.length * next.frames.length > MAX_PIXELS)
  )
    next = compactProject(next);
  validate(next, { reusePixels: true });
  checkCanvasSupport(next.w, next.h);
  if (!checkpointed) {
    if (sceneOnly) history.checkpointScene(project.procedural);
    else checkpoint(before || clone(project));
  }
  const resized = project.w !== next.w || project.h !== next.h;
  stop();
  procedural?.pause();
  if (exitAnimation) procedural?.leave();
  project = next;
  frame = Math.min(focus.frame ?? frame, project.frames.length - 1);
  layer = Math.min(focus.layer ?? layer, project.layers.length - 1);
  if (!preserveSelection) selection = null;
  changed(null, sceneOnly);
  if (resized) fit();
}
function updateHistory() {
  const active = selectionUI?.editingSelection ? selectionUI : history;
  ['#quick-undo', '#tool-undo'].forEach((s) => ($(s).disabled = !active.canUndo));
  ['#quick-redo', '#tool-redo'].forEach((s) => ($(s).disabled = !active.canRedo));
}
function restoreHistory(direction) {
  if (selectionUI?.transforming) {
    selectionUI.finish(false);
    return;
  }
  if (stroke) return;
  if (selectionUI?.editingSelection) {
    selectionUI[direction]();
    return;
  }
  const restored = history[direction](project);
  if (!restored) return;
  stop();
  selection = null;
  project = restored;
  frame = Math.min(frame, project.frames.length - 1);
  layer = Math.min(layer, project.layers.length - 1);
  changed();
}
function undo() {
  restoreHistory('undo');
}
function redo() {
  restoreHistory('redo');
}
let changedFrames = null;
function changed(affected = null, sceneOnly = false) {
  if (!sceneOnly) artRevision++;
  else affected = [];
  const previous = id + ':' + dirtyVersion;
  dirtyVersion++;
  changedFrames = affected;
  if (affected && frameCacheKey === previous) affected.forEach((index) => frameCache.delete(index));
  else frameCache.clear();
  frameCacheKey = id + ':' + dirtyVersion;
  onionCache.clear();
  $('#save-status').textContent = '保存中…';
  render();
  refresh();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(autoSave, 800);
}
function autoSave() {
  // Never snapshot/compress between samples of an active Pencil or touch gesture.
  if (stroke || fingers.active || penActive || procedural?.busy) {
    saveTimer = setTimeout(autoSave, 250);
    return;
  }
  void saveCurrent();
}
const checkedCanvasSizes = new Set();
function checkCanvasSupport(w, h) {
  const key = w + ':' + h;
  if (checkedCanvasSizes.has(key)) return;
  const canvas = document.createElement('canvas');
  try {
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d');
    context.fillRect(w - 1, h - 1, 1, 1);
    if (context.getImageData(w - 1, h - 1, 1, 1).data[3] !== 255) throw Error();
    checkedCanvasSizes.add(key);
  } catch {
    throw Error(`当前浏览器无法创建 ${w} × ${h} 的显示画布，请调整尺寸或换用其他设备。`);
  } finally {
    canvas.width = canvas.height = 0;
  }
}
function paintBuffer(c, pixels, w = project.w, h = project.h) {
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  c.getContext('2d').putImageData(
    new ImageData(
      pixels instanceof Uint8ClampedArray ? pixels : new Uint8ClampedArray(pixels),
      w,
      h,
    ),
    0,
    0,
  );
}
const renderScheduler = createRenderScheduler(draw);
let references,
  referenceLoader,
  referenceRevision = 0;
async function openReference() {
  try {
    referenceLoader ||= import('./references.js').then(({ createReferences }) => {
      references = createReferences({
        toast,
        pick: (value) => {
          color = value;
          refresh();
        },
      });
      return references;
    });
    const manager = await referenceLoader;
    closePrimaryPanels();
    manager.open();
    render();
  } catch {
    referenceLoader = null;
    toast('参考小窗未能打开，请重试');
  }
}
$('#reference-add').onclick = openReference;
$('#procedural-open').onclick = async () => {
  if (stroke) return;
  try {
    if (!proceduralLoader)
      proceduralLoader = import('./procedural-editor.js').then(({ createProceduralEditor }) => {
        procedural = createProceduralEditor({
          project: () => project,
          frame: () => frame,
          layer: () => layer,
          selection: () => selection,
          revision: () => dirtyVersion,
          artRevision: () => artRevision,
          scale: () => camera.scale,
          render,
          resize,
          toast,
          ask: askDialog,
          download,
          editProject,
          undo,
          redo,
          history: () => history,
          enter: () => {
            stop();
            selectionUI?.finish(true);
            chooseTool('pencil');
            toolWindows.closeAll();
          },
          commitScene: (scene) => {
            const next = { ...project, procedural: scene };
            commitProject(next, { sceneOnly: true });
          },
          commitBake: (result) => {
            commitProject(result.project, { focus: { frame: result.frame, layer: result.layer } });
            if (!timelineOpen) toggleTimeline();
          },
        });
        return procedural;
      });
    const editor = await proceduralLoader;
    editor.enter();
  } catch (e) {
    proceduralLoader = null;
    toast(e.message || '动画画室未能打开，请重试');
  }
};
function render() {
  renderScheduler.request();
}
function draw() {
  if (!cw || !ch) return;
  const dpr = devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = '#1b1c20';
  ctx.fillRect(0, 0, cw, ch);
  // Backing pixels follow devicePixelRatio; view interpolation never changes project pixels.
  ctx.save();
  ctx.translate(cw / 2 + camera.x, ch / 2 + camera.y);
  ctx.rotate(camera.angle);
  ctx.scale(camera.scale * (camera.flipX ? -1 : 1), camera.scale * (camera.flipY ? -1 : 1));
  ctx.translate(-project.w / 2, -project.h / 2);
  ctx.shadowColor = '#0008';
  ctx.shadowBlur = 25 / camera.scale;
  ctx.fillStyle = '#25262b';
  ctx.fillRect(0, 0, project.w, project.h);
  ctx.shadowBlur = 0;
  const checkerSize = project.w + ':' + project.h;
  if (checkerKey !== checkerSize) {
    checkerKey = checkerSize;
    checker.width = project.w;
    checker.height = project.h;
    const c = checker.getContext('2d'),
      tile = 8;
    for (let y = 0; y < project.h; y += tile)
      for (let x = 0; x < project.w; x += tile) {
        c.fillStyle = (x / tile + y / tile) % 2 ? '#35363b' : '#2c2d32';
        c.fillRect(x, y, tile, tile);
      }
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(checker, 0, 0);
  ctx.imageSmoothingEnabled = displayMode !== 'pixel';
  ctx.imageSmoothingQuality = 'high';
  let previewSource;
  if (procedural?.active) {
    paintBuffer(buffer, procedural.pixels());
    drawPreview(buffer, true);
    previewSource = buffer;
  } else if ((stroke?.before && !stroke.picking) || selectionUI?.preview) {
    paintBuffer(buffer, composite(renderProject(), frame));
    drawPreview(buffer, true);
    previewSource = buffer;
  } else {
    previewSource = frameCanvas(frame);
    drawPreview(previewSource);
  }
  references?.render(
    previewSource,
    id +
      ':' +
      dirtyVersion +
      ':' +
      frame +
      ':' +
      (stroke || selectionUI?.preview || procedural?.active ? ++referenceRevision : ''),
  );
  if (!procedural?.active) drawOnions();
  if (grid && camera.scale >= 5) {
    ctx.strokeStyle = '#111a2b55';
    ctx.lineWidth = 1 / camera.scale;
    ctx.beginPath();
    for (let x = 0; x <= project.w; x++) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, project.h);
    }
    for (let y = 0; y <= project.h; y++) {
      ctx.moveTo(0, y);
      ctx.lineTo(project.w, y);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = '#82919c44';
  ctx.lineWidth = 1 / camera.scale;
  ctx.strokeRect(0, 0, project.w, project.h);
  if (procedural?.active) procedural.draw(ctx, camera.scale);
  else if (artworkWindow?.editing) artworkWindow.draw(ctx, camera.scale);
  else drawSelection();
  ctx.restore();
  $('#zoom-label').textContent = Math.round(camera.scale * 100) + '%';
}
function renderProject() {
  if (!selectionUI?.preview) return project;
  const f = project.frames[frame],
    cels = f.cels.slice();
  cels[layer] = selectionUI.preview;
  return {
    ...project,
    frames: project.frames.map((item, i) => (i === frame ? { ...f, cels } : item)),
  };
}
const selectionOverlay = createSelectionOverlay();
function drawSelection() {
  if (selectionUI?.draw(ctx, camera.scale)) return;
  const effectMask =
    !!stroke?.magic && ['select', 'select-erase', 'lift', 'merge'].includes(stroke.magic.mode);
  const mask = effectMask ? stroke.mask : selection;
  selectionOverlay.draw(
    ctx,
    mask,
    project.w,
    project.h,
    camera.scale,
    !!selectionUI?.editingSelection || effectMask,
    selectionUI?.maskOpacity,
    effectMask,
  );
}

function drawPreview(source, dirty = false) {
  if (pixelRenderer.draw(ctx, source, camera, cw, ch, devicePixelRatio || 1, displayMode, dirty))
    return;
  ctx.imageSmoothingEnabled =
    displayMode === 'smooth' || (displayMode === 'auto' && camera.scale < 1);
  ctx.drawImage(source, 0, 0);
}
function canvasCenter() {
  let x = cw / 2,
    availableWidth = cw;
  const y = ch / 2;
  const panel = $('#panel');
  if (!panel.hidden && innerWidth > 700) {
    const width = panel.getBoundingClientRect().width + 18;
    availableWidth = cw - width;
    x = (cw + (panel.dataset.side === 'left' ? width : -width)) / 2;
  }
  return { x, y, availableWidth };
}
function resize() {
  const r = stage.getBoundingClientRect();
  cw = r.width;
  ch = r.height;
  const width = Math.round(cw * (devicePixelRatio || 1)),
    height = Math.round(ch * (devicePixelRatio || 1));
  if (view.width !== width) view.width = width;
  if (view.height !== height) view.height = height;
  render();
}
function fit() {
  const center = canvasCenter(),
    available = center.availableWidth;
  camera = {
    flipX: camera.flipX,
    flipY: camera.flipY,
    scale: Math.max(
      0.05,
      Math.min(20, Math.min((available - 130) / project.w, (ch - 100) / project.h)),
    ),
    angle: 0,
    x: center.x - cw / 2 + 20,
    y: 0,
  };
  render();
}
new ResizeObserver(resize).observe(stage);
function toolsBuild() {
  const defs = [
    ['pencil', '像素铅笔'],
    ['eraser', '橡皮擦'],
    ['fill', '油漆桶'],
    ['line', '直线'],
    ['rect', '矩形'],
    ['ellipse', '椭圆'],
    ['pick', '吸管'],
    ['hand', '移动画布'],
    ['select', '矩形选区'],
    ['wand', '魔棒选择'],
  ];
  $('#tools').innerHTML =
    defs
      .map(
        ([n, label]) =>
          `<button id="tool-${n}" title="${label}" aria-label="${label}" data-tool="${n}">${svg(n)}</button>`,
      )
      .join('') +
    `<span class="tool-separator"></span><button id="color-button" aria-label="颜色面板" title="当前颜色"><span class="color-dot"></span></button><span class="tool-separator"></span><button id="tool-undo" aria-label="撤销">${svg('undo')}</button><button id="tool-redo" aria-label="重做">${svg('redo')}</button>`;
  $('#painting-tools').prepend($('#tool-pencil'), $('#tool-eraser'));
  $('#tool-pencil').setAttribute('aria-label', '笔刷设置');
  $('#tool-pencil').title = '画笔 · 再次轻点打开笔刷库';
  $('#tool-eraser').title = '橡皮擦 · 再次轻点打开笔刷库';
  $('#editing-tools').append($('#tool-select'), $('#tool-wand'));
  $('#side-modify').append($('#tool-pick'));
  $('#side-history').append($('#tool-undo'), $('#tool-redo'));
  $('#side-history').append($('#floatbar'));
  $$('[data-tool]').forEach(
    (b) =>
      (b.onclick = () => {
        if (tool === b.dataset.tool && ['pencil', 'eraser'].includes(tool)) openPanel('brush', b);
        else if (tool === b.dataset.tool && ['select', 'wand'].includes(tool))
          selectionUI?.toggle();
        else chooseTool(b.dataset.tool);
      }),
  );
  for (const button of [$('#tool-pencil'), $('#tool-eraser')]) {
    let timer,
      held = false;
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || tool === button.dataset.tool) return;
      held = false;
      timer = setTimeout(() => {
        held = true;
        closePrimaryPanels();
        toolBrushes.switch(button.dataset.tool, true);
        chooseTool(button.dataset.tool);
        persistBrushes();
        toast('已使用相同笔刷切换到' + (tool === 'eraser' ? '橡皮擦' : '画笔'));
      }, 450);
    });
    for (const name of ['pointerup', 'pointercancel', 'pointerleave'])
      button.addEventListener(name, () => clearTimeout(timer));
    button.addEventListener(
      'click',
      (event) => {
        if (held) {
          event.stopImmediatePropagation();
          held = false;
        }
      },
      true,
    );
  }
  $('#color-button').onclick = () => openPanel('color');
  $('#tool-undo').onclick = undo;
  $('#tool-redo').onclick = redo;
  const shelf = document.createElement('div');
  shelf.id = 'plugin-shortcuts';
  $('#tools').append(shelf);
  const more = document.createElement('button');
  more.id = 'tool-plugin-library';
  more.setAttribute('aria-label', '添加快捷插件');
  more.textContent = '＋';
  more.onclick = () => launchPlugins();
  $('#tools').append(more);
  renderPins();
}
function refresh() {
  procedural?.sync();
  if (toolWindows.has('brush')) brushController?.sync();
  if (toolWindows.has('expand')) expansionController?.sync();
  if (toolWindows.has('color')) colorController?.syncExternal();
  selectionUI?.update();
  document.dispatchEvent(new Event('pixel-studio-context'));
  $('#project-name').textContent = project.name;
  $('#project-detail').textContent =
    `${project.w} × ${project.h} · 第 ${frame + 1} 帧${editingMask() ? ' · 正在绘制遮罩' : ''}`;
  $('#canvas-info').textContent =
    `${project.w} × ${project.h} · ${project.layers.length} 层 · ${project.frames.length} 帧`;
  updateCapacity();
  $('#frame-count').textContent = String(project.frames.length).padStart(2, '0') + ' FRAMES';
  $('#brush-size').textContent = size + ' px';
  $$('.color-dot').forEach((dot) => (dot.style.background = color));
  $$('[data-tool]').forEach((b) => {
    const active =
      b.dataset.tool === tool ||
      (b.dataset.tool === 'select' &&
        !!selection &&
        !['select', 'wand', 'lasso', 'ellipse-select'].includes(tool));
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', active);
  });
  $('#pencil-only').setAttribute('aria-pressed', penOnly);
  $('#input-mode').textContent = penOnly ? 'Pencil 模式' : '手指绘画';
  $('#header-color .color-dot').style.background = color;
  $('#side-size').value = size;
  $('#side-size-value').textContent = size + ' px';
  $('#side-opacity').value = currentBrush().opacity;
  $('#side-opacity-value').textContent = currentBrush().opacity + '%';
  updateRanges(document.querySelector('.size-rail'));
  $('#onion').setAttribute('aria-pressed', onion);
  $('#grid').setAttribute('aria-pressed', grid);
  updateHistory();
  if (timelineOpen) {
    framesBuild();
    warmFrames();
  }
  if (toolWindows.has('layers') && layerPanelKey !== panelContext()) layersPanel();
  if (
    toolWindows.has('animation') &&
    animationPanelKey !== panelContext() + ':' + onion + ':' + playbackSpeed
  )
    animationPanel();
}
function thumb(p, f) {
  const c = document.createElement('canvas');
  paintBuffer(c, composite(p, f), p.w, p.h);
  return c;
}
function paintFrameThumbnail(index, source) {
  const row = $('#frames');
  if (row.dataset.structure !== [id, project.w, project.h, project.frames.length].join(':')) return;
  const preview = row.children[index]?.querySelector('canvas');
  if (!preview || preview.dataset.ready) return;
  const context = preview.getContext('2d');
  context.clearRect(0, 0, preview.width, preview.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0, preview.width, preview.height);
  preview.dataset.ready = 'true';
}
function framesBuild() {
  animationTimeline?.render();
  const row = $('#frames');
  if (animationTimeline?.isDetailed()) return;
  const key = id + ':' + dirtyVersion;
  if (thumbKey === key) {
    highlightFrames();
    return;
  }
  const affected = thumbKey === id + ':' + (dirtyVersion - 1) ? changedFrames : null;
  thumbKey = key;
  const structure = [id, project.w, project.h, project.frames.length].join(':');
  if (row.dataset.structure !== structure) {
    row.dataset.structure = structure;
    const fragment = document.createDocumentFragment();
    project.frames.forEach((_, i) => {
      const button = document.createElement('button');
      button.className = 'frame';
      const preview = document.createElement('canvas');
      const scale = Math.min(1, 96 / Math.max(project.w, project.h));
      preview.width = Math.max(1, Math.round(project.w * scale));
      preview.height = Math.max(1, Math.round(project.h * scale));
      button.append(preview, document.createElement('span'));
      button.onclick = () => {
        stop();
        frame = i;
        render();
        refresh();
      };
      fragment.append(button);
    });
    row.replaceChildren(fragment);
  }
  project.frames.forEach((f, i) => {
    const button = row.children[i];
    button.setAttribute('aria-label', `第 ${i + 1} 帧，${f.duration} 毫秒`);
    button.querySelector('span').textContent =
      String(i + 1).padStart(2, '0') + ' / ' + f.duration + ' ms';
    if (!affected || affected.includes(i)) delete button.querySelector('canvas').dataset.ready;
  });
  paintFrameThumbnail(frame, frameCanvas(frame));
  warmKey = '';
  highlightFrames();
}
function highlightFrames() {
  animationTimeline?.highlight();
  $('#project-detail').textContent =
    `${project.w} × ${project.h} · 第 ${frame + 1} 帧${editingMask() ? ' · 正在绘制遮罩' : tool === 'gradient' ? ' · 渐变' : ''}`;
  if (!$('#frames').hidden)
    $$('.frame').forEach((b, i) => {
      b.classList.toggle('active', i === frame);
      b.setAttribute('aria-pressed', i === frame);
    });
}
function stop() {
  procedural?.pause();
  playing = false;
  cancelAnimationFrame(playTimer);
  $('#play').innerHTML = svg('play');
  $('#play').setAttribute('aria-label', '播放动画');
}
function advancePlayback(now) {
  if (!playing) return;
  const result = playClock.advance(
    now,
    playbackSpeed,
    () => project.frames[frame].duration,
    () => {
      const next = animationTimeline.next();
      if (next === null) return false;
      frame = next;
      return true;
    },
  );
  if (result.changed) {
    render();
    highlightFrames();
  }
  if (result.ended) {
    stop();
    render();
    refresh();
  }
}
function tick(now) {
  if (!playing) return;
  advancePlayback(now);
  renderScheduler.flush();
  if (playing) playTimer = requestAnimationFrame(tick);
}
$('#play').onclick = () => {
  if (playing) {
    stop();
    render();
    refresh();
  } else {
    if (stroke || selectionUI?.transforming) {
      toast('请先完成笔画或选区变换');
      return;
    }
    frame = animationTimeline?.resetPlayback() ?? frame;
    playing = true;
    playClock = new PlaybackClock(performance.now());
    render();
    highlightFrames();
    $('#play').innerHTML = svg('pause');
    $('#play').setAttribute('aria-label', '暂停动画');
    playTimer = requestAnimationFrame(tick);
  }
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden && playing) {
    stop();
    render();
    refresh();
  }
});
['first', 'prev', 'next', 'last'].forEach(
  (n) =>
    ($('#' + n).onclick = () => {
      stop();
      frame =
        n === 'first'
          ? 0
          : n === 'last'
            ? project.frames.length - 1
            : (frame + (n === 'prev' ? -1 : 1) + project.frames.length) % project.frames.length;
      render();
      refresh();
    }),
);
for (const [id, action] of [
  ['duplicate-frame', 'duplicate'],
  ['add-frame', 'blank'],
]) {
  $('#' + id).onclick = () => {
    try {
      editProject((p) => {
        frame = editFrames(p, action, frame);
        if (action === 'blank') p.frames[frame].duration = 120;
      });
    } catch (error) {
      toast(error.message);
    }
  };
}
$('#onion').onclick = () => {
  onion = !onion;
  render();
  refresh();
  if (onion) toast('洋葱皮已开启：红色前帧 · 绿色后帧，可在动画设置调节');
};
$('#grid').onclick = () => {
  grid = !grid;
  render();
  refresh();
};
$('#fit').onclick = fit;
$('#zoom-label').onclick = fit;
$('#zoom-in').onclick = () => {
  camera.scale = Math.min(60, camera.scale * 1.25);
  render();
};
$('#zoom-out').onclick = () => {
  camera.scale = Math.max(0.05, camera.scale / 1.25);
  render();
};
$('#rotate').onclick = () => {
  camera.angle += Math.PI / 2;
  render();
};
function mirrorView(axis) {
  if (stroke) finishStroke(true);
  camera[axis] = !camera[axis];
  document
    .querySelectorAll('[data-mirror]')
    .forEach((b) => b.setAttribute('aria-pressed', String(!!camera[b.dataset.mirror])));
  render();
}
$('#mirror-view').onclick = () => mirrorView('flipX');
$('#quick-undo').onclick = undo;
$('#quick-redo').onclick = redo;
$('#pencil-only').onclick = () => {
  penOnly = !penOnly;
  settingsSave();
  refresh();
  if (toolWindows.has('settings')) settingsPanel();
};
$('#dismiss-hint').onclick = () => ($('#welcome-hint').hidden = true);
function toggleTimeline() {
  if (procedural?.active) return procedural.leave();
  timelineOpen = !timelineOpen;
  document.body.classList.toggle('timeline-closed', !timelineOpen);
  $('#timeline').inert = !timelineOpen;
  $('#timeline-toggle').setAttribute('aria-pressed', timelineOpen);
  if (timelineOpen) refresh();
  else {
    clearTimeout(warmTimer);
    warmKey = '';
  }
}
$('#timeline-toggle').onclick = toggleTimeline;
$('#collapse-timeline').onclick = toggleTimeline;
$('#title-button').onclick = async () => {
  const name = await askDialog({
    title: '重命名作品',
    description: '给这个像素世界取个名字。',
    value: project.name,
    confirm: '保存名称',
  });
  if (name?.trim()) {
    checkpoint();
    project.name = name.trim().slice(0, 160);
    changed();
  }
};
// Map the pointer through the inverse camera transform into integer pixels.
function contextToken() {
  if (lastSelection !== selection) {
    lastSelection = selection;
    selectionRevision++;
  }
  return [id, dirtyVersion, frame, layer, selectionRevision, color].join(':');
}
function chooseTool(next) {
  if (stroke) finishStroke(true);
  if (procedural?.active) procedural.leave();
  if (selectionUI?.transforming) selectionUI.finish(true);
  tool = next;
  if (['pencil', 'eraser', 'line', 'rect', 'ellipse'].includes(next)) {
    const previousMode = toolBrushes.mode;
    const nextMode = next === 'eraser' ? 'eraser' : 'pencil';
    toolBrushes.switch(nextMode);
    applyBrushSettings();
    if (previousMode !== nextMode && toolWindows.has('brush')) void brushPanel();
  }
  if (['select', 'wand', 'lasso', 'ellipse-select'].includes(next)) selectionUI?.show();
  else selectionUI?.leave();
  refresh();
  render();
}
function renderPins() {
  const shelf = $('#plugin-shortcuts');
  if (!shelf) return;
  shelf.innerHTML = pinnedPlugins
    .map((id) => {
      const p = PLUGINS.find((p) => p.id === id);
      return (
        '<button data-plugin-shortcut="' +
        p.id +
        '" aria-label="打开' +
        p.name +
        '设置" title="' +
        p.name +
        '">' +
        p.symbol +
        '</button>'
      );
    })
    .join('');
  shelf
    .querySelectorAll('button')
    .forEach((b) => (b.onclick = () => launchPlugins(b.dataset.pluginShortcut)));
}
function pinPlugin(plugin, value) {
  pinnedPlugins = pinnedPlugins.filter((id) => id !== plugin);
  if (value) pinnedPlugins.push(plugin);
  try {
    localStorage.setItem('pixel-studio-pins', JSON.stringify(pinnedPlugins));
  } catch {}
  renderPins();
  toast(value ? '已固定到左侧快捷工具栏' : '已从快捷工具栏移除');
}
function positionFloat(e) {
  const r = view.getBoundingClientRect();
  return canvasPoint(
    { x: e.clientX - r.left - cw / 2, y: e.clientY - r.top - ch / 2 },
    camera,
    project.w,
    project.h,
  );
}
function position(e) {
  const p = positionFloat(e);
  return { x: Math.floor(p.x), y: Math.floor(p.y) };
}
let maskTarget = null;
const editingMask = () => maskTarget === project.layers[layer] && !!maskTarget?.mask;
const gradientOptions = {
  type: 'linear',
  from: '#9b78f5',
  to: '#63d5dd',
  opacity: 1,
  steps: 0,
  dither: false,
  transparent: false,
};
function gradientPanel() {
  gradientSettings(panelContent('gradient'), {
    get: () => gradientOptions,
    set: (patch) => Object.assign(gradientOptions, patch),
    color: () => color,
    use: () => {
      chooseTool('gradient');
      toast('在画布上拖动绘制渐变');
    },
  });
}
function gradientStroke(end) {
  const pixels = applyGradient(
    stroke.maskEditing
      ? stroke.before.layers[layer].mask
      : readCel(stroke.before.frames[frame].cels[layer]),
    project.w,
    project.h,
    stroke.start,
    end,
    {
      ...gradientOptions,
      from: rgba(gradientOptions.from).slice(0, 3),
      to: rgba(gradientOptions.to).slice(0, 3),
    },
    { selection, alphaLock: project.layers[layer].alphaLock, mask: stroke.maskEditing },
  );
  if (stroke.maskEditing) project.layers[layer].mask = pixels;
  else project.frames[frame].cels[layer] = pixels;
}
function stamp(x, y, e) {
  const brush = stroke?.brush || currentBrush();
  const n =
    brush.pressure && e.pointerType === 'pen'
      ? Math.max(
          1,
          Math.round(
            brush.size * (0.25 + 0.75 * pressureResponse(e.pressure, brush.pressureCurve)),
          ),
        )
      : brush.size;
  stampBrush({
    pixels: editCel(project.frames[frame], layer),
    pressureFactor:
      brush.opacityPressure && e.pointerType === 'pen'
        ? pressureResponse(e.pressure, brush.pressureCurve)
        : 1,
    coverage: stroke?.coverage,
    alphaLock: !!project.layers[layer].alphaLock,
    layerMask: stroke?.maskEditing ? project.layers[layer].mask : null,
    baseLayerMask: stroke?.maskEditing ? stroke.before.layers[layer].mask : null,
    w: project.w,
    h: project.h,
    x,
    y,
    size: n,
    brush,
    color: rgba(color),
    secondary: rgba(brush.dither.secondaryColor),
    selection: ['select', 'select-erase'].includes(stroke?.magic?.mode) ? null : selection,
    mask: stroke?.magic ? stroke.mask : null,
    erase: tool === 'eraser',
    base: readCel(stroke?.before.frames[frame].cels[layer]),
  });
}
function shapeStroke(a, b, e) {
  if (tool === 'line') line(a.x, a.y, b.x, b.y, (x, y) => stamp(x, y, e));
  else if (tool === 'rect') {
    line(a.x, a.y, b.x, a.y, (x, y) => stamp(x, y, e));
    line(b.x, a.y, b.x, b.y, (x, y) => stamp(x, y, e));
    line(b.x, b.y, a.x, b.y, (x, y) => stamp(x, y, e));
    line(a.x, b.y, a.x, a.y, (x, y) => stamp(x, y, e));
  } else {
    const mx = (a.x + b.x) / 2,
      my = (a.y + b.y) / 2,
      rx = Math.abs(b.x - a.x) / 2,
      ry = Math.abs(b.y - a.y) / 2,
      steps = Math.max(12, Math.ceil(Math.max(rx, ry) * 8));
    let prev = { x: Math.round(mx + rx), y: Math.round(my) };
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2,
        next = { x: Math.round(mx + rx * Math.cos(t)), y: Math.round(my + ry * Math.sin(t)) };
      line(prev.x, prev.y, next.x, next.y, (x, y) => stamp(x, y, e));
      prev = next;
    }
  }
}
// Pointer Events own pen/mouse strokes; full TouchEvent lists own finger gestures.
const pointers = new Map();
let penActive = false,
  gesture = null,
  gestureCamera = null;
function beginStroke(e) {
  if (stroke || $('dialog[open]')) return;
  if (artworkWindow?.editing && e.button !== 1) {
    if (artworkWindow.begin(e, positionFloat(e)))
      stroke = { artworkAction: true, id: e.pointerId, type: e.pointerType };
    return;
  }
  if (procedural?.active && e.button === 1) {
    procedural.pause();
    stroke = {
      pan: true,
      start: { x: e.clientX, y: e.clientY },
      camera: { ...camera },
      id: e.pointerId,
      type: e.pointerType,
    };
    return;
  }
  if (procedural?.active) {
    stroke = { proceduralAction: true, id: e.pointerId, type: e.pointerType };
    procedural.begin(e, positionFloat(e));
    return;
  }
  if (
    (project.layers[layer].group || layerLocked(project, layer)) &&
    !['hand', 'pick', 'select', 'wand', 'lasso', 'ellipse-select'].includes(tool)
  ) {
    toast(
      project.layers[layer].group ? '请选择组内的像素图层绘画' : '当前图层已锁定，可在图层面板解锁',
    );
    return;
  }
  stop();
  const p = position(e);
  if (
    e.pointerType === 'touch' &&
    penOnly &&
    !['select', 'wand', 'lasso', 'ellipse-select'].includes(tool) &&
    !selectionUI?.transforming
  ) {
    stroke = { eyedropperWait: true, id: e.pointerId, type: e.pointerType, beforeColor: color };
    armHold(e);
    return;
  }
  if (selectionUI?.begin(e, positionFloat(e), tool)) {
    stroke = { selectionAction: true, id: e.pointerId, type: e.pointerType };
    return;
  }
  if (tool === 'hand' || e.button === 1) {
    stroke = {
      pan: true,
      start: { x: e.clientX, y: e.clientY },
      camera: { ...camera },
      id: e.pointerId,
      type: e.pointerType,
    };
    return;
  }
  if (p.x < 0 || p.y < 0 || p.x >= project.w || p.y >= project.h) return;
  if (tool === 'select') {
    stroke = {
      selecting: true,
      start: p,
      id: e.pointerId,
      type: e.pointerType,
      beforeSelection: selection,
    };
    selection = rectangleMask(project.w, project.h, p, p);
    render();
    return;
  }
  if (tool === 'pick') {
    const c = composite(project, frame),
      i = (p.y * project.w + p.x) * 4;
    color = '#' + Array.from(c.subarray(i, i + 3), (v) => v.toString(16).padStart(2, '0')).join('');
    chooseTool('pencil');
    return;
  }
  if (!project.layers[layer].visible) {
    toast('先显示当前图层，再开始绘画');
    return;
  }
  stroke = {
    before: clone(project),
    start: p,
    last: p,
    id: e.pointerId,
    type: e.pointerType,
    tool,
    brush: normalizeBrush(currentBrush()),
    coverage: new Uint8Array(project.w * project.h),
    maskEditing: editingMask(),
    magic:
      !editingMask() && magicConfig.enabled && ['pencil', 'line', 'rect', 'ellipse'].includes(tool)
        ? { ...magicConfig }
        : null,
    mask: new Uint8Array(project.w * project.h),
  };
  if (tool === 'gradient') {
    render();
    return;
  }
  if (tool === 'fill') {
    flood(editCel(project.frames[frame], layer), project.w, project.h, p.x, p.y, rgba(color));
    if (selection)
      for (let i = 0; i < selection.length; i++)
        if (!selection[i])
          editCel(project.frames[frame], layer).set(
            readCel(stroke.before.frames[frame].cels[layer]).subarray(i * 4, i * 4 + 4),
            i * 4,
          );
    const before = readCel(stroke.before.frames[frame].cels[layer]),
      filled = editCel(project.frames[frame], layer);
    if (stroke.maskEditing) {
      const gray = new Uint8ClampedArray(project.w * project.h * 4),
        mask = project.layers[layer].mask;
      for (let i = 0; i < mask.length; i++) gray.set([mask[i], mask[i], mask[i], 255], i * 4);
      const original = new Uint8ClampedArray(gray),
        value = Math.round(0.3 * rgba(color)[0] + 0.59 * rgba(color)[1] + 0.11 * rgba(color)[2]);
      flood(gray, project.w, project.h, p.x, p.y, [value, value, value, 255]);
      for (let i = 0; i < mask.length; i++)
        if ((!selection || selection[i]) && gray[i * 4] !== original[i * 4])
          paintMask(mask, stroke.before.layers[layer].mask, i, value, stroke.brush.opacity / 100);
      project.frames[frame].cels[layer] = new Uint8ClampedArray(before);
    } else
      project.frames[frame].cels[layer] = mixPaintEffect(
        before,
        filled,
        stroke.brush.opacity / 100,
        project.layers[layer].alphaLock,
      );
  } else stamp(p.x, p.y, e);
  magicPreview();
  if (['pencil', 'eraser'].includes(tool)) armHold(e);
  render();
}
function moveStroke(e) {
  if (!stroke || stroke.id !== e.pointerId) return;
  if (stroke.artworkAction) {
    artworkWindow.move(e, positionFloat(e));
    return;
  }
  if (stroke.proceduralAction) {
    procedural.move(e, positionFloat(e));
    return;
  }
  if (stroke.selectionAction) {
    selectionUI.move(e, positionFloat(e));
    return;
  }
  if (trackHold(e)) return;
  if (stroke.selecting) {
    selection = rectangleMask(project.w, project.h, stroke.start, position(e));
    render();
    return;
  }
  if (stroke.pan) {
    camera.x = stroke.camera.x + e.clientX - stroke.start.x;
    camera.y = stroke.camera.y + e.clientY - stroke.start.y;
    render();
    return;
  }
  if (['line', 'rect', 'ellipse', 'gradient'].includes(tool)) {
    shapePreview.push(e);
    return;
  }
  const events = e.getCoalescedEvents?.() || [e];
  for (const sample of events.length ? events : [e]) {
    const p = position(sample);
    p.x = Math.max(
      -Math.max(project.w, project.h),
      Math.min(2 * Math.max(project.w, project.h), p.x),
    );
    p.y = Math.max(
      -Math.max(project.w, project.h),
      Math.min(2 * Math.max(project.w, project.h), p.y),
    );
    if (['line', 'rect', 'ellipse'].includes(tool)) {
      stroke.mask.fill(0);
      project.frames[frame].cels[layer] = new Uint8ClampedArray(
        readCel(stroke.before.frames[frame].cels[layer]),
      );
      shapeStroke(stroke.start, p, e);
    } else if (tool !== 'fill')
      line(stroke.last.x, stroke.last.y, p.x, p.y, (x, y) => stamp(x, y, sample));
    stroke.last = p;
  }
  magicPreview();
  render();
}
function magicPreview() {
  if (!stroke?.magic) return;
  const output = magicPixels(
    readCel(stroke.before.frames[frame].cels[layer]),
    project.w,
    project.h,
    stroke.mask,
    stroke.magic,
    color,
    palette,
  );
  mixStrokeOpacity(
    readCel(stroke.before.frames[frame].cels[layer]),
    output,
    stroke.brush.opacity,
    stroke.brush.opacityPressure ? stroke.coverage : null,
  );
  if (project.layers[layer].alphaLock) {
    const locked = mixPaintEffect(
      readCel(stroke.before.frames[frame].cels[layer]),
      output,
      1,
      true,
    );
    output.set(locked);
  }
  if (selection && !['select', 'select-erase'].includes(stroke.magic.mode))
    for (let i = 0; i < selection.length; i++)
      if (!selection[i])
        output.set(
          readCel(stroke.before.frames[frame].cels[layer]).subarray(i * 4, i * 4 + 4),
          i * 4,
        );
  project.frames[frame].cels[layer] = output;
}
function finishStroke(cancel = false) {
  clearTimeout(holdTimer);
  clearTimeout(shapeTimer);
  if (cancel) shapePreview.clear();
  else shapePreview.flush();
  if (!stroke) return;
  const current = stroke;
  stroke = null;
  if (current.artworkAction) {
    artworkWindow.end(cancel);
    return;
  }
  if (current.proceduralAction) {
    procedural.end(cancel);
    return;
  }
  $('#held-color').hidden = true;
  if (current.selectionAction) {
    selectionUI.end(cancel);
    document.dispatchEvent(new Event('pixel-studio-context'));
    return;
  }
  if (current.picking || current.eyedropperWait) {
    if (cancel && current.beforeColor) color = current.beforeColor;
    refresh();
    render();
    return;
  }
  if (current.selecting) {
    if (cancel) selection = current.beforeSelection;
    render();
    return;
  }
  if (current.pan) return;
  if (cancel) {
    project = current.before;
    render();
    return;
  }
  try {
    if (current.magic?.mode === 'select' || current.magic?.mode === 'select-erase') {
      const mask = selection ? new Uint8Array(selection) : new Uint8Array(project.w * project.h);
      for (let i = 0; i < mask.length; i++)
        if (current.mask[i]) mask[i] = current.magic.mode === 'select' ? 1 : 0;
      selection = maskBounds(mask, project.w, project.h) ? mask : null;
      project = current.before;
      render();
      refresh();
      return;
    }
    if (current.magic?.mode === 'lift' || current.magic?.mode === 'merge') {
      project = extractMasked(
        current.before,
        frame,
        layer,
        current.mask,
        current.magic.mode === 'merge',
      );
      layer = project.layers.length - 1;
    }
    checkpoint(current.before);
    changed(
      !current.maskEditing && project.layers.length === current.before.layers.length
        ? [frame]
        : null,
    );
  } catch (e) {
    project = current.before;
    toast(e.message);
    render();
    refresh();
  }
}
function sampleHeldColor(e) {
  const p = position(e);
  if (p.x < 0 || p.y < 0 || p.x >= project.w || p.y >= project.h) return;
  const pixels = (stroke.pickPixels ||= composite(stroke.before || project, frame)),
    offset = (p.y * project.w + p.x) * 4;
  if (!pixels[offset + 3]) return;
  color =
    '#' +
    Array.from(pixels.subarray(offset, offset + 3), (v) => v.toString(16).padStart(2, '0')).join(
      '',
    );
  const chip = $('#held-color');
  chip.hidden = false;
  chip.style.background = color;
  chip.style.left = e.clientX + 'px';
  chip.style.top = e.clientY + 'px';
  $$('.color-dot').forEach((dot) => (dot.style.background = color));
}
function armHold(e) {
  clearTimeout(holdTimer);
  clearTimeout(shapeTimer);
  const current = stroke;
  current.beforeColor = color;
  current.hold = {
    origin: { x: e.clientX, y: e.clientY },
    last: { x: e.clientX, y: e.clientY },
    event: {
      clientX: e.clientX,
      clientY: e.clientY,
      pointerType: e.pointerType,
      pressure: e.pressure,
    },
    points: [positionFloat(e)],
    moved: false,
  };
  holdTimer = setTimeout(() => {
    if (stroke !== current || current.hold.moved) return;
    if (current.before) project = current.before;
    current.picking = true;
    sampleHeldColor(current.hold.event);
    render();
    toast('已取色，拖动可继续取色');
  }, 650);
}
const shapePreview = new ShapePreview((e) => {
  const current = stroke;
  if (!current?.before) return;
  editCel(project.frames[frame], layer).set(readCel(current.before.frames[frame].cels[layer]));
  current.mask.fill(0);
  current.coverage.fill(0);
  if (current.maskEditing) project.layers[layer].mask.set(current.before.layers[layer].mask);
  if (tool === 'gradient') {
    gradientStroke(position(e));
    render();
    return;
  }
  if (current.quick) {
    const points = adjustShape(current.quick.shape, current.quick.hold, positionFloat(e));
    traceShape(points, project.w, project.h, size, (x, y) => stamp(x, y, e));
  } else {
    const p = position(e);
    p.x = Math.max(
      -Math.max(project.w, project.h),
      Math.min(2 * Math.max(project.w, project.h), p.x),
    );
    p.y = Math.max(
      -Math.max(project.w, project.h),
      Math.min(2 * Math.max(project.w, project.h), p.y),
    );
    shapeStroke(current.start, p, e);
    current.last = p;
  }
  magicPreview();
  render();
});
function drawQuick(e) {
  if (stroke?.quick) shapePreview.push(e);
}
function trackHold(e) {
  const h = stroke?.hold;
  if (!h) return false;
  h.event = {
    clientX: e.clientX,
    clientY: e.clientY,
    pointerType: e.pointerType,
    pressure: e.pressure,
  };
  if (stroke.picking) {
    sampleHeldColor(e);
    return true;
  }
  if (stroke.quick) {
    drawQuick(e);
    return true;
  }
  if (Math.hypot(e.clientX - h.origin.x, e.clientY - h.origin.y) > 8) {
    h.moved = true;
    clearTimeout(holdTimer);
  }
  if (stroke.eyedropperWait) return true;
  if (Math.hypot(e.clientX - h.last.x, e.clientY - h.last.y) > 2) {
    h.last = { x: e.clientX, y: e.clientY };
    h.points.push(positionFloat(e));
    if (h.points.length > 2048) h.points = h.points.filter((_, i) => i % 2 === 0);
    clearTimeout(shapeTimer);
    if (tool === 'pencil' && h.moved) {
      const current = stroke;
      shapeTimer = setTimeout(() => {
        if (stroke !== current) return;
        const shape = recognizeShape(h.points, current.start);
        if (!shape) return;
        current.quick = { shape, hold: positionFloat(h.event) };
        drawQuick(h.event);
        toast('已识别' + shape.name + ' · 起笔固定，拖动缩放与旋转');
      }, shapeHoldMs);
    }
  }
  return false;
}

const fingerEvent = (p) => ({
  clientX: p.x,
  clientY: p.y,
  pointerId: 'finger-' + p.id,
  pointerType: 'touch',
  pressure: 0.5,
  button: 0,
});
function centerPair(p) {
  const r = view.getBoundingClientRect();
  return { ...p, x: p.x - r.left - cw / 2, y: p.y - r.top - ch / 2 };
}
const fingers = new FingerSession({
  canDraw: () => !penActive && !$('dialog[open]') && $('#panel').hidden,
  begin: (p) => beginStroke(fingerEvent(p)),
  move: (p) => moveStroke(fingerEvent(p)),
  end: (cancel) => finishStroke(cancel),
  gestureStart: (p) => {
    stop();
    gesture = { ...centerPair(p) };
    gestureCamera = { ...camera };
    document.body.classList.add('gesturing');
  },
  gestureMove: (p) => {
    if (!gesture) return;
    camera = pinchCamera(gestureCamera, gesture, centerPair(p));
    render();
  },
  gestureEnd: () => {
    gesture = null;
    document.body.classList.remove('gesturing');
    render();
  },
  undo,
  redo,
});
const touchSupported = 'ontouchstart' in window;
function touchInput(e) {
  if (penActive) {
    if (e.cancelable) e.preventDefault();
    return;
  }
  if (!fingers.active && e.target !== view) return;
  const points = Array.from(e.touches)
    .filter((t) => t.touchType !== 'stylus')
    .map((t) => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
  if (!points.length && !fingers.active) return;
  if (e.cancelable) e.preventDefault();
  fingers.update(points, { cancel: e.type === 'touchcancel' });
}
for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'])
  stage.addEventListener(type, touchInput, { passive: false, capture: true });
// Safari's native page gesture must not compete with the canvas transform.
for (const type of ['gesturestart', 'gesturechange', 'gestureend'])
  stage.addEventListener(type, (e) => e.preventDefault(), { passive: false });
view.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') {
    if (touchSupported) return;
    e.preventDefault();
    pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
    fingers.update([...pointers.values()]);
    try {
      if (e.isTrusted) view.setPointerCapture(e.pointerId);
    } catch {}
    return;
  }
  if (e.button !== 0 && e.button !== 1 && e.pointerType === 'mouse') return;
  e.preventDefault();
  if (e.pointerType === 'pen') {
    fingers.update([], { cancel: true });
    penActive = true;
  }
  try {
    if (e.isTrusted) view.setPointerCapture(e.pointerId);
  } catch {}
  beginStroke(e);
});
view.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') {
    if (touchSupported || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
    fingers.update([...pointers.values()]);
    return;
  }
  moveStroke(e);
});
function endPointer(e, cancel = false) {
  if (e.pointerType === 'touch') {
    if (touchSupported) return;
    pointers.delete(e.pointerId);
    fingers.update([...pointers.values()], { cancel });
    return;
  }
  if (stroke?.id === e.pointerId) finishStroke(cancel);
  if (e.pointerType === 'pen') penActive = false;
}
view.addEventListener('pointerup', (e) => endPointer(e));
view.addEventListener('pointercancel', (e) => endPointer(e, true));
view.addEventListener('lostpointercapture', (e) => {
  const wasPen = stroke?.id === e.pointerId && stroke?.type === 'pen';
  if (stroke?.id === e.pointerId) finishStroke(true);
  if (e.pointerType === 'pen' || wasPen) penActive = false;
});
function cancelCanvasInput() {
  if (stroke) finishStroke(true);
  penActive = false;
  pointers.clear();
  fingers.update([], { cancel: true });
}
window.addEventListener('blur', cancelCanvasInput);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelCanvasInput();
});
view.addEventListener('contextmenu', (e) => e.preventDefault());
view.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const r = view.getBoundingClientRect(),
      x = e.clientX - r.left - cw / 2,
      y = e.clientY - r.top - ch / 2,
      prev = camera.scale;
    camera.scale = Math.max(0.05, Math.min(60, prev * Math.exp(-e.deltaY * 0.001)));
    const q = camera.scale / prev;
    camera.x = x - (x - camera.x) * q;
    camera.y = y - (y - camera.y) * q;
    render();
  },
  { passive: false },
);
let floatDrag;
$('#float-drag').onpointerdown = (e) => {
  e.preventDefault();
  const r = $('#floatbar').getBoundingClientRect(),
    s = stage.getBoundingClientRect();
  floatDrag = { x: e.clientX, y: e.clientY, left: r.left - s.left, top: r.top - s.top };
  if (e.isTrusted) e.target.setPointerCapture(e.pointerId);
};
$('#float-drag').onpointermove = (e) => {
  if (!floatDrag) return;
  const b = $('#floatbar');
  b.style.transform = 'none';
  b.style.bottom = 'auto';
  b.style.left =
    Math.max(0, Math.min(cw - b.offsetWidth, floatDrag.left + e.clientX - floatDrag.x)) + 'px';
  b.style.top =
    Math.max(0, Math.min(ch - b.offsetHeight, floatDrag.top + e.clientY - floatDrag.y)) + 'px';
};
$('#float-drag').onpointerup = $('#float-drag').onpointercancel = () => (floatDrag = null);
const toolWindows = createToolWindows((type) => {
  panelType = type || '';
  if (!toolWindows.has('layers')) stopLayerPreviews();
  $$('[data-panel]').forEach((b) => {
    const open = toolWindows.has(b.dataset.panel);
    b.classList.toggle('selected', open);
    b.setAttribute('aria-expanded', open);
    b.setAttribute('aria-controls', 'window-' + b.dataset.panel);
  });
  for (const [selector, type] of [
    ['#header-color', 'color'],
    ['#capacity-indicator', 'capacity'],
  ]) {
    const button = $(selector);
    button.setAttribute('aria-expanded', String(toolWindows.has(type)));
    button.setAttribute('aria-controls', 'window-' + type);
  }
});
const panelContent = (type) => toolWindows.content(type);
function openPanel(type, opener = document.activeElement) {
  if (stroke) finishStroke(true);
  closePrimaryPanels(type);
  const titles = {
    color: '颜色与色板',
    brush: '笔刷库',
    expand: '扩展画布',
    layers: '图层',
    export: '分享作品',
    settings: '偏好设置',
    animation: '动画编辑',
    tools: '绘画工具',
    gradient: '渐变',
    capacity: '画布容量',
  };
  toolWindows.toggle(
    type,
    titles[type],
    () =>
      ({
        color: colorPanel,
        brush: brushPanel,
        expand: expansionPanel,
        layers: layersPanel,
        export: exportPanel,
        settings: settingsPanel,
        animation: animationPanel,
        tools: toolsPanel,
        gradient: gradientPanel,
        capacity: capacityPanel,
      })[type](),
    opener,
  );
}
async function closePanel(type = panelType) {
  toolWindows.close(type);
}
$$('[data-panel]').forEach((b) => (b.onclick = () => openPanel(b.dataset.panel, b)));
$('#header-color').onclick = (e) => openPanel('color', e.currentTarget);
$('#side-size').oninput = (event) => {
  updateBrush({ size: Number(event.target.value) }, false);
  brushController?.sync();
  brushFeedback(event.target);
};
$('#side-size').onchange = persistBrushes;
$('#side-opacity').oninput = (event) => {
  updateBrush({ opacity: Number(event.target.value) }, false);
  brushController?.sync();
  brushFeedback(event.target);
};
$('#side-opacity').onchange = persistBrushes;
let brushFeedbackTimer;
function brushFeedback(input) {
  let hud = $('#brush-parameter-hud');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'brush-parameter-hud';
    hud.setAttribute('aria-hidden', 'true');
    hud.innerHTML = '<span></span><strong></strong><i></i>';
    document.body.append(hud);
  }
  const brush = currentBrush(),
    sizing = input.id === 'side-size',
    box = input.getBoundingClientRect();
  hud.hidden = false;
  hud.querySelector('span').textContent = sizing ? '笔刷大小' : '不透明度';
  hud.querySelector('strong').textContent = input.value + (sizing ? ' px' : '%');
  const tip = hud.querySelector('i');
  tip.style.width = tip.style.height = Math.max(2, brush.size * 2) + 'px';
  tip.style.borderRadius = brush.shape === 'round' ? '50%' : '0';
  tip.style.opacity = brush.opacity / 100;
  hud.style.left = box.right + 24 + 'px';
  hud.style.top = box.top + box.height / 2 + 'px';
  clearTimeout(brushFeedbackTimer);
  brushFeedbackTimer = setTimeout(() => (hud.hidden = true), 650);
}
for (const input of [$('#side-size'), $('#side-opacity')])
  input.addEventListener('pointerdown', () => brushFeedback(input));
const primaryPanels = ['brush', 'layers', 'color', 'settings', 'tools', 'export'];
let suppressPaletteTouch = 0;
function closePrimaryPanels(except) {
  if (multipleWindows) return;
  for (const type of primaryPanels) if (type !== except) toolWindows.close(type);
}
document.addEventListener(
  'pointerdown',
  (event) => {
    if (
      multipleWindows ||
      event.target !== view ||
      !primaryPanels.some((type) => toolWindows.has(type))
    )
      return;
    closePrimaryPanels();
    suppressPaletteTouch = event.pointerType === 'touch' ? performance.now() + 350 : 0;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);
document.addEventListener(
  'touchstart',
  (event) => {
    if (event.target === view && performance.now() < suppressPaletteTouch) {
      suppressPaletteTouch = 0;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  { capture: true, passive: false },
);
function showBrushLibrary(group = null) {
  closePrimaryPanels('brush');
  requestedBrushGroup = group;
  if (toolWindows.has('brush')) {
    toolWindows.open('brush', '笔刷库', brushPanel);
    if (brushController && group) brushController.group(group);
  } else toolWindows.open('brush', '笔刷库', brushPanel);
}
let pluginRequest = 0,
  pendingPlugin;
async function launchPlugins(initialPlugin = null) {
  if (initialPlugin === 'magic') {
    showBrushLibrary('magic');
    return;
  }
  if (project.layers[layer].group || layerLocked(project, layer)) {
    toast('请先选择可编辑的像素图层，再使用插件');
    return;
  }
  if (typeof initialPlugin !== 'string') initialPlugin = null;
  stop();
  if (stroke) finishStroke(true);
  const request = ++pluginRequest;
  if (pendingPlugin === initialPlugin) {
    pendingPlugin = undefined;
    return;
  }
  if (pluginWindow) {
    const same = pluginWindow.initialPlugin === initialPlugin;
    if (same && pluginWindow.element.classList.contains('float-collapsed')) {
      pluginWindow.expand();
      return;
    }
    pluginWindow.close();
    if (same) return;
  }
  pendingPlugin = initialPlugin;
  let openPlugins;
  try {
    ({ openPlugins } = await import('./plugins.js'));
  } catch {
    if (request !== pluginRequest) return;
    pendingPlugin = undefined;
    toast('插件暂未加载，请联网重试');
    return;
  }
  if (request !== pluginRequest) return;
  pendingPlugin = undefined;
  pluginWindow = openPlugins(
    {
      snapshot: () => ({
        project,
        frame,
        layer,
        color,
        palette,
        selection,
        context: contextToken(),
      }),
      busy: () => !!stroke || !!selectionUI?.transforming,
      pinned: (id) => pinnedPlugins.includes(id),
      pin: pinPlugin,
      closed: () => {
        pluginWindow = null;
      },
      brushes: () => showBrushLibrary('magic'),
      selectTool: () => chooseTool('select'),
      setSelection: (mask) => {
        selection = mask;
        selectionUI.update();
        render();
      },
      newProject: loadProject,
      commit: (next, mask) => {
        validate(next, { reusePixels: true });
        checkpoint();
        const addedLayer = next.layers.length > project.layers.length;
        project = next;
        frame = Math.min(frame, project.frames.length - 1);
        layer = addedLayer ? project.layers.length - 1 : Math.min(layer, project.layers.length - 1);
        if (mask !== undefined) selection = mask;
        changed();
      },
    },
    initialPlugin,
  );
}
let artworkWindow = null;
async function openArtwork(kind) {
  if (stroke || selectionUI?.transforming) return toast('请先完成笔画或选区变换');
  if (kind === 'outline' && (project.layers[layer].group || layerLocked(project, layer)))
    return toast('请选择未锁定的像素图层');
  procedural?.leave();
  toolWindows.closeAll();
  artworkWindow?.close();
  const { openArtworkPanel } = await import('./artwork-panel.js');
  artworkWindow = openArtworkPanel(
    {
      snapshot: () => ({
        project,
        frame,
        layer,
        mask: selection ? new Uint8Array(selection) : null,
        context: panelContext(),
      }),
      color: () => color,
      render,
      scale: () => camera.scale,
      context: panelContext,
      apply: (pixels, name, context) => {
        if (context !== panelContext()) throw Error('作品已改变，请重新打开编辑面板');
        const next = clone(project),
          index = addLayer(next, -1, false);
        next.layers[index].name = name;
        next.frames[frame].cels[index] = new Uint8ClampedArray(pixels);
        commitProject(next, { focus: { frame, layer: index } });
        selection = Uint8Array.from({ length: project.w * project.h }, (_, i) =>
          pixels[i * 4 + 3] ? 1 : 0,
        );
        chooseTool('select');
        selectionUI.show();
        render();
        toast('已添加独立像素图层，可继续变换');
      },
    },
    kind,
  );
}
function toolsPanel() {
  panelContent('tools').innerHTML =
    '<p class="panel-intro">选择一个工具，回到画布开始创作。</p><div class="tool-grid">' +
    [
      ['pencil', '像素铅笔'],
      ['eraser', '橡皮擦'],
      ['fill', '颜色填充'],
      ['gradient', '渐变'],
      ['line', '直线'],
      ['rect', '矩形'],
      ['ellipse', '椭圆'],
      ['pick', '吸管'],
      ['hand', '移动画布'],
      ['select', '矩形选区'],
      ['wand', '魔棒选择'],
    ]
      .map(
        ([key, label]) =>
          '<button data-pick-tool="' +
          key +
          '" class="' +
          (tool === key ? 'active' : '') +
          '">' +
          svg(key) +
          '<span>' +
          label +
          '</span></button>',
      )
      .join('') +
    '</div><button id="tools-text" class="panel-wide">像素文字 <span>中日英 · 横竖排 · 透视 ›</span></button><button id="tools-outline" class="panel-wide">像素描边 <span>选区 / 当前图层 ›</span></button><button id="tools-expand" class="panel-wide">扩展画布 <span>四方向 · ›</span></button><button id="open-plugins" class="panel-wide">✦ 插件工作台 · 5 个扩展</button>';
  $('#open-plugins').onclick = launchPlugins;
  $('#tools-text').onclick = () => openArtwork('text');
  $('#tools-outline').onclick = () => openArtwork('outline');
  $('#tools-expand').onclick = (event) => openPanel('expand', event.currentTarget);
  $$('[data-pick-tool]').forEach(
    (b) =>
      (b.onclick = () => {
        chooseTool(b.dataset.pickTool);
        closePanel('tools');
        if (b.dataset.pickTool === 'gradient') openPanel('gradient');
      }),
  );
}
function colorPanel() {
  colorController = colorStudio(panelContent('color'), {
    color: () => color,
    setColor: (next) => {
      color = next;
      $$('.color-dot').forEach((dot) => (dot.style.background = color));
    },
    palette: (next) => {
      palette = next;
    },
    pixels: () => composite(project, frame),
    ask: askDialog,
    toast,
  });
}
async function brushPanel() {
  const root = panelContent('brush');
  brushController = null;
  root.innerHTML = '<p class="help">正在准备笔刷库…</p>';
  try {
    const { createBrushPanel } = await import('./brush-library.js');
    if (!root.isConnected) return;
    brushController = createBrushPanel(
      root,
      {
        current: currentBrush,
        brushes: () => toolBrushes.brushes(),
        mode: () => toolBrushes.mode,
        color: () => color,
        palette: () => palette,
        select: selectBrush,
        update: updateBrush,
        persist: persistBrushes,
        close: () => closePanel('brush'),
        ask: askDialog,
        duplicate: (name) => {
          if (brushLibrary.brushes.filter((brush) => brush.group === 'user').length >= 48) {
            toast('自定义笔刷最多 48 支，请删除不用的笔刷');
            return false;
          }
          const copy = normalizeBrush(
            { id: 'user-' + crypto.randomUUID(), name, group: 'user' },
            currentBrush(),
          );
          brushLibrary.brushes.push(copy);
          selectBrush(copy.id);
          return true;
        },
        reset: () => updateBrush(BRUSH_PRESETS.find((brush) => brush.id === currentBrush().id)),
        remove: () => {
          if (currentBrush().group !== 'user') return;
          brushLibrary.brushes = brushLibrary.brushes.filter(
            (brush) => brush.id !== currentBrush().id,
          );
          selectBrush('pixel-hard');
        },
      },
      requestedBrushGroup,
    );
    requestedBrushGroup = null;
  } catch (error) {
    root.textContent = '笔刷库加载失败：' + error.message;
  }
}
async function expansionPanel() {
  const root = panelContent('expand');
  root.innerHTML = '<p class="help">正在准备画布预览…</p>';
  try {
    const { createExpansionPanel } = await import('./canvas-expansion.js');
    if (!root.isConnected) return;
    expansionController = createExpansionPanel(root, {
      snapshot: () => ({ project, frame, key: panelContext() }),
      apply: (sides) => {
        if (stroke || selectionUI?.transforming) throw Error('请先结束笔画或完成选区变换。');
        const next = expandCanvas(project, sides);
        checkCanvasSupport(next.w, next.h);
        stop();
        checkpoint();
        project = next;
        selection = null;
        changed();
        fit();
        toast('画布已扩展，可撤销');
      },
      close: () => closePanel('expand'),
    });
  } catch (error) {
    root.textContent = '画布设置加载失败：' + error.message;
  }
}
function panelContext() {
  return [id, dirtyVersion, frame, layer].join(':');
}
let layerSolo = null,
  suppressVisibilityClick = 0;
const layerPreviews = createLayerPreviewCache();
const layerPreviewJobs = new Set();
let disposeLayerList = () => {};
function stopLayerPreviews() {
  disposeLayerList();
  for (const job of layerPreviewJobs) cancelAnimationFrame(job);
  layerPreviewJobs.clear();
}
function layersPanel() {
  stopLayerPreviews();
  layerPanelKey = panelContext();
  const optionsOpen = panelContent('layers').querySelector('#layer-options')?.hidden === false;
  const adjustmentsOpen = !!panelContent('layers').querySelector('.layer-adjustments')?.open;
  const previousScroll = panelContent('layers').scrollTop;
  const c = panelContent('layers'),
    selected = project.layers[layer],
    parent = parentLayer(project, layer),
    end = subtreeEnd(project, layer);
  c.innerHTML = `<div class="layers-toolbar"><span>${project.layers.length} 图层</span><button id="add-group" aria-label="新建图层组">新建组</button><button id="add-layer" aria-label="新建图层">＋</button></div><div id="layer-list"></div><p class="layers-gesture-hint">轻点选择 · N 打开属性 · 右滑合并 · 左滑快捷操作 · 按住拖动排序</p><section id="layer-options" hidden aria-label="图层选项"><div class="layer-options-head"><strong>${esc(selected.name)}</strong><button id="layer-options-close" aria-label="关闭图层选项">×</button></div><label>不透明度 <output class="row-value" id="opacity-value">${Math.round((selected.opacity / 255) * 100)}%</output><input id="opacity" aria-label="图层不透明度" type="range" min="0" max="255" value="${selected.opacity}"></label><div class="layer-option-grid"><button id="rename-layer">重命名</button><button id="layer-outline">描边</button><button id="duplicate-layer">复制</button><button id="lock-layer">${selected.locked ? '解锁' : '锁定'}</button><button id="clear-layer">清空当前帧</button><button id="layer-up">上移</button><button id="layer-down">下移</button><button id="group-layer">编组</button><button id="ungroup-layer">解散组</button><button id="delete-layer" class="danger">删除图层</button></div><details><summary>移至图层组</summary><label>目标位置<select id="layer-parent"><option value="-1">画布根目录</option>${project.layers.map((l, i) => (l.group && (i < layer || i >= end) ? `<option value="${i}">${esc(l.name)}</option>` : '')).join('')}</select></label><button id="move-to-group" class="panel-wide">移入所选位置</button></details>${selected.group && selected.isolated === false ? '<p class="help">旧版 ASE 直通组保持原作合成方式，组不透明度不可单独修改。</p>' : ''}</section>`;
  function showLayerOptions(open, restore = false) {
    if (!restore && open) c.dataset.listScroll = String(c.scrollTop);
    $('#layer-options').hidden = !open;
    $('#layer-list').hidden = open;
    c.querySelector('.layers-gesture-hint').hidden = open;
    if (!restore) c.scrollTop = open ? 0 : Number(c.dataset.listScroll || 0);
  }
  showLayerOptions(optionsOpen, true);
  const run = (fn) => {
    try {
      editProject(fn);
    } catch (e) {
      toast(e.message);
    }
  };
  $('#layer-outline').onclick = () => openArtwork('outline');
  const makeRow = (i) => {
    const l = project.layers[i],
      row = document.createElement('div');
    row.className = 'layer' + (i === layer ? ' active' : '');
    row.style.marginLeft = (l.level || 0) * 10 + 'px';
    row.dataset.dragKey = i;
    if (l.group) row.dataset.dropGroup = 'true';
    row.innerHTML = `<div class="layer-merge-actions"><button data-layer-merge-up>向上合并</button><button data-layer-merge-down>向下合并</button></div><div class="layer-swipe-actions"><button data-layer-lock>${l.locked ? '解锁' : '锁定'}</button><button data-layer-copy>复制</button><button data-layer-delete class="destructive">删除</button></div><div class="layer-face">${l.group ? `<button class="layer-fold" aria-label="${l.collapsed ? '展开' : '折叠'}图层组 ${esc(l.name)}">${l.collapsed ? '▸' : '▾'}</button>` : ''}<button class="layer-select" data-item-touch aria-pressed="${i === layer}" aria-label="选择图层 ${esc(l.name)}"><span>${esc(l.name)}<small>${l.group ? '图层组' : l.clipping ? '剪贴图层' : '普通'}${l.mask ? ' · 遮罩' : ''}${l.alphaLock ? ' · 锁透明' : ''}${layerLocked(project, i) ? ' · 已锁定' : ''}</small></span></button><button class="layer-blend" aria-label="图层 ${esc(l.name)} 不透明度">${l.blend ? BLEND_MODES[l.blend].slice(0, 2) : Math.round((l.opacity / 255) * 100) === 100 ? 'N' : Math.round((l.opacity / 255) * 100) + '%'}</button><button class="visibility" role="checkbox" aria-checked="${l.visible}" aria-label="${l.visible ? '隐藏' : '显示'}图层 ${esc(l.name)}">${l.visible ? '☑' : '□'}</button></div>`;
    if (!l.group) {
      const t = document.createElement('canvas');
      t.width = t.height = 1;
      const job = requestAnimationFrame(() => {
        layerPreviewJobs.delete(job);
        if (!t.isConnected) return;
        const preview = layerPreviews.get(project, frame, i, id + ':' + dirtyVersion);
        t.width = preview.width;
        t.height = preview.height;
        t.getContext('2d').putImageData(
          new ImageData(preview.data, preview.width, preview.height),
          0,
          0,
        );
      });
      layerPreviewJobs.add(job);
      row.querySelector('.layer-select').prepend(t);
    }
    row.querySelector('.visibility').onclick = () => {
      if (performance.now() < suppressVisibilityClick) return;
      run((p) => (p.layers[i].visible = !p.layers[i].visible));
    };
    const visibility = row.querySelector('.visibility');
    let soloTimer;
    visibility.onpointerdown = (event) => {
      if (event.button !== 0) return;
      soloTimer = setTimeout(() => {
        suppressVisibilityClick = performance.now() + 900;
        const restore =
          layerSolo?.id === id &&
          layerSolo.layers.every((item, k) => item === project.layers[k]) &&
          layerSolo.layers.length === project.layers.length;
        const previous = project.layers.map((item) => item.visible);
        run((p) => {
          const ancestors = new Set([i]);
          for (let k = parentLayer(p, i); k >= 0; k = parentLayer(p, k)) ancestors.add(k);
          p.layers.forEach(
            (item, k) =>
              (item.visible = restore
                ? layerSolo.visible[k]
                : ancestors.has(k) || (k > i && k < subtreeEnd(p, i))),
          );
        });
        layerSolo = restore ? null : { id, layers: [...project.layers], visible: previous };
        toast(restore ? '已恢复图层显示' : '仅显示此图层 · 长按勾选框恢复');
      }, 500);
    };
    for (const name of ['pointerup', 'pointercancel', 'pointerleave'])
      visibility.addEventListener(name, () => clearTimeout(soloTimer));
    visibility.oncontextmenu = (event) => event.preventDefault();
    if (l.group)
      row.querySelector('.layer-fold').onclick = () =>
        run((p) => (p.layers[i].collapsed = !p.layers[i].collapsed));
    const select = () => {
      if (i === layer) return;
      stop();
      layer = i;
      selection = null;
      render();
      refresh();
    };
    row.querySelector('.layer-select').onclick = select;
    row.querySelector('.layer-blend').onclick = () => {
      if (i !== layer) {
        layer = i;
        refresh();
      }
      showLayerOptions(true);
      $('#opacity').focus({ preventScroll: true });
    };
    row.querySelector('[data-layer-copy]').onclick = () =>
      run((p) => (layer = duplicateLayer(p, i)));
    row.querySelector('[data-layer-lock]').onclick = () =>
      run((p) => (p.layers[i].locked = !p.layers[i].locked));
    row.querySelector('[data-layer-delete]').onclick = () => {
      if (i !== layer) {
        layer = i;
        refresh();
      }
      $('#delete-layer').click();
    };
    row.querySelector('[data-layer-merge-up]').disabled = !project.layers.some(
      (_, j) => j > i && parentLayer(project, j) === parentLayer(project, i),
    );
    row.querySelector('[data-layer-merge-down]').disabled = !project.layers.some(
      (_, j) => j < i && parentLayer(project, j) === parentLayer(project, i),
    );
    row.querySelector('[data-layer-merge-up]').onclick = () => run((p) => (layer = mergeUp(p, i)));
    row.querySelector('[data-layer-merge-down]').onclick = () =>
      run((p) => (layer = mergeLayers(p, i)));
    itemGestures(row, {
      scroller: c,
      rightSwipe: true,
      insertion: true,
      swipe: (direction) => {
        c.querySelectorAll('.layer').forEach((el) => el.classList.remove('swiped', 'swiped-right'));
        row.classList.toggle('swiped-right', direction === 'right');
        row.classList.toggle('swiped', direction === 'left');
      },
      drop: (destination, placement) =>
        run((p) => (layer = dropLayer(p, i, Number(destination), placement))),
    });
    return row;
  };
  c.scrollTop = previousScroll;
  disposeLayerList = virtualList(
    $('#layer-list'),
    c,
    visibleLayerOrder(project, layerOrder(project.layers)),
    makeRow,
  );
  layerEffects(c, {
    project: () => project,
    layer: () => layer,
    selection: () => selection,
    maskEditing: editingMask,
    editMask: (value) => {
      maskTarget = value ? project.layers[layer] : null;
      chooseTool('pencil');
      layersPanel();
    },
    setColor: (value) => {
      color = value;
      refresh();
    },
    toast,
    edit: (fn) => {
      const wasEditing = editingMask();
      editProject(fn);
      if (wasEditing) maskTarget = project.layers[layer];
    },
  });
  if (adjustmentsOpen && c.querySelector('.layer-adjustments'))
    c.querySelector('.layer-adjustments').open = true;
  c.scrollTop = previousScroll;
  $('#layer-options-close').onclick = () => showLayerOptions(false);
  $('#duplicate-layer').onclick = () => run((p) => (layer = duplicateLayer(p, layer)));
  for (const [id, label, group] of [
    ['merge-down', '向下合并', false],
    ['merge-up', '向上合并', false],
    ['merge-group', '合并图层组', true],
  ]) {
    const button = document.createElement('button');
    button.id = id;
    button.textContent = label;
    button.disabled = group
      ? !selected.group
      : !project.layers.some(
          (_, i) =>
            (id === 'merge-up' ? i > layer : i < layer) && parentLayer(project, i) === parent,
        );
    button.onclick = () =>
      run((p) => {
        layer = id === 'merge-up' ? mergeUp(p, layer) : mergeLayers(p, layer, group);
        toast('已合并全部动画帧 · 可撤销');
      });
    c.querySelector('.layer-option-grid').append(button);
  }
  $('#clear-layer').disabled = selected.group || layerLocked(project, layer);
  $('#clear-layer').onclick = () => run((p) => editCel(p.frames[frame], layer).fill(0));
  $('#lock-layer').onclick = () => run((p) => (p.layers[layer].locked = !p.layers[layer].locked));
  $('#add-layer').onclick = () => run((p) => (layer = addLayer(p, layer)));
  $('#add-group').onclick = () => run((p) => (layer = addLayer(p, layer, true)));
  $('#rename-layer').onclick = async () => {
    const target = selected,
      name = await askDialog({ title: '重命名图层', value: selected.name, confirm: '保存名称' });
    if (name?.trim() && project.layers.includes(target))
      run(() => (target.name = name.trim().slice(0, 160)));
  };
  $('#opacity').disabled = selected.group && selected.isolated === false;
  let opacityBefore = null;
  $('#opacity').onchange = () => {
    if (!opacityBefore) return;
    checkpoint(opacityBefore);
    opacityBefore = null;
    changed();
  };
  $('#opacity').oninput = (e) => {
    opacityBefore ||= clone(project);
    selected.opacity = Number(e.target.value);
    $('#opacity-value').textContent = Math.round((e.target.value / 255) * 100) + '%';
    frameCache.clear();
    onionCache.clear();
    render();
  };
  $('#layer-up').onclick = () => run((p) => (layer = reorderLayer(p, layer, 1)));
  $('#layer-down').onclick = () => run((p) => (layer = reorderLayer(p, layer, -1)));
  const siblings = project.layers
    .map((_, i) => i)
    .filter((i) => parentLayer(project, i) === parent);
  $('#layer-up').disabled = layer === siblings.at(-1);
  $('#layer-down').disabled = layer === siblings[0];
  $('#group-layer').onclick = () => run((p) => (layer = groupLayer(p, layer)));
  $('#ungroup-layer').disabled = !selected.group;
  $('#ungroup-layer').onclick = () => run((p) => (layer = ungroupLayer(p, layer)));
  $('#layer-parent').value = parent;
  $('#move-to-group').onclick = () => {
    const target = Number($('#layer-parent').value);
    run((p) => (layer = moveLayer(p, layer, target)));
  };
  $('#delete-layer').onclick = async () => {
    if (
      !(await askDialog({
        title: '删除这个图层？',
        description: '此图层及其子图层在全部帧中的内容都会移除。删除后可撤销。',
        confirm: '删除图层',
        danger: true,
      }))
    )
      return;
    run((p) => (layer = deleteLayer(p, layer)));
  };
}

function animationPanel() {
  animationPanelKey = panelContext() + ':' + onion + ':' + playbackSpeed;
  animationEditor?.(panelContent('animation'));
}
function capacityPanel() {
  panelContent('capacity').innerHTML = `
    <div class="capacity-panel">
      <div class="capacity-hero"><strong id="capacity-current"></strong><span>项目像素数据</span><p id="capacity-status"></p></div>
      <div class="capacity-row"><div><span>实际像素存储</span><output id="capacity-pixel-label"></output></div><progress id="capacity-pixels" aria-label="项目像素容量" max="${LIMITS.projectBytes}"></progress><small>实际存储预算 ${mebibytes(LIMITS.projectBytes)}；空白与重复单元共享，按需解码，缓存另计 ≤16 MiB。</small></div>
      <div class="capacity-row"><div><span>图层</span><output id="capacity-layers"></output></div><small id="capacity-more-layers"></small></div>
      <div class="capacity-row"><div><span>动画帧</span><output id="capacity-frames"></output></div><small id="capacity-more-frames"></small></div>
      <div class="capacity-row"><div><span>撤销与重做</span><output id="capacity-history"></output></div><progress id="capacity-history-meter" aria-label="历史像素数据预算" max="${LIMITS.historyBytes}"></progress><small>最多 ${LIMITS.historyEntries} 步，共用 ${mebibytes(LIMITS.historyBytes)}。达到任一上限，会释放最早的历史记录。</small></div>
      <div class="capacity-row"><div><span>选区历史</span><output>上限 ${mebibytes(LIMITS.selectionHistoryBytes)}</output></div><small>最多 ${LIMITS.selectionHistoryEntries} 次操作，遮罩与取样记录共用预算；切换帧、图层、作品或修改像素后重置。</small></div>
      <div class="capacity-row"><div><span>帧预览缓存</span><output id="capacity-preview"></output></div><small>上限 ${mebibytes(LIMITS.previewBytes)}，按需释放后可重新生成。</small></div>
      <div class="capacity-row"><div><span>参考小窗</span><output>最多 ${LIMITS.referenceWindows} 个</output></div><small>每张参考图最多 ${mebibytes(LIMITS.referencePixels * 4)} 像素数据；较大图片等比缩小。窗口显示缓冲同样限制为 ${mebibytes(LIMITS.referencePixels * 4)} / 个，关闭即释放。参考图仅用于当前会话，不写入作品。</small></div>
      <p class="capacity-note">画布宽高与图层数量不设固定上限。单张像素面编辑缓冲最多 ${mebibytes(LIMITS.planeBytes)}，最终可用尺寸也受浏览器与设备限制。工程文件最多 ${mebibytes(LIMITS.projectFileBytes)}；其他导入文件最多 60 MiB。PNG 输出像素预算 64 MiB，超限倍率不可选。以上是画室的数据预算；设备实际内存还包括图像转换、显示纹理及系统开销。</p>
      <p class="capacity-note">容量接近上限时，可减少帧或图层，或导出备份后拆成多个作品。作品保存在此设备，建议定期导出 .pixel 备份。</p>
      <button id="capacity-export" class="panel-wide">保存与导出 <span>›</span></button>
    </div>`;
  $('#capacity-export').onclick = (event) => openPanel('export', event.currentTarget);
  updateCapacity();
}
function updateCapacity() {
  const usage = projectUsage(project);
  const indicator = $('#capacity-indicator');
  if (indicator) {
    $('#capacity-brief').textContent = `${mebibytes(usage.bytes)} · 容量`;
    indicator.dataset.warning = String(usage.ratio >= 0.8);
    indicator.setAttribute(
      'aria-label',
      `查看画布容量与限制，已用 ${Math.round((usage.bytes / LIMITS.projectBytes) * 100)}% 像素容量`,
    );
  }
  if (!toolWindows.has('capacity')) return;
  const set = (id, text) => {
    const element = $(id);
    if (element && element.textContent !== text) element.textContent = text;
  };
  $('.capacity-panel').dataset.warning = String(usage.ratio >= 0.8);
  set('#capacity-current', mebibytes(usage.bytes));
  set(
    '#capacity-status',
    usage.ratio >= 1
      ? '已达到一项容量上限。减少帧或图层后可继续添加。'
      : usage.ratio >= 0.8
        ? '容量接近上限，请留意实际存储与帧数。'
        : '容量充足，可以继续创作。',
  );
  set('#capacity-pixel-label', `${mebibytes(usage.bytes)} / ${mebibytes(LIMITS.projectBytes)}`);
  $('#capacity-pixels').value = usage.bytes;
  set('#capacity-layers', `${project.layers.length} · 不设数量上限`);
  set('#capacity-frames', `${project.frames.length} / ${LIMITS.frames}`);
  set('#capacity-more-layers', '按实际像素存储计算容量，空白与重复单元共享。');
  set(
    '#capacity-more-frames',
    `还可添加 ${usage.moreFrames} 帧；解码缓存 ${mebibytes(decodeCacheBytes())} / 16 MiB。`,
  );
  set('#capacity-history', `${history.count} 步 · ${mebibytes(history.bytes)}`);
  $('#capacity-history-meter').value = history.bytes;
  set('#capacity-preview', mebibytes(frameCache.size * project.w * project.h * 4));
}
function settingsPanel() {
  panelContent('settings').innerHTML = `
    <section class="setting-group"><h3>触控与画笔</h3>
      <label class="switch"><span>手指绘画<small>关闭后，手指只移动画布</small></span><input id="finger-setting" type="checkbox" ${!penOnly ? 'checked' : ''}></label>
      <label>停笔识别 <output id="shape-delay-value" class="row-value">${(shapeHoldMs / 1000).toFixed(2)} 秒</output><input id="shape-delay" aria-label="停笔识别时间" type="range" min="200" max="3000" step="50" value="${shapeHoldMs}"></label>
      <details class="settings-help"><summary>手势与形状识别</summary><p>双指拖动、缩放与旋转。双指轻点撤销，三指轻点重做。长按取色；画完不抬笔停留，可识别形状；继续拖动时，起笔像素保持固定，可调整大小与方向。识别时间越短，越快进入调整。</p><p>Pencil 的硬件双击与挤压尚未接入。</p></details>
    </section>
    <section class="setting-group"><h3>画布显示</h3>
      <label class="switch"><span>多窗口工作区<small>色板、图层与笔刷可同时打开；画布操作保留窗口</small></span><input id="multiple-windows" type="checkbox" ${multipleWindows ? 'checked' : ''}></label>
      <div class="segment display-modes"><button data-display="auto">智能清晰</button><button data-display="smooth">柔和</button><button data-display="pixel">原始像素</button></div>
      <details class="settings-help"><summary>显示模式说明</summary><p>智能清晰保留像素内部，只平滑缩放或旋转后的边缘。显示模式不会改变作品或导出像素。</p></details>
      <div class="segment mirror-controls"><button data-mirror="flipX" aria-pressed="${!!camera.flipX}">水平镜像</button><button data-mirror="flipY" aria-pressed="${!!camera.flipY}">垂直镜像</button></div><p class="help">镜像只改变查看方向，作品与导出保持原样。</p><button id="settings-reference" class="panel-wide">参考小窗 <span>画布预览 · 图片 · ＋</span></button><button id="settings-expand" class="panel-wide">扩展画布 <span>四方向 · ›</span></button>
      <button id="view-reset" class="panel-wide">重置画布视角 <span>↺</span></button>
    </section>
    <section class="setting-group"><h3>作品与存储</h3>
      <button id="settings-capacity" class="panel-wide">画布容量与限制 <span>${mebibytes(projectUsage(project).bytes)} · ›</span></button>
      <button id="manual-save" class="panel-wide">保存到作品库 <span>仅此设备</span></button>
    </section>
    <section class="setting-group"><h3>画室</h3>
      <button id="settings-export" class="panel-wide">分享与导出 <span>项目 · 图片 · 动画 ›</span></button><button id="settings-plugins" class="panel-wide">插件工作台 <span>5 个扩展 · ›</span></button>
      <button id="install-help" class="panel-wide">添加到主屏幕 <span>全屏使用 · ›</span></button>
      <button id="check-update" class="panel-wide">检查更新 <span>v0.17.0</span></button>
    </section>`;
  editorIntegration.settings(panelContent('settings'));
  document
    .querySelectorAll('.mirror-controls [data-mirror]')
    .forEach((b) => (b.onclick = () => mirrorView(b.dataset.mirror)));
  $('#settings-reference').onclick = openReference;
  $('#settings-export').onclick = (event) => openPanel('export', event.currentTarget);
  $('#settings-expand').onclick = (event) => openPanel('expand', event.currentTarget);
  $('#settings-capacity').onclick = (event) => openPanel('capacity', event.currentTarget);
  $('#shape-delay').oninput = (e) => {
    shapeHoldMs = shapeDelay(Number(e.target.value));
    $('#shape-delay-value').value = (shapeHoldMs / 1000).toFixed(2) + ' 秒';
    settingsSave();
  };
  $('#multiple-windows').onchange = (e) => {
    multipleWindows = e.target.checked;
    settingsSave();
    if (!multipleWindows) closePrimaryPanels('settings');
  };
  $('#finger-setting').onchange = (e) => {
    penOnly = !e.target.checked;
    settingsSave();
    refresh();
  };
  $$('[data-display]').forEach((b) => {
    b.classList.toggle('active', b.dataset.display === displayMode);
    b.setAttribute('aria-pressed', String(b.dataset.display === displayMode));
    b.onclick = () => {
      displayMode = b.dataset.display;
      settingsSave();
      render();
      $$('[data-display]').forEach((button) => {
        const active = button.dataset.display === displayMode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    };
  });
  $('#view-reset').onclick = fit;
  $('#settings-plugins').onclick = launchPlugins;
  $('#install-help').onclick = () =>
    askDialog({
      title: '添加到主屏幕',
      description:
        '在 iPad 的 Safari 中打开画室，轻点「分享」，再选择「添加到主屏幕」。首次联网打开后即可离线使用。',
      confirm: '知道了',
    });
  $('#manual-save').onclick = async () => {
    if (await saveCurrent()) toast('已保存到本地作品库');
  };
  $('#check-update').onclick = async () => {
    const r = await navigator.serviceWorker?.getRegistration();
    if (r) {
      await r.update();
      toast('已检查更新；如有新版本，顶部会显示更新提示');
    } else toast('当前版本 v0.13.0');
  };
}
function download(data, ext, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = project.name.replace(/[\\/:*?"<>|]/g, '_') + ext;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast('已生成文件，请在浏览器下载中查看');
}
async function exportWith(path, action) {
  try {
    await action(await import(path));
  } catch (error) {
    toast(error.message || '导出失败，请重试');
  }
}
function exportPanel() {
  panelContent('export').innerHTML =
    `<p class="help">项目备份保留所有像素、图层和动画；导出后可在「文件」中保存或传到其他设备。</p><button id="export-project" class="panel-wide">${svg('export')}画室项目 .pixel</button><button id="export-ase" class="panel-wide">${svg('layers')}Aseprite .aseprite</button><label class="export-scale">PNG 尺寸<select id="png-scale"><option value="1">原始像素 · 1×</option><option value="2">清晰放大 · 2×</option><option value="4">清晰放大 · 4×</option><option value="8">清晰放大 · 8×</option></select></label><button id="export-svg" class="panel-wide">当前帧 · SVG 像素矢量</button><p class="help">SVG 将可见图层合成为矢量像素块，保留透明度，可无损缩放。</p><button id="export-png" class="panel-wide">当前帧 · PNG 透明图片</button><button id="export-sheet" class="panel-wide">全部帧 · PNG 横向精灵图</button><button id="export-gif" class="panel-wide">动画 · GIF</button><button id="export-import" class="panel-wide">导入项目 / Aseprite / 图片转像素</button><p class="help">Aseprite：保留普通图层、图层组、动画标签和帧时长。链接单元展开为独立可编辑像素；支持 19 种混合模式；遮罩与颜色调整会应用到像素，剪贴层合并到对应底层，保持画面效果。需保留可编辑遮罩请同时保存 .pixel；瓦片需先转换。GIF 支持尺寸、帧率与 16–256 色压缩设置，半透明像素转为透明或不透明。</p>`;
  $('#export-project').onclick = async () => {
    try {
      download(await encodeProjectFile(project), '.pixel', 'application/octet-stream');
    } catch (e) {
      toast(e.message);
    }
  };
  for (const option of $('#png-scale').options) {
    if (project.w * project.h * Number(option.value) ** 2 > LIMITS.exportPixels) {
      option.disabled = true;
      option.textContent += ' · 超出输出容量';
    }
  }
  $('#export-ase').onclick = () =>
    exportWith('./ase.js', (module) =>
      download(module.writeAse(project), '.aseprite', 'application/octet-stream'),
    );
  $('#export-svg').onclick = () =>
    exportWith('./svg.js', (module) =>
      download(module.pixelSvg(project, frame), '.svg', 'image/svg+xml'),
    );
  $('#export-png').onclick = () => {
    const factor = +$('#png-scale').value;
    if (
      ![1, 2, 4, 8].includes(factor) ||
      project.w * project.h * factor ** 2 > LIMITS.exportPixels
    ) {
      toast('PNG 输出像素预算为 64 MiB，请降低放大倍率');
      return;
    }
    const source = thumb(project, frame),
      c = document.createElement('canvas');
    c.width = project.w * factor;
    c.height = project.h * factor;
    const context = c.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0, c.width, c.height);
    c.toBlob((b) => (b ? download(b, '.png') : toast('图片生成失败')), 'image/png');
  };
  $('#export-sheet').onclick = () => {
    if (project.w * project.frames.length > 16384) {
      toast('精灵图过宽，请减少帧数或使用 Aseprite 导出');
      return;
    }
    const c = document.createElement('canvas');
    c.width = project.w * project.frames.length;
    c.height = project.h;
    const x = c.getContext('2d');
    project.frames.forEach((_, i) => x.drawImage(thumb(project, i), i * project.w, 0));
    c.toBlob((b) => download(b, '-sheet.png'), 'image/png');
  };
  $('#export-gif').onclick = () =>
    exportWith('./gif-export.js', (module) => {
      const tag = animationTimeline.activeTag();
      return module.openGifExport(project, { download }, tag ? { from: tag.from, to: tag.to } : {});
    });
  $('#export-import').onclick = () => $('#file-input').click();
}
// Persistence is isolated from UI; gallery reads never load all project pixels.
function storeRecord(record) {
  return projectStore.put(record);
}
const prepareSave = createSavePreparation();
function saveCurrent() {
  const prepared = prepareSave(stroke?.before || project),
    key = id,
    v = dirtyVersion;
  // The queue may still be writing an older version when preparation fails.
  prepared.catch(() => {});
  saveQueue = saveQueue
    .catch(() => {})
    .then(async () => {
      try {
        if (!projectStore) throw Error('本地存储不可用');
        const { project: p, width, height, data } = await prepared,
          c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        c.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);
        const preview = c.toDataURL('image/png');
        await storeRecord({ id: key, project: p, preview, updated: Date.now() });
        try {
          localStorage.setItem('pixel-studio-current', key);
        } catch {}
        if (key === id && v === dirtyVersion) {
          if (p.storage === 'packed' && !stroke && !procedural?.busy)
            project = { ...project, frames: p.frames };
          savedVersion = v;
          $('#save-status').textContent = '已保存在此设备';
        }
        return true;
      } catch (e) {
        $('#save-status').textContent = '保存失败，请导出备份';
        toast('本地保存失败，请导出 .pixel 文件备份');
        return false;
      }
    });
  return saveQueue;
}
let switchingProject = false;
async function loadProject(p, key = crypto.randomUUID()) {
  validate(p);
  checkCanvasSupport(p.w, p.h);
  if (stroke || switchingProject) return false;
  switchingProject = true;
  const wasInert = document.body.inert;
  document.body.inert = true;
  try {
    procedural?.leave();
    selectionUI?.finish(false);
    pluginWindow?.close();
    stop();
    clearTimeout(saveTimer);
    if (savedVersion !== dirtyVersion && !(await saveCurrent())) return false;
    selection = null;
    project = p;
    layerPreviews.clear();
    id = key;
    frame = 0;
    layer = p.layers.length - 1;
    history.clear();
    dirtyVersion = 0;
    savedVersion = -1;
    toolWindows.closeAll();
    await hideDialog($('#gallery-dialog'));
    fit();
    refresh();
    setTimeout(() => {
      if (!stroke) {
        resize();
        fit();
      }
    }, 320);
    await saveCurrent();
    return true;
  } finally {
    switchingProject = false;
    document.body.inert = wasInert;
  }
}
async function gallery() {
  if (stroke) return;
  procedural?.leave();
  selectionUI?.finish(true);
  pluginWindow?.close();
  stop();
  await saveCurrent();
  toolWindows.closeAll();
  showDialog($('#gallery-dialog'));
  try {
    await galleryView({
      list: () => projectStore.list(),
      get: (key) => projectStore.get(key),
      open: async (record) => {
        const full = await projectStore.get(record.id);
        if (!full) throw Error('作品已被移除');
        return loadProject(full.project, full.id);
      },
      store: storeRecord,
      current: () => id,
      ask: askDialog,
      toast,
      remove: (key) => projectStore.remove(key),
      share: async (keys) => {
        for (const key of keys) {
          const record = await projectStore.get(key);
          if (!record) throw Error('作品已被移除');
          const url = URL.createObjectURL(await encodeProjectFile(record.project));
          const link = document.createElement('a');
          link.href = url;
          link.download = record.project.name + '.pixel';
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      },
      rename: async (record, name) => {
        const full = await projectStore.get(record.id);
        if (!full) throw Error('作品已被移除');
        full.project.name = name.trim().slice(0, 160);
        full.updated = Date.now();
        if (record.id === id) {
          checkpoint();
          project.name = full.project.name;
          changed();
          if (!(await saveCurrent())) throw Error('作品名称未能保存，请重试');
        } else await storeRecord(full);
      },
    });
  } catch {
    $('#gallery-list').textContent = '作品库暂不可用，请通过保存与导出备份当前作品。';
  }
}
$('#gallery').onclick = gallery;
$('#close-gallery').onclick = () => hideDialog($('#gallery-dialog'));
$('#new-project').onclick = () => {
  newCapacity();
  showDialog($('#new-dialog'));
};
$('#cancel-new').onclick = () => hideDialog($('#new-dialog'));
function newCapacity() {
  const w = Number($('#new-form [name=width]').value),
    h = Number($('#new-form [name=height]').value);
  try {
    canvasPixels(w, h);
    $('#new-capacity-note').textContent =
      `${w} × ${h} · 单张像素面 ${mebibytes(w * h * 4)}。图层数量和宽高不设固定上限；编辑缓冲预算 ${mebibytes(LIMITS.planeBytes)}，实际可用尺寸取决于浏览器与设备。`;
    $('#new-form button[type=submit]').disabled = false;
  } catch (error) {
    $('#new-capacity-note').textContent = error.message;
    $('#new-form button[type=submit]').disabled = true;
  }
}
$('#new-form').addEventListener('input', newCapacity);
$$('[data-size]').forEach(
  (b) =>
    (b.onclick = () => {
      $('#new-form [name=width]').value = b.dataset.size;
      $('#new-form [name=height]').value = b.dataset.size;
      newCapacity();
    }),
);
$('#new-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const data = new FormData(e.target),
      p = blank(
        Number(data.get('width')),
        Number(data.get('height')),
        String(data.get('name')).trim() || '未命名作品',
      );
    await hideDialog($('#new-dialog'));
    await loadProject(p);
  } catch (error) {
    toast(error.message);
  }
};
$('#new-demo').onclick = () => loadProject(demo());
let exampleLoad = null;
$('#gallery-dialog').addEventListener('close', () => exampleLoad?.abort());
$('#open-pelican-example').onclick = async () => {
  if (exampleLoad) return;
  const controller = new AbortController(),
    sourceId = id,
    button = $('#open-pelican-example'),
    status = $('#example-status');
  exampleLoad = controller;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  status.hidden = false;
  status.textContent = '正在打开示例…';
  try {
    const { loadPelicanExample } = await import('./gallery-examples.js');
    const p = await loadPelicanExample(controller.signal);
    if (controller.signal.aborted || !$('#gallery-dialog').open || id !== sourceId) return;
    if (!(await loadProject(p))) throw Error('请先保存或导出当前作品，再打开示例。');
    status.hidden = true;
    toast('已添加鹈鹕骑车副本 · 轻点播放查看动画');
  } catch (error) {
    if (!controller.signal.aborted) status.textContent = error.message || '示例打开失败，请重试。';
  } finally {
    if (controller.signal.aborted) status.hidden = true;
    button.disabled = false;
    button.removeAttribute('aria-busy');
    exampleLoad = null;
  }
};
$('#import-button').onclick = () => $('#file-input').click();
$('#gallery-photos').onclick = () => $('#photo-input').click();
$('#photo-input').onchange = (e) => $('#file-input').onchange(e);
let importing = false;
$('#file-input').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || importing) return;
  importing = true;
  const status = $('#import-status');
  status.hidden = false;
  status.textContent = '正在读取 ' + file.name + '…';
  try {
    let p,
      warnings = [];
    const kind = await importKind(file);
    if (kind === 'ase') {
      const { readAse } = await import('./ase.js');
      const result = await readAse(await file.arrayBuffer());
      p = result.project;
      warnings = result.warnings;
    } else if (kind === 'project') p = await decodeProjectFile(file);
    else {
      stop();
      const { importPixelImage } = await import('./pixel-import.js');
      const converted = await importPixelImage(file);
      if (!converted) {
        status.hidden = true;
        return;
      }
      p = blank(converted.w, converted.h);
      p.frames[0].cels[0] = converted.data;
    }
    p.name = file.name.replace(/\.[^.]+$/, '').slice(0, 160) || '导入的作品';
    if (!(await loadProject(p)))
      throw Error('当前作品尚未保存，导入已暂停。请先导出备份或重试保存。');
    status.hidden = true;
    toast(warnings.length ? '已导入：' + warnings.join('；') : '已导入 ' + file.name);
  } catch (err) {
    const message = err.message || '文件导入失败，请先在「文件」中完整下载后重试。';
    status.textContent = '导入失败：' + message;
    if (!$('#gallery-dialog').open)
      await askDialog({ title: '无法导入文件', description: message, confirm: '知道了' });
  } finally {
    importing = false;
  }
};
document.addEventListener('keydown', (e) => {
  if (
    e.defaultPrevented ||
    e.target.closest(
      'input,textarea,select,[contenteditable="true"],[role="combobox"],[role="listbox"]',
    ) ||
    $('dialog[open]')
  )
    return;
  if (e.target.closest('button') && ['Space', 'Enter'].includes(e.code)) return;
  if (procedural?.key(e)) return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if ((e.ctrlKey || e.metaKey) && key === 'j' && selection) {
    e.preventDefault();
    if (!e.repeat) selectionUI.copyToLayer();
  } else if ((e.ctrlKey || e.metaKey) && key === 's') {
    e.preventDefault();
    saveCurrent();
  } else if (e.code === 'Space') {
    e.preventDefault();
    $('#play').click();
  } else if (key === 'escape') {
    if (selectionUI?.transforming || selection) selectionUI.escape();
    else dismissTopWindow();
  } else if (key === 'enter' && selectionUI?.transforming) selectionUI.finish(true);
  else if (
    { b: 'pencil', e: 'eraser', i: 'pick', g: 'fill', h: 'hand', l: 'line', r: 'rect' }[key]
  ) {
    chooseTool(
      { b: 'pencil', e: 'eraser', i: 'pick', g: 'fill', h: 'hand', l: 'line', r: 'rect' }[key],
    );
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stop();
    fingers.update([], { cancel: true });
    if (stroke) finishStroke(true);
    pointers.clear();
    penActive = false;
    gesture = null;
    saveCurrent();
  }
});
window.addEventListener('beforeunload', (e) => {
  persistBrushes();
  if (savedVersion !== dirtyVersion) {
    e.preventDefault();
    e.returnValue = '';
  }
});
async function init() {
  animationTimeline = createTimeline({
    project: () => project,
    id: () => id,
    revision: () => dirtyVersion,
    changedFrames: () => changedFrames,
    frame: () => frame,
    layer: () => layer,
    speed: () => playbackSpeed,
    setSpeed,
    stop,
    resize,
    refresh,
    selectFrame: (i) => {
      stop();
      frame = i;
      render();
      refresh();
    },
    selectLayer: (i) => {
      layer = i;
      render();
      refresh();
    },
    selectCell: (f, l) => {
      stop();
      frame = f;
      layer = l;
      selection = null;
      render();
      refresh();
    },
    toggleGroup: (i) => {
      editProject((p) => (p.layers[i].collapsed = !p.layers[i].collapsed));
    },
  });
  animationEditor = createAnimationEditor({
    project: () => project,
    id: () => id,
    frame: () => frame,
    layer: () => layer,
    tag: () => animationTimeline.activeTag(),
    speed: () => playbackSpeed,
    setSpeed,
    edit: editProject,
    selectFrame: (i) => (frame = i),
    ask: askDialog,
    toast,
    onion: () => ({
      enabled: onion,
      before: onionBefore,
      after: onionAfter,
      opacity: onionOpacity,
      scope: onionScope,
    }),
    setOnion: (config) => {
      onion = config.enabled;
      onionBefore = config.before;
      onionAfter = config.after;
      onionOpacity = config.opacity;
      onionScope = config.scope;
      render();
      $('#onion').setAttribute('aria-pressed', onion);
    },
  });
  const chip = document.createElement('div');
  chip.id = 'held-color';
  chip.hidden = true;
  document.body.append(chip);
  selectionUI = createSelectionController({
    snapshot: () => ({
      project,
      frame,
      layer,
      context: [id, dirtyVersion, frame, layer].join(':'),
    }),
    selection: () => selection,
    setSelection: (mask) => {
      selection = mask;
    },
    tool: () => tool,
    selectTool: chooseTool,
    historyChanged: updateHistory,
    canEdit: () =>
      !project.layers[layer].group &&
      !project.layers[layer].alphaLock &&
      !layerLocked(project, layer),
    canCopy: () => !project.layers[layer].group && !layerLocked(project, layer),
    copyLayer: () => {
      if (stroke || selectionUI?.transforming) throw Error('请先完成笔画或变换');
      const next = clone(project);
      const target = copySelectionLayer(next, frame, layer, selection);
      commitProject(next, { focus: { layer: target }, preserveSelection: true });
    },
    color: () => color,
    outline: () => openArtwork('outline'),
    scale: () => camera.scale,
    render,
    toast,
    commit: (pixels, mask) => {
      if (project.layers[layer].group || layerLocked(project, layer)) {
        toast('请选择未锁定的像素图层');
        return;
      }
      checkpoint();
      project.frames[frame].cels[layer] = pixels;
      selection = mask;
      changed([frame]);
    },
  });
  toolsBuild();
  resize();
  fit();
  refresh();
  try {
    projectStore = await openProjectStore();
    let key;
    try {
      key = localStorage.getItem('pixel-studio-current');
    } catch {}
    if (key) {
      const record = await projectStore.get(key);
      if (record) {
        project = validate(record.project);
        id = key;
        layer = project.layers.length - 1;
        fit();
        refresh();
        setTimeout(() => {
          if (!stroke) {
            resize();
            fit();
          }
        }, 320);
      }
    }
    await saveCurrent();
  } catch (e) {
    toast(e.message || '浏览器存储不可用，请通过导出备份作品');
  }
  if ('serviceWorker' in navigator)
    navigator.serviceWorker
      .register('./sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        const ready = () => {
          if (reg.waiting && navigator.serviceWorker.controller) $('#update-banner').hidden = false;
        };
        ready();
        reg.addEventListener('updatefound', () =>
          reg.installing?.addEventListener('statechange', ready),
        );
        $('#apply-update').onclick = async () => {
          if (stroke || fingers.active || selectionUI?.transforming) {
            toast('请先结束笔画，并应用或取消选区变换');
            return;
          }
          if (!(await saveCurrent())) return;
          reg.waiting?.postMessage({ type: 'ACTIVATE_UPDATE' });
        };
        let refreshing = false;
        let controlled = !!navigator.serviceWorker.controller;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!controlled) {
            controlled = true;
            return;
          }
          if (!refreshing) {
            refreshing = true;
            location.reload();
          }
        });
        reg.update().catch(() => {});
      })
      .catch(() => toast('离线缓存暂未启用，联网时仍可正常绘画'));
  await editorIntegration.start();
}
for (const d of $$('#gallery-dialog,#new-dialog')) {
  d.addEventListener('cancel', (e) => {
    e.preventDefault();
    hideDialog(d);
  });
  d.addEventListener('click', (e) => {
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        hideDialog(d);
    }
  });
}
installControls();
const editorIntegration = createEditorIntegration({
  snapshot: () => ({
    project,
    id,
    frame,
    layer,
    selection,
    history,
    revision: contextToken(),
    inputBusy:
      document.body.inert || switchingProject
        ? '作品正在加载'
        : stroke || procedural?.busy
          ? '请先完成当前画布操作'
          : null,
    busy:
      document.body.inert || switchingProject
        ? '作品正在加载，请稍后重试'
        : stroke || selectionUI?.transforming || procedural?.busy || artworkWindow?.editing
          ? '请先完成笔画、选区或动画调整'
          : $('dialog[open]')
            ? '请先关闭当前对话框'
            : null,
  }),
  selectionInfo: () => ({
    active: !!selection,
    bounds: selection ? maskBounds(selection, project.w, project.h) : null,
  }),
  commit: (next, options) => commitProject(next, options),
  create: async (next, check) => {
    if (!(await saveCurrent())) return false;
    check();
    return loadProject(next);
  },
  history: (direction) => {
    if (selectionUI?.editingSelection) throw Error('请先退出选区编辑再撤销作品');
    restoreHistory(direction);
  },
  save: saveCurrent,
  download: (blob, filename) => {
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
  showPreview: (canvas, metadata) => {
    const existing = toolWindows.has('ai-preview');
    const show = () => {
      const body = panelContent('ai-preview'),
        caption = document.createElement('p');
      caption.className = 'help';
      caption.textContent = `${metadata.sourceWidth} × ${metadata.sourceHeight} · ${metadata.samples.length} 个画面 · 预览快照`;
      canvas.id = 'ai-preview-canvas';
      canvas.setAttribute('aria-label', 'AI 渲染预览');
      canvas.style.cssText =
        'display:block;width:100%;height:auto;image-rendering:pixelated;background:repeating-conic-gradient(#555 0% 25%,#444 0% 50%) 0 0/16px 16px';
      body.replaceChildren(canvas, caption);
    };
    toolWindows.open('ai-preview', 'AI 画面预览', show);
    if (existing) show();
  },
});
$('#capacity-indicator').onclick = (event) => openPanel('capacity', event.currentTarget);
document.body.inert = true;
init()
  .catch((error) => {
    console.error(error);
    toast('画室初始化失败，请刷新重试。');
  })
  .finally(() => {
    document.body.inert = false;
  });
