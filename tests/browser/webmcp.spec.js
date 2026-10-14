import { test, expect } from '@playwright/test';
import { buffer } from 'node:stream/consumers';
import { decodeProjectFile } from '../../dist/project-file.js';

test.use({
  launchOptions: {
    args: ['--enable-experimental-web-platform-features', '--enable-features=WebMCPTesting'],
    ...(process.env.PIXEL_BROWSER_PATH ? { executablePath: process.env.PIXEL_BROWSER_PATH } : {}),
  },
});
async function load(page) {
  await page.goto('/');
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
  if (await page.locator('#dismiss-hint').isVisible()) await page.locator('#dismiss-hint').click();
  expect(await page.evaluate(() => typeof document.modelContext?.getTools)).toBe('function');
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await document.modelContext.getTools()).filter((t) => t.name.startsWith('pixel_'))
            .length,
      ),
    )
    .toBe(15);
}
async function invoke(page, name, args = {}) {
  return page.evaluate(
    async ({ name, args }) => {
      const tool = (await document.modelContext.getTools()).find((t) => t.name === `pixel_${name}`);
      return JSON.parse(await document.modelContext.executeTool(tool, args));
    },
    { name, args },
  );
}
async function state(page) {
  return invoke(page, 'get_document');
}
async function call(page, name, args = {}) {
  return invoke(page, name, { expectedRevision: (await state(page)).revision, ...args });
}
async function create(page, width = 32, height = 32) {
  const result = await call(page, 'create_document', { name: 'AI 动画试验', width, height });
  expect(result.isError, result.message).not.toBe(true);
  await expect(page.locator('#project-name')).toHaveText('AI 动画试验');
}
async function saved(page) {
  expect((await call(page, 'save')).saved).toBe(true);
  return page.evaluate(async () => {
    const { openProjectStore } = await import('/project-store.js');
    const { readCel } = await import('/cel-storage.js');
    const store = await openProjectStore();
    try {
      const record = await store.get(localStorage.getItem('pixel-studio-current'));
      return {
        ...record.project,
        frames: record.project.frames.map((f) => ({
          ...f,
          cels: f.cels.map((c) => [...readCel(c)]),
        })),
      };
    } finally {
      store.close();
    }
  });
}
const shape = { type: 'rect', x: 4, y: 6, width: 6, height: 5, color: '#44bb88' };
async function animate(page, duration = 1, fps = 8) {
  expect(
    (await call(page, 'draw', { frame: 0, layer: 0, selection: 'all', commands: [shape] })).isError,
  ).not.toBe(true);
  const result = await call(page, 'edit_animation', {
    settings: { duration, fps },
    objects: [
      {
        action: 'create',
        name: '运动对象',
        sourceLayers: [0],
        path: [
          { x: 7, y: 8.5 },
          { x: 23, y: 20.5 },
        ],
      },
    ],
  });
  expect(result.isError, result.message).not.toBe(true);
}

