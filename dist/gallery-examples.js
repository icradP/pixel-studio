import { deserialize } from './engine.js';

// Decode only when opened; the gallery itself uses the small static cover.
export async function loadPelicanExample(signal) {
  if (typeof DecompressionStream === 'undefined')
    throw Error('当前浏览器不支持解压示例，请更新浏览器后重试。');
  const response = await fetch(new URL('./examples/pelican-cycling.pixel.gz', import.meta.url), {
    signal,
  });
  if (!response.ok || !response.body) throw Error('示例下载失败，请联网后重试。');
  const text = await new Response(
    response.body.pipeThrough(new DecompressionStream('gzip')),
  ).text();
  signal?.throwIfAborted();
  return deserialize(text);
}
