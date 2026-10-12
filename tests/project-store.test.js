import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { blank } from '../dist/engine.js';
import { openProjectStore } from '../dist/project-store.js';

const record = (id = 'one') => ({
  id,
  project: blank(2, 2, '作品'),
  preview: 'data:image/png;base64,',
  updated: 123,
});

test('project writes commit pixels and lightweight summaries together', async (t) => {
  const store = await openProjectStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  const item = record();
  await store.put(item);
  const summaries = await store.list();
  assert.deepEqual(summaries, [
    { id: 'one', name: '作品', w: 2, h: 2, frameCount: 1, preview: item.preview, updated: 123 },
  ]);
  assert.deepEqual(await store.get('one'), item);
  item.project.frames[0].cels[0][0] = 200;
  assert.equal((await store.get('one')).project.frames[0].cels[0][0], 0);
  await store.remove('one');
  assert.deepEqual(await store.list(), []);
  assert.equal(await store.get('one'), undefined);
});

test('a v1 database migrates existing projects without changing their pixels', async (t) => {
  const indexedDB = new IDBFactory();
  const item = record('legacy');
  item.project.frames[0].cels[0].set([120, 30, 60, 255]);
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('pixel-studio', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('projects', { keyPath: 'id' }).put(item);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
  const store = await openProjectStore({ indexedDB });
  t.after(() => store.close());
  assert.deepEqual(await store.get('legacy'), item);
  assert.equal((await store.list())[0].name, '作品');
});

test('failed summary writes roll back the corresponding pixel write', async (t) => {
  const store = await openProjectStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  const put = IDBObjectStore.prototype.put;
  const mock = t.mock.method(IDBObjectStore.prototype, 'put', function (...args) {
    if (this.name === 'summaries') throw new DOMException('Full', 'QuotaExceededError');
    return put.apply(this, args);
  });
  await assert.rejects(store.put(record()), { name: 'QuotaExceededError' });
  mock.mock.restore();
  assert.equal(await store.get('one'), undefined);
  assert.deepEqual(await store.list(), []);
  await store.put(record());
  assert.equal((await store.list()).length, 1);
});

test('write success is reported only after the transaction commits', async (t) => {
  const store = await openProjectStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  const put = IDBObjectStore.prototype.put;
  const mock = t.mock.method(IDBObjectStore.prototype, 'put', function (...args) {
    const request = put.apply(this, args);
    if (this.name === 'summaries')
      request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  await assert.rejects(store.put(record()));
  mock.mock.restore();
  assert.equal(await store.get('one'), undefined);
  assert.deepEqual(await store.list(), []);
});

test('connections close on versionchange so a later database upgrade can proceed', async () => {
  const indexedDB = new IDBFactory();
  await openProjectStore({ indexedDB });
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('pixel-studio', 3);
    request.onblocked = () => reject(Error('Upgrade unexpectedly blocked'));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
});