test('native WebMCP: create, draw, PNG readback, shared UI undo, save and reload', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page);
  const initial = await state(page);
  await create(page);
  const result = await call(page, 'draw', { frame: 0, layer: 0, commands: [shape] });
  expect(result.pixelWrites).toBe(30);
  const preview = await call(page, 'preview', { frames: [0], maxEdge: 32 });
  expect(preview.isError, preview.message).not.toBe(true);
  await expect(page.locator('#ai-preview-canvas')).toBeVisible();
  expect(
    await page
      .locator('#ai-preview-canvas')
      .evaluate((c) => [...c.getContext('2d').getImageData(4, 6, 1, 1).data]),
  ).toEqual([68, 187, 136, 255]);
  expect(preview.content[1].data.length).toBeGreaterThan(40);
  await call(page, 'preview', { frames: [0], maxEdge: 64 });
  await expect(page.locator('#ai-preview-canvas')).toHaveAttribute('width', '64');
  await page.keyboard.press('ControlOrMeta+z');
  expect((await saved(page)).frames[0].cels[0].every((n) => n === 0)).toBe(true);
  await call(page, 'history', { direction: 'redo' });
  const p = await saved(page);
  expect(p.frames[0].cels[0][(6 * 32 + 4) * 4]).toBe(68);
  expect(
    await page.evaluate(async (initialId) => {
      const { openProjectStore } = await import('/project-store.js');
      const store = await openProjectStore();
      try {
        return !!(await store.get(initialId));
      } finally {
        store.close();
      }
    }, initial.documentId),
  ).toBe(true);
  await page.reload();
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
  expect((await state(page)).name).toBe('AI 动画试验');
  expect(errors).toEqual([]);
});
test('native animation tools: editable metadata, visual contact sheet, bake and GIF export', async ({
  page,
}) => {
  await load(page);
  await create(page);
  await animate(page);
  const result = await call(page, 'preview', { times: [0, 0.25, 0.5, 0.875], maxEdge: 64 });
  expect(result.isError, result.message).not.toBe(true);
  expect(result.samples).toHaveLength(4);
  await page.locator('#procedural-open').click();
  await expect(page.locator('.scene-track')).toHaveCount(1);
  await expect(page.locator('.scene-track')).toContainText('运动对象');
  const baked = await call(page, 'bake_animation', { mode: 'objects' });
  expect(baked.isError, baked.message).not.toBe(true);
  expect(baked.frameRange).toEqual([1, 8]);
  await expect(page.locator('#scene-timeline')).toBeHidden();
  const downloadPromise = page.waitForEvent('download');
  const exported = await call(page, 'export', {
    format: 'gif',
    from: 1,
    to: 8,
    gif: { maxEdge: 16, colors: 32, fps: 4 },
  });
  expect(exported.isError, exported.message).not.toBe(true);
  const download = await downloadPromise,
    bytes = await buffer(await download.createReadStream());
  expect(bytes.subarray(0, 6).toString()).toBe('GIF89a');
  expect(bytes.readUInt16LE(6)).toBe(16);
  expect(bytes.readUInt16LE(8)).toBe(16);
  expect(exported.bytes).toBe(bytes.length);
  const p = await saved(page);
  expect(p.procedural.objects[0].path).toHaveLength(2);
  expect(p.frames).toHaveLength(9);
  expect(p.frames[0].cels[0][(6 * 32 + 4) * 4]).toBe(68);
});
test('native tools reject stale revisions and gestures, and malformed batches remain atomic', async ({
  page,
}) => {
  await load(page);
  await create(page);
  const before = await state(page);
  await call(page, 'edit_layers', { operations: [{ action: 'add', name: '手动可见图层' }] });
  expect(
    (
      await invoke(page, 'draw', {
        expectedRevision: before.revision,
        frame: 0,
        layer: 0,
        commands: [shape],
      })
    ).code,
  ).toBe('STALE_REVISION');
  const invalid = await call(page, 'draw', {
    frame: 0,
    layer: 0,
    commands: [shape, { type: 'pixel', x: 100, y: 3, color: '#ffffff' }],
  });
  expect(invalid.isError).toBe(true);
  expect((await saved(page)).frames[0].cels[0].every((n) => n === 0)).toBe(true);
  await page.locator('[data-panel=settings]').click();
  const range = await page.locator('#shape-delay').boundingBox();
  await page.mouse.move(range.x + range.width / 2, range.y + range.height / 2);
  await page.mouse.down();
  expect((await call(page, 'draw', { frame: 0, layer: 0, commands: [shape] })).code).toBe(
    'EDITOR_BUSY',
  );
  await page.mouse.up();
});
test('native cancellation aborts a bake without frames or undo entries', async ({ page }) => {
  await load(page);
  await create(page);
  await animate(page, 3, 50);
  const before = await state(page);
  await page.evaluate(async (revision) => {
    const tools = await document.modelContext.getTools(),
      tool = tools.find((t) => t.name === 'pixel_bake_animation');
    const controller = new AbortController();
    window.bakeFinished = document.modelContext
      .executeTool(
        tool,
        { expectedRevision: revision, mode: 'composite' },
        { signal: controller.signal },
      )
      .then(
        (value) => JSON.parse(value),
        (e) => ({ cancelled: e.name }),
      );
    setTimeout(() => controller.abort(), 20);
  }, before.revision);
  await page.evaluate(() => window.bakeFinished);
  await expect.poll(async () => (await state(page)).operation).toBe(null);
  const after = await state(page);
  expect(after.frames).toHaveLength(1);
  expect(after.revision).toBe(before.revision);
  expect(after.history.bytes).toBe(before.history.bytes);
});
test('site tools can be disabled, persist off, and register again without duplicates', async ({
  page,
}) => {
  await load(page);
  await page.locator('[data-panel=settings]').click();
  await expect(page.locator('#ai-tools-status')).toContainText('15 个工具');
  await page.locator('#ai-tools-enabled').uncheck();
  await expect
    .poll(() => page.evaluate(async () => (await document.modelContext.getTools()).length))
    .toBe(0);
  await page.reload();
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
  expect(await page.evaluate(async () => (await document.modelContext.getTools()).length)).toBe(0);
  await page.locator('[data-panel=settings]').click();
  await page.locator('#ai-tools-enabled').check();
  await expect
    .poll(() => page.evaluate(async () => (await document.modelContext.getTools()).length))
    .toBe(15);
});
test('unsupported browsers keep normal editing and do not load the command engine', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'modelContext', { value: undefined });
    Object.defineProperty(navigator, 'modelContext', { value: undefined });
  });
  const requests = [],
    errors = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
  await page.locator('[data-panel=settings]').click();
  await expect(page.locator('#ai-tools-status')).toContainText('尚未提供');
  // Service-worker precaching fetches assets, so inspect the module performance initiator, not network alone.
  expect(
    await page.evaluate(
      () =>
        performance
          .getEntriesByType('resource')
          .filter((e) => e.name.endsWith('/editor-api.js') && e.initiatorType === 'script').length,
    ),
  ).toBe(0);
  await page.locator('[data-panel=settings]').click();
  await page.locator('[data-panel=layers]').click();
  await page.locator('#add-layer').click();
  await expect(page.locator('.layer')).toHaveCount(4);
  expect(errors).toEqual([]);
  expect(requests.length).toBeGreaterThan(0);
});

