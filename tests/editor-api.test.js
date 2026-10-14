import test from 'node:test';
import assert from 'node:assert/strict';
import { blank, clone, serialize, composite } from '../dist/engine.js';
import { createHistory } from '../dist/history.js';
import { createEditorAPI } from '../dist/editor-api.js';
import { createWebMCP, modelContext } from '../dist/webmcp.js';
import { compileScene, evaluateScene } from '../dist/procedural.js';

function fixture(project = blank(16, 16)) {
  const history = createHistory();
  const s = {
    project,
    id: 'test',
    revision: '0',
    frame: 0,
    layer: 0,
    history,
    selection: null,
    busy: null,
  };
  let revision = 0;
  const bump = () => {
    s.revision = String(++revision);
  };
  const host = {
    snapshot: () => s,
    commit(next, { sceneOnly, focus }) {
      if (sceneOnly) history.checkpointScene(s.project.procedural);
      else history.checkpoint(clone(s.project));
      s.project = next;
      Object.assign(s, focus);
      bump();
    },
    history(direction) {
      s.project = history[direction](s.project);
      bump();
    },
    async create(p, check) {
      check();
      s.project = p;
      history.clear();
      bump();
      return true;
    },
    save: async () => true,
  };
  const api = createEditorAPI(host);
  const call = (name, args = {}, options) =>
    api.execute(
      `pixel_${name}`,
      name === 'get_document' ? args : { expectedRevision: s.revision, ...args },
      options,
    );
  return { api, s, host, call, bump };
}
const dot = (x = 2, y = 3, color = '#ff8800') => ({ type: 'pixel', x, y, color });
const draw = (commands = [dot()]) => ({ frame: 0, layer: 0, commands });
const pixel = (p, x, y, frame = 0, layer = 0) => [
  ...p.frames[frame].cels[layer].slice((y * p.w + x) * 4, (y * p.w + x) * 4 + 4),
];

