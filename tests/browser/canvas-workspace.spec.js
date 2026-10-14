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
    name: 'workspace.pixel',
    mimeType: 'application/json',
    buffer: Buffer.from(serialize(project)),
  });
  await expect(page.locator('#project-name')).toHaveText('workspace');
  await page.waitForTimeout(360);
}
async function referenceControls(ref) {
  await ref.locator('.reference-viewport').focus();
  await ref.locator('.reference-viewport').press('Enter');
}
async function snapshot(page, pixels = true) {
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
  return page.evaluate(async (pixels) => {
    const { openProjectStore } = await import('/project-store.js');
    const db = await openProjectStore();
    const { project } = await db.get(localStorage.getItem('pixel-studio-current'));
    db.close();
    return {
      w: project.w,
      h: project.h,
      ...(pixels ? { cel: [...project.frames[0].cels[0]] } : {}),
    };
  }, pixels);
}
async function settled(page) {
  await page.evaluate(async () => {
    await Promise.allSettled(document.getAnimations().map((a) => a.finished));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}
async function picture(page) {
  return Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#16a36e';
      ctx.fillRect(0, 0, 16, 16);
      return c.toDataURL().split(',')[1];
    }),
    'base64',
  );
}

test('1024 preset shows the actual budget and survives a saved drawing and reload', async ({
  page,
}) => {
  await ready(page);
  await page.locator('#gallery').click();
  await page.locator('#new-project').click();
  await page.locator('[data-size="1024"]').click();
  await expect(page.locator('#new-capacity-note')).toContainText('图层数量和宽高不设固定上限');
  await page.locator('#new-form button[type="submit"]').click();
  await expect(page.locator('#project-detail')).toContainText('1024 × 1024');
  await page.waitForTimeout(360);
  const box = await page.locator('#view').boundingBox();
  await page.mouse.click(box.x + box.width / 2 + 35, box.y + box.height / 2 + 10);
  expect(await snapshot(page, false)).toEqual({ w: 1024, h: 1024 });
  const count = await page.evaluate(async () => {
    const { openProjectStore } = await import('/project-store.js');
    const db = await openProjectStore();
    const { project } = await db.get(localStorage.getItem('pixel-studio-current'));
    db.close();
    return project.frames[0].cels[0].filter((v, i) => i % 4 === 3 && v > 0).length;
  });
  expect(count).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator('#project-detail')).toContainText('1024 × 1024');
  await page.locator('#capacity-indicator').click();
  await expect(page.locator('#capacity-more-layers')).toContainText('按实际像素存储');
  await page.locator('#capacity-export').click();
  await page.locator('.export-scale .choice-button').click();
  await expect(page.getByRole('option', { name: '清晰放大 · 8× · 超出输出容量' })).toBeDisabled();
  await expect(page.getByRole('option', { name: '清晰放大 · 4×' })).toBeEnabled();
});

test('proportional expansion uses the chosen anchor and restores artwork on undo', async ({
  page,
}) => {
  await ready(page);
  const p = blank(3, 5);
  p.frames[0].cels[0].set([255, 20, 10, 255]);
  await load(page, p);
  await page.locator('[data-panel="settings"]').click();
  await page.locator('#settings-expand').click();
  await page.locator('[data-expand-mode="ratio"]').click();
  await page.locator('[data-expand-percent="200"]').click();
  await page.locator('[data-expand-anchor="8"]').click();
  await expect(page.locator('#expand-size')).toHaveText('3 × 5 → 6 × 10');
  await page.locator('#expand-apply').click();
  const result = await snapshot(page);
  expect(result.cel.slice((5 * 6 + 3) * 4, (5 * 6 + 3) * 4 + 4)).toEqual([255, 20, 10, 255]);
  await page.locator('#quick-undo').click();
  expect(await snapshot(page)).toEqual({ w: 3, h: 5, cel: [...p.frames[0].cels[0]] });
});

