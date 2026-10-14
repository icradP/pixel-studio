import { test, expect } from '@playwright/test';
import { blank, serialize } from '../../dist/engine.js';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
}
async function projectFile(page, project) {
  await page.locator('#file-input').setInputFiles({
    name: 'brush-test.pixel',
    mimeType: 'application/json',
    buffer: Buffer.from(serialize(project)),
  });
  await expect(page.locator('#project-name')).toHaveText('brush-test');
  // Loading a project settles the camera after closing the gallery.
  await page.waitForTimeout(350);
}
async function savedProject(page) {
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
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
async function library(page, group) {
  await page.getByRole('button', { name: '笔刷设置', exact: true }).click();
  await page.locator(`[data-brush-group="${group}"]`).click();
}
async function drawCenter(page) {
  const box = await page.locator('#view').boundingBox();
  await page.mouse.click(box.x + box.width / 2 + 20, box.y + box.height / 2);
}

test('dither brush paints exact ordered coverage and round trips through history', async ({
  page,
}) => {
  await ready(page);
  await projectFile(page, blank(32, 32));
  await library(page, 'dither');
  await page.locator('[data-brush="dither-8"]').click();
  await page.locator('#window-brush .window-close').click();
  await drawCenter(page);
  const first = await savedProject(page);
  expect(
    Object.values(first.frames[0].cels[0]).filter((value, i) => i % 4 === 3 && value > 0),
  ).toHaveLength(72);
  await drawCenter(page);
  expect((await savedProject(page)).frames).toEqual(first.frames);
  await page.locator('#quick-undo').click();
  await page.locator('#quick-undo').click();
  expect(Object.values((await savedProject(page)).frames[0].cels[0]).some(Boolean)).toBe(false);
  await page.locator('#quick-redo').click();
  expect((await savedProject(page)).frames).toEqual(first.frames);
});

test('brush library remembers individual settings and custom copies after reload', async ({
  page,
}) => {
  await ready(page);
  await library(page, 'dither');
  await page.locator('[data-brush="dither-4"]').click();
  await page.getByRole('button', { name: '配置当前笔刷', exact: true }).click();
  await page.locator('#brush-tab-stroke').click();
  await page.locator('#size-range').fill('19');
  await page.locator('#brush-tab-dither').click();
  await page.locator('#dither-scale').fill('3');
  await page.locator('#brush-back').click();
  await page.locator('[data-brush-group="pixel"]').click();
  await page.locator('[data-brush="pixel-hard"]').click();
  await expect(page.locator('#brush-size')).toHaveText('1 px');
  await page.locator('[data-brush-group="dither"]').click();
  await page.locator('[data-brush="dither-4"]').click();
  await expect(page.locator('#brush-size')).toHaveText('19 px');
  await page.locator('#brush-new').click();
  await page.locator('#action-dialog input').fill('夜雨纹理');
  await page.locator('#action-dialog button[type="submit"]').click();
  await expect(page.locator('#brush-studio-name')).toHaveText('夜雨纹理');
  await expect(page.locator('#dither-scale')).toHaveValue('3');
  await page.locator('#brush-done').click();
  await page.reload();
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#brush-size')).toHaveText('19 px');
  await library(page, 'user');
  await page.getByRole('button', { name: '选择夜雨纹理', exact: true }).click();
  await expect(page.locator('#dither-scale')).toHaveValue('3');
});

test('Magic Pencil enters the brush library and produces a reversible outline stroke', async ({
  page,
}) => {
  await ready(page);
  await projectFile(page, blank(32, 32));
  await page.locator('#tool-plugin-library').click();
  await page.locator('[data-plugin="magic"]').click();
  await expect(page.locator('#plugins-dialog')).toHaveCount(0);
  await expect(page.locator('[data-brush-group="magic"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-brush]')).toHaveCount(14);
  await page.locator('[data-brush="magic-outline-brush"]').click();
  await page.locator('#window-brush .window-close').click();
  await drawCenter(page);
  const result = await savedProject(page),
    pixels = Object.values(result.frames[0].cels[0]);
  expect(pixels.filter((value, i) => i % 4 === 3 && value > 0)).toHaveLength(96);
  await page.locator('#quick-undo').click();
  expect(Object.values((await savedProject(page)).frames[0].cels[0]).some(Boolean)).toBe(false);
  await library(page, 'pixel');
  await page.locator('[data-brush="pixel-hard"]').click();
  await expect(page.locator('body')).not.toHaveClass(/magic-active/);
});

test('four-sided expansion preserves every frame and supports undo, redo and reload', async ({
  page,
}) => {
  await ready(page);
  const project = blank(3, 2);
  project.layers.push({ name: '第二层', opacity: 128, visible: true });
  project.frames = [80, 140].map((duration, f) => ({
    duration,
    cels: [0, 1].map((l) => Uint8ClampedArray.from({ length: 24 }, (_, i) => i + f * 50 + l * 25)),
  }));
  await projectFile(page, project);
  await page.getByRole('button', { name: '绘画工具菜单', exact: true }).click();
  await page.locator('#tools-expand').click();
  for (const [key, value] of Object.entries({ left: 2, right: 4, top: 3, bottom: 1 }))
    await page.locator('#expand-' + key).fill(String(value));
  await expect(page.locator('#expand-size')).toHaveText('3 × 2 → 9 × 6');
  await page.locator('#expand-apply').click();
  const expanded = await savedProject(page);
  expect([expanded.w, expanded.h]).toEqual([9, 6]);
  for (let f = 0; f < 2; f++)
    for (let l = 0; l < 2; l++) {
      const pixels = Object.values(expanded.frames[f].cels[l]);
      expect(pixels.slice((3 * 9 + 2) * 4, (3 * 9 + 5) * 4)).toEqual([
        ...project.frames[f].cels[l].slice(0, 12),
      ]);
      expect(pixels.slice(0, 12).some(Boolean)).toBe(false);
    }
  await page.locator('#quick-undo').click();
  const undone = await savedProject(page);
  expect([undone.w, undone.h]).toEqual([3, 2]);
  await page.locator('#quick-redo').click();
  expect((await savedProject(page)).frames).toEqual(expanded.frames);
  await page.reload();
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
  expect((await savedProject(page)).frames).toEqual(expanded.frames);
});

test('invalid expansion is blocked without changing the canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await ready(page);
  await page.getByRole('button', { name: '画室设置', exact: true }).click();
  await page.locator('#settings-expand').click();
  await page.locator('#expand-left').fill('1000000');
  await expect(page.locator('#expand-apply')).toBeDisabled();
  await expect(page.locator('#expand-status')).toContainText('64 MiB');
  await expect(page.locator('#expand-status')).toBeInViewport();
  await expect(page.locator('#expand-size')).toBeInViewport();
  await expect(page.locator('#expand-apply')).toBeInViewport();
  await page.locator('#window-expand .window-body').evaluate((body) => {
    body.scrollTop = body.scrollHeight;
  });
  await expect(page.locator('#expand-apply')).toBeInViewport();
  const project = await savedProject(page);
  expect([project.w, project.h]).toEqual([160, 112]);
});

test('brush configuration and drawing pad remain usable in portrait without editing artwork', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  const before = await savedProject(page);
  await library(page, 'dither');
  await page.locator('[data-brush="dither-12"]').click();
  await page.screenshot({ path: testInfo.outputPath('brush-library.png'), animations: 'disabled' });
  await page.locator('#brush-configure').click();
  const pad = await page.locator('#brush-pad').boundingBox();
  await page.mouse.move(pad.x + 20, pad.y + 30);
  await page.mouse.down();
  await page.mouse.move(pad.x + pad.width - 20, pad.y + 60, { steps: 15 });
  await page.mouse.up();
  await expect(page.getByRole('switch', { name: '抖动绘制', exact: true })).toBeChecked();
  await page.getByRole('tab', { name: '抖色', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: '笔触', exact: true })).toBeFocused();
  await expect(page.locator('#size-range')).toBeVisible();
  await expect(page.locator('#dither-density')).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#dither-density')).toBeVisible();
  const panel = await page.locator('#window-brush').boundingBox();
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(768);
  expect(panel.y + panel.height).toBeLessThanOrEqual(1024);
  await page.locator('#brush-done').click();
  expect((await savedProject(page)).frames).toEqual(before.frames);
  expect(errors).toEqual([]);
});
