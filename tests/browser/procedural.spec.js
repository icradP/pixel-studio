import { test, expect } from '@playwright/test';
import { buffer } from 'node:stream/consumers';
import { blank, serialize } from '../../dist/engine.js';
import { createScene, pathNode } from '../../dist/procedural-model.js';
import { createObject } from '../../dist/procedural.js';

function artwork(animated = false) {
  const p = blank(96, 72);
  p.layers = [
    { name: '史莱姆', visible: true, opacity: 255 },
    { name: '石头', visible: true, opacity: 255 },
  ];
  p.frames[0].cels = p.layers.map(() => new Uint8ClampedArray(p.w * p.h * 4));
  for (let y = 28; y < 40; y++)
    for (let x = 18; x < 34; x++) p.frames[0].cels[0].set([80, 208, 150, 255], (y * p.w + x) * 4);
  for (let y = 52; y < 60; y++)
    for (let x = 65; x < 77; x++) p.frames[0].cels[1].set([167, 167, 186, 255], (y * p.w + x) * 4);
  if (animated) {
    p.procedural = createScene(p, 0);
    p.procedural.objects.push(createObject(p, p.procedural, [0], null, '史莱姆'));
    p.procedural.objects.push(createObject(p, p.procedural, [1], null, '石头'));
    p.procedural.objects[0].path = [pathNode(26, 34), pathNode(65, 45)];
  }
  return p;
}
async function load(page, p = artwork(true)) {
  await page.goto('/');
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
  if (await page.locator('#dismiss-hint').isVisible()) await page.locator('#dismiss-hint').click();
  await page.locator('#file-input').setInputFiles({
    name: '动作试验.pixel',
    mimeType: 'application/json',
    buffer: Buffer.from(serialize(p)),
  });
  await expect(page.locator('#project-name')).toHaveText('动作试验');
  await page.waitForTimeout(350);
  await page.locator('#procedural-open').click();
  await expect(page.locator('#scene-timeline')).toBeVisible();
}
async function saved(page) {
  await page.evaluate(() => document.activeElement?.blur());
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
async function closePanel(page) {
  const panel = page.locator('#scene-inspector');
  if (await panel.count()) await panel.locator('.window-close').click();
}
async function screen(page, transformed = false) {
  await page.locator('#fit').click();
  if (transformed) {
    await page.locator('#mirror-view').click();
    await page.locator('#rotate').click();
  }
  const b = await page.locator('#view').boundingBox(),
    scale = Math.min(20, (b.width - 130) / 96, (b.height - 100) / 72);
  return (x, y) => ({
    x: b.x + b.width / 2 + 20 + (transformed ? 36 - y : x - 48) * scale,
    y: b.y + b.height / 2 + (transformed ? 48 - x : y - 36) * scale,
  });
}
async function drag(page, a, b) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}
async function change(page, selector, value) {
  await page.locator(selector).fill(String(value));
  await page.locator(selector).dispatchEvent('change');
}

