// GNU Unifont's native 8/16 × 16 monochrome glyphs; no browser font rasterization.
let loading;
export function parseFont(text) {
  const font = new Map();
  for (const line of text.split('\n')) {
    const [code, hex] = line.trim().split(':');
    if (!/^[0-9A-F]{4,6}$/i.test(code) || !/^(?:[0-9A-F]{32}|[0-9A-F]{64})$/i.test(hex)) continue;
    const width = hex.length / 4;
    font.set(parseInt(code, 16), {
      width,
      rows: Array.from({ length: 16 }, (_, y) =>
        parseInt(hex.slice((y * width) / 4, ((y + 1) * width) / 4), 16),
      ),
    });
  }
  return font;
}
export function loadPixelFont() {
  loading ||= (async () => {
    const response = await fetch(new URL('./fonts/unifont-18.0.01.hex.gz', import.meta.url));
    if (!response.ok) throw Error('点阵字库加载失败，请重试');
    return parseFont(
      await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text(),
    );
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}
export function renderPixelText(
  font,
  text,
  { direction = 'horizontal', spacing = 1, lineGap = 3, color = [255, 255, 255, 255] } = {},
) {
  if (typeof text !== 'string' || !text.trim() || [...text].length > 512)
    throw Error('文字需要 1–512 个字符');
  if (
    !['horizontal', 'vertical'].includes(direction) ||
    !Number.isInteger(spacing) ||
    spacing < 0 ||
    spacing > 32 ||
    !Number.isInteger(lineGap) ||
    lineGap < 0 ||
    lineGap > 64
  )
    throw Error('文字排版设置无效');
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) =>
      [...line].map((c) => font.get(c.codePointAt(0)) || font.get(0xfffd) || font.get(0x3f)),
    );
  if (lines.flat().some((g) => !g)) throw Error('字库缺少所需字符');
  const vertical = direction === 'vertical';
  const width = Math.max(
    1,
    vertical
      ? lines.length * (16 + lineGap) - lineGap
      : Math.max(...lines.map((line) => line.reduce((n, g) => n + g.width + spacing, 0) - spacing)),
  );
  const height = Math.max(
    1,
    vertical
      ? Math.max(...lines.map((line) => line.length * (16 + spacing) - spacing))
      : lines.length * (16 + lineGap) - lineGap,
  );
  if (width > 4096 || height > 4096 || width * height > 1048576)
    throw Error('文字过长，请换行或减少字符');
  const pixels = new Uint8ClampedArray(width * height * 4);
  lines.forEach((line, i) => {
    let cursor = 0;
    line.forEach((g) => {
      const ox = vertical
        ? (lines.length - i - 1) * (16 + lineGap) + Math.floor((16 - g.width) / 2)
        : cursor;
      const oy = vertical ? cursor : i * (16 + lineGap);
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < g.width; x++)
          if (g.rows[y] & (1 << (g.width - x - 1)))
            pixels.set(color, ((oy + y) * width + ox + x) * 4);
      cursor += (vertical ? 16 : g.width) + spacing;
    });
  });
  return { width, height, pixels };
}
