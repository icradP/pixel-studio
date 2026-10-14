import { test, expect } from '@playwright/test';
import { blank, serialize } from '../../dist/engine.js';
const project = blank(32, 24);
for (let y = 0; y < 24; y++)
  for (let x = 0; x < 32; x++) {
    let color = [18, 28, 42, 255];
    if (y >= 5 && y < 9) {
      if ((x >= 5 && x < 9) || (x >= 20 && x < 24)) color = [100, 80, 50, 255];
      if (x >= 9 && x < 13) color = [125, 80, 50, 255];
    }
    project.frames[0].cels[0].set(color, (y * 32 + x) * 4);
  }
async function ready(page) {
  await page.goto('/');
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
  if (await page.locator('#dismiss-hint').isVisible()) await page.locator('#dismiss-hint').click();
  await page.locator('#file-input').setInputFiles({
    name: 'selection.pixel',
    mimeType: 'application/json',
    buffer: Buffer.from(serialize(project)),
  });
  await expect(page.locator('#project-name')).toHaveText('selection');
  await page.waitForTimeout(350);
  await page.locator('#tool-wand').click();
  await threshold(page, 0);
}
async function threshold(page, value) {
  await page.locator('#wand-settings-toggle').click();
  await page.locator('#wand-tolerance').fill(String(value));
  await page.locator('#wand-settings-toggle').click();
}
async function point(page, x = 6, y = 6) {
  const box = await page.locator('#view').boundingBox();
  const scale = Math.max(0.3, Math.min(20, (box.width - 130) / 32, (box.height - 100) / 24));
  return {
    x: box.x + box.width / 2 + 20 + (x + 0.5 - 16) * scale,
    y: box.y + box.height / 2 + (y + 0.5 - 12) * scale,
  };
}
async function tap(page, x = 6, y = 6) {
  const p = await point(page, x, y);
  await page.mouse.click(p.x, p.y);
}
async function count(page, n) {
  await expect(page.locator('#selection-count')).toHaveAttribute('data-pixels', String(n));
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
test('copy selected pixels to a new layer, move from outside its box and undo without altering the source', async ({
  page,
}) => {
  await ready(page);
  await expect(page.locator('#selection-new-layer')).toBeDisabled();
  await tap(page);
  await page.locator('#selection-new-layer').click();
  await expect(page.locator('#canvas-info')).toContainText('2 层');
  await expect(page.locator('#transform-options')).toBeVisible();
  await expect(page.locator('#transform-x')).toHaveValue('5');
  const a = await point(page, 17, 3),
    b = await point(page, 20, 3);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#transform-x')).toHaveValue('8');
  await page.locator('#selection-done').click();
  const copied = await saved(page);
  expect(copied.frames[0].cels[0]).toEqual(project.frames[0].cels[0]);
  expect([...copied.frames[0].cels[1].slice((5 * 32 + 8) * 4, (5 * 32 + 8) * 4 + 4)]).toEqual([
    100, 80, 50, 255,
  ]);
  expect(copied.frames[0].cels[1][(5 * 32 + 5) * 4 + 3]).toBe(0);
  await page.locator('#quick-undo').click();
  await expect(page.locator('#canvas-info')).toContainText('2 层');
  await page.locator('#quick-undo').click();
  await expect(page.locator('#canvas-info')).toContainText('1 层');
  expect((await saved(page)).frames).toEqual(project.frames);
  await page.locator('#tool-wand').click();
  await tap(page);
  await page.keyboard.press('ControlOrMeta+j');
  await expect(page.locator('#canvas-info')).toContainText('2 层');
  await page.locator('#selection-done').click();
  const shortcut = await saved(page);
  expect(shortcut.frames[0].cels[0]).toEqual(project.frames[0].cels[0]);
  expect(shortcut.frames[0].cels[1][(5 * 32 + 5) * 4 + 3]).toBe(255);
});

test('all selection tools drag selected pixels directly without accidentally resizing; cancel and undo restore pixels', async ({
  page,
}) => {
  await ready(page);
  await tap(page);
  for (const tool of ['select', 'ellipse-select', 'lasso', 'wand']) {
    await page.locator(`[data-select-tool="${tool}"]`).click();
    const a = await point(page, 6, 6),
      b = await point(page, 10, 8);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('#transform-options')).toBeVisible();
    await expect(page.locator('#transform-x')).toHaveValue('9');
    await expect(page.locator('#transform-y')).toHaveValue('7');
    await expect(page.locator('#transform-width')).toHaveValue('4');
    await page.locator('#transform-cancel').click();
    await count(page, 16);
    expect((await saved(page)).frames).toEqual(project.frames);
  }
  const a = await point(page, 6, 6),
    b = await point(page, 10, 8);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await page.mouse.up();
  await page.locator('#transform-apply').click();
  expect((await saved(page)).frames).not.toEqual(project.frames);
  await page.locator('#quick-undo').click();
  expect((await saved(page)).frames).toEqual(project.frames);
});

