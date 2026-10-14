// Shared schemas are used by the command API and WebMCP. Never rely on the client to validate.
export const object = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
export const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
export const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
export const string = (maxLength = 160) => ({ type: 'string', minLength: 1, maxLength });
export const boolean = { type: 'boolean' };
export const choice = (...values) => ({ type: 'string', enum: values });
export const array = (items, maxItems, minItems = 0) => ({
  type: 'array',
  items,
  minItems,
  maxItems,
});
export const point = object({ x: number(-16384, 16384), y: number(-16384, 16384) }, ['x', 'y']);
const pixelPoint = object({ x: integer(0, 1023), y: integer(0, 1023) }, ['x', 'y']);
const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$' };
const index = integer(0, 239),
  layer = integer(0, 31);
const revision = string(240);
const bounds = {
  x: integer(0, 1023),
  y: integer(0, 1023),
  width: integer(1, 1024),
  height: integer(1, 1024),
};
const keys = (min, max, time = 60) =>
  array(object({ t: number(0, time), v: number(min, max) }, ['t', 'v']), 128);
const curve = keys(0, 1, 1);
const path = array(object({ ...point.properties, in: point, out: point }, ['x', 'y']), 64, 1);
const tracks = object({
  rotation: keys(-36000, 36000),
  scaleX: keys(0.05, 20),
  scaleY: keys(0.05, 20),
  opacity: keys(0, 1),
});
const motion = object({
  start: number(0, 60),
  end: number(0.001, 60),
  repeat: integer(1, 20),
  orient: boolean,
});
const clip = object(
  {
    type: choice('rotate', 'stretch', 'squash', 'fade', 'shake'),
    start: number(0, 60),
    end: number(0.001, 60),
    enabled: boolean,
    intensity: number(0, 2),
    curve,
    params: object({
      angle: number(-3600, 3600),
      x: number(0.05, 4),
      y: number(0.05, 4),
      opacity: number(0, 1),
      amplitude: number(0, 256),
      frequency: number(0, 50),
    }),
  },
  ['type', 'start', 'end'],
);
const drawing = {
  oneOf: [
    object({ type: { const: 'pixel' }, x: bounds.x, y: bounds.y, color }, [
      'type',
      'x',
      'y',
      'color',
    ]),
    object({ type: { const: 'line' }, from: pixelPoint, to: pixelPoint, color }, [
      'type',
      'from',
      'to',
      'color',
    ]),
    object({ type: choice('rect', 'ellipse'), ...bounds, fill: boolean, color }, [
      'type',
      ...Object.keys(bounds),
      'color',
    ]),
    object(
      { type: { const: 'polygon' }, points: array(pixelPoint, 128, 3), fill: boolean, color },
      ['type', 'points', 'color'],
    ),
    object(
      {
        type: { const: 'patch' },
        ...bounds,
        palette: array(color, 256, 1),
        indices: array(integer(0, 255), 262144, 1),
      },
      ['type', ...Object.keys(bounds), 'palette', 'indices'],
    ),
  ],
};
const tool = (name, title, description, inputSchema, readOnly = false) => ({
  name: `pixel_${name}`,
  title,
  description,
  inputSchema,
  readOnly,
});
const change = (properties, required = []) =>
  object({ expectedRevision: revision, ...properties }, ['expectedRevision', ...required]);