test('API snapshot is detached, bounded, and shares real engine limits', async () => {
  const f = fixture(),
    d = await f.call('get_document');
  d.layers[0].name = 'external mutation';
  assert.equal(f.s.project.layers[0].name, '图层 1');
  assert.equal(d.limits.dimension, 1024);
  assert.equal(d.usage.bytes, 16 * 16 * 4);
  assert.equal(d.frames[0].cels, undefined);
});
test('a drawing batch is exact RGBA and one undo/redo step', async () => {
  const f = fixture();
  const result = await f.call(
    'draw',
    draw([
      dot(),
      {
        type: 'patch',
        x: 4,
        y: 4,
        width: 2,
        height: 1,
        palette: ['#12ab3456', '#00000000'],
        indices: [0, 1],
      },
    ]),
  );
  assert.equal(result.pixelWrites, 2);
  assert.equal(f.s.history.count, 1);
  assert.deepEqual(pixel(f.s.project, 4, 4), [18, 171, 52, 86]);
  await f.call('history', { direction: 'undo' });
  assert.deepEqual(pixel(f.s.project, 2, 3), [0, 0, 0, 0]);
  await f.call('history', { direction: 'redo' });
  assert.deepEqual(pixel(f.s.project, 2, 3), [255, 136, 0, 255]);
});
test('invalid late command rolls back every pixel and does not touch history', async () => {
  const f = fixture(),
    before = serialize(f.s.project);
  await assert.rejects(f.call('draw', draw([dot(), dot(20, 2)])), /超出画布/);
  assert.equal(serialize(f.s.project), before);
  assert.equal(f.s.history.count, 0);
  assert.equal(f.s.revision, '0');
});
test('polygon fill and outline visit each translucent pixel once', async () => {
  const f = fixture();
  await f.call('draw', {
    ...draw([
      {
        type: 'polygon',
        points: [
          { x: 1, y: 1 },
          { x: 5, y: 1 },
          { x: 1, y: 5 },
        ],
        color: '#ff000080',
      },
    ]),
    blend: 'over',
  });
  const alphas = f.s.project.frames[0].cels[0].filter((_, i) => i % 4 === 3);
  assert.ok(alphas.some((a) => a === 128));
  assert.ok(alphas.every((a) => a === 0 || a === 128));
});
test('action-specific fields are never silently ignored', async () => {
  const f = fixture();
  await assert.rejects(
    f.call('edit_layers', { operations: [{ action: 'add', opacity: 30 }] }),
    (e) => e.code === 'INVALID_INPUT',
  );
  await assert.rejects(
    f.call('edit_frames', { operations: [{ action: 'duplicate', from: 0, duration: 50 }] }),
    (e) => e.code === 'INVALID_INPUT',
  );
  assert.equal(f.s.history.count, 0);
});
test('schema rejects non-finite numbers, unknown keys, invalid payloads and missing revisions', async () => {
  const f = fixture();
  for (const args of [
    draw([dot(1.5)]),
    { ...draw(), ignored: true },
    draw([{ type: 'eval', code: 'alert(1)' }]),
    draw([dot(2, 2, 'red')]),
  ])
    await assert.rejects(f.call('draw', args), (e) => e.code === 'INVALID_INPUT');
  await assert.rejects(f.api.execute('pixel_draw', draw()), (e) => e.code === 'INVALID_INPUT');
  await assert.rejects(
    f.call('create_document', { name: 'x', width: Infinity, height: 1 }),
    /参数无效/,
  );
  assert.equal(f.s.history.count, 0);
});
test('manual revision changes and active gestures reject writes before any change', async () => {
  const f = fixture();
  f.bump();
  await assert.rejects(
    f.call('draw', { ...draw(), expectedRevision: '0' }),
    (e) => e.code === 'STALE_REVISION',
  );
  f.s.busy = '笔画进行中';
  await assert.rejects(f.call('draw', draw()), (e) => e.code === 'EDITOR_BUSY');
  assert.equal((await f.call('get_document')).busy, '笔画进行中');
  assert.equal(f.s.history.count, 0);
});
test('locks, alpha lock and selection have the same pixel semantics as manual painting', async () => {
  const f = fixture();
  f.s.selection = new Uint8Array(256);
  f.s.selection[3 * 16 + 2] = 1;
  await f.call('draw', draw([dot(), dot(4, 3)]));
  assert.equal(pixel(f.s.project, 4, 3)[3], 0);
  f.s.project.layers[0].alphaLock = true;
  await f.call('draw', { ...draw([dot(2, 3, '#0000ff80'), dot(4, 3)]), selection: 'all' });
  assert.deepEqual(pixel(f.s.project, 2, 3), [127, 68, 128, 255]);
  assert.equal(pixel(f.s.project, 4, 3)[3], 0);
  f.s.project.layers[0].locked = true;
  await assert.rejects(f.call('draw', draw()), /锁定/);
});
test('layer and frame batches retain IDs, account capacity, and reject dangling animation sources', async () => {
  const f = fixture();
  await f.call('edit_layers', {
    operations: [
      { action: 'add', name: 'wheel' },
      { action: 'add', name: 'body' },
    ],
  });
  assert.equal(f.s.history.count, 1);
  assert.equal(new Set(f.s.project.layers.map((l) => l.id)).size, 3);
  await f.call('edit_frames', {
    operations: [
      { action: 'duplicate', from: 0 },
      { action: 'duration', from: 0, to: 1, duration: 80 },
    ],
  });
  assert.equal(f.s.project.frames.length, 2);
  assert.equal(f.s.project.frames[1].duration, 80);
  await f.call('draw', draw());
  await f.call('edit_animation', {
    baseFrame: 0,
    objects: [{ action: 'create', name: 'dot', sourceLayers: [0] }],
  });
  const before = serialize(f.s.project);
  await assert.rejects(
    f.call('edit_layers', { operations: [{ action: 'delete', layer: 0 }] }),
    /动画引用/,
  );
  await assert.rejects(
    f.call('edit_frames', { operations: [{ action: 'delete', from: 0 }] }),
    /动画引用/,
  );
  assert.equal(serialize(f.s.project), before);
});
test('source pivots, keys and effects are editable with metadata-only history', async () => {
  const f = fixture();
  await f.call('draw', draw());
  await f.call('edit_animation', {
    settings: { duration: 1, fps: 6 },
    objects: [{ action: 'create', name: 'wheel', sourceLayers: [0], origin: { x: 2, y: 3 } }],
  });
  const o = f.s.project.procedural.objects[0],
    cel = f.s.project.frames[0].cels[0];
  assert.deepEqual(o.path[0], { x: 2, y: 3, in: { x: 2, y: 3 }, out: { x: 2, y: 3 } });
  await f.call('edit_animation', {
    objects: [
      {
        action: 'update',
        id: o.id,
        tracks: {
          rotation: [
            { t: 0, v: 0 },
            { t: 1, v: 360 },
          ],
        },
        clips: [{ type: 'shake', start: 0, end: 1, params: { amplitude: 1 } }],
      },
    ],
  });
  assert.equal(f.s.project.frames[0].cels[0], cel);
  await f.call('history', { direction: 'undo' });
  assert.equal(f.s.project.frames[0].cels[0], cel);
  assert.deepEqual(f.s.project.procedural.objects[0].tracks.rotation, []);
});
async function animated() {
  const f = fixture();
  await f.call('draw', draw());
  await f.call('edit_animation', {
    settings: { duration: 1, fps: 6 },
    objects: [
      {
        action: 'create',
        name: 'dot',
        sourceLayers: [0],
        path: [
          { x: 2.5, y: 3.5 },
          { x: 8.5, y: 3.5 },
        ],
      },
    ],
  });
  return f;
}
test('dry-run does not mutate; baked pixels match every preview sample', async () => {
  const f = await animated(),
    before = serialize(f.s.project),
    count = f.s.history.count;
  const plan = await f.call('bake_animation', { dryRun: true, mode: 'composite' });
  assert.equal(plan.samples, 6);
  assert.equal(serialize(f.s.project), before);
  assert.equal(f.s.history.count, count);
  const p = f.s.project,
    scene = p.procedural,
    c = compileScene(p, scene);
  const result = await f.call('bake_animation', { mode: 'composite' });
  assert.deepEqual(result.frameRange, [1, 6]);
  for (let i = 0; i < 6; i++)
    assert.deepEqual(composite(f.s.project, i + 1), evaluateScene(c, scene, i / 6));
  assert.equal(f.s.history.count, count + 1);
});
for (const kind of ['cancel', 'manual edit'])
  test(`baking aborts atomically after ${kind}`, async () => {
    const f = await animated(),
      before = serialize(f.s.project),
      history = f.s.history.count;
    f.host.activity = (a) => {
      if (a.done === 2) {
        if (kind === 'cancel') f.api.cancel();
        else f.bump();
      }
    };
    await assert.rejects(
      f.call('bake_animation'),
      (e) => e.code === (kind === 'cancel' ? 'CANCELLED' : 'STALE_REVISION'),
    );
    assert.equal(serialize(f.s.project), before);
    assert.equal(f.s.history.count, history);
  });
