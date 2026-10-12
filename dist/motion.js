export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const running = new WeakMap();

/** One compositor animation per surface; a new intent always replaces the old one. */
export function stopMotion(element) {
  running.get(element)?.cancel();
  running.delete(element);
}
export function animateSurface(element, opening) {
  stopMotion(element);
  if (reducedMotion()) return Promise.resolve();
  const hidden = { opacity: 0, transform: 'translateY(-5px) scale(.98)' };
  const visible = { opacity: 1, transform: 'translateY(0) scale(1)' };
  const animation = element.animate(opening ? [hidden, visible] : [visible, hidden], {
    duration: opening ? 180 : 120,
    easing: 'cubic-bezier(.2,.8,.2,1)',
  });
  running.set(element, animation);
  return animation.finished
    .catch(() => {})
    .finally(() => {
      if (running.get(element) === animation) running.delete(element);
    });
}