for (const transformed of [false, true])
  test(`two named objects keep independent paths and progress${transformed ? ' in a mirrored rotated view' : ''}`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const original = artwork();
    await load(page, original);
    await page.locator('#scene-object-name').fill('石头');
    await page.locator('#scene-create').click();
    await page.locator('#scene-add').click();
    await page.locator('[data-source-layer="1"]').uncheck();
    await page.locator('[data-source-layer="0"]').check();
    await page.locator('#scene-object-name').fill('史莱姆');
    await page.locator('#scene-create').click();
    await expect(page.locator('.scene-track')).toHaveCount(2);
    await closePanel(page);
    const point = await screen(page, transformed);
    await drag(page, point(26, 34), point(56, 25));
    const before = await saved(page),
      slime = before.procedural.objects.find((o) => o.name === '史莱姆');
    expect(slime.path.length).toBeGreaterThan(1);
    expect(slime.path.at(-1).x).toBeCloseTo(56, 0);
    expect(slime.path.at(-1).y).toBeCloseTo(25, 0);
    await page.locator('#scene-curve').click();
    await page.getByRole('button', { name: '停留后下落', exact: true }).click();
    const after = await saved(page);
    expect(after.procedural.objects.find((o) => o.name === '史莱姆').path).toEqual(slime.path);
    expect(after.procedural.objects.find((o) => o.name === '石头')).toEqual(
      before.procedural.objects.find((o) => o.name === '石头'),
    );
    for (let i = 0; i < 2; i++)
      expect(Object.values(after.frames[0].cels[i])).toEqual([...original.frames[0].cels[i]]);
    await closePanel(page);
    await page.locator('#scene-effects').click();
    await expect(page.locator('#scene-inspector')).toHaveCount(1);
    await page.locator('[data-add-effect="squash"]').click();
    await closePanel(page);
    await page.locator('#scene-play').click();
    await expect(page.locator('#scene-time')).not.toHaveText('0.000 s');
    await page.locator('#scene-play').click();
    await saved(page);
    await page.reload();
    await expect(page.locator('body')).not.toHaveAttribute('inert', '');
    await page.locator('#procedural-open').click();
    expect(
      (await saved(page)).procedural.objects.find((o) => o.name === '史莱姆').clips,
    ).toHaveLength(1);
    expect(errors).toEqual([]);
  });

test('pose keys retain the source pose, exact frame times, undo and live inspector values', async ({
  page,
}) => {
  await load(page);
  await page.getByRole('button', { name: '选择动画对象 史莱姆', exact: true }).click();
  await page.locator('#scene-next').click();
  await change(page, '[data-scene-value="rotation"]', 90);
  let scene = (await saved(page)).procedural;
  expect(scene.objects[0].tracks.rotation).toEqual([
    { t: 0, v: 0 },
    { t: 1 / 12, v: 90 },
  ]);
  await page.locator('#scene-prev').click();
  await expect(page.locator('[data-scene-value="rotation"]')).toHaveValue('0');
  await page.locator('#scene-undo').click();
  scene = (await saved(page)).procedural;
  expect(scene.objects[0].tracks.rotation).toEqual([]);
  await page.locator('#scene-redo').click();
  expect((await saved(page)).procedural.objects[0].tracks.rotation).toHaveLength(2);
});

test('curve and interval drags cancel atomically and curve keyboard control does not scrub time', async ({
  page,
}) => {
  await load(page);
  const before = (await saved(page)).procedural;
  await page.locator('#scene-curve').click();
  await page.getByRole('button', { name: '停留后下落', exact: true }).click();
  const curveBefore = (await saved(page)).procedural.objects[0].progress;
  const dot = await page.locator('.scene-curve circle').nth(1).boundingBox();
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await page.mouse.down();
  await page.mouse.move(dot.x + 20, dot.y - 20, { steps: 4 });
  await page.locator('.scene-curve').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  expect((await saved(page)).procedural.objects[0].progress).toEqual(curveBefore);
  await page.locator('.scene-curve circle').nth(1).focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#scene-time')).toHaveText('0.000 s');
  expect((await saved(page)).procedural.objects[0].progress[1].v).toBeCloseTo(
    curveBefore[1].v + 0.01,
  );
  await closePanel(page);
  const interval = page.locator('.scene-track.selected .scene-motion'),
    edge = await interval.locator('[data-edge="end"]').boundingBox();
  await page.mouse.move(edge.x + 4, edge.y + 10);
  await page.mouse.down();
  await page.mouse.move(edge.x - 100, edge.y + 10, { steps: 5 });
  await interval.dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  expect((await saved(page)).procedural.objects[0].motion).toEqual(before.objects[0].motion);
});

