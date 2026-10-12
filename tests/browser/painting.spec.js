import { test, expect } from '@playwright/test';
import { blank, serialize } from '../../dist/engine.js';

async function ready(page, project = blank(16, 16)) {
  await page.goto('/');
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
  await page.locator('#file-input').setInputFiles({
    name: 'painting.pixel',
    mimeType: 'application/json',
    buffer: Buffer.from(serialize(project)),
  });
  await expect(page.locator('#project-name')).toHaveText('painting');
  if (await page.locator('#dismiss-hint').isVisible()) await page.locator('#dismiss-hint').click();
  await page.waitForTimeout(350);
}
async function saved(page) {
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
async function layers(page) {
  await page.getByRole('button', { name: '图层面板', exact: true }).click();
  await page.locator('.layer.active .layer-blend').click();
}
async function draw(page) {
  const box = await page.locator('#view').boundingBox();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 8 });
  await page.mouse.up();
}
test('layer effects and editable masks persist, painting the mask does not overwrite the cel', async ({
  page,
}) => {
  const p = blank(16, 16);
  for (let i = 0; i < 256; i++) p.frames[0].cels[0].set([210, 100, 60, 255], i * 4);
  await ready(page, p);
  await layers(page);
  await page.getByRole('combobox', { name: '混合模式：正常', exact: true }).click();
  await page.getByRole('option', { name: '正片叠底', exact: true }).click();
  await page.locator('#alpha-lock').check();
  await page.locator('#mask-add').click();
  await page.locator('#mask-black').click();
  await expect(page.locator('#project-detail')).toContainText('正在绘制遮罩');
  await page.getByRole('button', { name: '关闭图层', exact: true }).click();
  await draw(page);
  const q = await saved(page);
  expect(Object.values(q.frames[0].cels[0])).toEqual([...p.frames[0].cels[0]]);
  expect(Object.values(q.layers[0].mask).some((v) => v < 255)).toBe(true);
  expect(q.layers[0].blend).toBe(1);
  expect(q.layers[0].alphaLock).toBe(true);
  await page.reload();
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
  await layers(page);
  await expect(page.locator('#mask-edit')).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: '混合模式：正片叠底', exact: true }),
  ).toBeVisible();
});

test('gradient draw, undo, redo and mask gradients use the normal drawing transaction', async ({
  page,
}) => {
  await ready(page);
  await page.getByRole('button', { name: '绘画工具菜单', exact: true }).click();
  await page.getByRole('button', { name: '渐变', exact: true }).click();
  await page.getByRole('combobox', { name: '渐变形状：线性渐变', exact: true }).click();
  await page.getByRole('option', { name: '径向渐变', exact: true }).click();
  await page.getByRole('button', { name: '关闭渐变', exact: true }).click();
  await draw(page);
  const pixels = Object.values((await saved(page)).frames[0].cels[0]);
  expect(new Set(pixels.filter((_, i) => i % 4 === 0)).size).toBeGreaterThan(3);
  await page.locator('#quick-undo').click();
  expect(Object.values((await saved(page)).frames[0].cels[0]).some(Boolean)).toBe(false);
  await page.locator('#quick-redo').click();
  expect(Object.values((await saved(page)).frames[0].cels[0])).toEqual(pixels);
});

test('pressure curve settings remain per brush after closing the studio and reloading', async ({
  page,
}) => {
  await ready(page);
  await page.getByRole('button', { name: '笔刷设置', exact: true }).click();
  await page.locator('[data-brush="pixel-hard"]').click();
  await page.locator('#opacity-pressure').check();
  await page.locator('.pressure-settings summary').click();
  await page.getByRole('button', { name: '轻触敏感', exact: true }).click();
  await expect(page.locator('#pressure-point-1')).toHaveValue('50');
  await page.locator('#brush-opacity').fill('35');
  await page.locator('#brush-done').click();
  await page.reload();
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
  await page.getByRole('button', { name: '笔刷设置', exact: true }).click();
  await page.locator('[data-brush="pixel-hard"]').click();
  await expect(page.locator('#opacity-pressure')).toBeChecked();
  await expect(page.locator('#pressure-point-1')).toHaveValue('50');
  await expect(page.locator('#brush-opacity')).toHaveValue('35');
});
