import { composite } from './engine.js';
export function encodeGif(p) {
  const a = [],
    byte = (v) => a.push(v & 255),
    word = (v) => {
      byte(v);
      byte(v >> 8);
    },
    text = (s) => [...s].forEach((c) => byte(c.charCodeAt(0)));
  text('GIF89a');
  word(p.w);
  word(p.h);
  byte(0xf7);
  byte(0);
  byte(0);
  for (let i = 0; i < 256; i++) {
    if (!i) {
      byte(0);
      byte(0);
      byte(0);
    } else {
      const n = Math.min(215, i - 1);
      byte(Math.floor(n / 36) * 51);
      byte((Math.floor(n / 6) % 6) * 51);
      byte((n % 6) * 51);
    }
  }
  byte(0x21);
  byte(0xff);
  byte(11);
  text('NETSCAPE2.0');
  byte(3);
  byte(1);
  word(0);
  byte(0);
  for (let f = 0; f < p.frames.length; f++) {
    byte(0x21);
    byte(0xf9);
    byte(4);
    byte(9);
    word(Math.max(2, Math.round(p.frames[f].duration / 10)));
    byte(0);
    byte(0);
    byte(0x2c);
    word(0);
    word(0);
    word(p.w);
    word(p.h);
    byte(0);
    byte(8);
    const c = composite(p, f),
      codes = [256];
    let n = 0;
    for (let i = 0; i < c.length; i += 4) {
      if (n === 200) {
        codes.push(256);
        n = 0;
      }
      codes.push(
        c[i + 3] < 128
          ? 0
          : 1 +
              Math.round(c[i] / 51) * 36 +
              Math.round(c[i + 1] / 51) * 6 +
              Math.round(c[i + 2] / 51),
      );
      n++;
    }
    codes.push(257);
    let bits = 0,
      count = 0;
    const packed = [];
    for (const code of codes) {
      bits |= code << count;
      count += 9;
      while (count >= 8) {
        packed.push(bits & 255);
        bits >>>= 8;
        count -= 8;
      }
    }
    if (count) packed.push(bits & 255);
    for (let i = 0; i < packed.length; i += 255) {
      byte(Math.min(255, packed.length - i));
      for (let j = i; j < Math.min(i + 255, packed.length); j++) byte(packed[j]);
    }
    byte(0);
  }
  byte(0x3b);
  return new Uint8Array(a);
}
