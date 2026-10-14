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
export const point = object(
  {
    x: number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    y: number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
  },
  ['x', 'y'],
);
const pixelPoint = object(
  { x: integer(0, Number.MAX_SAFE_INTEGER), y: integer(0, Number.MAX_SAFE_INTEGER) },
  ['x', 'y'],
);
const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$' };
const index = integer(0, 239),
  layer = integer(0, Number.MAX_SAFE_INTEGER);
const revision = string(240);
const bounds = {
  x: integer(0, Number.MAX_SAFE_INTEGER),
  y: integer(0, Number.MAX_SAFE_INTEGER),
  width: integer(1, Number.MAX_SAFE_INTEGER),
  height: integer(1, Number.MAX_SAFE_INTEGER),
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
    type: choice(
      'rotate',
      'stretch',
      'squash',
      'fade',
      'shake',
      'fadeIn',
      'fadeOut',
      'hide',
      'blink',
      'rainbow',
      'tint',
    ),
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
      color,
      colorTo: color,
      cycles: number(0, 20),
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
    'Create and open a blank document. Saves the previous work in the local gallery first; does not overwrite it. No fixed dimension or layer count cap; canvas area and actual storage are checked against memory budgets.',
    change(
      {
        name: string(),
        width: integer(1, Number.MAX_SAFE_INTEGER),
        height: integer(1, Number.MAX_SAFE_INTEGER),
      },
      ['name', 'width', 'height'],
    ),
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
              parent: integer(-1, Number.MAX_SAFE_INTEGER),
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
    'add_text',
    '添加像素文字',
    'Add native 16px bitmap text (Chinese/Japanese/English) as a new pixel layer. x/y are canvas pixels; size controls font height; direction horizontal or vertical. Optional quad contains four convex corners TL,TR,BR,BL for perspective and overrides position/scale/rotation. Preserves existing pixels and supports undo.',
    change(
      {
        frame: index,
        text: string(512),
        x: number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        y: number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        size: number(4, 128),
        direction: choice('horizontal', 'vertical'),
        spacing: integer(0, 32),
        color,
        scaleX: number(0.05, 20),
        scaleY: number(0.05, 20),
        rotation: number(-360, 360),
        flipX: boolean,
        flipY: boolean,
        quad: array(point, 4, 4),
      },
      ['frame', 'text', 'x', 'y', 'color'],
    ),
  ),
  tool(
    'add_outline',
    '添加像素描边',
    'Outline opaque pixels in a layer or current selection. Creates an independent pixel layer as one undo step. Width 1..32px; inside/outside/center. Respects source layer locks; selection=current requires the active cel.',
    change(
      {
        frame: index,
        layer,
        width: integer(1, 32),
        position: choice('inside', 'outside', 'center'),
        color,
        selection: choice('current', 'all'),
      },
      ['frame', 'layer', 'color'],
    ),
  ),
  tool(
    'transform',
    '变换选区或图层',
    'Move, resize, rotate, mirror or perspective-warp pixels as one undo step using nearest-neighbor sampling. selection=current (default) uses the active selection, or opaque layer bounds when no selection exists; all uses opaque layer bounds. Optional region explicitly chooses a rectangle instead. x/y are the unrotated destination top-left; rotation is degrees around its center. Optional convex quad TL,TR,BR,BL overrides x/y/width/height/rotation. copy=true retains the source on the same layer. newLayer=true copies the selected current-frame pixels into a new layer and focuses it; source pixels and other frames remain unchanged, copy is ignored, masks/adjustments are baked into the copy. Without transform fields the copy stays at its original position. Pixels outside the canvas are clipped. Rejects locked layers; alpha lock only blocks in-place transforms.',
    change(
      {
        frame: index,
        layer,
        selection: choice('current', 'all'),
        region: object(bounds, Object.keys(bounds)),
        x: number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        y: number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        width: number(1, Number.MAX_SAFE_INTEGER),
        height: number(1, Number.MAX_SAFE_INTEGER),
        rotation: number(-36000, 36000),
        flipX: boolean,
        flipY: boolean,
        copy: boolean,
        newLayer: boolean,
        quad: array(point, 4, 4),
      },
      ['frame', 'layer'],
    ),
  ),
  tool(
    'expand_canvas',
    '扩展画布',
    'Expand in four directions without resampling; shifts animation paths and masks with the artwork. Each margin is integer pixels.',
    change({
      left: integer(0, Number.MAX_SAFE_INTEGER),
      right: integer(0, Number.MAX_SAFE_INTEGER),
      top: integer(0, Number.MAX_SAFE_INTEGER),
      bottom: integer(0, Number.MAX_SAFE_INTEGER),
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
      lights: array(
        object(
          {
            id: string(100),
            name: string(80),
            enabled: boolean,
            x: number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
            y: number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
            radius: number(1, 2048),
            intensity: number(0, 4),
            color,
            colorTo: color,
            start: number(0, 60),
            end: number(0.001, 60),
            pulse: number(0, 1),
            frequency: number(0, 20),
            phase: number(-100, 100),
            colorCycle: boolean,
            path,
            keys: keys(0, 4),
            intensityKeys: keys(0, 4),
            radiusKeys: keys(1, 2048),
            positionKeys: array(
              object({ t: number(0, 60), x: number(-16384, 16384), y: number(-16384, 16384) }, [
                't',
                'x',
                'y',
              ]),
              128,
            ),
            coverage: choice('radial', 'global'),
            area: object({ x: integer(0), y: integer(0), w: integer(1), h: integer(1) }, [
              'x',
              'y',
              'w',
              'h',
            ]),
            targets: array(string(100), 32),
          },
          ['id', 'name', 'enabled', 'x', 'y', 'radius', 'intensity', 'color', 'start', 'end'],
        ),
        8,
      ),
      objects: array(
        object(
          {
            action: choice('create', 'update', 'delete'),
            id: string(100),
            name: string(80),
            sourceLayers: array(layer, Number.MAX_SAFE_INTEGER, 1),
            region: object(bounds, Object.keys(bounds)),
            origin: point,
            path,
            progress: curve,
            motion,
            tracks,
            appearance: object(
              {
                start: number(0, 60),
                end: number(0.001, 60),
                fadeIn: number(0, 60),
                fadeOut: number(0, 60),
              },
              ['start', 'end', 'fadeIn', 'fadeOut'],
            ),
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
    'Bake the procedural scene into editable frames/layers. Optional frameCount OR fps overrides output sampling while preserving the scene duration and source settings. dryRun returns a capacity plan; compact byte counts are estimates. Actual baking is cancellable and commits one undo step only if the revision still matches. Default creates a new group; replace=true replaces only compatible previous bake output. Sampling excludes the end point for seamless loops.',
    change({
      mode: choice('objects', 'composite'),
      objectIds: array(string(100), 32, 1),
      frameCount: integer(1, 240),
      fps: number(0.01, 50),
      replace: boolean,
      dryRun: boolean,
    }),
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
    'Download an editable .pixel document, PNG frame, animated GIF or PNG sprite sheet. from/to are inclusive frame indices; defaults to current frame for PNG, all frames for GIF/sheet. For baked animation use the returned bake frame range to exclude source frames. Optional gif settings: maxEdge (no upscaling), colors (16/32/64/128/256), fps (0 preserves source; otherwise caps sampling without changing duration). GIF uses LZW, duplicate frame merging and changed-region compression; export is cancellable and limited to 64 MiB. Returns filename/byte count, not the whole project in the chat.',
    change(
      {
        format: choice('pixel', 'png', 'gif', 'sheet'),
        from: index,
        to: index,
        gif: object({
          maxEdge: integer(1, 65535),
          colors: { type: 'integer', enum: [16, 32, 64, 128, 256] },
          fps: number(0, 50),
        }),
      },
      ['format'],
    ),
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
