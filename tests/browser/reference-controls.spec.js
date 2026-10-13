import { test, expect } from '@playwright/test';

async function open(page) {
  await page.goto('/');
  await expect(page.locator('body')).not.toHaveAttribute('inert', '');
  if (await page.locator('#dismiss-hint').isVisible()) await page.locator('#dismiss-hint').click();
  await page.clock.install();
  await page.locator('#reference-add').click();
  const ref = page.locator('.reference-window').last();
  await expect(ref).toBeVisible();
  await settle(page);
  return page.locator('#' + (await ref.getAttribute('id')));
}
async function settle(page) {
  await page.evaluate(async () => {
    await Promise.allSettled(document.getAnimations().map((a) => a.finished));
    await new Promise(requestAnimationFrame);
  });
}
async function preview(ref) {
  return ref.locator('canvas').evaluate((canvas) => ({
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    image: canvas.toDataURL(),
  }));
}
async function center(ref) {
  const b = await ref.locator('canvas').boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function reveal(ref) {
  await ref.locator('.reference-viewport').click();
  await expect(ref.locator('header')).toBeVisible();
}
async function drag(page, x, y, dx, dy) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await settle(page);
}

test('reference chrome starts hidden, reveals on tap and expires without resizing or repainting the preview', async ({
  page,
}) => {
  const ref = await open(page);
  await expect(ref.locator('header')).toBeHidden();
  await expect(ref.locator('.reference-toolbar')).toBeHidden();
  const before = await preview(ref);
  expect(before.height).toBe(288);
  await reveal(ref);
  expect(await preview(ref)).toEqual(before);
  await page.clock.runFor(2600);
  await expect(ref.locator('header')).toBeHidden();
  expect(await preview(ref)).toEqual(before);
  await expect(ref.locator('header')).toHaveJSProperty('inert', true);
  await reveal(ref);
  await page.locator('#side-size').click();
  await expect(ref.locator('header')).toBeHidden();
});

test('hidden preview pans in all four directions and wheel zoom does not reveal chrome', async ({
  page,
}) => {
  const ref = await open(page),
    p = await center(ref);
  const before = await preview(ref);
  for (const [dx, dy] of [
    [24, 0],
    [-24, 0],
    [0, 24],
    [0, -24],
  ]) {
    const previous = await preview(ref);
    await drag(page, p.x, p.y, dx, dy);
    expect((await preview(ref)).image).not.toBe(previous.image);
    await expect(ref.locator('header')).toBeHidden();
  }
  expect(await preview(ref)).toEqual(before);
  await page.mouse.move(p.x, p.y);
  await page.mouse.wheel(0, -180);
  await settle(page);
  expect((await preview(ref)).image).not.toBe(before.image);
  await expect(ref.locator('header')).toBeHidden();
});

test('title moves a reference in all directions and chrome stays visible throughout holding, resizing and collapse', async ({
  page,
}) => {
  const ref = await open(page);
  await reveal(ref);
  // Move away from the top/right clamp before testing each direction.
  let head = await ref.locator('h2').boundingBox();
  await drag(page, head.x + 20, head.y + 8, -180, 120);
  for (const [dx, dy] of [
    [28, 0],
    [-28, 0],
    [0, 28],
    [0, -28],
  ]) {
    const before = await ref.boundingBox();
    head = await ref.locator('h2').boundingBox();
    await page.mouse.move(head.x + 20, head.y + 8);
    await page.mouse.down();
    await page.clock.runFor(2700);
    await expect(ref.locator('header')).toBeVisible();
    await page.mouse.move(head.x + 20 + dx, head.y + 8 + dy, { steps: 6 });
    await page.mouse.up();
    const after = await ref.boundingBox();
    expect(after.x - before.x).toBeCloseTo(dx, 0);
    expect(after.y - before.y).toBeCloseTo(dy, 0);
  }
  const before = await ref.boundingBox(),
    corner = await ref.locator('.resize-right').boundingBox();
  await page.mouse.move(corner.x + 14, corner.y + 12);
  await page.mouse.down();
  await page.clock.runFor(2700);
  await expect(ref.locator('.resize-right')).toBeVisible();
  await page.mouse.move(corner.x + 54, corner.y + 52, { steps: 6 });
  await page.mouse.up();
  expect((await ref.boundingBox()).width).toBeCloseTo(before.width + 40, 0);
  await ref.locator('.window-collapse').click();
  await page.clock.runFor(2700);
  await expect(ref.locator('header')).toBeVisible();
  expect((await ref.boundingBox()).height).toBe(36);
  await ref.locator('.window-collapse').click();
  await page.clock.runFor(2700);
  await expect(ref.locator('header')).toBeHidden();
  await expect(ref.locator('canvas')).toBeVisible();
});

