import { serialize, deserialize } from './engine.js';
import { LIMITS } from './limits.js';
export async function encodeProjectFile(project) {
  const source = new Blob([serialize(project)], { type: 'application/json' });
  return new Response(source.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}
export async function decodeProjectFile(file) {
  if (file.size > LIMITS.projectFileBytes) throw Error('项目文件超过 384 MiB');
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x1f || head[1] !== 0x8b) return deserialize(await file.text());
  const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > LIMITS.projectFileBytes) {
        await reader.cancel();
        throw Error('解压后的项目超过 384 MiB');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return deserialize(await new Blob(chunks).text());
}