for (const mode of ['objects', 'composite'])
  test(`${mode} bake matches live evaluation, returns to frame editing, and supports undo and reload`, async ({
    page,
  }) => {
    await load(page);
    const original = await saved(page);
    await page.locator('#scene-bake').click();
    await page.locator('#scene-bake-mode').evaluate((el, value) => {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, mode);
    await expect(page.locator('#scene-bake-capacity')).toContainText('24 个采样帧');
    await page.locator('#scene-bake-confirm').click();
    await expect(page.locator('#scene-timeline')).toBeHidden();
    await expect(page.locator('#frame-count')).toHaveText('25 FRAMES');
    const baked = await saved(page);
    expect(baked.procedural.bakes).toHaveLength(1);
    expect(baked.frames[0].cels.slice(0, 2)).toEqual(original.frames[0].cels);
    expect(
      await page.evaluate(async () => {
        const { openProjectStore } = await import('/project-store.js');
        const db = await openProjectStore();
        const { project: p } = await db.get(localStorage.getItem('pixel-studio-current'));
        db.close();
        const { compileScene, evaluateScene, sampleTimes } = await import('/procedural.js'),
          { composite, deserialize, serialize } = await import('/engine.js');
        const s = p.procedural,
          c = compileScene(p, s),
          last = s.bakes.at(-1);
        return (
          sampleTimes(s).every((sample, i) => {
            const frame = p.frames.findIndex((f) => f.id === last.frameIds[i]),
              a = composite(p, frame),
              b = evaluateScene(c, s, sample.time);
            return a.every((v, i) => v === b[i]);
          }) && serialize(deserialize(serialize(p))) === serialize(p)
        );
      }),
    ).toBe(true);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('#frame-count')).toHaveText('01 FRAMES');
    expect((await saved(page)).procedural.bakes).toHaveLength(0);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(page.locator('#frame-count')).toHaveText('25 FRAMES');
    await saved(page);
    await page.reload();
    await expect(page.locator('body')).not.toHaveAttribute('inert', '');
    expect((await saved(page)).procedural).toEqual(baked.procedural);
    if (mode === 'objects') {
      await page.locator('#procedural-open').click();
      await page.locator('#scene-bake').click();
      for (const [selector, extension] of [
        ['#scene-export-gif', 'gif'],
        ['#scene-export-sheet', 'png'],
      ]) {
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.locator(selector).click(),
        ]);
        expect(download.suggestedFilename()).toMatch(new RegExp('\\.' + extension + '$'));
        const data = await buffer(await download.createReadStream());
        if (extension === 'gif') expect(data.subarray(0, 6).toString()).toBe('GIF89a');
        else {
          expect(data.readUInt32BE(16)).toBe(96 * 24);
          expect(data.readUInt32BE(20)).toBe(72);
        }
      }
    }
  });

test('overlapping source selection is rejected without changing the scene', async ({ page }) => {
  await load(page);
  const before = (await saved(page)).procedural;
  await page.locator('#scene-add').click();
  await page.locator('#scene-create').click();
  await expect(page.locator('#toast')).toContainText('重叠');
  expect((await saved(page)).procedural).toEqual(before);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
])
  test(`scene controls stay inside ${viewport.width}px viewport and panels remain scrollable`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await load(page);
    await page.locator('#scene-settings').click();
    const box = await page.locator('#scene-inspector').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    await page.locator('#scene-save-settings').scrollIntoViewIfNeeded();
    await expect(page.locator('#scene-save-settings')).toBeInViewport();
    await closePanel(page);
    await page.locator('#scene-exit').click();
    await expect(page.locator('#scene-timeline')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

test('a drawing selection becomes a referenced object without copying or clearing source pixels', async ({
  page,
}) => {
  await load(page, artwork());
  await closePanel(page);
  await page.locator('#scene-exit').click();
  await page.locator('#tool-wand').click();
  const point = await screen(page),
    p = point(70, 56);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#selection-count')).toHaveAttribute('data-pixels', '96');
  await page.locator('#selection-done').click();
  await page.locator('#procedural-open').click();
  await expect(page.locator('#scene-use-selection')).toBeChecked();
  await page.locator('#scene-create').click();
  const savedProject = await saved(page),
    region = savedProject.procedural.objects[0].source.region;
  expect(region.runs.filter((_, i) => i % 2 === 1).reduce((sum, n) => sum + n, 0)).toBe(96);
  expect(Object.values(savedProject.frames[0].cels[1])).toEqual([...artwork().frames[0].cels[1]]);
});

test('a second touch cancels an object drag and never paints the drawing', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 1024, height: 768 },
  });
  const page = await context.newPage();
  await load(page);
  const before = await saved(page),
    point = await screen(page),
    p = point(26, 34);
  const client = await context.newCDPSession(page),
    send = (type, points) =>
      client.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map((v, i) => ({ id: i + 1, x: v.x, y: v.y })),
      });
  await send('touchStart', [p]);
  await page.waitForTimeout(150);
  await send('touchMove', [{ x: p.x + 60, y: p.y }]);
  await send('touchStart', [
    { x: p.x + 60, y: p.y },
    { x: p.x + 100, y: p.y + 40 },
  ]);
  await send('touchEnd', []);
  const after = await saved(page);
  expect(after.procedural).toEqual(before.procedural);
  expect(after.frames).toEqual(before.frames);
  await context.close();
});

