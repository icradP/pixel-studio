// Only mount rows near the viewport. Pointer-captured rows remain mounted while
// a drag auto-scrolls, so long lists keep the existing reorder/swipe gestures.
export function virtualList(
  list,
  scroller,
  items,
  create,
  { height = 76, gap = 6, overscan = 3, changed = () => {} } = {},
) {
  const rows = new Map();
  let job = 0,
    stopped = false;
  list.style.position = 'relative';
  list.style.height = items.length * height + 'px';
  function render() {
    job = 0;
    if (stopped || !list.isConnected || list.hidden) return;
    const top = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const first = Math.max(0, Math.min(items.length - 1, Math.floor(-top / height) - overscan));
    const last = Math.min(
      items.length,
      Math.max(first + 1, Math.ceil((scroller.clientHeight - top) / height) + overscan),
    );
    for (const [i, row] of rows) {
      if ((i < first || i >= last) && !row.classList.contains('item-engaged')) {
        row.remove();
        rows.delete(i);
      }
    }
    for (let i = first; i < last; i++) {
      if (rows.has(i)) continue;
      const row = create(items[i]);
      row.style.position = 'absolute';
      row.style.top = i * height + 'px';
      row.style.left = '0';
      row.style.right = '0';
      row.style.height = height - gap + 'px';
      row.style.marginBlock = gap / 2 + 'px';
      rows.set(i, row);
      const following = [...rows.keys()].filter((index) => index > i).sort((a, b) => a - b)[0];
      list.insertBefore(row, rows.get(following) || null);
    }
    changed([...rows].sort(([a], [b]) => a - b).map(([index, row]) => [items[index], row]));
  }
  const schedule = () => {
    if (!job && !stopped) job = requestAnimationFrame(render);
  };
  scroller.addEventListener('scroll', schedule, { passive: true });
  const resize = new ResizeObserver(schedule);
  resize.observe(scroller);
  resize.observe(list);
  // A list can be rebuilt while its options page is visible. Revealing it must
  // mount its rows even if the surrounding floating panel did not change size.
  const visibility = new MutationObserver(schedule);
  visibility.observe(list, { attributes: true, attributeFilter: ['hidden'] });
  render();
  return () => {
    stopped = true;
    cancelAnimationFrame(job);
    resize.disconnect();
    visibility.disconnect();
    scroller.removeEventListener('scroll', schedule);
  };
}
