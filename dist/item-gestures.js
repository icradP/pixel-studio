// Item lists: tap, horizontal swipe, hold to reorder; vertical motion before the hold scrolls.
export function itemGestures(element, { scroller, swipe, drop, holdDelay = 360 }) {
  let state,
    timer,
    suppressUntil = 0,
    target;
  const clean = () => {
    clearTimeout(timer);
    element.classList.remove('item-lifted');
    target?.classList.remove('item-drop-target');
    target = null;
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
      (event.target.closest('button,input') && !event.target.closest('[data-item-touch]'))
    )
      return;
    state = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastY: event.clientY,
      drag: false,
      scroll: false,
    };
    (event.target.closest('[data-item-touch]') || element).setPointerCapture(event.pointerId);
    timer = setTimeout(() => {
      if (!state || state.scroll || !drop) return;
      state.drag = true;
      element.classList.add('item-lifted');
    }, holdDelay);
  });
  element.addEventListener('pointermove', (event) => {
    if (state?.id !== event.pointerId) return;
    const dx = event.clientX - state.x,
      dy = event.clientY - state.y;
    if (state.drag) {
      event.preventDefault();
      const candidate = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-drag-key]');
      target?.classList.remove('item-drop-target');
      target =
        candidate !== element && candidate?.parentElement === element.parentElement
          ? candidate
          : null;
      target?.classList.add('item-drop-target');
      const box = scroller.getBoundingClientRect();
      if (event.clientY < box.top + 40) scroller.scrollTop -= 12;
      if (event.clientY > box.bottom - 40) scroller.scrollTop += 12;
    } else if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      clearTimeout(timer);
      if (Math.abs(dy) > Math.abs(dx) || state.scroll) {
        state.scroll = true;
        scroller.scrollTop += state.lastY - event.clientY;
      }
    }
    state.lastY = event.clientY;
  });
  element.addEventListener('pointerup', (event) => {
    if (state?.id !== event.pointerId) return;
    const dx = event.clientX - state.x,
      dy = event.clientY - state.y,
      destination = target?.dataset.dragKey;
    const drag = state.drag,
      scroll = state.scroll;
    state = null;
    clean();
    if (drag || scroll || Math.abs(dx) > 35) suppressUntil = performance.now() + 400;
    if (drag && destination !== undefined) drop?.(destination);
    else if (!drag && !scroll && Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy))
      swipe?.(dx < 0 ? 'left' : 'right');
  });
  for (const type of ['pointercancel', 'lostpointercapture'])
    element.addEventListener(type, () => {
      state = null;
      clean();
    });
}
