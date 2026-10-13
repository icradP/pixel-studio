import { test, expect } from '@playwright/test';
import { blank, serialize } from '../../dist/engine.js';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
  if (await page.locator('#dismiss-hint').isVisible()) await page.locator('#dismiss-hint').click();
}
async function load(page, project) {
  await page.locator('#file-input').setInputFiles({
    name: 'workflow.pixel',
    mimeType: 'application/json',
    buffer: Buffer.from(serialize(project)),
  });
  await expect(page.locator('#project-name')).toHaveText('workflow');
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
async function center(page) {
  const box = await page.locator('#view').boundingBox();
  return { x: box.x + box.width / 2 + 20, y: box.y + box.height / 2 };
}
async function swipe(page, locator, dx = -110) {
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
}

test('paint and eraser tap twice to open their libraries, retain independent settings and support hold transfer', async ({
  page,
}) => {
  await ready(page);
  await page.locator('#side-size').fill('3');
  await page.locator('#tool-eraser').click();
  await expect(page.locator('#window-brush')).toHaveCount(0);
  await page.locator('#tool-eraser').click();
  await expect(page.locator('#window-brush')).toContainText('橡皮笔刷库');
  await page.locator('[data-brush="pixel-round"]').click();
  await expect(page.locator('#tool-eraser')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#window-brush .window-close').click();
  await page.locator('#side-size').fill('9');
  await page.locator('#side-opacity').fill('35');
  await page.locator('#tool-pencil').click();
  await expect(page.locator('#side-size')).toHaveValue('3');
  await expect(page.locator('#side-opacity')).toHaveValue('100');
  await page.locator('#tool-eraser').click();
  await expect(page.locator('#side-size')).toHaveValue('9');
  await expect(page.locator('#side-opacity')).toHaveValue('35');
  await page.reload();
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
  await page.locator('#tool-eraser').click();
  await expect(page.locator('#side-size')).toHaveValue('9');
  await page.locator('#tool-pick').click();
  const point = await center(page);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#tool-pencil')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#side-size')).toHaveValue('3');
  await expect(page.locator('#side-opacity')).toHaveValue('100');
  await page.locator('#tool-eraser').click();
  await page.keyboard.press('l');
  await expect(page.locator('#tool-line')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#side-size')).toHaveValue('3');
  await expect(page.locator('#side-opacity')).toHaveValue('100');
  await page.locator('#tool-eraser').click();
  const button = await page.locator('#tool-pencil').boundingBox();
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(520);
  await page.mouse.up();
  await expect(page.locator('#tool-pencil')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#side-size')).toHaveValue('9');
  await expect(page.locator('#window-brush')).toHaveCount(0);
});

test('canvas opacity, erase opacity and dismissing palettes preserve stroke and undo semantics', async ({
  page,
}) => {
  await ready(page);
  await load(page, blank(16, 16));
  const p = await center(page);
  await page.locator('#side-opacity').fill('50');
  await page.locator('#tool-pencil').click();
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#window-brush')).toHaveCount(0);
  expect(Object.values((await saved(page)).frames[0].cels[0]).some(Boolean)).toBe(false);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 1, p.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.up();
  const painted = Object.values((await saved(page)).frames[0].cels[0]);
  expect(painted.filter((v, i) => i % 4 === 3 && v > 0)).toEqual([128]);
  await page.locator('#tool-eraser').click();
  await page.locator('#side-opacity').fill('50');
  await page.mouse.click(p.x, p.y);
  const erased = Object.values((await saved(page)).frames[0].cels[0]);
  expect(erased.filter((v, i) => i % 4 === 3 && v > 0)).toEqual([64]);
  await page.locator('#quick-undo').click();
  expect(Object.values((await saved(page)).frames[0].cels[0])).toEqual(painted);
});

test('layers support repeat-tap options, swipe duplicate, drag reorder and undo across frames', async ({
  page,
}) => {
  await ready(page);
  const original = await saved(page);
  await page.locator('[data-panel="layers"]').click();
  await expect(page.locator('#layer-options')).toBeHidden();
  await page.locator('.layer-select').first().click();
  await expect(page.locator('#layer-options')).toBeVisible();
  await page.locator('#layer-options-close').click();
  await swipe(page, page.locator('.layer-select').first());
  await expect(page.locator('.layer').first()).toHaveClass(/swiped/);
  await page.locator('.layer').first().locator('[data-layer-copy]').click();
  await expect(page.locator('.layer')).toHaveCount(4);
  const copied = await saved(page);
  for (let f = 0; f < 6; f++) expect(copied.frames[f].cels[3]).toEqual(original.frames[f].cels[2]);
  const source = await page.locator('.layer-select').first().boundingBox(),
    target = await page.locator('.layer-select').last().boundingBox();
  await page.mouse.move(source.x + 80, source.y + 30);
  await page.mouse.down();
  await page.waitForTimeout(420);
  await page.mouse.move(target.x + 80, target.y + 30, { steps: 10 });
  await page.mouse.up();
  const moved = await saved(page);
  expect(moved.layers[0].name).toContain('副本');
  for (let f = 0; f < 6; f++) expect(moved.frames[f].cels[0]).toEqual(original.frames[f].cels[2]);
  await page.locator('#quick-undo').click();
  expect((await saved(page)).layers).toEqual(copied.layers);
  await page.locator('#quick-undo').click();
  expect((await saved(page)).frames).toEqual(original.frames);
});

test('layer solo restores preexisting visibility and layer opacity records one undo step', async ({
  page,
}) => {
  await ready(page);
  await page.locator('[data-panel="layers"]').click();
  await page.locator('.visibility').last().click();
  const before = await saved(page);
  const b = await page.locator('.visibility').first().boundingBox();
  for (let i = 0; i < 2; i++) {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(570);
    await page.mouse.up();
    if (i === 0)
      expect((await saved(page)).layers.map((l) => l.visible)).toEqual([false, false, true]);
  }
  expect((await saved(page)).layers.map((l) => l.visible)).toEqual(
    before.layers.map((l) => l.visible),
  );
  await page.locator('.layer-blend').first().click();
  await page.locator('#opacity').fill('100');
  expect((await saved(page)).layers[2].opacity).toBe(100);
  await page.locator('#quick-undo').click();
  expect((await saved(page)).layers[2].opacity).toBe(255);
});

test('gallery stacks, rename, reorder, unstack and share persist without altering artwork', async ({
  page,
}) => {
  await ready(page);
  const before = await saved(page);
  await page.locator('#gallery').click();
  await page.locator('.project-more').first().click();
  await page
    .locator('.project-card-actions')
    .first()
    .getByRole('button', { name: '复制', exact: true })
    .click();
  await expect(page.locator('.project-card')).toHaveCount(2);
  await page.locator('.project-name').last().click();
  await page.locator('#action-dialog input').fill('独立副本');
  await page.locator('#action-dialog button[type="submit"]').click();
  await page.locator('#gallery-select').click();
  await page.locator('.project-open').first().click();
  await page.locator('.project-open').last().click();
  await page.locator('#gallery-stack').click();
  await page.locator('#action-dialog input').fill('像素练习');
  await page.locator('#action-dialog button[type="submit"]').click();
  await expect(page.locator('.stack-card')).toHaveCount(1);
  await expect(page.locator('.stack-card .stack-count')).toHaveText('2');
  await expect(page.locator('.stack-card img')).toHaveCount(2);
  const coverTransform = await page
    .locator('.stack-card .project-cover')
    .evaluate((image) => getComputedStyle(image).transform);
  await expect(page.locator('.stack-card .stack-sheet-1')).not.toHaveCSS(
    'transform',
    coverTransform,
  );
  await expect(page.locator('.stack-card .project-open')).toHaveAttribute(
    'aria-label',
    '打开 像素练习，堆叠，2 件作品',
  );
  await page.locator('#gallery-select').click();
  await page.locator('.stack-card .project-open').click();
  await expect(page.locator('#gallery-stack-name')).toHaveText('像素练习');
  const first = await page.locator('.project-open').first().boundingBox(),
    last = await page.locator('.project-open').last().boundingBox();
  await page.mouse.move(first.x + 30, first.y + 30);
  await page.mouse.down();
  await page.waitForTimeout(420);
  await page.mouse.move(last.x + 30, last.y + 30, { steps: 10 });
  await page.mouse.up();
  const order = await page
    .locator('.project-card')
    .evaluateAll((cards) => cards.map((c) => c.dataset.id));
  await page.reload();
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
  await page.locator('#gallery').click();
  await page.locator('.stack-card .project-open').click();
  expect(
    await page.locator('.project-card').evaluateAll((cards) => cards.map((c) => c.dataset.id)),
  ).toEqual(order);
  await page.locator('#gallery-select').click();
  await page.getByRole('button', { name: '打开 独立副本', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.locator('#gallery-share').click();
  expect((await download).suggestedFilename()).toBe('独立副本.pixel');
  await page.getByRole('button', { name: '打开 独立副本', exact: true }).click();
  await page.locator('#gallery-unstack').click();
  await expect(page.locator('.project-card')).toHaveCount(1);
  await page.locator('#gallery-back').click();
  await expect(page.locator('.project-card')).toHaveCount(2);
  await expect(page.locator('.stack-card .stack-count')).toHaveText('1');
  await expect(page.locator('.stack-card img')).toHaveCount(1);
  await expect(page.locator('.project-card:not(.stack-card) .stack-count')).toHaveCount(0);
  await page.locator('#close-gallery').click();
  expect((await saved(page)).frames).toEqual(before.frames);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
])
  test(`core tools and brush studio remain reachable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await ready(page);
    for (const selector of [
      '#tool-pencil',
      '#tool-eraser',
      '#tool-select',
      '#tool-wand',
      '#side-size',
      '#side-opacity',
      '#quick-undo',
    ])
      await expect(page.locator(selector)).toBeInViewport();
    await page.locator('#tool-pencil').click();
    await page.locator('#brush-configure').click();
    for (const selector of [
      '#brush-done',
      '#brush-cancel',
      '#brush-pad',
      '#brush-tab-stroke',
      '#size-range',
      '#brush-opacity',
    ])
      await expect(page.locator(selector)).toBeInViewport();
    await page.locator('#size-range').fill('20');
    await page.locator('#brush-cancel').click();
    await expect(page.locator('#side-size')).toHaveValue('1');
    await page.locator('[data-panel="layers"]').click();
    await expect(page.locator('#window-brush')).toHaveCount(0);
    await expect(page.locator('#window-layers')).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('workspace.png'), animations: 'disabled' });
  });

test('touch dismisses a palette without painting and a cancelled layer drag does not reorder', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await ready(page);
  await load(page, blank(16, 16));
  await page.locator('#pencil-only').click();
  const p = await center(page),
    client = await context.newCDPSession(page);
  const touch = (type, points) =>
    client.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((point, i) => ({ id: i + 1, ...point })),
    });
  await page.locator('#tool-pencil').click();
  await touch('touchStart', [p]);
  await touch('touchEnd', []);
  await expect(page.locator('#window-brush')).toHaveCount(0);
  expect(Object.values((await saved(page)).frames[0].cels[0]).some(Boolean)).toBe(false);
  await touch('touchStart', [p]);
  await page.waitForTimeout(160);
  await touch('touchEnd', []);
  expect(Object.values((await saved(page)).frames[0].cels[0]).some(Boolean)).toBe(true);
  await page.locator('[data-panel="layers"]').click();
  await page.locator('#add-layer').click();
  const before = (await saved(page)).layers;
  const a = await page.locator('.layer-select').first().boundingBox(),
    b = await page.locator('.layer-select').last().boundingBox();
  await touch('touchStart', [{ x: a.x + 40, y: a.y + 30 }]);
  await page.waitForTimeout(430);
  await touch('touchMove', [{ x: b.x + 40, y: b.y + 30 }]);
  await touch('touchCancel', []);
  expect((await saved(page)).layers).toEqual(before);
  await expect(page.locator('.item-lifted,.item-drop-target')).toHaveCount(0);
  await context.close();
});
