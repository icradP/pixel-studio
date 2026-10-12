import { test, expect } from '@playwright/test';
import { blank, serialize } from '../../dist/engine.js';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
}

async function settled(page) {
  await page.evaluate(async () => {
    await Promise.allSettled(document.getAnimations().map((animation) => animation.finished));
    await new Promise(requestAnimationFrame);
  });
}

test('tool windows toggle, expand, remember dragging and survive rapid reopening', async ({
  page,
}) => {
  await ready(page);
  const trigger = page.getByRole('button', { name: '画室设置', exact: true });
  const panel = page.locator('#window-settings');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await settled(page);
  const header = await panel.locator('h2').boundingBox();
  await page.mouse.move(header.x + 35, header.y + header.height / 2);
  await page.mouse.down();
  await page.mouse.move(header.x - 280, header.y + header.height / 2, { steps: 8 });
  await page.mouse.up();
  const position = await panel.boundingBox();
  await panel.locator('.window-collapse').click();
  await expect(panel).toHaveClass(/float-collapsed/);
  await trigger.click();
  await expect(panel).not.toHaveClass(/float-collapsed/);
  await trigger.click();
  await expect(panel).toHaveCount(0);
  await trigger.click();
  await settled(page);
  expect(Math.abs((await panel.boundingBox()).x - position.x)).toBeLessThan(2);
  await page.evaluate(() => {
    const button = document.querySelector('[data-panel="settings"]');
    button.click();
    button.click();
  });
  await expect(panel).toHaveCount(1);
  await settled(page);
  await panel.locator('.window-collapse').focus();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('choice menus preserve form values, keyboard navigation and dismissal', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: '笔刷设置', exact: true }).click();
  await page.getByRole('button', { name: '配置当前笔刷', exact: true }).click();
  const combo = page.getByRole('combobox', { name: /笔尖形状/ });
  await combo.click();
  await settled(page);
  await expect(page.getByRole('listbox', { name: '笔尖形状', exact: true })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(combo).toContainText('圆形');
  await expect(page.locator('#brush-shape')).toHaveValue('round');
  await expect(combo).toBeFocused();
  await expect(page.locator('.choice-menu')).toHaveCount(0);
  await combo.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.choice-menu')).toHaveCount(0);
  await expect(page.locator('#window-brush')).toBeVisible();
  await combo.click();
  await page.getByRole('option', { name: '自定义 · 8 × 8 笔尖', exact: true }).click();
  await expect(combo).toContainText('自定义');
  await combo.click();
  await page.locator('#window-brush h2').click();
  await expect(page.locator('.choice-menu')).toHaveCount(0);
  await combo.click();
  await page.locator('#window-brush .window-body').evaluate((body) => {
    body.scrollTop += 30;
  });
  await expect(page.locator('.choice-menu')).toHaveCount(0);
});

test('capacity and switch state update with edits and history', async ({ page }) => {
  await ready(page);
  await page.locator('#capacity-indicator').click();
  await expect(page.locator('#capacity-layers')).toHaveText('3 / 32');
  await expect(page.locator('#capacity-frames')).toHaveText('6 / 240');
  await expect(page.locator('#window-capacity')).toContainText('64.0 MiB');
  await expect(page.locator('#window-capacity')).toContainText('32.0 MiB');
  await expect(page.locator('#window-capacity')).toContainText('设备实际内存');
  await page.locator('#duplicate-frame').click();
  await expect(page.locator('#capacity-frames')).toHaveText('7 / 240');
  await expect(page.locator('#capacity-history')).toContainText('1 步');
  await page.locator('#quick-undo').click();
  await expect(page.locator('#capacity-frames')).toHaveText('6 / 240');
  await expect(page.locator('#capacity-history')).toContainText('1 步');
  await page.locator('#window-capacity .window-close').click();
  await page.getByRole('button', { name: '画室设置', exact: true }).click();
  const input = page.getByRole('switch', { name: /手指绘画/ });
  await input.check();
  await expect(input).toBeChecked();
  await expect(input).toHaveCSS('background-color', 'rgb(114, 186, 255)');
  await expect(page.locator('#pencil-only')).toHaveAttribute('aria-pressed', 'false');
});

