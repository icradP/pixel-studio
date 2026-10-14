import { clone } from './engine.js';

// Snapshot on dispatch; the worker owns its structured clone. Compression and
// cover compositing never run inside pointer handlers or the drawing thread.
export function createSavePreparation() {
  let worker,
    ticket = 0;
  const pending = new Map();
  return (project) => {
    if (typeof Worker === 'undefined') {
      const snapshot = clone(project);
      return import('./save-preparation.js').then(({ prepareSave }) => prepareSave(snapshot));
    }
    if (!worker) {
      worker = new Worker(new URL('./save-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        const job = pending.get(data.ticket);
        pending.delete(data.ticket);
        if (data.error) job?.reject(Error(data.error));
        else job?.resolve(data.result);
      };
      worker.onerror = () => {
        for (const job of pending.values()) job.reject(Error('后台保存未完成，请重试'));
        pending.clear();
        worker.terminate();
        worker = null;
      };
    }
    return new Promise((resolve, reject) => {
      const id = ++ticket;
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ ticket: id, project });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  };
}
