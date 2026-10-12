import test from 'node:test';
import assert from 'node:assert/strict';
import { importKind } from '../dist/file-import.js';
import { blank } from '../dist/engine.js';
import { writeAse, readAse } from '../dist/ase.js';
test('ASE import recognizes binary content with an unknown extension and no MIME', async () => {
  const bytes = writeAse(blank(2, 2)),
    file = new File([bytes], '下载的作品', { type: '' });
  assert.equal(await importKind(file), 'ase');
  assert.equal((await readAse(await file.arrayBuffer())).project.w, 2);
  assert.equal(
    await importKind(new File([bytes], 'Portrait.ASEPRITE', { type: 'application/octet-stream' })),
    'ase',
  );
});
test('corrupt named ASE reaches the parser and unsupported files get an actionable error', async () => {
  const file = new File(['corrupt'], 'test.ase');
  assert.equal(await importKind(file), 'ase');
  await assert.rejects(readAse(await file.arrayBuffer()));
  await assert.rejects(
    importKind(new File(['unrelated document'], 'notes.txt')),
    /请选择 Aseprite/,
  );
  await assert.rejects(importKind(new File([], 'empty.aseprite')), /文件为空/);
  await assert.rejects(importKind({ size: 61 * 1024 * 1024 }), /60 MiB/);
});
test('project and image imports do not depend on OS MIME registration', async () => {
  assert.equal(await importKind(new File(['{}'], 'backup.pixel')), 'project');
  assert.equal(
    await importKind(new File(['\uFEFF {"format":"pixel-studio"}'], 'backup')),
    'project',
  );
  for (const bytes of [
    [137, 80, 78, 71, 13, 10, 26, 10],
    [255, 216, 255],
    [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80],
  ])
    assert.equal(
      await importKind(new File([new Uint8Array(bytes)], 'image', { type: '' })),
      'image',
    );
});