test('color dragging coalesces paints while preserving the final color and swatch nodes', async ({
  page,
}) => {
  await ready(page);
  await page.locator('#header-color').click();
  await settled(page);
  const result = await page.evaluate(async () => {
    const prototype = CanvasRenderingContext2D.prototype,
      arc = prototype.arc,
      swatch = document.querySelector('#color-harmony button');
    let calls = 0;
    prototype.arc = function (...args) {
      calls++;
      return arc.apply(this, args);
    };
    try {
      const input = document.querySelector('[data-channel="0"]');
      for (let i = 0; i < 100; i++) {
        input.value = i * 3;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return {
        calls,
        hue: input.value,
        retained: swatch === document.querySelector('#color-harmony button'),
        hex: document.querySelector('#hex-color').value,
        header: document.querySelector('#header-color .color-dot').style.background,
      };
    } finally {
      prototype.arc = arc;
    }
  });
  expect(result.calls).toBe(2);
  expect(result.hue).toBe('297');
  expect(result.retained).toBe(true);
  await expect(page.locator('#header-color .color-dot')).toHaveCSS(
    'background-color',
    result.header,
  );
  expect(result.hex).toMatch(/^#[a-f0-9]{6}$/);
});

test('one stroke retains 90 frame nodes and recomposites only changed previews', async ({
  page,
}) => {
  await ready(page);
  const project = blank(32, 32, '帧缓存测试');
  project.frames = Array.from({ length: 90 }, () => ({
    duration: 120,
    cels: [new Uint8ClampedArray(32 * 32 * 4)],
  }));
  await page.locator('#file-input').setInputFiles({
    name: 'frames.pixel',
    mimeType: 'application/json',
    buffer: Buffer.from(serialize(project)),
  });
  await expect(page.locator('#project-name')).toHaveText('frames');
  await expect(page.locator('#frames canvas[data-ready]')).toHaveCount(90);
  await page.evaluate(() => {
    window.testFrameNodes = [...document.querySelectorAll('#frames > button')];
    window.testPutCount = 0;
    const put = CanvasRenderingContext2D.prototype.putImageData;
    CanvasRenderingContext2D.prototype.putImageData = function (...args) {
      window.testPutCount++;
      return put.apply(this, args);
    };
  });
  const canvas = await page.locator('#view').boundingBox();
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
  await expect(page.locator('#frames canvas[data-ready]')).toHaveCount(90);
  const result = await page.evaluate(() => ({
    calls: window.testPutCount,
    retained: window.testFrameNodes.every(
      (node, i) => node === document.querySelector('#frames').children[i],
    ),
    nonempty: document
      .querySelector('#frames canvas')
      .getContext('2d')
      .getImageData(0, 0, 32, 32)
      .data.some((value, i) => i % 4 === 3 && value > 0),
  }));
  expect(result.calls).toBeGreaterThan(0);
  expect(result.calls).toBeLessThan(10);
  expect(result.retained).toBe(true);
  expect(result.nonempty).toBe(true);
  await page.locator('#timeline-detail').click();
  await settled(page);
  await expect(page.locator('.ase-cel').first()).toContainText('●');
  await page.evaluate(() => {
    window.testCel = document.querySelector('.ase-cel');
  });
  const resized = await page.locator('#view').boundingBox();
  await page.mouse.click(resized.x + resized.width / 2 + 15, resized.y + resized.height / 2);
  expect(await page.evaluate(() => window.testCel === document.querySelector('.ase-cel'))).toBe(
    true,
  );
  await page.locator('.ase-cel').nth(1).click();
  await page.mouse.click(resized.x + resized.width / 2 + 15, resized.y + resized.height / 2);
  await expect(page.locator('.ase-cel').nth(1)).toContainText('●');
  await page.locator('#timeline-detail').click();
  await expect(page.locator('#frames')).toBeVisible();
  await expect(page.locator('#frames canvas[data-ready]')).toHaveCount(90);
  expect(
    await page
      .locator('#frames canvas')
      .nth(1)
      .evaluate((canvas) =>
        canvas
          .getContext('2d')
          .getImageData(0, 0, 32, 32)
          .data.some((value, i) => i % 4 === 3 && value > 0),
      ),
  ).toBe(true);
  await expect(page.getByRole('combobox', { name: /播放动画片段/ })).toContainText('全部帧');
});

test('selection tools toggle and hide composition controls during transformation', async ({
  page,
}) => {
  await ready(page);
  const trigger = page.locator('#tool-select');
  const panel = page.locator('#selection-bar');
  await trigger.click();
  await expect(panel).toBeVisible();
  await settled(page);
  await trigger.click();
  await expect(panel).toBeHidden();
  await trigger.click();
  await expect(panel).toBeVisible();
  await page.locator('#selection-invert').click();
  const combo = page.getByRole('group', { name: '选区组合', exact: true });
  await expect(combo).toBeVisible();
  await page.locator('#selection-transform').click();
  await expect(combo).toBeHidden();
  await expect(page.locator('#selection-mode')).toBeHidden();
  await page.locator('#transform-cancel').click();
  await expect(combo).toBeVisible();
  await page.locator('#selection-collapse').click();
  await trigger.click();
  await expect(panel).not.toHaveClass(/float-collapsed/);
});

test('deferred SVG export remains available after an offline reload', async ({ page, context }) => {
  await ready(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
      );
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
  await page.getByRole('button', { name: '保存与导出', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.locator('#export-svg').click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.svg$/);
  expect(await download.failure()).toBeNull();
});

test('codecs and plugins load on demand and plugin windows use the same collapse behavior', async ({
  page,
}) => {
  const scripts = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname);
  });
  await ready(page);
  for (const path of ['/ase.js', '/gif.js', '/svg.js', '/pixel-import.js', '/plugins.js'])
    expect(scripts).not.toContain(path);
  await page.getByRole('button', { name: '画室设置', exact: true }).click();
  await page.locator('#settings-plugins').click();
  await expect(page.locator('#plugins-dialog')).toBeVisible();
  expect(scripts).toContain('/plugins.js');
  await page.locator('#plugin-collapse').click();
  await expect(page.locator('#plugins-dialog')).toHaveClass(/float-collapsed/);
  await page.locator('#settings-plugins').click();
  await expect(page.locator('#plugins-dialog')).not.toHaveClass(/float-collapsed/);
  await page.locator('#settings-plugins').click();
  await expect(page.locator('#plugins-dialog')).toHaveCount(0);
});

test('menus work inside a modal import dialog and reduced motion skips surface animation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await page.locator('#photo-input').setInputFiles('dist/icon-192.png');
  const dialog = page.locator('#pixel-import-dialog');
  await expect(dialog).toBeVisible();
  await page.getByRole('combobox', { name: /采样方式/ }).click();
  await expect(page.locator('.choice-menu')).toBeVisible();
  await page.getByRole('option', { name: '中心采样', exact: true }).click();
  await expect(page.locator('#pixel-sampling')).toHaveValue('center');
  await page.getByRole('button', { name: '取消图片导入', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '画室设置', exact: true }).click();
  expect(
    await page.locator('#window-settings').evaluate((panel) => panel.getAnimations().length),
  ).toBe(0);
});