export const EDITOR_TOOLS = [
  tool(
    'get_document',
    '读取当前作品',
    'Read current Pixel Studio document, revision, zero-based layer/frame indices, selection, limits, history and editable animation metadata. Read before writing; do not reuse an old revision after any edit. Coordinates are source pixels, independent of view zoom/rotation/mirror. Layer order is bottom to top within groups.',
    object({}),
    true,
  ),
  tool(
    'create_document',
    '创建作品',
    'Create and open a blank document. Saves the previous work in the local gallery first; does not overwrite it. Dimensions up to 1024, subject to total pixel budget.',
    change({ name: string(), width: integer(1, 1024), height: integer(1, 1024) }, [
      'name',
      'width',
      'height',
    ]),
  ),
  tool(
    'edit_layers',
    '编辑图层',
    'Apply ordered layer operations as one undo step. Indices refer to the evolving list after each operation. New layers default to the root; parent must be a group. Locked layers cannot be changed except unlocking them. Deleting animation sources is rejected.',
    change(
      {
        operations: array(
          object(
            {
              action: choice('add', 'update', 'duplicate', 'move', 'delete'),
              layer,
              parent: integer(-1, 31),
              group: boolean,
              name: string(),
              visible: boolean,
              locked: boolean,
              alphaLock: boolean,
              opacity: integer(0, 255),
            },
            ['action'],
          ),
          32,
          1,
        ),
      },
      ['operations'],
    ),
  ),
  tool(
    'edit_frames',
    '编辑动画帧',
    'Apply ordered blank/duplicate/delete/move/duration frame operations as one undo step. from/to are inclusive zero-based indices, duration is milliseconds. Blank/duplicate insert after to. Deleting animation sources is rejected.',
    change(
      {
        operations: array(
          object(
            {
              action: choice('blank', 'duplicate', 'delete', 'move', 'duration'),
              from: index,
              to: index,
              destination: index,
              duration: integer(20, 10000),
            },
            ['action', 'from'],
          ),
          64,
          1,
        ),
      },
      ['operations'],
    ),
  ),
  tool(
    'draw',
    '批量绘制像素',
    'Draw a batch on one pixel cel as one undo step. Colors are #RRGGBB or #RRGGBBAA; default replace writes exact RGBA (transparent clears), over uses source-over. Respects layer/parent locks and alpha lock. selection=current (default) respects the current selection and requires targeting the active cel; all explicitly ignores it. Shapes use integer source pixels; rectangles/ellipses use an inclusive bounding box of width×height; fill defaults true. Palette patches contain row-major indices, exactly width×height. Send batches, not one tool call per pixel. Layer masks remain unchanged.',
    change(
      {
        frame: index,
        layer,
        blend: choice('replace', 'over'),
        selection: choice('current', 'all'),
        commands: array(drawing, 256, 1),
      },
      ['frame', 'layer', 'commands'],
    ),
  ),
  tool(
    'expand_canvas',
    '扩展画布',
    'Expand in four directions without resampling; shifts animation paths and masks with the artwork. Each margin is integer pixels.',
    change({
      left: integer(0, 1024),
      right: integer(0, 1024),
      top: integer(0, 1024),
      bottom: integer(0, 1024),
    }),
  ),
  tool(
    'edit_animation',
    '编辑程序化动画',
    'Create/update the procedural scene and ordered object edits as one undo step. New scenes use baseFrame (default active frame). Object sourceLayers are zero-based indices; optional region is a pixel rectangle. Objects render in listed order over the residual background. origin is the rotation/scale pivot in source pixels; path positions are pivot destinations. rotation keys use degrees, scale uses factors, opacity 0..1, t/start/end use seconds. Progress and clip curves use normalized t/v 0..1 and require endpoints t=0 and t=1. Unspecified fields are retained. Read the scene after creation to obtain object IDs. No bones/IK are provided.',
    change({
      baseFrame: index,
      settings: object({
        name: string(),
        duration: number(0.1, 60),
        fps: integer(1, 50),
        loop: boolean,
        range: array(number(0, 60), 2, 2),
      }),
      objects: array(
        object(
          {
            action: choice('create', 'update', 'delete'),
            id: string(100),
            name: string(80),
            sourceLayers: array(layer, 32, 1),
            region: object(bounds, Object.keys(bounds)),
            origin: point,
            path,
            progress: curve,
            motion,
            tracks,
            clips: array(clip, 64),
            visible: boolean,
            enabled: boolean,
            locked: boolean,
          },
          ['action'],
        ),
        32,
      ),
    }),
  ),
  tool(
    'preview',
    '查看渲染预览',
    'Render a PNG/contact sheet of frames or procedural times (seconds), up to 16 samples. Returns image content and exact sample metadata. Also shows a preview window for visual inspection/screenshot in clients that treat tool images as text. Does not change artwork. maxEdge is per-cell maximum before the total preview budget applies.',
    object(
      {
        expectedRevision: revision,
        frames: array(index, 16, 1),
        times: array(number(0, 60), 16, 1),
        maxEdge: integer(16, 512),
      },
      ['expectedRevision'],
    ),
    true,
  ),
  tool(
    'bake_animation',
    '烘焙动画',
    'Bake the procedural scene into editable frames/layers. dryRun returns exact capacity requirements without editing. Actual baking is cancellable and commits one undo step only if the revision still matches. Default creates a new group; replace=true replaces only compatible previous bake output. Sampling excludes the end point for seamless loops.',
    change({ mode: choice('objects', 'composite'), replace: boolean, dryRun: boolean }),
  ),
  tool(
    'history',
    '撤销或重做',
    'Undo or redo one project edit using the same history as the interface. Selection-only editing must be finished first.',
    change({ direction: choice('undo', 'redo') }, ['direction']),
  ),
  tool(
    'save',
    '保存作品',
    'Save the current document in the local device gallery and report whether it succeeded.',
    change({}),
  ),
  tool(
    'export',
    '导出作品',
    'Download an editable .pixel document, PNG frame, animated GIF or PNG sprite sheet. from/to are inclusive frame indices; defaults to current frame for PNG, all frames for GIF/sheet. For baked animation use the returned bake frame range to exclude source frames. Output obeys export memory limits. Returns filename/byte count, not the whole project in the chat.',
    change({ format: choice('pixel', 'png', 'gif', 'sheet'), from: index, to: index }, ['format']),
  ),
];

export function validateInput(value, schema, path = 'input') {
  const fail = () => {
    throw Object.assign(Error(`参数无效：${path}`), { code: 'INVALID_INPUT' });
  };
  if (schema.oneOf) {
    let matches = 0;
    for (const option of schema.oneOf) {
      try {
        validateInput(value, option, path);
        matches++;
      } catch {}
    }
    if (matches !== 1) fail();
    return;
  }
  if ('const' in schema && value !== schema.const) fail();
  if (schema.enum && !schema.enum.includes(value)) fail();
  if (schema.type === 'object') {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      fail();
    for (const k of schema.required || []) if (!Object.hasOwn(value, k)) fail();
    for (const k of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, k)) fail();
      validateInput(value[k], schema.properties[k], `${path}.${k}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems)
      fail();
    for (let i = 0; i < value.length; i++) validateInput(value[i], schema.items, `${path}[${i}]`);
  } else if (schema.type === 'string') {
    if (
      typeof value !== 'string' ||
      value.length < (schema.minLength || 0) ||
      value.length > (schema.maxLength || 160) ||
      (schema.pattern && !new RegExp(schema.pattern).test(value))
    )
      fail();
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') fail();
  } else if (['number', 'integer'].includes(schema.type)) {
    if (
      !Number.isFinite(value) ||
      (schema.type === 'integer' && !Number.isInteger(value)) ||
      value < schema.minimum ||
      value > schema.maximum
    )
      fail();
  }
}
