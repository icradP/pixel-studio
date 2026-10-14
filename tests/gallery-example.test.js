import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { deserialize, composite } from '../dist/engine.js';

test('bundled pelican retains the original artwork, every layer and every animation frame', async () => {
  const packed = await readFile(
    new URL('../dist/examples/pelican-cycling.pixel.gz', import.meta.url),
  );
  const original = gunzipSync(packed);
  assert.equal(
    createHash('sha256').update(original).digest('hex'),
    '0c954553f19977139b9e463342b421db303d89bc5ce0b4d4abc6368a673d4472',
  );
  assert.ok(packed.length < 100_000);
  const p = deserialize(original.toString());
  assert.equal(p.name, '鹈鹕骑车 · 海风慢行');
  assert.deepEqual([p.w, p.h, p.layers.length, p.frames.length], [176, 128, 6, 16]);
  assert.ok(p.frames.every((frame) => frame.duration === 80 && frame.cels.length === 6));
  const hashes = p.frames.map((_, i) => createHash('sha256').update(composite(p, i)).digest('hex'));
  assert.equal(new Set(hashes).size, 16);
});
