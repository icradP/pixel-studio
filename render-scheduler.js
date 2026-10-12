/** Merge input events into one paint per display frame; pixel edits remain synchronous. */
export function createRenderScheduler(
  draw,
  {
    request = (callback) => requestAnimationFrame(callback),
    cancel = (id) => cancelAnimationFrame(id),
  } = {},
) {
  let pending = null;
  function cancelPending() {
    if (pending !== null) cancel(pending);
    pending = null;
  }
  return {
    request() {
      if (pending !== null) return;
      pending = request(() => {
        pending = null;
        draw();
      });
    },
    flush() {
      if (pending === null) return;
      cancelPending();
      draw();
    },
    cancel: cancelPending,
  };
}