test('mirrored display leaves pixels unchanged and maps eyedropper and paint back to the original coordinates', async ({
  page,
}) => {
  await ready(page);
  const p = blank(8, 4);
  for (let i = 0; i < 32; i++)
    p.frames[0].cels[0].set(i % 8 < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
  await load(page, p);
  const before = await snapshot(page),
    box = await page.locator('#view').boundingBox();
  const cx = box.x + box.width / 2 + 20,
    cy = box.y + box.height / 2;
  async function screenColor(x) {
    await settled(page);
    return page.locator('#view').evaluate(
      (canvas, { x, y }) => {
        const r = canvas.getBoundingClientRect(),
          dpr = canvas.width / r.width;
        return [
          ...canvas
            .getContext('2d')
            .getImageData(Math.floor((x - r.left) * dpr), Math.floor((y - r.top) * dpr), 1, 1).data,
        ];
      },
      { x, y: cy },
    );
  }
  expect(await screenColor(cx - 50)).toEqual([255, 0, 0, 255]);
  await page.locator('#mirror-view').click();
  expect(await screenColor(cx - 50)).toEqual([0, 0, 255, 255]);
  expect(await snapshot(page)).toEqual(before);
  await page.keyboard.press('i');
  await page.mouse.click(cx + 50, cy + 10);
  await expect(page.locator('#header-color .color-dot')).toHaveCSS(
    'background-color',
    'rgb(255, 0, 0)',
  );
  await page.mouse.click(cx - 50, cy + 10);
  const after = await snapshot(page);
  expect(after.cel.slice((2 * 8 + 6) * 4, (2 * 8 + 6) * 4 + 4)).toEqual([255, 0, 0, 255]);
  await page.locator('#quick-undo').click();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('[data-panel="settings"]').click();
  await page.locator('[data-display="pixel"]').click();
  await page.locator('#window-settings .window-close').click();
  expect(await screenColor(cx - 50)).toEqual([0, 0, 255, 255]);
});

test('multiple reference windows resize and drag independently, import and pick color without changing artwork', async ({
  page,
}) => {
  await ready(page);
  const before = await snapshot(page);
  await page.locator('#reference-add').click();
  await settled(page);
  const first = page.locator('.reference-window').first();
  await referenceControls(first);
  const firstSize = await first.evaluate((el) => ({
    width: el.offsetWidth,
    height: el.offsetHeight,
  }));
  await first.locator('.reference-new').click();
  await settled(page);
  const second = page.locator('.reference-window').last();
  await referenceControls(second);
  const original = await second.boundingBox();
  const head = await second.locator('h2').boundingBox();
  await page.mouse.move(head.x + 30, head.y + 10);
  await page.mouse.down();
  await page.mouse.move(head.x + 130, head.y + 160, { steps: 10 });
  await page.mouse.up();
  const moved = await second.boundingBox();
  expect(moved.y - original.y).toBeGreaterThan(100);
  const handle = await second.locator('.resize-right').boundingBox();
  await page.mouse.move(handle.x + 14, handle.y + 12);
  await page.mouse.down();
  await page.mouse.move(handle.x + 94, handle.y + 72, { steps: 10 });
  await page.mouse.up();
  expect((await second.boundingBox()).width - moved.width).toBeGreaterThan(65);
  expect((await first.boundingBox()).width).toBeCloseTo(firstSize.width, 0);
  expect((await first.boundingBox()).height).toBeCloseTo(firstSize.height, 0);
  await second
    .locator('.reference-file')
    .setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: await picture(page) });
  await expect(second).toHaveAttribute('data-image', 'reference.png');
  await settled(page);
  await second.locator('.reference-pick').click();
  const preview = await second.locator('canvas').boundingBox();
  await page.mouse.click(preview.x + preview.width / 2, preview.y + preview.height / 2);
  await expect(page.locator('#header-color .color-dot')).toHaveCSS(
    'background-color',
    'rgb(22, 163, 110)',
  );
  expect(await snapshot(page)).toEqual(before);
  await second.locator('.window-close').click();
  await expect(page.locator('.reference-window')).toHaveCount(1);
  await referenceControls(first);
  await first.locator('.window-close').click();
  await expect(page.locator('.reference-window')).toHaveCount(0);
});

test('reference canvas follows live strokes and undo and stops repainting while idle', async ({
  page,
}) => {
  await ready(page);
  await load(page, blank(16, 16));
  await page.locator('#reference-add').click();
  await settled(page);
  const ref = page.locator('.reference-window');
  async function preview() {
    await settled(page);
    return ref.locator('canvas').evaluate((c) => c.toDataURL());
  }
  const before = await preview();
  const box = await page.locator('#view').boundingBox();
  await page.mouse.click(box.x + box.width / 2 + 20, box.y + box.height / 2);
  expect(await preview()).not.toBe(before);
  await page.locator('#quick-undo').click();
  expect(await preview()).toBe(before);
  const idle = await ref.locator('canvas').evaluate(async (canvas) => {
    let count = 0;
    const ctx = canvas.getContext('2d'),
      draw = ctx.drawImage;
    ctx.drawImage = function (...args) {
      count++;
      return draw.apply(this, args);
    };
    await new Promise((r) => setTimeout(r, 120));
    ctx.drawImage = draw;
    return count;
  });
  expect(idle).toBe(0);
});