test('canvas text creates a new layer; WebMCP selected compact bake exports and reloads gzip', async ({
  page,
}) => {
  await load(page);
  await create(page, 256, 128);
  await page.locator('[data-panel=tools]').click();
  await page.locator('#tools-text').click();
  await page.locator('#text-content').fill('中日英 ♥');
  await expect(page.locator('#artwork-apply')).toBeEnabled();
  await expect(page.locator('#artwork-preview')).toBeHidden();
  const view = await page.locator('#view').boundingBox();
  const a = { x: view.x + view.width * 0.6, y: view.y + view.height * 0.4 };
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 20, a.y + 30, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#text-x')).not.toHaveValue('26');
  await page.locator('#artwork-apply').click();
  await expect(page.locator('#artwork-panel')).toHaveCount(0);
  expect((await state(page)).layers).toHaveLength(2);
  await page.locator('[data-tool=pencil]').first().click();
  await animate(page, 4, 30);
  const doc = await state(page);
  const baked = await call(page, 'bake_animation', { objectIds: [doc.animation.objects[0].id] });
  expect(baked.isError, baked.message).not.toBe(true);
  expect(baked.compact).toBe(true);
  expect(baked.frameRange).toEqual([1, 120]);
  const downloadPromise = page.waitForEvent('download');
  const exported = await call(page, 'export', { format: 'pixel' });
  expect(exported.isError, exported.message).not.toBe(true);
  const bytes = await buffer(await (await downloadPromise).createReadStream());
  expect([...bytes.subarray(0, 2)]).toEqual([31, 139]);
  const decoded = await decodeProjectFile(new Blob([bytes]));
  expect(decoded.storage).toBe('packed');
  expect(decoded.frames).toHaveLength(121);
  expect(decoded.procedural.bakes.at(-1).mode).toBe('composite');
  await page
    .locator('#file-input')
    .setInputFiles({ name: '紧凑往返.pixel', mimeType: 'application/octet-stream', buffer: bytes });
  await expect(page.locator('#project-name')).toHaveText('紧凑往返');
  expect((await call(page, 'save')).saved).toBe(true);
  expect((await state(page)).frames).toHaveLength(121);
  await page.reload();
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
  expect((await state(page)).frames).toHaveLength(121);
});