test('capacity and drawing work budgets fail atomically', async () => {
  const f = fixture(blank(1024, 1024));
  await assert.rejects(
    f.call('edit_layers', { operations: Array.from({ length: 8 }, () => ({ action: 'add' })) }),
    /容量/,
  );
  await assert.rejects(
    f.call(
      'draw',
      draw(
        Array.from({ length: 5 }, () => ({
          type: 'rect',
          x: 0,
          y: 0,
          width: 1024,
          height: 1024,
          fill: false,
          color: '#ffffff',
        })),
      ),
    ),
    /400 万/,
  );
  assert.equal(f.s.project.layers.length, 1);
  assert.equal(f.s.history.count, 0);
});
test('expansion moves source artwork and animation paths together', async () => {
  const f = await animated();
  await f.call('expand_canvas', { left: 4, top: 3 });
  assert.deepEqual(pixel(f.s.project, 6, 6), [255, 136, 0, 255]);
  assert.equal(f.s.project.procedural.objects[0].path[0].x, 6.5);
});
test('pre-aborted invocation does nothing', async () => {
  const f = fixture(),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(
    f.call('draw', draw(), { signal: controller.signal }),
    (e) => e.code === 'CANCELLED',
  );
  assert.equal(f.s.history.count, 0);
});
function context() {
  const tools = new Map();
  return {
    tools,
    async registerTool(tool, { signal }) {
      if (tools.has(tool.name)) throw Error('duplicate');
      tools.set(tool.name, tool);
      signal.addEventListener('abort', () => tools.delete(tool.name), { once: true });
    },
  };
}
test('WebMCP registers schemas, calls the core, and disables stale callbacks', async () => {
  const f = fixture(),
    c = context(),
    states = [],
    adapter = createWebMCP(f.api, c, (s) => states.push(s));
  await adapter.start();
  assert.equal(c.tools.size, 12);
  const drawTool = c.tools.get('pixel_draw');
  const d = await c.tools.get('pixel_get_document').execute({});
  await drawTool.execute({ ...draw(), expectedRevision: d.revision });
  assert.deepEqual(pixel(f.s.project, 2, 3), [255, 136, 0, 255]);
  const error = await drawTool.execute({ ...draw(), expectedRevision: d.revision });
  assert.equal(error.code, 'STALE_REVISION');
  await adapter.stop();
  assert.equal(c.tools.size, 0);
  await assert.rejects(drawTool.execute({ ...draw(), expectedRevision: f.s.revision }), /关闭/);
  await adapter.start();
  assert.equal(c.tools.size, 12);
  await adapter.stop();
});
test('partial registration failure cleans up; unsupported browsers are inert', async () => {
  const f = fixture(),
    c = context(),
    register = c.registerTool,
    states = [];
  c.registerTool = async (t, o) => {
    if (t.name === 'pixel_draw') throw Error('blocked');
    return register(t, o);
  };
  await createWebMCP(f.api, c, (s) => states.push(s)).start();
  assert.equal(c.tools.size, 0);
  assert.equal(states.at(-1).state, 'error');
  assert.equal(modelContext({}, {}), null);
  assert.equal(modelContext({ modelContext: c }, { modelContext: context() }), c);
});
test('rapid overlapping enable/disable requests serialize registration without stale tools', async () => {
  const f = fixture(),
    c = context(),
    adapter = createWebMCP(f.api, c);
  await Promise.all([adapter.start(), adapter.start(), adapter.stop(), adapter.start()]);
  assert.equal(c.tools.size, 12);
  await adapter.stop();
  assert.equal(c.tools.size, 0);
});
