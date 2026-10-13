import { test, expect } from '@playwright/test';
import { blank, serialize } from '../../dist/engine.js';

const vertices = (points) =>
  points.flatMap(([x, y], i) =>
    i
      ? Array.from({ length: 10 }, (_, j) => ({
          x: points[i - 1][0] + ((x - points[i - 1][0]) * (j + 1)) / 10,
          y: points[i - 1][1] + ((y - points[i - 1][1]) * (j + 1)) / 10,
        }))
      : [{ x, y }],
  );
const rectangle = vertices([
  [14.85, 15.75],
  [43.4, 17.2],
  [42.9, 41.5],
  [12.5, 39.5],
  [14.85, 15.75],
]);
const shapes = [
  [
    '直线',
    vertices([
      [14.85, 15.75],
      [45.85, 32.75],
    ]),
  ],
  ['矩形', rectangle],
  ...[
    ['圆形', 17.5],
    ['椭圆', 11],
  ].map(([name, ry]) => [
    name,
    Array.from({ length: 65 }, (_, i) => {
      const t = 0.8 + (i / 64) * Math.PI * 2,
        wobble = 1 + 0.04 * Math.cos(3 * t + 0.9);
      return { x: 31.7 + 18 * Math.cos(t) * wobble, y: 31.8 + ry * Math.sin(t) * wobble };
    }),
  ]),
  [
    '3 边形',
    vertices([
      [14.85, 15.75],
      [45.7, 18.9],
      [32.4, 44.2],
      [14.85, 15.75],
    ]),
  ],
  ['矩形', rectangle, true],
];

async function saved(page) {
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('#save-status')).toHaveText('已保存在此设备');
  return page.evaluate(async () => {
    const { openProjectStore } = await import('/project-store.js');
    const db = await openProjectStore();
    try {
      const { project } = await db.get(localStorage.getItem('pixel-studio-current'));
      return [...project.frames[0].cels[0]];
    } finally {
      db.close();
    }
  });
}

for (const [name, points, transformed] of shapes)
  test(`${name} holds its first painted pixel through recognition, adjustment and save${transformed ? ' in a mirrored rotated view' : ''}`, async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('body')).not.toHaveAttribute('inert', '');
    if (await page.locator('#dismiss-hint').isVisible())
      await page.locator('#dismiss-hint').click();
    await page.locator('#file-input').setInputFiles({
      name: 'shape-anchor.pixel',
      mimeType: 'application/json',
      buffer: Buffer.from(serialize(blank(64, 64))),
    });
    await expect(page.locator('#project-name')).toHaveText('shape-anchor');
    await page.waitForTimeout(350);
    await page.locator('#side-size').fill('1');
    await page.locator('#header-color').click();
    await page.evaluate(async () => {
      await Promise.allSettled(document.getAnimations().map((a) => a.finished));
      await new Promise(requestAnimationFrame);
    });
    await page.locator('#hex-color').fill('#ff3d63');
    await page.locator('#hex-color').dispatchEvent('change');
    await expect(page.locator('#header-color .color-dot')).toHaveCSS(
      'background-color',
      'rgb(255, 61, 99)',
    );
    await page.locator('#window-color .window-close').click();
    await page.locator('[data-panel="settings"]').click();
    await page.locator('#shape-delay').fill('200');
    await page.locator('[data-display="pixel"]').click();
    await page.locator('#window-settings .window-close').click();
    if (transformed) {
      await page.locator('#mirror-view').click();
      await page.locator('#rotate').click();
    }
    const box = await page.locator('#view').boundingBox(),
      scale = Math.min(20, (box.width - 130) / 64, (box.height - 100) / 64),
      screen = ({ x, y }) => ({
        x: box.x + box.width / 2 + 20 + (transformed ? 32 - y : x - 32) * scale,
        y: box.y + box.height / 2 + (transformed ? 32 - x : y - 32) * scale,
      }),
      anchor = { x: Math.floor(points[0].x), y: Math.floor(points[0].y) },
      pixel = screen({ x: anchor.x + 0.5, y: anchor.y + 0.5 });
    const previewPixel = () =>
      page.locator('#view').evaluate((canvas, p) => {
        const r = canvas.getBoundingClientRect();
        return [
          ...canvas
            .getContext('2d')
            .getImageData(
              Math.floor(((p.x - r.left) * canvas.width) / r.width),
              Math.floor(((p.y - r.top) * canvas.height) / r.height),
              1,
              1,
            ).data,
        ];
      }, pixel);
    const first = screen(points[0]);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const point of points.slice(1)) {
      const p = screen(point);
      await page.mouse.move(p.x, p.y);
    }
    await expect(page.locator('#toast')).toContainText('已识别' + name);
    await expect.poll(previewPixel).toEqual([255, 61, 99, 255]);
    const hold = points.at(-1);
    for (const [dx, dy] of [
      [8, -5],
      [-9, 11],
      [0, 0],
      [12, 3],
    ]) {
      const p = screen({ x: hold.x + dx, y: hold.y + dy });
      await page.mouse.move(p.x, p.y);
      await expect.poll(previewPixel).toEqual([255, 61, 99, 255]);
    }
    await page.mouse.up();
    const result = await saved(page),
      offset = (anchor.y * 64 + anchor.x) * 4;
    expect(result.slice(offset, offset + 4)).toEqual([255, 61, 99, 255]);
    await page.locator('#quick-undo').click();
    expect((await saved(page)).some(Boolean)).toBe(false);
    await page.locator('#quick-redo').click();
    expect(await saved(page)).toEqual(result);
  });