test('keyboard can reveal and use controls without the idle timer hiding focused actions', async ({
  page,
}) => {
  const ref = await open(page);
  await ref.locator('.reference-viewport').focus();
  await page.keyboard.press('Enter');
  await ref.locator('.reference-import').focus();
  await page.clock.runFor(4000);
  await expect(ref.locator('.reference-toolbar')).toBeVisible();
  await ref.locator('.resize-right').focus();
  const before = await ref.boundingBox();
  await page.keyboard.press('ArrowLeft');
  expect((await ref.boundingBox()).width).toBe(before.width - 10);
  await ref.locator('.window-close').focus();
  await page.keyboard.press('Enter');
  await expect(ref).toHaveCount(0);
  await page.clock.runFor(3000);
});

test('touch pinch, cancellation and long-press picking stay separate from tap-to-show', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ref = await open(page),
    p = await center(ref);
  const client = await page.context().newCDPSession(page);
  const point = (id, x, y) => ({ id, x, y, radiusX: 3, radiusY: 3, force: 1 });
  const dispatch = (type, touchPoints) =>
    client.send('Input.dispatchTouchEvent', { type, touchPoints });
  for (const [dx, dy] of [
    [24, 0],
    [-24, 0],
    [0, 24],
    [0, -24],
  ]) {
    const previous = await preview(ref);
    await dispatch('touchStart', [point(1, p.x, p.y)]);
    await dispatch('touchMove', [point(1, p.x + dx, p.y + dy)]);
    await dispatch('touchEnd', []);
    await settle(page);
    expect((await preview(ref)).image).not.toBe(previous.image);
    await expect(ref.locator('header')).toBeHidden();
  }
  const before = await preview(ref);
  await dispatch('touchStart', [point(1, p.x - 25, p.y), point(2, p.x + 25, p.y)]);
  await dispatch('touchMove', [point(1, p.x - 50, p.y), point(2, p.x + 50, p.y)]);
  await dispatch('touchEnd', [point(1, p.x - 50, p.y)]);
  await dispatch('touchEnd', []);
  await settle(page);
  expect((await preview(ref)).image).not.toBe(before.image);
  await expect(ref.locator('header')).toBeHidden();
  await dispatch('touchStart', [point(1, p.x, p.y)]);
  await dispatch('touchCancel', []);
  await expect(ref.locator('header')).toBeHidden();
  await dispatch('touchStart', [point(1, p.x, p.y)]);
  await page.clock.runFor(460);
  await expect(ref.locator('.reference-color')).toBeVisible();
  await dispatch('touchEnd', []);
  await expect(ref.locator('.reference-color')).toBeHidden();
  await expect(ref.locator('header')).toBeHidden();
  await dispatch('touchStart', [point(1, p.x, p.y)]);
  await dispatch('touchEnd', []);
  await expect(ref.locator('header')).toBeVisible();
  await ref.locator('.reference-pick').click();
  await page.clock.runFor(2700);
  await expect(ref.locator('header')).toBeHidden();
  await dispatch('touchStart', [point(1, p.x, p.y)]);
  await expect(ref.locator('.reference-color')).toBeVisible();
  await dispatch('touchEnd', []);
  // A tap still reveals the exit from pick mode after its toolbar has disappeared.
  await expect(ref.locator('.reference-pick')).toBeVisible();
  await ref.locator('.reference-pick').click();
  await expect(ref.locator('.reference-pick')).toHaveAttribute('aria-pressed', 'false');
  await client.detach();
});

test('release outside a control does not pin chrome, and each window has its own visibility lifecycle', async ({
  page,
}) => {
  const first = await open(page);
  await reveal(first);
  const button = await first.locator('.reference-fit').boundingBox();
  await page.mouse.move(button.x + 10, button.y + 10);
  await page.mouse.down();
  await page.mouse.move(button.x - 400, button.y + 120);
  await page.mouse.up();
  await page.clock.runFor(2700);
  await expect(first.locator('header')).toBeHidden();
  await reveal(first);
  await first.locator('.reference-new').click();
  const second = page.locator('.reference-window').last();
  await expect(second.locator('header')).toBeHidden();
  await reveal(second);
  await expect(first.locator('header')).toBeHidden();
  await expect(second.locator('header')).toBeVisible();
  await second.locator('.window-close').click();
  await expect(page.locator('.reference-window')).toHaveCount(1);
  await page.clock.runFor(3000);
  await reveal(first);
  await first.locator('.window-close').click();
  await expect(page.locator('.reference-window')).toHaveCount(0);
  await page.clock.runFor(3000);
});