test('second touch or pointer cancellation rolls back direct movement without replacing the selection', async ({
  page,
}) => {
  await ready(page);
  await tap(page);
  const a = await point(page, 6, 6),
    b = await point(page, 10, 8);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await page.locator('#view').dispatchEvent('pointercancel', {
    pointerId: 1,
    pointerType: 'mouse',
    clientX: b.x,
    clientY: b.y,
  });
  await page.mouse.up();
  await expect(page.locator('#transform-options')).toBeHidden();
  await count(page, 16);
  expect((await saved(page)).frames).toEqual(project.frames);
});
test('automatic selection adds taps, subtracts and restores selection steps without touching artwork', async ({
  page,
}) => {
  await ready(page);
  const before = await saved(page);
  await tap(page);
  await count(page, 16);
  await tap(page, 21);
  await count(page, 32);
  await tap(page, 21);
  await page.locator('#selection-undo').click();
  await count(page, 16);
  await page.locator('#selection-redo').click();
  await count(page, 32);
  await page.locator('[data-select-mode="subtract"]').click();
  await tap(page);
  await count(page, 16);
  await page.keyboard.press('ControlOrMeta+z');
  await count(page, 32);
  await page.locator('#selection-clear').click();
  await count(page, 0);
  await page.locator('#quick-undo').click();
  await count(page, 32);
  await page.locator('[data-select-mode="replace"]').click();
  await tap(page, 21);
  await count(page, 16);
  expect((await saved(page)).frames).toEqual(before.frames);
});
test('canvas drag adjusts a fixed seed threshold, shrinks again and commits one undo step', async ({
  page,
}) => {
  await ready(page);
  const p = await point(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await count(page, 16);
  await page.mouse.move(p.x + 60, p.y, { steps: 5 });
  await count(page, 32);
  await expect(page.locator('#selection-threshold-hud')).toBeVisible();
  await expect(page.locator('#wand-summary')).toHaveText('20%');
  await page.mouse.move(p.x, p.y);
  await count(page, 16);
  await page.mouse.move(p.x + 60, p.y);
  await page.mouse.up();
  await count(page, 32);
  await expect(page.locator('#selection-threshold-hud')).toBeHidden();
  await page.locator('#selection-undo').click();
  await count(page, 0);
  await page.locator('#selection-redo').click();
  await count(page, 32);
  // Re-adjusting the most recent area can shrink it; previous areas are not restored accidentally.
  await threshold(page, 0);
  await count(page, 16);
  await tap(page, 21);
  await count(page, 32);
  await page.locator('#selection-clear').click();
  await threshold(page, 100);
  await count(page, 0);
});
test('pointer cancellation rolls back both the preview and threshold without adding history', async ({
  page,
}) => {
  await ready(page);
  await tap(page);
  const p = await point(page, 21);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 90, p.y);
  await page.locator('#view').dispatchEvent('pointercancel', {
    pointerId: 1,
    pointerType: 'mouse',
    clientX: p.x + 90,
    clientY: p.y,
  });
  await page.mouse.up();
  await count(page, 16);
  await expect(page.locator('#wand-summary')).toHaveText('0%');
  await page.locator('#selection-undo').click();
  await count(page, 0);
});
test('finishing preserves a paint mask, highlights selection and keeps project undo separate', async ({
  page,
}) => {
  await ready(page);
  await tap(page);
  await page.locator('#selection-done').click();
  await expect(page.locator('#selection-bar')).toBeHidden();
  await expect(page.locator('#tool-select')).toHaveAttribute('aria-pressed', 'true');
  const before = await saved(page);
  await tap(page, 21);
  expect((await saved(page)).frames).toEqual(before.frames);
  await tap(page);
  const painted = await saved(page);
  expect(painted.frames).not.toEqual(before.frames);
  await page.locator('#tool-wand').click();
  await expect(page.locator('#quick-undo')).toBeDisabled();
  await page.keyboard.press('ControlOrMeta+z');
  expect((await saved(page)).frames).toEqual(painted.frames);
  await page.locator('#tool-wand').click();
  await expect(page.locator('#selection-bar')).toBeHidden();
  await expect(page.locator('#tool-select')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#quick-undo').click();
  expect((await saved(page)).frames).toEqual(before.frames);
});
test('a second touch cancels threshold scrubbing and two/three finger taps undo and redo selections', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await ready(page);
  await tap(page);
  const client = await context.newCDPSession(page),
    p = await point(page, 21);
  const send = (type, points) =>
    client.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((v, i) => ({ id: i + 1, x: v.x, y: v.y })),
    });
  await send('touchStart', [p]);
  await page.waitForTimeout(150);
  await send('touchMove', [{ x: p.x + 60, y: p.y }]);
  await send('touchStart', [
    { x: p.x + 60, y: p.y },
    { x: p.x + 85, y: p.y + 20 },
  ]);
  await send('touchEnd', []);
  await count(page, 16);
  await expect(page.locator('#wand-summary')).toHaveText('0%');
  await tap(page, 21);
  await count(page, 32);
  await send('touchStart', [p, { x: p.x + 20, y: p.y + 20 }]);
  await send('touchEnd', []);
  await count(page, 16);
  await send('touchStart', [p, { x: p.x + 20, y: p.y + 20 }, { x: p.x + 40, y: p.y }]);
  await send('touchEnd', []);
  await count(page, 32);
  await context.close();
});
for (const viewport of [
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
])
  test(`selection toolbar is usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await ready(page);
    await tap(page);
    await count(page, 16);
    await expect(page.locator('#selection-done')).toBeInViewport();
    await expect(page.locator('#wand-settings-toggle')).toBeInViewport();
    const box = await page.locator('#selection-bar').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({
      path: testInfo.outputPath('automatic-selection.png'),
      animations: 'disabled',
    });
  });

test('sampling options resample the latest region and undo restores the sampling settings', async ({
  page,
}) => {
  await ready(page);
  await tap(page);
  await count(page, 16);
  await page.locator('#wand-settings-toggle').click();
  await page.locator('#wand-contiguous').uncheck();
  await count(page, 32);
  await page.locator('#selection-undo').click();
  await count(page, 16);
  await expect(page.locator('#wand-contiguous')).toBeChecked();
  await page.locator('#selection-redo').click();
  await count(page, 32);
  await expect(page.locator('#wand-contiguous')).not.toBeChecked();
});
test('selection preview inverts selected colors, preserves paint colors and refreshes mutable magic masks', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createSelectionOverlay } = await import('/selection-overlay.js');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext('2d'),
      overlay = createSelectionOverlay(),
      mask = new Uint8Array(256);
    for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) mask[y * 16 + x] = 1;
    const reset = () => {
      ctx.fillStyle = 'rgb(20,40,60)';
      ctx.fillRect(0, 0, 16, 16);
    };
    const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
    reset();
    overlay.draw(ctx, mask, 16, 16, 10, true);
    const editing = pixel(5, 5),
      unselected = pixel(1, 1);
    reset();
    overlay.draw(ctx, mask, 16, 16, 10, false);
    const painting = pixel(5, 5),
      protectedPixel = pixel(1, 1);
    for (let y = 10; y < 14; y++) for (let x = 10; x < 14; x++) mask[y * 16 + x] = 1;
    reset();
    overlay.draw(ctx, mask, 16, 16, 10, true, 0.45, true);
    const extended = pixel(11, 11);
    return { editing, unselected, painting, protectedPixel, extended };
  });
  expect(result.editing).toEqual([235, 215, 195, 255]);
  expect(result.unselected).toEqual([20, 40, 60, 255]);
  expect(result.painting).toEqual([20, 40, 60, 255]);
  expect(result.protectedPixel).not.toEqual(result.painting);
  expect(result.extended).toEqual(result.editing);
});
