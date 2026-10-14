import { animateSurface, stopMotion } from './motion.js';
import { createRenderScheduler } from './render-scheduler.js';

const windows = [];
const positions = new Map();
const glyph = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
export const closeIcon = glyph('M7 7l10 10M17 7L7 17');
export function dismissTopWindow() {
  const top = [...windows].reverse().find((element) => !element.hidden && !element.dataset.closing);
  const close = top?.querySelector('.window-close,#plugins-close,#selection-dismiss');
  if (!close) return false;
  close.click();
  return true;
}

export function floatingPanel(
  element,
  {
    onClose = () => {},
    onFocus = () => {},
    onMove = () => {},
    titleHandle,
    collapseButton,
    closeButton,
    autoPlace = true,
    resizable = false,
    opener = document.activeElement,
  } = {},
) {
  let drag = null,
    closed = false,
    moved = false;
  let resizing = null;
  // User size is independent of the temporary keyboard/viewport/collapsed size.
  let preferredSize = null;
  const parts = () =>
    element.querySelectorAll(
      '.plugins-body,.plugins-footer,.window-body,.window-footer,.selection-body',
    );
  const notify = () => {
    if (element.id !== 'selection-bar') document.dispatchEvent(new Event('pixel-studio-windows'));
  };
  if (closeButton) closeButton.innerHTML = closeIcon;
  const collapseIcon = () => {
    if (collapseButton)
      collapseButton.innerHTML = glyph(
        element.classList.contains('float-collapsed') ? 'M7 10l5 5 5-5' : 'M7 14l5-5 5 5',
      );
  };
  collapseIcon();
  function raise() {
    if (closed || element.hidden) return;
    if (windows.at(-1) !== element) {
      const at = windows.indexOf(element);
      if (at >= 0) windows.splice(at, 1);
      windows.push(element);
      windows.forEach((el, i) => (el.style.zIndex = String(40 + i)));
    }
    onFocus();
  }
  function bounds() {
    const viewport = window.visualViewport;
    const w = viewport?.width || innerWidth,
      h = viewport?.height || innerHeight;
    const x = viewport?.offsetLeft || 0,
      y = viewport?.offsetTop || 0;
    const bottom =
      element.id === 'selection-bar' || resizable
        ? y + h
        : Math.min(
            y + h,
            document.querySelector('#stage')?.getBoundingClientRect().bottom || y + h,
          );
    const top = Math.max(
      y + 8,
      document.querySelector('.topbar')?.getBoundingClientRect().bottom + 8 || y + 68,
    );
    return {
      left: x + 8,
      right: Math.max(x + 8, x + w - element.offsetWidth - 8),
      top,
      bottom: Math.max(top, bottom - Math.min(element.offsetHeight, bottom - top - 8) - 8),
      limit: bottom,
    };
  }
  function clamp() {
    if (closed || element.hidden || drag || resizing) return;
    const collapsed = element.classList.contains('float-collapsed');
    const area = bounds();
    // Measure expanded content with the full available space first. Measuring
    // under the previous max-height creates a self-reinforcing tiny window.
    if (element.id !== 'selection-bar')
      element.style.setProperty(
        '--window-available-height',
        Math.max(120, area.limit - area.top - 8) + 'px',
      );
    if (resizable) {
      preferredSize ||= { width: element.offsetWidth, height: element.offsetHeight };
      element.style.width =
        Math.min(preferredSize.width, (window.visualViewport?.width || innerWidth) - 16) + 'px';
      if (!collapsed)
        element.style.height = Math.min(preferredSize.height, area.limit - area.top - 8) + 'px';
    }
    const box = bounds();
    const left = Math.max(box.left, Math.min(box.right, element.offsetLeft));
    const top = Math.max(box.top, Math.min(box.bottom, element.offsetTop));
    element.style.left = left + 'px';
    element.style.top = top + 'px';
    element.style.right = 'auto';
    element.style.bottom = 'auto';
  }
  function position() {
    if (!autoPlace) return;
    const saved = positions.get(element.id);
    if (saved) {
      moved = true;
      element.style.left = saved.left + 'px';
      element.style.top = saved.top + 'px';
      return;
    }
    const width = element.offsetWidth;
    const occupied = windows
      .filter((el) => el !== element && !el.hidden)
      .map((el) => el.getBoundingClientRect());
    const candidates = [
      Math.max(8, innerWidth - width - 12),
      Math.min(82, innerWidth - width - 8),
      Math.max(8, innerWidth - 2 * width - 24),
    ];
    const overlap = (left) =>
      occupied.reduce(
        (sum, r) => sum + Math.max(0, Math.min(left + width, r.right) - Math.max(left, r.left)),
        0,
      );
    candidates.sort((a, b) => overlap(a) - overlap(b));
    element.style.left = candidates[0] + 'px';
    element.style.top = bounds().top + 'px';
  }
  const resizeJob = createRenderScheduler(() => {
    if (closed) return;
    if (autoPlace && !moved) position();
    clamp();
    notify();
  });
  const dragJob = createRenderScheduler(() => {
    if (drag)
      element.style.transform = `translate3d(${drag.left - drag.originLeft}px,${drag.top - drag.originTop}px,0)`;
  });
  const resize = () => resizeJob.request();
  function finishDrag() {
    if (!drag) return;
    dragJob.cancel();
    element.style.left = drag.left + 'px';
    element.style.top = drag.top + 'px';
    element.style.transform = '';
    element.style.willChange = '';
    element.classList.remove('window-dragging');
    drag = null;
    clamp();
    notify();
    if (autoPlace) positions.set(element.id, { left: element.offsetLeft, top: element.offsetTop });
  }
  function close() {
    if (closed) return;
    finishDrag();
    closed = true;
    resizeJob.cancel();
    dragJob.cancel();
    sizeJob.cancel();
    resizing = null;
    observer.disconnect();
    window.removeEventListener('resize', resize);
    window.visualViewport?.removeEventListener('resize', resize);
    element.removeEventListener('pointerdown', raise);
    const at = windows.indexOf(element);
    if (at >= 0) windows.splice(at, 1);
    if (resizable) positions.delete(element.id);
    element.dataset.closing = 'true';
    element.inert = true;
    if (element.contains(document.activeElement) && opener?.isConnected)
      opener.focus({ preventScroll: true });
    onClose();
    notify();
    element.style.pointerEvents = 'none';
    void animateSurface(element, false).then(() => element.remove());
  }
  function collapse(value = !element.classList.contains('float-collapsed')) {
    if (closed || element.classList.contains('float-collapsed') === value) return;
    element.classList.toggle('float-collapsed', value);
    collapseButton?.setAttribute('aria-expanded', String(!value));
    collapseIcon();
    parts().forEach((part) => (part.inert = value));
    if (value && element.contains(document.activeElement))
      collapseButton?.focus({ preventScroll: true });
    resize();
    if (!value) void animateSurface(element, true);
    notify();
  }
  titleHandle.onpointerdown = (event) => {
    if (event.button !== 0 || event.target.closest('button,input,select,a')) return;
    stopMotion(element);
    raise();
    event.preventDefault();
    const box = bounds();
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originLeft: element.offsetLeft,
      originTop: element.offsetTop,
      left: element.offsetLeft,
      top: element.offsetTop,
      box,
    };
    element.classList.add('window-dragging');
    element.style.willChange = 'transform';
    titleHandle.setPointerCapture(event.pointerId);
  };
  titleHandle.onpointermove = (event) => {
    if (drag?.id !== event.pointerId) return;
    moved = true;
    onMove();
    drag.left = Math.max(
      drag.box.left,
      Math.min(drag.box.right, drag.originLeft + event.clientX - drag.x),
    );
    drag.top = Math.max(
      drag.box.top,
      Math.min(drag.box.bottom, drag.originTop + event.clientY - drag.y),
    );
    dragJob.request();
  };
  titleHandle.onpointerup =
    titleHandle.onpointercancel =
    titleHandle.onlostpointercapture =
      finishDrag;
  const sizeJob = createRenderScheduler(() => {
    if (!resizing || closed) return;
    element.style.width = resizing.width + 'px';
    element.style.height = resizing.height + 'px';
    element.style.left = resizing.left + 'px';
  });
  if (resizable)
    for (const side of ['left', 'right']) {
      const handle = document.createElement('button');
      handle.className = 'window-resize resize-' + side;
      handle.setAttribute(
        'aria-label',
        side === 'left' ? '从左下角调整窗口大小' : '从右下角调整窗口大小',
      );
      handle.title = '拖动调整大小 · 方向键微调';
      element.append(handle);
      handle.onpointerdown = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        stopMotion(element);
        raise();
        moved = true;
        resizing = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          width: element.offsetWidth,
          height: element.offsetHeight,
          left: element.offsetLeft,
          initialWidth: element.offsetWidth,
          initialHeight: element.offsetHeight,
          initialLeft: element.offsetLeft,
        };
        element.classList.add('window-resizing');
        handle.setPointerCapture(event.pointerId);
      };
      handle.onpointermove = (event) => {
        if (resizing?.id !== event.pointerId) return;
        const r = resizing,
          maxWidth =
            side === 'left' ? r.initialLeft + r.initialWidth - 8 : innerWidth - r.initialLeft - 8;
        r.width = Math.max(
          Math.min(240, maxWidth),
          Math.min(maxWidth, r.initialWidth + (event.clientX - r.x) * (side === 'left' ? -1 : 1)),
        );
        r.height = Math.max(
          220,
          Math.min(innerHeight - element.offsetTop - 8, r.initialHeight + event.clientY - r.y),
        );
        r.left = side === 'left' ? r.initialLeft + r.initialWidth - r.width : r.initialLeft;
        sizeJob.request();
      };
      const finishSize = () => {
        if (!resizing) return;
        sizeJob.flush();
        preferredSize = { width: resizing.width, height: resizing.height };
        resizing = null;
        element.classList.remove('window-resizing');
        clamp();
        notify();
        positions.set(element.id, { left: element.offsetLeft, top: element.offsetTop });
      };
      handle.onpointerup = handle.onpointercancel = handle.onlostpointercapture = finishSize;
      handle.onkeydown = (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        element.style.width =
          Math.max(
            240,
            element.offsetWidth +
              (event.key === 'ArrowRight' ? 10 : event.key === 'ArrowLeft' ? -10 : 0),
          ) + 'px';
        element.style.height =
          Math.max(
            220,
            element.offsetHeight +
              (event.key === 'ArrowDown' ? 10 : event.key === 'ArrowUp' ? -10 : 0),
          ) + 'px';
        preferredSize = {
          width: parseFloat(element.style.width),
          height: parseFloat(element.style.height),
        };
        clamp();
      };
    }
  element.addEventListener('pointerdown', raise);
  if (collapseButton) collapseButton.onclick = () => collapse();
  if (closeButton) closeButton.onclick = close;
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  const observer = new ResizeObserver(resize);
  observer.observe(element);
  const stage = document.querySelector('#stage');
  if (stage) observer.observe(stage);
  position();
  raise();
  clamp();
  notify();
  if (!element.hidden) void animateSurface(element, true);
  return { close, raise, collapse, clamp };
}