test('new baking preserves actual brush refinements and replacement requires an explicit decision', async ({
  page,
}) => {
  await load(page);
  await page.locator('#scene-bake').click();
  await page.locator('#scene-bake-confirm').click();
  await expect(page.locator('#scene-timeline')).toBeHidden();
  await page.keyboard.press('b');
  await page.locator('#side-size').fill('1');
  const point = await screen(page);
  await drag(page, point(10, 10), point(13, 10));
  const refined = await saved(page),
    first = refined.procedural.bakes[0],
    f = refined.frames.findIndex((v) => v.id === first.frameIds[0]),
    li = refined.layers.findIndex((v) => v.id === first.layerIds[1]);
  expect(Object.values(refined.frames[f].cels[li]).some((v) => v > 0)).toBe(true);
  await page.locator('#procedural-open').click();
  await page.locator('#scene-bake').click();
  await page.locator('#scene-bake-confirm').click();
  await expect(page.locator('#scene-timeline')).toBeHidden();
  const second = await saved(page);
  expect(second.procedural.bakes).toHaveLength(2);
  expect(second.frames[f].cels.slice(0, refined.layers.length)).toEqual(refined.frames[f].cels);
  await page.locator('#procedural-open').click();
  await page.locator('#scene-bake').click();
  await page.getByRole('combobox', { name: /保存位置/ }).click();
  await page.getByRole('option', { name: /替换上次生成内容/ }).click();
  await page.locator('#scene-bake-confirm').click();
  await expect(page.locator('#action-dialog')).toContainText('人工修改也会被覆盖');
  await page.locator('#action-dialog [data-cancel]').click();
  await expect(page.locator('#action-dialog')).not.toBeVisible();
  expect((await saved(page)).frames).toEqual(second.frames);
});

test('the lazy animation editor and saved scene reopen entirely offline', async ({
  page,
  context,
}) => {
  await load(page);
  const before = (await saved(page)).procedural;
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
  await page.locator('#procedural-open').click();
  await expect(page.locator('.scene-track')).toHaveCount(2);
  await page.locator('#scene-curve').click();
  await expect(page.locator('.scene-curve')).toBeVisible();
  expect((await saved(page)).procedural).toEqual(before);
});

test('middle-button panning leaves object geometry and source pixels untouched', async ({
  page,
}) => {
  await load(page);
  const before = await saved(page),
    point = await screen(page),
    p = point(26, 34);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(p.x + 70, p.y + 30, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  const after = await saved(page);
  expect(after.procedural).toEqual(before.procedural);
  expect(after.frames).toEqual(before.frames);
  await expect(page.locator('#scene-timeline')).toBeVisible();
});
