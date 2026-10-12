const DATABASE_VERSION = 2;
const STORES = ['projects', 'summaries'];

function summary(record) {
  const { id, project, preview, updated } = record;
  return {
    id,
    name: project.name,
    w: project.w,
    h: project.h,
    frameCount: project.frames.length,
    preview,
    updated,
  };
}

/** Keep project pixels and lightweight gallery metadata in the same transaction. */
export function openProjectStore({ indexedDB = globalThis.indexedDB, name = 'pixel-studio' } = {}) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION);
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(new Error('请关闭其他画室标签页后刷新，以升级本地作品库。'));
    };
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('projects'))
        db.createObjectStore('projects', { keyPath: 'id' });
      const summaries = db.createObjectStore('summaries', { keyPath: 'id' });
      const cursor = request.transaction.objectStore('projects').openCursor();
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        summaries.put(summary(cursor.result.value));
        cursor.result.continue();
      };
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      function transact(stores, mode, action) {
        return new Promise((resolve, reject) => {
          const tx = db.transaction(stores, mode);
          let result;
          tx.oncomplete = () => resolve(result?.result);
          tx.onabort = () => reject(tx.error || new Error('作品库事务已取消'));
          tx.onerror = () => reject(tx.error || new Error('作品库读写失败'));
          try {
            result = action(tx);
          } catch (error) {
            tx.abort();
            reject(error);
          }
        });
      }
      resolve({
        get: (id) => transact(['projects'], 'readonly', (tx) => tx.objectStore('projects').get(id)),
        list: () =>
          transact(['summaries'], 'readonly', (tx) => tx.objectStore('summaries').getAll()),
        put: (record) =>
          transact(STORES, 'readwrite', (tx) => {
            tx.objectStore('projects').put(record);
            tx.objectStore('summaries').put(summary(record));
          }),
        remove: (id) =>
          transact(STORES, 'readwrite', (tx) => {
            tx.objectStore('projects').delete(id);
            tx.objectStore('summaries').delete(id);
          }),
        close: () => db.close(),
      });
    };
  });
}
