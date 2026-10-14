import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
      );
    }
  });
}

async function currentProject(page) {
  return page.evaluate(async () => {
    const { openProjectStore } = await import('/project-store.js');
    const store = await openProjectStore();
    try {
      return (await store.get(localStorage.getItem('pixel-studio-current'))).project;
    } finally {
      store.close();
    }
  });
}

async function save(page) {
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
}

test('draw, undo, redo and reload preserve committed pixels', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  const before = await currentProject(page);
  const canvas = await page.locator('#view').boundingBox();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width / 2 + 35, canvas.y + canvas.height / 2 + 15, {
    steps: 12,
  });
  await page.mouse.up();
  await save(page);
  const drawn = await currentProject(page);
  expect(drawn.frames).not.toEqual(before.frames);
  await page.locator('#quick-undo').click();
  await save(page);
  expect((await currentProject(page)).frames).toEqual(before.frames);
  await page.locator('#quick-redo').click();
  await save(page);
  expect((await currentProject(page)).frames).toEqual(drawn.frames);
  await page.reload();
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
  expect((await currentProject(page)).frames).toEqual(drawn.frames);
  expect(errors).toEqual([]);
});

test('legacy gallery migrates, copies, renames, opens and deletes projects', async ({ page }) => {
  await page.goto('/icon.svg');
  await page.evaluate(async () => {
    const project = {
      format: 'pixel-studio',
      version: 1,
      name: '旧版作品',
      w: 2,
      h: 2,
      layers: [{ name: '图层 1', visible: true, opacity: 255 }],
      frames: [
        { duration: 120, cels: [new Uint8ClampedArray([255, 0, 0, 255, ...Array(12).fill(0)])] },
      ],
    };
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('pixel-studio', 1);
      request.onupgradeneeded = () =>
        request.result
          .createObjectStore('projects', { keyPath: 'id' })
          .put({ id: 'legacy', project, updated: 1, preview: '/icon-192.png' });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
    localStorage.setItem('pixel-studio-current', 'legacy');
  });
  await ready(page);
  await expect(page.locator('#project-name')).toHaveText('旧版作品');
  const original = await currentProject(page);
  await page.locator('#gallery').click();
  await expect(page.locator('.project-card')).toHaveCount(1);
  await page.locator('#gallery-select').click();
  await page.getByRole('button', { name: '打开 旧版作品', exact: true }).click();
  await page.locator('#gallery-copy').click();
  await expect(page.locator('.project-card')).toHaveCount(2);
  await page.getByRole('button', { name: '打开 旧版作品 副本', exact: true }).click();
  await page.locator('#gallery-rename').click();
  await page.locator('#action-dialog input').fill('副本测试');
  await page.locator('#action-dialog button[type=submit]').click();
  await expect(page.getByRole('button', { name: '打开 副本测试', exact: true })).toBeVisible();
  await page.locator('#gallery-select').click();
  await page.getByRole('button', { name: '打开 副本测试', exact: true }).click();
  await expect(page.locator('#project-name')).toHaveText('副本测试');
  expect((await currentProject(page)).frames).toEqual(original.frames);
  await page.locator('#gallery').click();
  await page.locator('#gallery-select').click();
  await page.getByRole('button', { name: '打开 旧版作品', exact: true }).click();
  await page.locator('#gallery-delete').click();
  await page.locator('#action-dialog button[type=submit]').click();
  await expect(page.locator('.project-card')).toHaveCount(1);
});

test('failed saves keep the current unsaved project when another project is requested', async ({
  page,
}) => {
  await ready(page);
  const name = await page.locator('#project-name').textContent();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'projects') throw new DOMException('Storage full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.locator('#duplicate-frame').click();
  await expect(page.locator('#frame-count')).toHaveText('07 FRAMES');
  await page.locator('#gallery').click();
  await expect(page.locator('#save-status')).toHaveText('保存失败，请导出备份');
  await page.locator('#open-pelican-example').click();
  await expect(page.locator('#example-status')).toContainText('请先保存或导出当前作品');
  await expect(page.locator('#frame-count')).toHaveText('07 FRAMES');
  await page.locator('#new-demo').click();
  await expect(page.locator('#frame-count')).toHaveText('07 FRAMES');
  await expect(page.locator('#project-name')).toHaveText(name);
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
  await page.locator('#close-gallery').click();
  await expect(page.locator('#quick-undo')).toBeEnabled();
});

test('offline reload and image worker use the complete precache', async ({ page, context }) => {
  await ready(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
  const result = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const worker = new Worker('/pixel-worker.js', { type: 'module' });
        worker.onerror = (error) => {
          worker.terminate();
          reject(Error(error.message));
        };
        worker.onmessage = ({ data }) => {
          worker.terminate();
          resolve(data);
        };
        worker.postMessage({
          id: 1,
          image: { w: 2, h: 2, data: new Uint8ClampedArray(16).fill(255) },
          options: { grid: [1, 1] },
        });
      }),
  );
  expect(result.error).toBeUndefined();
  expect(result.result.w).toBe(1);
  expect(result.result.h).toBe(1);
});

test('animation skips canvas paints between frame changes', async ({ page }) => {
  await ready(page);
  const paints = await page.evaluate(async () => {
    const prototype = CanvasRenderingContext2D.prototype;
    const clear = prototype.clearRect;
    let count = 0;
    prototype.clearRect = function (...args) {
      if (this.canvas.id === 'view') count++;
      return clear.apply(this, args);
    };
    document.querySelector('#play').click();
    try {
      for (let i = 0; i < 30; i++) await new Promise(requestAnimationFrame);
      return count;
    } finally {
      document.querySelector('#play').click();
      prototype.clearRect = clear;
    }
  });
  expect(paints).toBeGreaterThan(1);
  expect(paints).toBeLessThan(15);
});

for (const viewport of [
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
]) {
  test(`tool windows remain usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await ready(page);
    await page.getByRole('button', { name: '画室设置', exact: true }).click();
    await expect(page.locator('#window-settings')).toBeVisible();
    const bounds = await page.locator('#window-settings').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    await page.getByRole('button', { name: '关闭偏好设置', exact: true }).click();
    await expect(page.locator('#window-settings')).toHaveCount(0);
    await expect(page.locator('#view')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('studio.png') });
  });
}
