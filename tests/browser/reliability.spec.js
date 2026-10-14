import { test, expect } from '@playwright/test';
import { blank, serialize } from '../../dist/engine.js';
import { createScene } from '../../dist/procedural-model.js';
import { compactProject } from '../../dist/cel-storage.js';

function artwork() {
  const p = blank(96, 72);
  p.layers = ['底层', '中层', '顶层'].map((name) => ({ name, visible: true, opacity: 255 }));
  p.frames[0].cels = p.layers.map((_, i) => {
    const data = new Uint8ClampedArray(96 * 72 * 4);
    for (let j = 0; j < 96 * 72; j++)
      data.set(
        [
          [30, 130, 80, 255],
          [80, 70, 180, 255],
          [210, 90, 40, 255],
        ][i],
        j * 4,
      );
    return data;
  });
  return p;
}
async function load(page, p = artwork()) {
  await page.goto('/');
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
  await page.locator('#file-input').setInputFiles({
    name: '可靠性.pixel',
    mimeType: 'application/json',
    buffer: Buffer.from(serialize(p)),
  });
  await expect(page.locator('#project-name')).toHaveText('可靠性');
  await page.waitForTimeout(350);
}
async function saved(page) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
  return page.evaluate(async () => {
    const { openProjectStore } = await import('/project-store.js'),
      store = await openProjectStore();
    try {
      return (await store.get(localStorage.getItem('pixel-studio-current'))).project;
    } finally {
      store.close();
    }
  });
}
async function screen(page, x = 48, y = 36) {
  const b = await page.locator('#view').boundingBox(),
    scale = Math.min(20, (b.width - 130) / 96, (b.height - 100) / 72);
  return { x: b.x + b.width / 2 + 20 + (x - 48) * scale, y: b.y + b.height / 2 + (y - 36) * scale };
}
async function pixel(page) {
  return page.locator('#view').evaluate((c) => {
    const scale = devicePixelRatio || 1;
    return [
      ...c
        .getContext('2d')
        .getImageData(
          Math.round((c.clientWidth / 2 + 20) * scale),
          Math.round((c.clientHeight / 2) * scale),
          1,
          1,
        ).data,
    ];
  });
}
test('hide, delete, reorder and merge redraw lower layers immediately and keep the list mounted', async ({
  page,
}) => {
  await load(page, compactProject(artwork()));
  await page.getByRole('button', { name: '图层面板', exact: true }).click();
  await page.getByRole('checkbox', { name: '隐藏图层 顶层', exact: true }).click();
  await expect.poll(() => pixel(page)).toEqual([80, 70, 180, 255]);
  await page.getByRole('button', { name: '图层 顶层 不透明度', exact: true }).click();
  await page.locator('#delete-layer').click();
  await page.getByRole('button', { name: '删除图层', exact: true }).last().click();
  await page.locator('#layer-options-close').click();
  await expect(page.locator('#layer-list .layer')).toHaveCount(2);
  await expect.poll(() => pixel(page)).toEqual([80, 70, 180, 255]);
  await page.getByRole('button', { name: '图层 中层 不透明度', exact: true }).click();
  await page.locator('#layer-down').click();
  await expect.poll(() => pixel(page)).toEqual([30, 130, 80, 255]);
  await page.locator('#layer-options-close').click();
  await expect(page.getByRole('button', { name: '选择图层 底层', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '图层 底层 不透明度', exact: true }).click();
  await page.locator('#merge-down').click();
  expect((await saved(page)).layers.length).toBe(1);
  await expect.poll(() => pixel(page)).toEqual([30, 130, 80, 255]);
  await page.locator('#quick-undo').click();
  expect((await saved(page)).layers.length).toBe(2);
});

test('collapsed windows dragged near the bottom recover height, including resizable references', async ({
  page,
}) => {
  await load(page);
  for (const [button, panel] of [
    ['画室设置', '#window-settings'],
    ['图层面板', '#window-layers'],
    ['打开颜色', '#window-color'],
  ]) {
    await page.getByRole('button', { name: button, exact: true }).click();
    await page.locator(panel + ' .window-collapse').click();
    const h = await page.locator(panel + ' h2').boundingBox();
    await page.mouse.move(h.x + 15, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 15, 525, { steps: 6 });
    await page.mouse.up();
    await page.locator(panel + ' .window-collapse').click();
    await expect
      .poll(async () => (await page.locator(panel).boundingBox()).height)
      .toBeGreaterThan(250);
    await page.setViewportSize({ width: 1024, height: 420 });
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect
      .poll(async () => (await page.locator(panel).boundingBox()).height)
      .toBeGreaterThan(250);
    await page.locator(panel + ' .window-close').click();
  }
  await page.locator('#reference-add').click();
  const reference = page.locator('.reference-window');
  await reference.locator('.window-collapse').click();
  await page.setViewportSize({ width: 768, height: 1024 });
  await reference.locator('.window-collapse').click();
  await expect.poll(async () => (await reference.boundingBox()).height).toBeGreaterThan(220);
});

test('light objects drag, keyframe, constrain their canvas region and undo without painting', async ({
  page,
}) => {
  const p = artwork();
  p.procedural = createScene(p, 0);
  p.procedural.lights = [
    {
      id: 'lamp',
      name: '柔光',
      enabled: true,
      x: 26,
      y: 34,
      radius: 14,
      intensity: 0.5,
      color: '#aaddff',
      start: 0,
      end: 2,
    },
  ];
  await load(page, p);
  await page.locator('#procedural-open').click();
  await page.locator('#fit').click();
  await expect(page.locator('.light-track')).toHaveCount(1);
  const from = await screen(page, 26, 34),
    to = await screen(page, 36, 40);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  let result = await saved(page);
  expect(result.procedural.lights[0].x).toBeCloseTo(36, 1);
  await page.locator('#scene-lights').click();
  await page.locator('#light-record').check();
  await page.locator('#scene-scrub').fill('1');
  await page.locator('#scene-inspector .window-close').click();
  const start = await screen(page, 36, 40),
    end = await screen(page, 46, 30);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  result = await saved(page);
  expect(result.procedural.lights[0].positionKeys.map((k) => k.t)).toEqual([0, 1]);
  expect(result.procedural.lights[0].positionKeys[1].x).toBeCloseTo(46, 1);
  await expect(page.locator('.light-track .scene-key')).toHaveCount(2);
  await page.locator('#scene-lights').click();
  await page.locator('#light-area').click();
  await page.locator('#scene-inspector .window-close').click();
  const a = await screen(page, 10, 10),
    b = await screen(page, 30, 30);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  expect((await saved(page)).procedural.lights[0].area.w).toBeGreaterThan(18);
  await page.locator('#scene-undo').click();
  expect((await saved(page)).procedural.lights[0].area).toBeUndefined();
  await page.locator('#scene-redo').click();
  expect((await saved(page)).procedural.lights[0].area).toBeDefined();
  await page.reload();
  await page.locator('#procedural-open').click();
  await expect(page.locator('.light-track')).toHaveCount(1);
});

test('held eyedropper coalesces color changes, leaves no pixels, and immediately accepts the next stroke', async ({
  page,
}) => {
  const p = artwork();
  p.layers[2].visible = false;
  await load(page, compactProject(p));
  await page.getByRole('button', { name: '图层面板', exact: true }).click();
  await page.getByRole('button', { name: '选择图层 中层', exact: true }).click();
  await page.locator('#window-layers .window-close').click();
  const point = await screen(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await expect(page.locator('#held-color')).toBeVisible();
  await page.mouse.move(point.x + 60, point.y, { steps: 30 });
  await page.mouse.up();
  await expect(page.locator('#held-color')).toBeHidden();
  await page.locator('#tool-eraser').click();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 25, point.y, { steps: 4 });
  await page.mouse.up();
  await saved(page);
  const pixels = await page.evaluate(async () => {
    const { readCel } = await import('/cel-storage.js');
    const { openProjectStore } = await import('/project-store.js'),
      store = await openProjectStore();
    try {
      const record = await store.get(localStorage.getItem('pixel-studio-current'));
      return [...readCel(record.project.frames[0].cels[1])];
    } finally {
      store.close();
    }
  });
  expect(pixels.filter((v, i) => i % 4 === 3 && v === 0).length).toBeGreaterThan(1);
  await page.locator('#quick-undo').click();
  await expect.poll(() => pixel(page)).toEqual([80, 70, 180, 255]);
});
