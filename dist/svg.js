import { composite } from './engine.js';
const xml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
  );
// Horizontal runs become vector paths; no embedded raster or tracing approximation.
export function pixelSvg(project, frame = 0) {
  const data = composite(project, frame),
    groups = new Map();
  for (let y = 0; y < project.h; y++)
    for (let x = 0; x < project.w;) {
      const i = (y * project.w + x) * 4;
      if (!data[i + 3]) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < project.w) {
        const j = (y * project.w + end) * 4;
        if (![0, 1, 2, 3].every((k) => data[i + k] === data[j + k])) break;
        end++;
      }
      const key = Array.from(data.subarray(i, i + 4)).join(',');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(`M${x} ${y}h${end - x}v1H${x}z`);
      x = end;
    }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${project.w}" height="${project.h}" viewBox="0 0 ${project.w} ${project.h}" shape-rendering="crispEdges"><title>${xml(project.name)}</title><desc>Pixel Studio: current frame, visible layers composited into vector pixel shapes.</desc>${[
    ...groups,
  ]
    .map(([key, runs]) => {
      const [r, g, b, a] = key.split(',').map(Number),
        hex = [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
      return `<path fill="#${hex}"${a < 255 ? ` fill-opacity="${(a / 255).toFixed(6)}"` : ''} d="${runs.join('')}"/>`;
    })
    .join('')}</svg>`;
}
