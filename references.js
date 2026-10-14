import { floatingPanel } from './floating.js';
import { createRenderScheduler } from './render-scheduler.js';
import { LIMITS, mebibytes } from './limits.js';
import { importKind } from './file-import.js';

export function createReferences(host) {
  const windows = new Set();
  let imageQueue = Promise.resolve();
  let serial = 0,
    source = null,
    sourceKey = '';
  function open() {
    if (windows.size >= LIMITS.referenceWindows) {
      host.toast(`最多同时打开 ${LIMITS.referenceWindows} 个参考小窗，请先关闭一个。`);
      return;
    }
    const root = document.createElement('aside');
    root.className = 'studio-window reference-window reference-controls-hidden';
    root.id = 'reference-' + ++serial;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', '参考小窗 ' + serial);
    root.innerHTML = `<header class="window-head"><h2>参考</h2><button class="reference-new" aria-label="再开一个参考小窗">＋</button><button class="window-collapse" aria-label="收起参考小窗" aria-expanded="true"></button><button class="window-close" aria-label="关闭参考小窗"></button></header><div class="window-body reference-body"><div class="reference-viewport"><canvas aria-label="参考预览，可缩放、拖动或取色"></canvas><span class="reference-empty">导入一张参考图片</span><output class="reference-color" hidden></output></div><div class="reference-toolbar"><div class="segment"><button data-source="canvas" aria-pressed="true">画布</button><button data-source="image" aria-pressed="false">图片</button></div><button class="reference-import" aria-label="导入参考图片">导入</button><button class="reference-fit" aria-label="显示参考全图">全图</button><button class="reference-pick" aria-label="从参考图取色" aria-pressed="false">取色</button></div><p class="reference-note" role="status">拖动平移 · 双指缩放 · 按住取色</p><input class="reference-file" type="file" accept="image/png,image/jpeg,image/webp" hidden></div>`;
    document.body.append(root);
    const q = (s) => root.querySelector(s),
      canvas = q('canvas'),
      viewport = q('.reference-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'group');
    viewport.setAttribute(
      'aria-label',
      '参考预览，轻点或按回车显示操作栏；拖动平移，双指缩放，长按取色',
    );
    const ctx = canvas.getContext('2d'),
      pointers = new Map();
    let mode = 'canvas',
      image = null,
      closed = false,
      loading = false,
      picking = false,
      hold = null,
      gesture = null,
      tapEligible = false;
    let zoom = 1,
      panX = 0,
      panY = 0,
      geometry = null,
      lastWidth = 0,
      lastHeight = 0;
    let controlsVisible = false,
      hideTimer;
    const interactions = new Set(),
      listeners = new AbortController();
    const getSource = () => (mode === 'canvas' ? source : image);
    const drawJob = createRenderScheduler(draw);
    function fit() {
      zoom = 1;
      panX = panY = 0;
      drawJob.request();
    }
    function draw() {
      if (closed || root.classList.contains('float-collapsed')) return;
      // Layout dimensions stay stable while the containing window animates its scale.
      const w = viewport.clientWidth,
        h = viewport.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(2, devicePixelRatio || 1, Math.sqrt(LIMITS.referencePixels / (w * h)));
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const picture = getSource();
      q('.reference-empty').hidden = !!picture;
      if (!picture) {
        geometry = null;
        return;
      }
      if (lastWidth !== picture.width || lastHeight !== picture.height) {
        lastWidth = picture.width;
        lastHeight = picture.height;
        zoom = 1;
        panX = panY = 0;
      }
      const scale = Math.min((w - 8) / picture.width, (h - 8) / picture.height) * zoom;
      const width = picture.width * scale,
        height = picture.height * scale;
      panX = Math.max(-width / 2, Math.min(width / 2, panX));
      panY = Math.max(-height / 2, Math.min(height / 2, panY));
      geometry = { x: (w - width) / 2 + panX, y: (h - height) / 2 + panY, scale };
      ctx.imageSmoothingEnabled = mode === 'image' || scale < 1;
      ctx.drawImage(picture, geometry.x, geometry.y, width, height);
    }
    const observer = new ResizeObserver(() => drawJob.request());
    observer.observe(viewport);
    const item = {
      update: () => {
        if (mode === 'canvas') drawJob.request();
      },
    };
    windows.add(item);
    const floating = floatingPanel(root, {
      titleHandle: q('header'),
      collapseButton: q('.window-collapse'),
      closeButton: q('.window-close'),
      resizable: true,
      onClose: () => {
        closed = true;
        clearTimeout(hold);
        clearTimeout(hideTimer);
        listeners.abort();
        interactions.clear();
        drawJob.cancel();
        observer.disconnect();
        windows.delete(item);
        image = null;
        canvas.width = canvas.height = 1;
        pointers.clear();
        if (!windows.size) {
          source = null;
          sourceKey = '';
        }
      },
    });
    const chrome = [
      q('header'),
      q('.reference-toolbar'),
      q('.reference-note'),
      ...root.querySelectorAll('.window-resize'),
    ];
    function busy() {
      return (
        interactions.size ||
        loading ||
        root.classList.contains('float-collapsed') ||
        (root.contains(document.activeElement) && document.activeElement.matches(':focus-visible'))
      );
    }
    function hideLater() {
      clearTimeout(hideTimer);
      if (closed || !controlsVisible || busy()) return;
      hideTimer = setTimeout(() => {
        if (!busy()) showControls(false);
      }, 2400);
    }
    function showControls(visible) {
      if (closed) return;
      visible ||= root.classList.contains('float-collapsed');
      controlsVisible = visible;
      root.classList.toggle('reference-controls-hidden', !visible);
      for (const element of chrome) element.inert = !visible;
      if (!visible && chrome.some((element) => element.contains(document.activeElement)))
        document.activeElement.blur();
      hideLater();
    }
    const listen = (target, type, callback, options = {}) =>
      target.addEventListener(type, callback, { ...options, signal: listeners.signal });
    listen(
      root,
      'pointerdown',
      (event) => {
        interactions.add(event.pointerId);
        clearTimeout(hideTimer);
      },
      { capture: true },
    );
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
      listen(
        document,
        type,
        (event) => {
          if (!interactions.delete(event.pointerId)) return;
          hideLater();
        },
        { capture: true },
      );
    listen(root, 'pointermove', (event) => {
      if (event.target.closest('.window-head,.reference-toolbar,.window-resize')) hideLater();
    });
    listen(root, 'focusin', (event) => {
      if (event.target.matches(':focus-visible')) showControls(true);
    });
    listen(root, 'focusout', () => queueMicrotask(hideLater));
    listen(viewport, 'keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        showControls(true);
      }
    });
    listen(
      document,
      'pointerdown',
      (event) => {
        if (!root.contains(event.target) && !interactions.size) showControls(false);
      },
      { capture: true },
    );
    listen(q('.window-collapse'), 'click', () => showControls(true));
    q('.reference-new').onclick = open;
    q('.reference-fit').onclick = fit;
    q('.reference-import').onclick = () => q('.reference-file').click();
    function setMode(next) {
      mode = next;
      q('h2').textContent = mode === 'canvas' ? '参考 · 画布' : '参考 · 图片';
      q('.reference-note').textContent =
        mode === 'canvas'
          ? '实时预览 · 拖动平移 · 按住取色'
          : '参考图仅此会话 · 拖动平移 · 按住取色';
      root
        .querySelectorAll('[data-source]')
        .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.source === mode)));
      fit();
    }
    root
      .querySelectorAll('[data-source]')
      .forEach((b) => (b.onclick = () => setMode(b.dataset.source)));
    q('.reference-pick').onclick = () => {
      picking = !picking;
      q('.reference-pick').setAttribute('aria-pressed', String(picking));
      viewport.classList.toggle('picking', picking);
    };
    q('.reference-file').onchange = async (event) => {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file || loading) return;
      loading = true;
      const previous = imageQueue;
      let release;
      imageQueue = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      let url, decoded;
      try {
        if (closed) return;
        if ((await importKind(file)) !== 'image') throw Error('请选择 PNG、JPEG 或 WebP 图片。');
        url = URL.createObjectURL(file);
        decoded = new Image();
        decoded.src = url;
        await decoded.decode();
        if (closed) return;
        const w = decoded.naturalWidth,
          h = decoded.naturalHeight;
        if (!w || !h || w * h > 40_000_000) throw Error('参考图片请控制在 4000 万像素以内。');
        const scale = Math.min(
          1,
          LIMITS.referenceDimension / Math.max(w, h),
          Math.sqrt(LIMITS.referencePixels / (w * h)),
        );
        const next = document.createElement('canvas');
        next.width = Math.max(1, Math.floor(w * scale));
        next.height = Math.max(1, Math.floor(h * scale));
        next
          .getContext('2d', { willReadFrequently: true })
          .drawImage(decoded, 0, 0, next.width, next.height);
        image = next;
        setMode('image');
        q('.reference-note').textContent =
          `${image.width} × ${image.height} · ${mebibytes(image.width * image.height * 4)} · 仅此会话`;
        root.dataset.image = file.name;
        showControls(true);
      } catch (error) {
        if (!closed) {
          q('.reference-note').textContent = error.message || '无法读取参考图片';
          host.toast(q('.reference-note').textContent);
        }
      } finally {
        if (url) URL.revokeObjectURL(url);
        if (decoded) decoded.src = '';
        loading = false;
        hideLater();
        release();
      }
    };
    function sample(point) {
      const picture = getSource();
      if (!picture || !geometry) return;
      const x = Math.floor((point.x - geometry.x) / geometry.scale),
        y = Math.floor((point.y - geometry.y) / geometry.scale);
      if (x < 0 || y < 0 || x >= picture.width || y >= picture.height) return;
      const pixel = picture.getContext('2d').getImageData(x, y, 1, 1).data;
      if (!pixel[3]) return;
      const color =
        '#' + Array.from(pixel.subarray(0, 3), (n) => n.toString(16).padStart(2, '0')).join('');
      host.pick(color);
      const swatch = q('.reference-color');
      swatch.hidden = false;
      swatch.textContent = color.toUpperCase();
      swatch.style.setProperty('--sample-color', color);
    }
    const point = (event) => {
      const r = viewport.getBoundingClientRect();
      return { x: event.clientX - r.left, y: event.clientY - r.top };
    };
    function startGesture() {
      const [a, b] = [...pointers.values()];
      if (!a) {
        gesture = null;
        return;
      }
      gesture = {
        a,
        panX,
        panY,
        zoom,
        pick: picking,
        moved: false,
        ...(b
          ? {
              pair: true,
              x: (a.x + b.x) / 2,
              y: (a.y + b.y) / 2,
              distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
            }
          : {}),
      };
    }
    viewport.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      floating.raise();
      const p = point(event);
      pointers.set(event.pointerId, p);
      tapEligible = pointers.size === 1;
      if (event.isTrusted) viewport.setPointerCapture(event.pointerId);
      clearTimeout(hold);
      startGesture();
      if (pointers.size === 1) {
        if (picking) sample(p);
        else
          hold = setTimeout(() => {
            if (gesture && !gesture.moved && pointers.size === 1) {
              gesture.pick = true;
              tapEligible = false;
              sample([...pointers.values()][0]);
            }
          }, 420);
      }
    };
    viewport.onpointermove = (event) => {
      if (!pointers.has(event.pointerId) || !gesture) return;
      const p = point(event);
      pointers.set(event.pointerId, p);
      const [a, b] = [...pointers.values()],
        g = gesture;
      if (b && g.pair) {
        clearTimeout(hold);
        const x = (a.x + b.x) / 2,
          y = (a.y + b.y) / 2;
        zoom = Math.max(
          0.25,
          Math.min(16, (g.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / g.distance),
        );
        const ratio = zoom / g.zoom,
          w = viewport.clientWidth,
          h = viewport.clientHeight;
        panX = x - w / 2 - (g.x - w / 2 - g.panX) * ratio;
        panY = y - h / 2 - (g.y - h / 2 - g.panY) * ratio;
      } else if (!g.pair) {
        if (Math.hypot(p.x - g.a.x, p.y - g.a.y) > 5) {
          g.moved = true;
          tapEligible = false;
          clearTimeout(hold);
        }
        if (g.pick) sample(p);
        else if (g.moved) {
          panX = g.panX + p.x - g.a.x;
          panY = g.panY + p.y - g.a.y;
        }
      }
      drawJob.request();
    };
    function end(event) {
      if (!pointers.has(event.pointerId)) return;
      const p = point(event),
        tap =
          event.type === 'pointerup' &&
          tapEligible &&
          pointers.size === 1 &&
          gesture &&
          !gesture.pair &&
          !gesture.moved &&
          Math.hypot(p.x - gesture.a.x, p.y - gesture.a.y) <= 5;
      clearTimeout(hold);
      tapEligible = false;
      pointers.delete(event.pointerId);
      q('.reference-color').hidden = true;
      // A finger remaining after a pinch can pan, but must not trigger a tap or pick.
      startGesture();
      if (tap) showControls(true);
    }
    viewport.onpointerup = viewport.onpointercancel = viewport.onlostpointercapture = end;
    viewport.ondblclick = fit;
    viewport.oncontextmenu = (event) => event.preventDefault();
    viewport.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        hideLater();
        const p = point(event),
          previous = zoom;
        zoom = Math.max(0.25, Math.min(16, zoom * Math.exp(-event.deltaY * 0.002)));
        const ratio = zoom / previous;
        panX = p.x - viewport.clientWidth / 2 - (p.x - viewport.clientWidth / 2 - panX) * ratio;
        panY = p.y - viewport.clientHeight / 2 - (p.y - viewport.clientHeight / 2 - panY) * ratio;
        drawJob.request();
      },
      { passive: false },
    );
    showControls(false);
    drawJob.request();
    return root;
  }
  return {
    open,
    render(next, key) {
      if (!windows.size || (source === next && sourceKey === key)) return;
      source = next;
      sourceKey = key;
      for (const item of windows) item.update();
    },
    get count() {
      return windows.size;
    },
  };
}