test('wide canvas, 81 layers and virtualized frame grid support WebMCP, scrolling and saved reload', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await load(page);
  await create(page, 2048, 8);
  for (let i = 0; i < 4; i++) {
    const result = await call(page, 'edit_layers', {
      operations: Array.from({ length: 20 }, () => ({ action: 'add' })),
    });
    expect(result.isError, result.message).not.toBe(true);
  }
  expect((await state(page)).layers).toHaveLength(81);
  expect(
    (
      await call(page, 'draw', {
        frame: 0,
        layer: 80,
        commands: [{ type: 'pixel', x: 2047, y: 7, color: '#aabbcc' }],
      })
    ).isError,
  ).not.toBe(true);
  await page.locator('[data-panel="layers"]').click();
  expect(await page.locator('#layer-list > .layer').count()).toBeLessThan(20);
  await expect(page.locator('.layers-toolbar')).toContainText('81 图层');
  await page.locator('#layer-list [data-drag-key="80"] .visibility').click();
  expect((await state(page)).layers[80].visible).toBe(false);
  await page.locator('#quick-undo').click();
  expect((await state(page)).layers[80].visible).toBe(true);
  const dragSource = await page
    .locator('#layer-list [data-drag-key="80"] .layer-select')
    .boundingBox();
  const scroller = await page.locator('#window-layers .window-body').boundingBox();
  await page.mouse.move(dragSource.x + 30, dragSource.y + 30);
  await page.mouse.down();
  await page.waitForTimeout(420);
  await page.mouse.move(dragSource.x + 30, scroller.y + scroller.height - 10, { steps: 8 });
  await page.waitForTimeout(900);
  expect(
    await page.locator('#window-layers .window-body').evaluate((body) => body.scrollTop),
  ).toBeGreaterThan(400);
  await expect(page.locator('#layer-list .item-engaged')).toHaveCount(1);
  expect(await page.locator('#layer-list > .layer').count()).toBeLessThan(20);
  await page.mouse.up();
  await expect(page.locator('.item-drag-preview')).toHaveCount(0);
  await page.locator('#window-layers .window-body').evaluate((body) => {
    body.scrollTop = body.scrollHeight;
  });
  await expect(page.locator('#layer-list [data-drag-key="0"]')).toBeVisible();
  await page.locator('#layer-list [data-drag-key="0"] .layer-select').click();
  await expect(page.locator('#layer-list [data-drag-key="0"]')).toHaveClass(/active/);
  await page.locator('#window-layers .window-close').click();
  await page.locator('#timeline-detail').click();
  await expect(page.locator('#ase-timeline')).toBeVisible();
  expect(await page.locator('.ase-cel').count()).toBeLessThan(30);
  await page.locator('#ase-timeline').evaluate((body) => {
    body.scrollTop = body.scrollHeight;
  });
  await expect(page.locator('.ase-layer-select').last()).toHaveText('图层 1');
  expect((await call(page, 'save')).saved).toBe(true);
  await page.reload();
  await expect(page.locator('#project-detail')).toContainText('2048 × 8');
  await expect(page.locator('#canvas-info')).toContainText('81 层');
  expect((await state(page)).layers).toHaveLength(81);
  expect(errors).toEqual([]);
});