for (const size of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
])
  test(`reference controls and resizing stay reachable at ${size.width}`, async ({ page }) => {
    await page.setViewportSize(size);
    await ready(page);
    await page.locator('#reference-add').click();
    await settled(page);
    const ref = page.locator('.reference-window');
    await referenceControls(ref);
    for (const button of ['.reference-import', '.reference-pick', '.window-close', '.resize-right'])
      await expect(ref.locator(button)).toBeInViewport();
    await ref.locator('.resize-right').focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowDown');
    const b = await ref.boundingBox();
    expect(b.x + b.width).toBeLessThanOrEqual(size.width);
    expect(b.y + b.height).toBeLessThanOrEqual(size.height);
    await ref.locator('.window-collapse').click();
    await expect(ref.locator('.reference-body')).toBeHidden();
    await ref.locator('.window-collapse').click();
    await expect(ref.locator('canvas')).toBeVisible();
  });

test('layer drag preview follows pointer and touch cancellation cleans it without changing order', async ({
  page,
}) => {
  await ready(page);
  await page.locator('[data-panel="layers"]').click();
  await settled(page);
  const names = await page.locator('.layer-select span').allTextContents(),
    box = await page.locator('.layer-select').first().boundingBox();
  await page.mouse.move(box.x + 80, box.y + 30);
  await page.mouse.down();
  await page.waitForTimeout(390);
  await page.mouse.move(box.x + 100, box.y + 100, { steps: 4 });
  const ghost = page.locator('.item-drag-preview');
  await expect(ghost).toBeVisible();
  const b = await ghost.boundingBox();
  expect(b.y).toBeGreaterThan(box.y + 40);
  await page.locator('.layer-select').first().dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  await expect(ghost).toHaveCount(0);
  expect(await page.locator('.layer-select span').allTextContents()).toEqual(names);
});

test('reference touch pan, pinch, long-press sampling and cancelled resizing keep artwork intact', async ({
  page,
}) => {
  await ready(page);
  const before = await snapshot(page);
  await page.locator('#reference-add').click();
  await settled(page);
  const ref = page.locator('.reference-window');
  await ref
    .locator('.reference-file')
    .setInputFiles({ name: 'touch.png', mimeType: 'image/png', buffer: await picture(page) });
  await expect(ref).toHaveAttribute('data-image', 'touch.png');
  await settled(page);
  const preview = await ref.locator('canvas').boundingBox(),
    x = preview.x + preview.width / 2,
    y = preview.y + preview.height / 2;
  const client = await page.context().newCDPSession(page);
  const touch = (id, x, y) => ({ id, x, y, radiusX: 3, radiusY: 3, force: 1 });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [touch(1, x - 30, y), touch(2, x + 30, y)],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [touch(1, x - 60, y + 15), touch(2, x + 60, y + 15)],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [touch(1, x, y)],
  });
  await page.waitForTimeout(460);
  await expect(ref.locator('.reference-color')).toBeVisible();
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(ref.locator('.reference-color')).toBeHidden();
  await expect(page.locator('#header-color .color-dot')).toHaveCSS(
    'background-color',
    'rgb(22, 163, 110)',
  );
  await referenceControls(ref);
  const handle = await ref.locator('.resize-left').boundingBox();
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [touch(1, handle.x + 12, handle.y + 12)],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [touch(1, handle.x - 55, handle.y + 45)],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(ref).not.toHaveClass(/window-resizing/);
  expect(await snapshot(page)).toEqual(before);
  await client.detach();
});

test('reference count is bounded and closing releases a slot, including reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await page.locator('#reference-add').click();
  for (let i = 1; i < 6; i++) {
    await referenceControls(page.locator('.reference-window').last());
    await page.locator('.reference-window').last().locator('.reference-new').click();
  }
  await referenceControls(page.locator('.reference-window').last());
  await page.locator('.reference-window').last().locator('.reference-new').click();
  await expect(page.locator('.reference-window')).toHaveCount(6);
  await expect(page.locator('#toast')).toContainText('最多同时打开 6');
  await page.locator('.reference-window').last().locator('.window-close').click();
  await expect(page.locator('.reference-window')).toHaveCount(5);
  await referenceControls(page.locator('.reference-window').last());
  await page.locator('.reference-window').last().locator('.reference-new').click();
  await expect(page.locator('.reference-window')).toHaveCount(6);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(50);
  const boxes = await page
    .locator('.reference-window')
    .evaluateAll((nodes) =>
      nodes.map((n) => ({ x: n.offsetLeft, y: n.offsetTop, w: n.offsetWidth, h: n.offsetHeight })),
    );
  for (const b of boxes) {
    expect(b.x + b.w).toBeLessThanOrEqual(390);
    expect(b.y + b.h).toBeLessThanOrEqual(844);
  }
});
