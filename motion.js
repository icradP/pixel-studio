export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const running = new WeakMap();

/** One compositor animation per surface; a new intent always replaces the old one. */
export function stopMotion(element) {
  running.get(element)?.cancel();
  running.delete(element);
}
export function animateSurface(element, opening) {
  const current = running.has(element)
    ? { opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform }
    : null;
  stopMotion(element);
  if (reducedMotion()) return Promise.resolve();
  const hidden = { opacity: 0, transform: 'translateY(-7px) scale(.975)' };
  const visible = { opacity: 1, transform: 'translateY(0) scale(1)' };
  const animation = element.animate(
    [current || (opening ? hidden : visible), opening ? visible : hidden],
    {
      duration: opening ? 220 : 150,
      easing: 'cubic-bezier(.18,.82,.25,1)',
    },
  );
  running.set(element, animation);
  return animation.finished
    .catch(() => {})
    .finally(() => {
      if (running.get(element) === animation) running.delete(element);
    });
}
