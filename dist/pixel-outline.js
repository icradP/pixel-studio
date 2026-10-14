// Two-pass chessboard distance transform: work is O(canvas pixels), independent of stroke width.
export function outlinePixels(
  pixels,
  w,
  h,
  { mask = null, width = 1, position = 'outside', color = [255, 255, 255, 255] } = {},
) {
  if (
    !Number.isInteger(width) ||
    width < 1 ||
    width > 32 ||
    !['inside', 'outside', 'center'].includes(position)
  )
    throw Error('描边宽度为 1–32 像素');
  if (mask && mask.length !== w * h) throw Error('选区尺寸无效');
  const shape = Uint8Array.from({ length: w * h }, (_, i) =>
    pixels[i * 4 + 3] > 0 && (!mask || mask[i]) ? 1 : 0,
  );
  if (!shape.some(Boolean)) throw Error('当前图层或选区没有可描边的像素');
  function distance(toInside) {
    const d = new Uint16Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        d[i] =
          shape[i] === toInside
            ? 0
            : !toInside && (x === 0 || y === 0 || x === w - 1 || y === h - 1)
              ? 1
              : 2048;
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let n = d[i];
        if (x) n = Math.min(n, d[i - 1] + 1);
        if (y) {
          n = Math.min(n, d[i - w] + 1);
          if (x) n = Math.min(n, d[i - w - 1] + 1);
          if (x < w - 1) n = Math.min(n, d[i - w + 1] + 1);
        }
        d[i] = n;
      }
    for (let y = h - 1; y >= 0; y--)
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        let n = d[i];
        if (x < w - 1) n = Math.min(n, d[i + 1] + 1);
        if (y < h - 1) {
          n = Math.min(n, d[i + w] + 1);
          if (x) n = Math.min(n, d[i + w - 1] + 1);
          if (x < w - 1) n = Math.min(n, d[i + w + 1] + 1);
        }
        d[i] = n;
      }
    return d;
  }
  const outer = position === 'inside' ? null : distance(1),
    inner = position === 'outside' ? null : distance(0),
    out = new Uint8ClampedArray(w * h * 4);
  const ow = position === 'center' ? Math.ceil(width / 2) : width,
    iw = position === 'center' ? Math.floor(width / 2) : width;
  for (let i = 0; i < w * h; i++)
    if ((!shape[i] && outer && outer[i] <= ow) || (shape[i] && inner && inner[i] <= iw))
      out.set(color, i * 4);
  return out;
}
