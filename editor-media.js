import { encodeProjectFile } from './project-file.js';
import { composite } from './engine.js';
import { compileScene, evaluateScene } from './procedural.js';
import { LIMITS } from './limits.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function frameCanvas(p, pixels) {
  const c = canvas(p.w, p.h);
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), p.w, p.h), 0, 0);
  return c;
}
const png = (c) =>
  new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(Error('图片生成失败'))), 'image/png'),
  );
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
export async function preview(p, args, host, check) {
  if (args.frames && args.times) throw Error('请选择帧预览或程序化时间预览');
  if (args.times && !p.procedural) throw Error('作品还没有程序化动画');
  const samples = args.times || args.frames || [host.snapshot().frame],
    times = !!args.times,
    columns = Math.min(4, samples.length),
    rows = Math.ceil(samples.length / columns);
  const scale = Math.min(
    (args.maxEdge || 256) / Math.max(p.w, p.h),
    Math.sqrt(262144 / (columns * rows * p.w * p.h)),
  );
  const w = Math.max(1, Math.floor(p.w * scale)),
    h = Math.max(1, Math.floor(p.h * scale)),
    label = samples.length > 1 ? 20 : 0;
  const output = canvas(w * columns, (h + label) * rows),
    ctx = output.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const scene = times ? structuredClone(p.procedural) : null,
    compiled = times ? compileScene(p, scene) : null;
  for (let i = 0; i < samples.length; i++) {
    check();
    const value = samples[i];
    if (times ? value > scene.duration : !p.frames[value]) throw Error('预览时间或帧超出作品范围');
    const pixels = times ? evaluateScene(compiled, scene, value) : composite(p, value);
    ctx.drawImage(
      frameCanvas(p, pixels),
      (i % columns) * w,
      Math.floor(i / columns) * (h + label),
      w,
      h,
    );
    if (label) {
      ctx.fillStyle = '#202125';
      ctx.fillRect((i % columns) * w, Math.floor(i / columns) * (h + label) + h, w, label);
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px sans-serif';
      ctx.fillText(
        times ? `${value.toFixed(3)} s` : `Frame ${value}`,
        (i % columns) * w + 4,
        Math.floor(i / columns) * (h + label) + h + 14,
      );
    }
    await tick();
  }
  check();
  const dataUrl = output.toDataURL('image/png'),
    metadata = {
      revision: args.expectedRevision,
      width: output.width,
      height: output.height,
      sourceWidth: p.w,
      sourceHeight: p.h,
      samples,
      mode: times ? 'animation' : 'frames',
    };
  host.showPreview?.(output, metadata);
  return {
    ...metadata,
    content: [
      { type: 'text', text: JSON.stringify(metadata) },
      { type: 'image', mimeType: 'image/png', data: dataUrl.slice(dataUrl.indexOf(',') + 1) },
    ],
  };
}
export async function exportDocument(p, args, host, check) {
  let blob, extension;
  if (args.gif && args.format !== 'gif') throw Error('GIF 参数仅用于 GIF 导出');
  if (args.format === 'pixel') {
    blob = await encodeProjectFile(p);
    check();
    extension = '.pixel';
  } else {
    const from = args.from ?? (args.format === 'png' ? host.snapshot().frame : 0),
      to = args.to ?? (args.format === 'png' ? from : p.frames.length - 1);
    if (!p.frames[from] || !p.frames[to] || to < from || (args.format === 'png' && from !== to))
      throw Error('导出帧范围无效');
    if (args.format === 'gif') {
      const { encodeGifAsync } = await import('./gif.js');
      check();
      blob = new Blob([await encodeGifAsync(p, { ...args.gif, from, to }, { check })], {
        type: 'image/gif',
      });
      extension = '.gif';
    } else {
      if (p.w * p.h * (to - from + 1) > LIMITS.exportPixels)
        throw Error('导出超过 64 MiB 像素预算');
      const count = to - from + 1;
      if (p.w * count > 16384) throw Error('精灵图宽度超过 16384，请减少帧数');
      const output = canvas(p.w * count, p.h),
        ctx = output.getContext('2d');
      for (let f = from; f <= to; f++) {
        check();
        ctx.drawImage(frameCanvas(p, composite(p, f)), (f - from) * p.w, 0);
        await tick();
      }
      blob = await png(output);
      extension = args.format === 'sheet' ? '-sheet.png' : '.png';
    }
  }
  check();
  const filename = `${[...p.name].map((c) => (c.charCodeAt(0) < 32 || /[\\/:*?"<>|]/.test(c) ? '_' : c)).join('') || '作品'}${extension}`;
  host.download(blob, filename);
  return {
    filename,
    bytes: blob.size,
    mimeType: blob.type,
    exportedRevision: args.expectedRevision,
  };
}
