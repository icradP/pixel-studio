import { reducedMotion } from './motion.js';

// Only mount rows near the viewport. Pointer-captured rows remain mounted while
// a drag auto-scrolls, so long lists keep the existing reorder/swipe gestures.
export function virtualList(
  list,
  scroller,
  items,
  create,
  { height = 76, gap = 6, overscan = 3, changed = () => {}, detail = null } = {},
) {
  const rows = new Map();
  let job = 0,
    stopped = false,
    animation = 0,
    detailHeight = 0,
    expanded = false;
  const detailIndex = detail ? items.indexOf(detail.after) : -1;
  const detailTop = (detailIndex + 1) * height;
  const slot = detailIndex < 0 ? null : document.createElement('div');
  if (slot) {
    slot.className = 'layer-inline-options';
    slot.style.position = 'absolute';
    slot.style.insetInline = '0';
    slot.style.top = detailTop + 'px';
    slot.hidden = true;
    slot.append(detail.element);
    list.append(slot);
  }
  list.style.position = 'relative';
  list.style.height = items.length * height + 'px';
  const rowAt = (y) =>
    Math.floor(
      (y < detailTop || !detailHeight ? y : Math.max(detailTop, y - detailHeight)) / height,
    );
  function render() {
    job = 0;
    if (stopped || !list.isConnected || list.hidden) return;
    const top = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    list.style.height = items.length * height + detailHeight + 'px';
    if (slot) slot.style.height = detailHeight + 'px';
    const first = Math.max(0, Math.min(items.length - 1, rowAt(-top) - overscan));
    const last = Math.min(
      items.length,
      Math.max(first + 1, rowAt(scroller.clientHeight - top) + 1 + overscan),
    );
    for (const [i, row] of rows) {
      if (
        (i < first || i >= last) &&
        i !== detailIndex &&
        !row.classList.contains('item-engaged')
      ) {
        row.remove();
        rows.delete(i);
      }
    }
    const needed = new Set(Array.from({ length: last - first }, (_, i) => first + i));
    if (slot) needed.add(detailIndex);
    for (const i of needed) {
      if (rows.has(i)) continue;
      const row = create(items[i]);
      row.style.position = 'absolute';
      row.style.left = '0';
      row.style.right = '0';
      row.style.height = height - gap + 'px';
      row.style.marginBlock = gap / 2 + 'px';
      rows.set(i, row);
      const following = [...rows.keys()].filter((index) => index > i).sort((a, b) => a - b)[0];
      list.insertBefore(row, rows.get(following) || null);
    }
    for (const [i, row] of rows)
      row.style.top = i * height + (i > detailIndex ? detailHeight : 0) + 'px';
    // Keep property controls directly after their owner in keyboard/DOM order.
    if (slot && rows.has(detailIndex) && rows.get(detailIndex).nextSibling !== slot)
      rows.get(detailIndex).after(slot);
    changed([...rows].sort(([a], [b]) => a - b).map(([index, row]) => [items[index], row]));
  }
  const schedule = () => {
    if (!job && !stopped) job = requestAnimationFrame(render);
  };
  scroller.addEventListener('scroll', schedule, { passive: true });
  const resize = new ResizeObserver(schedule);
  resize.observe(scroller);
  resize.observe(list);
  const detailResize = new ResizeObserver(() => {
    if (!slot || !expanded || animation || stopped) return;
    detailHeight = detail.element.offsetHeight;
    schedule();
  });
  if (slot) detailResize.observe(detail.element);
  function setExpanded(open, animate = true) {
    if (!slot || stopped) return;
    expanded = open;
    detail.element.dataset.expanded = String(open);
    cancelAnimationFrame(animation);
    animation = 0;
    slot.hidden = detail.element.hidden = false;
    slot.inert = !open;
    const from = detailHeight;
    const to = open ? detail.element.offsetHeight : 0;
    const finish = () => {
      animation = 0;
      detailHeight = open ? detail.element.offsetHeight : 0;
      slot.hidden = detail.element.hidden = !open;
      slot.style.opacity = '';
      render();
    };
    if (!animate || reducedMotion() || Math.abs(from - to) < 1) return finish();
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 220);
      const progress = 1 - (1 - t) ** 3;
      detailHeight = from + (to - from) * progress;
      slot.style.opacity = String(open ? 0.35 + progress * 0.65 : 1 - progress);
      render();
      if (t < 1) animation = requestAnimationFrame(step);
      else finish();
    };
    animation = requestAnimationFrame(step);
  }
  // A list can be rebuilt while its options page is visible. Revealing it must
  // mount its rows even if the surrounding floating panel did not change size.
  const visibility = new MutationObserver(schedule);
  visibility.observe(list, { attributes: true, attributeFilter: ['hidden'] });
  if (slot) setExpanded(!!detail.expanded, false);
  else render();
  const dispose = () => {
    stopped = true;
    cancelAnimationFrame(job);
    cancelAnimationFrame(animation);
    resize.disconnect();
    detailResize.disconnect();
    visibility.disconnect();
    scroller.removeEventListener('scroll', schedule);
  };
  dispose.setExpanded = setExpanded;
  return dispose;
}
