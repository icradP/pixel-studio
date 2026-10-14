import { PLANE_BYTES } from './pixel-budget.js';
// Bounded byte dictionary codec: literal runs followed by 16-bit backward matches.
// Token high nibble = literal length, low nibble = match length minus 4.
// A nibble of 15 is extended by bytes (255 continues). No external dictionary.
export function packBytes(input) {
  const out = new Uint8Array(input.length + Math.ceil(input.length / 255) + 32),
    table = new Int32Array(65536).fill(-1);
  let i = 0,
    anchor = 0,
    at = 0;
  const hash = (p) =>
    Math.imul(
      input[p] | (input[p + 1] << 8) | (input[p + 2] << 16) | (input[p + 3] << 24),
      0x9e3779b1,
    ) >>> 16;
  const extra = (n) => {
    while (n >= 255) {
      out[at++] = 255;
      n -= 255;
    }
    out[at++] = n;
  };
  while (i + 4 <= input.length) {
    const h = hash(i),
      ref = table[h];
    table[h] = i;
    if (
      ref < 0 ||
      i - ref > 65535 ||
      input[ref] !== input[i] ||
      input[ref + 1] !== input[i + 1] ||
      input[ref + 2] !== input[i + 2] ||
      input[ref + 3] !== input[i + 3]
    ) {
      i++;
      continue;
    }
    let end = i + 4;
    while (end < input.length && input[ref + end - i] === input[end]) end++;
    const literals = i - anchor,
      match = end - i - 4;
    out[at++] = (Math.min(literals, 15) << 4) | Math.min(match, 15);
    if (literals >= 15) extra(literals - 15);
    out.set(input.subarray(anchor, i), at);
    at += literals;
    const distance = i - ref;
    out[at++] = distance & 255;
    out[at++] = distance >>> 8;
    if (match >= 15) extra(match - 15);
    i = end;
    anchor = i;
    if (i >= 2 && i + 2 < input.length) table[hash(i - 2)] = i - 2;
  }
  const literals = input.length - anchor;
  out[at++] = Math.min(literals, 15) << 4;
  if (literals >= 15) extra(literals - 15);
  out.set(input.subarray(anchor), at);
  at += literals;
  return out.slice(0, at);
}
export function unpackBytes(input, length) {
  if (!Number.isInteger(length) || length < 0 || length > PLANE_BYTES + 4096)
    throw Error('字典解码长度无效');
  const out = new Uint8Array(length);
  let i = 0,
    at = 0;
  const size = (n) => {
    if (n !== 15) return n;
    let b;
    do {
      if (i >= input.length) throw Error('字典数据不完整');
      b = input[i++];
      n += b;
      if (n > length) throw Error('字典长度超限');
    } while (b === 255);
    return n;
  };
  while (i < input.length) {
    const token = input[i++],
      literals = size(token >>> 4);
    if (i + literals > input.length || at + literals > length) throw Error('字典数据超限');
    out.set(input.subarray(i, i + literals), at);
    i += literals;
    at += literals;
    if (i === input.length) break;
    if (i + 2 > input.length) throw Error('字典距离不完整');
    const distance = input[i++] | (input[i++] << 8),
      match = size(token & 15) + 4;
    if (!distance || distance > at || at + match > length) throw Error('字典参考无效');
    for (let j = 0; j < match; j++) out[at + j] = out[at + j - distance];
    at += match;
  }
  if (at !== length) throw Error('字典像素数据不完整');
  return out;
}