export function createToolWindows(onChange) {
  const items = new Map();
  return {
    has: (type) => items.has(type),
    content: (type) => items.get(type)?.body,
    toggle(type, title, render, opener) {
      const item = items.get(type);
      if (!item) return this.open(type, title, render, opener);
      if (item.element.classList.contains('float-collapsed')) {
        item.float.collapse(false);
        item.float.raise();
        return item.body;
      }
      item.float.close();
      return null;
    },
    open(type, title, render, opener) {
      let item = items.get(type);
      if (item) {
        item.float.collapse(false);
        item.float.raise();
        return item.body;
      }
      document.querySelector(`#window-${type}[data-closing]`)?.remove();
      const element = document.createElement('aside');
      element.id = 'window-' + type;
      element.className = 'studio-window';
      element.dataset.type = type;
      element.setAttribute('role', 'dialog');
      element.setAttribute('aria-label', title);
      element.innerHTML =
        '<header class="window-head"><h2></h2><button type="button" class="window-collapse" aria-expanded="true"></button><button type="button" class="window-close"></button></header><div class="window-body"></div>';
      element.querySelector('h2').textContent = title;
      element.querySelector('.window-collapse').setAttribute('aria-label', '收起或展开' + title);
      element.querySelector('.window-close').setAttribute('aria-label', '关闭' + title);
      document.body.append(element);
      const body = element.querySelector('.window-body');
      item = { element, body, float: null };
      items.set(type, item);
      render();
      item.float = floatingPanel(element, {
        opener,
        titleHandle: element.querySelector('header'),
        collapseButton: element.querySelector('.window-collapse'),
        closeButton: element.querySelector('.window-close'),
        onClose: () => {
          items.delete(type);
          onChange?.(null);
        },
        onFocus: () => onChange?.(type),
      });
      return body;
    },
    close(type) {
      items.get(type)?.float.close();
    },
    closeAll() {
      for (const item of [...items.values()]) item.float.close();
    },
  };
}
