import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
}

async function records(page) {
  return page.evaluate(async () => {
    const { openProjectStore } = await import('/project-store.js');
    const store = await openProjectStore();
    try {
      return await store.list();
    } finally {
      store.close();
    }
  });
}

test('gallery example opens offline as an editable copy and leaves previous works intact', async ({
  page,
  context,
}) => {
  await ready(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
      );
  });
  const original = (await records(page))[0];
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
  await page.locator('#gallery').click();
  await expect(page.locator('#open-pelican-example')).toBeVisible();
  await page.locator('#gallery-select').click();
  await expect(page.locator('#gallery-examples')).toBeHidden();
  await page.locator('#gallery-select').click();
  await page.locator('#open-pelican-example').click();
  await expect(page.locator('#project-name')).toHaveText('鹈鹕骑车 · 海风慢行');
  await expect(page.locator('#frame-count')).toHaveText('16 FRAMES');
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
  const first = await records(page);
  expect(first).toHaveLength(2);
  expect(first.find((record) => record.id === original.id).frameCount).toBe(original.frameCount);
  const copy = first.find((record) => record.id !== original.id);
  expect([copy.w, copy.h, copy.frameCount]).toEqual([176, 128, 16]);
  const layerCount = await page.evaluate(async (id) => {
    const { openProjectStore } = await import('/project-store.js');
    const store = await openProjectStore();
    try {
      return (await store.get(id)).project.layers.length;
    } finally {
      store.close();
    }
  }, copy.id);
  expect(layerCount).toBe(6);
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveAttribute('aria-label', '暂停动画');
  await page.locator('#play').click();
  await page.locator('#duplicate-frame').click();
  await expect(page.locator('#frame-count')).toHaveText('17 FRAMES');
  await page.locator('#gallery').click();
  await page.locator('#open-pelican-example').click();
  await expect(page.locator('#frame-count')).toHaveText('16 FRAMES');
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
  const second = await records(page);
  expect(second).toHaveLength(3);
  expect(second.find((record) => record.id === copy.id).frameCount).toBe(17);
});

test.describe('example loading without a service worker', () => {
  test.use({ serviceWorkers: 'block' });

  test('failed downloads can be retried without creating an empty work', async ({ page }) => {
    await ready(page);
    await page.route('**/examples/pelican-cycling.pixel.gz', (route) =>
      route.fulfill({ status: 503, body: '' }),
    );
    await page.locator('#gallery').click();
    await page.locator('#open-pelican-example').click();
    await expect(page.locator('#example-status')).toContainText('示例下载失败');
    await expect(page.locator('#open-pelican-example')).toBeEnabled();
    expect(await records(page)).toHaveLength(1);
    await page.unroute('**/examples/pelican-cycling.pixel.gz');
    await page.locator('#open-pelican-example').click();
    await expect(page.locator('#project-name')).toHaveText('鹈鹕骑车 · 海风慢行');
  });

  test('closing the gallery cancels a pending example instead of switching the canvas later', async ({
    page,
  }) => {
    await ready(page);
    let pending;
    await page.route('**/examples/pelican-cycling.pixel.gz', (route) => {
      pending = route;
    });
    await page.locator('#gallery').click();
    await page.locator('#open-pelican-example').click();
    await expect.poll(() => !!pending).toBe(true);
    await page.locator('#close-gallery').click();
    await expect(page.locator('#gallery-dialog')).not.toBeVisible();
    await pending.continue();
    await expect(page.locator('#project-name')).toHaveText('雨巷 · 霓虹练习');
    await expect(page.locator('#open-pelican-example')).toBeEnabled();
    expect(await records(page)).toHaveLength(1);
  });
});
