import { reducedMotion } from './motion.js';

// The lifted preview follows the pointer while the source keeps its list geometry.
export function itemGestures(element, { scroller, swipe, drop, holdDelay = 360 }) {
  let state,
    timer,
    target,
    ghost,
    job = 0,
    suppressUntil = 0;
  const face = () => element.querySelector('.layer-face');
  function clean(land = false) {
    clearTimeout(timer);
    cancelAnimationFrame(job);
    job = 0;
    element.classList.remove('item-lifted', 'item-swiping');
    element.classList.remove('item-engaged');
    face()?.style.removeProperty('transform');
    target?.classList.remove('item-drop-target');
    if (ghost) {
      const preview = ghost,
        rect = target?.getBoundingClientRect();
      if (land && rect && !reducedMotion()) {
        preview
          .animate(
            [
              { transform: preview.style.transform, opacity: 1 },
              {
                transform: `translate3d(${rect.left - Number(preview.dataset.x)}px,${rect.top - Number(preview.dataset.y)}px,0) scale(1)`,
                opacity: 0.3,
              },
            ],
            { duration: 170, easing: 'cubic-bezier(.2,.8,.2,1)' },
          )
          .finished.catch(() => {})
          .finally(() => preview.remove());
      } else preview.remove();
    }
    ghost = target = null;
  }
  function paint() {
    job = 0;
    if (!state) return;
    if (!element.isConnected) {
      state = null;
      clean();
      return;
    }
    if (state.drag) {
      ghost.style.transform = `translate3d(${state.px - state.x}px,${state.py - state.y}px,0) scale(1.025)`;
      const candidate = document.elementFromPoint(state.px, state.py)?.closest('[data-drag-key]');
      if (candidate !== target) {
        target?.classList.remove('item-drop-target');
        target =
          candidate !== element && candidate?.parentElement === element.parentElement
            ? candidate
            : null;
        target?.classList.add('item-drop-target');
      }
      const box = scroller.getBoundingClientRect();
      const velocity =
        state.py < box.top + 44
          ? -Math.min(16, (box.top + 44 - state.py) / 3)
          : state.py > box.bottom - 44
            ? Math.min(16, (state.py - box.bottom + 44) / 3)
            : 0;
      if (velocity) {
        scroller.scrollTop += velocity;
        job = requestAnimationFrame(paint);
      }
    } else if (state.axis === 'x' && face()) {
      element.classList.add('item-swiping');
      face().style.transform = `translate3d(${Math.max(-186, Math.min(0, state.swiped + state.px - state.x))}px,0,0)`;
    }
  }
  const request = () => {
    if (!job) job = requestAnimationFrame(paint);
  };
  element.addEventListener(
    'click',
    (event) => {
      if (
        performance.now() < suppressUntil &&
        (!event.target.closest('button') || event.target.closest('[data-item-touch]'))
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  element.addEventListener('pointerdown', (event) => {
    if (
      event.button !== 0 ||
      state ||
      (event.target.closest('button,input') && !event.target.closest('[data-item-touch]'))
    )
      return;
    state = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      px: event.clientX,
      py: event.clientY,
      lastY: event.clientY,
      drag: false,
      axis: null,
      swiped: element.classList.contains('swiped') ? -186 : 0,
    };
    element.classList.add('item-engaged');
    (event.target.closest('[data-item-touch]') || element).setPointerCapture(event.pointerId);
    timer = setTimeout(() => {
      if (!state || state.axis || !drop || !element.isConnected) return;
      state.drag = true;
      const box = element.getBoundingClientRect();
      ghost = element.cloneNode(true);
      ghost.removeAttribute('id');
      ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
      const originals = element.querySelectorAll('canvas');
      ghost
        .querySelectorAll('canvas')
        .forEach((canvas, i) => canvas.getContext('2d').drawImage(originals[i], 0, 0));
      ghost.classList.add('item-drag-preview');
      ghost.classList.remove('swiped', 'layer', 'project-card', 'stack-card');
      ghost.removeAttribute('data-id');
      ghost.removeAttribute('data-drag-key');
      ghost.inert = true;
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.cssText = `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;margin:0;pointer-events:none;z-index:999;`;
      ghost.dataset.x = box.left;
      ghost.dataset.y = box.top;
      (element.closest('dialog') || document.body).append(ghost);
      element.classList.add('item-lifted');
      request();
    }, holdDelay);
  });
  element.addEventListener('pointermove', (event) => {
    if (state?.id !== event.pointerId) return;
    state.px = event.clientX;
    state.py = event.clientY;
    const dx = state.px - state.x,
      dy = state.py - state.y;
    if (state.drag) {
      event.preventDefault();
      request();
    } else {
      if (!state.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 10) {
        clearTimeout(timer);
        state.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
      }
      if (state.axis === 'y') scroller.scrollTop += state.lastY - event.clientY;
      else if (state.axis === 'x') request();
    }
    state.lastY = event.clientY;
  });
  element.addEventListener('pointerup', (event) => {
    if (state?.id !== event.pointerId) return;
    state.px = event.clientX;
    state.py = event.clientY;
    cancelAnimationFrame(job);
    paint();
    if (!state) return;
    const dx = state.px - state.x,
      destination = target?.dataset.dragKey,
      drag = state.drag,
      axis = state.axis;
    state = null;
    if (drag || axis) suppressUntil = performance.now() + 400;
    clean(drag && destination !== undefined);
    if (drag && destination !== undefined) drop?.(destination);
    else if (!drag && axis === 'x' && Math.abs(dx) > 35) swipe?.(dx < 0 ? 'left' : 'right');
  });
  for (const type of ['pointercancel', 'lostpointercapture'])
    element.addEventListener(type, (event) => {
      if (state?.id !== event.pointerId) return;
      suppressUntil = performance.now() + 400;
      state = null;
      clean();
    });
}
