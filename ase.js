import { readCel } from './cel-storage.js';
import { prepareAse } from './layer-effects.js';
import { blank, validate, MAX_PIXELS } from './engine.js';
class Reader {
  constructor(buffer) {
    this.v = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
    this.p = 0;
  }
  need(n) {
    if (this.p + n > this.bytes.length) throw Error('Aseprite 文件不完整');
  }
  u8() {
    this.need(1);
    return this.v.getUint8(this.p++);
  }
  u16() {
    this.need(2);
    const x = this.v.getUint16(this.p, true);
    this.p += 2;
    return x;
  }
  i16() {
    this.need(2);
    const x = this.v.getInt16(this.p, true);
    this.p += 2;
    return x;
  }
  u32() {
    this.need(4);
    const x = this.v.getUint32(this.p, true);
    this.p += 4;
    return x;
  }
  skip(n) {
    this.need(n);
    this.p += n;
  }
  string() {
    const n = this.u16();
    this.need(n);
    const s = new TextDecoder().decode(this.bytes.subarray(this.p, this.p + n));
    this.p += n;
    return s;
  }
}
export async function readAse(buffer) {
  const r = new Reader(buffer),
    size = r.u32();
  if (size !== buffer.byteLength || r.u16() !== 0xa5e0) throw Error('不是有效的 Aseprite 文件');
  const count = r.u16(),
    w = r.u16(),
    h = r.u16(),
    depth = r.u16(),
    flags = r.u32();
  if (
    ![8, 16, 32].includes(depth) ||
    w < 1 ||
    h < 1 ||
    count < 1 ||
    count > 240 ||
    w * h * count > MAX_PIXELS
  )
    throw Error('Aseprite 尺寸或格式超出支持范围');
  r.skip(10);
  const transparent = r.u8();
  r.p = 128;
  const p = blank(w, h, '导入的 Aseprite');
  p.layers = [];
  p.frames = [];
  const rawFrames = [];
  let tagUserIndex = -1;
  const palette = Array.from({ length: 256 }, (_, i) => [i, i, i, 255]),
    links = [],
    warnings = new Set();
  for (let f = 0; f < count; f++) {
    const begin = r.p,
      bytes = r.u32();
    if (bytes < 16 || begin + bytes > size || r.u16() !== 0xf1fa) throw Error('动画帧数据损坏');
    const old = r.u16(),
      duration = r.u16();
    r.skip(2);
    const chunks = r.u32() || old,
      raw = [];
    for (let c = 0; c < chunks; c++) {
      const cb = r.p,
        cs = r.u32(),
        type = r.u16();
      if (cs < 6 || cb + cs > begin + bytes) throw Error('数据块损坏');
      if (type === 0x2004) {
        const lf = r.u16(),
          lt = r.u16(),
          level = r.u16();
        r.skip(4);
        const blend = r.u16(),
          opacity = r.u8();
        r.skip(3);
        const name = r.string();
        if (![0, 1].includes(lt) || blend > 18 || lf & 64)
          throw Error('暂不支持瓦片、参考图层或未知混合模式，请先转换为普通图层。');
        p.layers.push({
          name,
          ...(blend ? { blend } : {}),
          visible: !!(lf & 1),
          opacity: (lt === 1 ? flags & 2 : flags & 1) ? opacity : 255,
          background: !!(lf & 8),
          ...(lt === 1 ? { group: true, isolated: !!(flags & 2) } : {}),
          ...(level ? { level } : {}),
          ...(lf & 32 ? { collapsed: true } : {}),
          ...(!(lf & 2) ? { locked: true } : {}),
        });
        if (w * h * count * p.layers.length > MAX_PIXELS) throw Error('项目像素总量超出限制');
      } else if (type === 0x2019) {
        const n = r.u32(),
          first = r.u32(),
          last = r.u32();
        r.skip(8);
        if (n > 65536 || last >= n) throw Error('调色板数据无效');
        for (let i = first; i <= last; i++) {
          const ef = r.u16(),
            color = [r.u8(), r.u8(), r.u8(), r.u8()];
          palette[i] = color;
          if (ef & 1) r.string();
        }
      } else if (type === 4 || type === 0x11) {
        const packets = r.u16();
        let idx = 0;
        for (let k = 0; k < packets; k++) {
          idx += r.u8();
          const n = r.u8() || 256;
          for (let i = 0; i < n; i++) {
            const scale = type === 0x11 ? 255 / 63 : 1;
            palette[idx++] = [
              Math.round(r.u8() * scale),
              Math.round(r.u8() * scale),
              Math.round(r.u8() * scale),
              255,
            ];
          }
        }
      } else if (type === 0x2005) {
        const layer = r.u16(),
          x = r.i16(),
          y = r.i16(),
          opacity = r.u8(),
          ct = r.u16(),
          z = r.i16();
        r.skip(5);
        if (z !== 0) throw Error('暂不支持带 Z 顺序偏移的动画单元');
        if (ct === 1) {
          links.push({ f, layer, to: r.u16(), x, y, opacity });
        } else if (ct === 0 || ct === 2) {
          const cw = r.u16(),
            ch = r.u16(),
            expected = cw * ch * (depth / 8);
          if (!cw || !ch || cw * ch > MAX_PIXELS) throw Error('图像单元过大');
          let pixels = r.bytes.slice(r.p, cb + cs);
          if (ct === 2) {
            if (typeof DecompressionStream === 'undefined')
              throw Error('此浏览器不支持压缩 Aseprite 导入，请升级 Safari');
            const reader = new Blob([pixels])
                .stream()
                .pipeThrough(new DecompressionStream('deflate'))
                .getReader(),
              parts = [];
            let length = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              length += value.length;
              if (length > expected) {
                await reader.cancel();
                throw Error('压缩图像大小异常');
              }
              parts.push(value);
            }
            pixels = new Uint8Array(length);
            let o = 0;
            parts.forEach((b) => {
              pixels.set(b, o);
              o += b.length;
            });
          }
          if (pixels.length !== expected) throw Error('像素数据长度不正确');
          raw.push({ layer, x, y, opacity, cw, ch, pixels });
        } else throw Error('当前不支持瓦片动画单元');
      } else if (type === 0x2018) {
        const n = r.u16();
        if (n > 1024) throw Error('动画标签过多');
        r.skip(8);
        p.tags = [];
        for (let i = 0; i < n; i++) {
          const from = r.u16(),
            to = r.u16(),
            direction = r.u8(),
            repeat = r.u16();
          r.skip(6);
          const rgb = [r.u8(), r.u8(), r.u8()];
          r.skip(1);
          const name = r.string();
          p.tags.push({
            name,
            from,
            to,
            direction,
            repeat,
            color: '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join(''),
          });
        }
        tagUserIndex = 0;
      } else if (type === 0x2020 && tagUserIndex >= 0 && tagUserIndex < (p.tags?.length || 0)) {
        const uf = r.u32();
        if (uf & 1) r.string();
        if (uf & 2) {
          const rgb = [r.u8(), r.u8(), r.u8()];
          r.u8();
          p.tags[tagUserIndex].color =
            '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('');
        }
        if (uf & 4) warnings.add('附加属性暂不保留');
        tagUserIndex++;
      } else if ([0x2022, 0x2020].includes(type)) warnings.add('切片或附加元数据暂不保留');
      if (r.p > cb + cs) throw Error('数据块字段超出边界');
      r.p = cb + cs;
    }
    if (!p.layers.length) throw Error('文件没有普通图层');
    const frame = {
      duration: Math.min(10000, Math.max(20, duration || 120)),
      cels: p.layers.map(() => new Uint8ClampedArray(w * h * 4)),
    };
    rawFrames.push(raw.map((c) => ({ ...c, palette: palette.map((color) => [...color]) })));
    p.frames.push(frame);
    r.p = begin + bytes;
  }
  for (const raw of rawFrames)
    for (const c of raw) if (!p.layers[c.layer]) throw Error('动画引用未知图层');
  for (const link of links) if (!p.layers[link.layer]) throw Error('动画引用未知图层');
  const resolved = new Map();
  function resolve(f, layer, seen = new Set()) {
    const key = f + ':' + layer;
    if (resolved.has(key)) return resolved.get(key);
    if (seen.has(key)) throw Error('循环链接单元');
    seen.add(key);
    let cel = rawFrames[f]?.find((c) => c.layer === layer);
    if (!cel) {
      const link = links.find((l) => l.f === f && l.layer === layer);
      if (link) {
        if (link.to >= count) throw Error('链接单元引用未知帧');
        const source = resolve(link.to, layer, seen);
        if (!source) throw Error('链接单元引用空白帧');
        cel = { ...source, x: link.x, y: link.y, opacity: link.opacity };
      }
    }
    resolved.set(key, cel);
    return cel;
  }
  for (let f = 0; f < count; f++)
    for (let layer = 0; layer < p.layers.length; layer++) {
      const c = resolve(f, layer);
      if (!c) continue;
      if (p.layers[layer].group) throw Error('图层组不能包含像素单元');
      for (let yy = 0; yy < c.ch; yy++)
        for (let xx = 0; xx < c.cw; xx++) {
          const dx = c.x + xx,
            dy = c.y + yy;
          if (dx < 0 || dy < 0 || dx >= w || dy >= h) continue;
          const si = ((yy * c.cw + xx) * depth) / 8,
            di = (dy * w + dx) * 4;
          let color;
          if (depth === 32) color = Array.from(c.pixels.subarray(si, si + 4));
          else if (depth === 16)
            color = [c.pixels[si], c.pixels[si], c.pixels[si], c.pixels[si + 1]];
          else {
            const ix = c.pixels[si];
            color = [...(c.palette[ix] || [0, 0, 0, 255])];
            if (ix === transparent && !p.layers[layer].background) color[3] = 0;
          }
          color[3] = Math.round((color[3] * c.opacity) / 255);
          p.frames[f].cels[layer].set(color, di);
        }
    }
  p.layers.forEach((l) => delete l.background);
  if (depth !== 32) warnings.add('已转换为 RGBA 色彩模式');
  return { project: validate(p), warnings: [...warnings] };
}
class Writer {
  constructor() {
    this.a = [];
  }
  u8(v) {
    this.a.push(v & 255);
  }
  u16(v) {
    this.u8(v);
    this.u8(v >> 8);
  }
  u32(v) {
    this.u16(v);
    this.u16(v >>> 16);
  }
  zeros(n) {
    for (let i = 0; i < n; i++) this.u8(0);
  }
  bytes(b) {
    for (const v of b) this.u8(v);
  }
  string(s) {
    const b = new TextEncoder().encode(s);
    this.u16(b.length);
    this.bytes(b);
  }
  out() {
    return new Uint8Array(this.a);
  }
}
function chunk(type, data) {
  const x = new Writer();
  x.u32(data.length + 6);
  x.u16(type);
  x.bytes(data);
  return x.out();
}
export function writeAse(p) {
  validate(p);
  if (p.w > 65535 || p.h > 65535 || p.layers.length > 65535)
    throw Error('Aseprite 文件格式的宽高与图层索引必须小于 65536');
  // This writer materializes every cel; compact projects can represent far more pixels.
  if (p.w * p.h * p.layers.length * p.frames.length > MAX_PIXELS)
    throw Error('此项目展开后超过 Aseprite 导出预算，请保存无损 .pixel 工程或减少导出帧数');
  p = prepareAse(p);
  validate(p);
  const tags = [...(p.tags || [])].sort((a, b) => a.from - b.from || b.to - a.to);
  const frames = [];
  p.frames.forEach((f, fi) => {
    const chunks = [];
    if (fi === 0)
      p.layers.forEach((l) => {
        const x = new Writer();
        x.u16((l.visible ? 1 : 0) | (l.locked ? 0 : 2) | (l.collapsed ? 32 : 0));
        x.u16(l.group ? 1 : 0);
        x.u16(l.level || 0);
        x.zeros(4);
        x.u16(l.blend || 0);
        x.u8(l.opacity);
        x.zeros(3);
        x.string(l.name);
        chunks.push(chunk(0x2004, x.out()));
      });
    if (fi === 0 && p.tags?.length) {
      const t = new Writer();
      t.u16(p.tags.length);
      t.zeros(8);
      for (const tag of tags) {
        t.u16(tag.from);
        t.u16(tag.to);
        t.u8(tag.direction);
        t.u16(tag.repeat);
        t.zeros(6);
        t.bytes([1, 3, 5].map((i) => parseInt(tag.color.slice(i, i + 2), 16)));
        t.u8(0);
        t.string(tag.name);
      }
      chunks.push(chunk(0x2018, t.out()));
      for (const tag of tags) {
        const u = new Writer();
        u.u32(2);
        u.bytes([1, 3, 5].map((i) => parseInt(tag.color.slice(i, i + 2), 16)));
        u.u8(255);
        chunks.push(chunk(0x2020, u.out()));
      }
    }
    f.cels.forEach((c, li) => {
      if (p.layers[li].group) return;
      const x = new Writer();
      x.u16(li);
      x.u16(0);
      x.u16(0);
      x.u8(255);
      x.u16(0);
      x.zeros(7);
      x.u16(p.w);
      x.u16(p.h);
      x.bytes(readCel(c));
      chunks.push(chunk(0x2005, x.out()));
    });
    const x = new Writer();
    x.u32(16 + chunks.reduce((s, c) => s + c.length, 0));
    x.u16(0xf1fa);
    x.u16(chunks.length);
    x.u16(f.duration);
    x.zeros(2);
    x.u32(chunks.length);
    chunks.forEach((c) => x.bytes(c));
    frames.push(x.out());
  });
  const x = new Writer();
  x.u32(128 + frames.reduce((s, f) => s + f.length, 0));
  x.u16(0xa5e0);
  x.u16(frames.length);
  x.u16(p.w);
  x.u16(p.h);
  x.u16(32);
  x.u32(p.layers.some((l) => l.group && l.isolated !== false) ? 3 : 1);
  x.u16(p.frames[0].duration);
  x.zeros(8);
  x.u8(0);
  x.zeros(3);
  x.u16(0);
  x.u8(1);
  x.u8(1);
  x.zeros(4);
  x.u16(16);
  x.u16(16);
  x.zeros(84);
  frames.forEach((f) => x.bytes(f));
  return x.out();
}
