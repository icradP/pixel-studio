import { LIMITS } from './limits.js';
// Leave the system file picker unrestricted. iPadOS may not know the UTI for
// .ase/.aseprite/.pixel, even when a web accept filter names these extensions.
// Validate the selected file here instead of relying on the OS MIME registry.
export async function importKind(file) {
  if (!file.size) throw Error('文件为空，请先在「文件」中完整下载后再导入。');
  if (file.size > LIMITS.importBytes) throw Error('文件超过 60 MiB，请先缩小项目。');
  const head = new Uint8Array(await file.slice(0, 128).arrayBuffer()),
    name = file.name || '';
  if (head.length >= 128 && head[4] === 0xe0 && head[5] === 0xa5) return 'ase';
  if (/\.(ase|aseprite)$/i.test(name)) return 'ase'; // Parser reports corrupt ASEs.
  if ((head[0] === 0x1f && head[1] === 0x8b) || /\.(pixel|json)$/i.test(name)) return 'project';
  const match = (offset, bytes) => bytes.every((v, i) => head[offset + i] === v);
  if (
    match(0, [137, 80, 78, 71, 13, 10, 26, 10]) ||
    match(0, [255, 216, 255]) ||
    (match(0, [82, 73, 70, 70]) && match(8, [87, 69, 66, 80]))
  )
    return 'image';
  if (/^\s*\{/.test(new TextDecoder().decode(head))) return 'project';
  throw Error(
    '请选择 Aseprite（.aseprite / .ase）、画室项目（.pixel / .json），或 PNG、JPEG、WebP 图片。',
  );
}
