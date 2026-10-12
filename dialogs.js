import { animateSurface, stopMotion } from './motion.js';
const sessions = new WeakMap();
export async function showDialog(dialog) {
  sessions.set(dialog, {});
  stopMotion(dialog);
  dialog.classList.remove('leaving');
  if (!dialog.open) dialog.showModal();
  await animateSurface(dialog, true);
}
export async function hideDialog(dialog) {
  if (!dialog.open) return;
  const current = sessions.get(dialog) || {};
  if (current.closing) return current.closing;
  sessions.set(dialog, current);
  dialog.classList.add('leaving');
  current.closing = animateSurface(dialog, false).then(() => {
    if (sessions.get(dialog) !== current) return;
    dialog.close();
    dialog.classList.remove('leaving');
    sessions.delete(dialog);
  });
  return current.closing;
}
export function askDialog({ title, description = '', value, confirm = '确定', danger = false }) {
  const d = document.querySelector('#action-dialog'),
    form = d.querySelector('form'),
    field = d.querySelector('input'),
    isText = value !== undefined;
  d.querySelector('h2').textContent = title;
  d.querySelector('p').textContent = description;
  field.hidden = !isText;
  field.value = value ?? '';
  field.required = isText;
  const ok = d.querySelector('[type=submit]');
  ok.textContent = confirm;
  ok.className = danger ? 'destructive' : 'primary';
  showDialog(d);
  requestAnimationFrame(() => {
    if (isText) {
      field.focus();
      field.select();
    } else d.querySelector('[data-cancel]').focus();
  });
  return new Promise((resolve) => {
    let settled = false;
    const finish = async (result) => {
      if (settled) return;
      settled = true;
      await hideDialog(d);
      resolve(result);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      if (isText && !field.value.trim()) return;
      finish(isText ? field.value.trim() : true);
    };
    d.querySelector('[data-cancel]').onclick = () => finish(null);
    d.oncancel = (e) => {
      e.preventDefault();
      finish(null);
    };
    d.onclick = (e) => {
      if (e.target === d) {
        const r = d.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
          finish(null);
      }
    };
  });
}
