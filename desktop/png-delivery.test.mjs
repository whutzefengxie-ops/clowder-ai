import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { appGlobalCssFiles } from '../packages/web/scripts/sync-vendor-assets.mjs';
import { stageBuiltWeb } from './scripts/stage-built-web.mjs';

const chunk = (kind, data) => {
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length);
  output.write(kind, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(output.subarray(4, -4)), output.length - 4);
  return output;
};

function parts(bytes) {
  const result = [];
  let offset = 8;
  while (offset < bytes.length) {
    const end = offset + bytes.readUInt32BE(offset) + 12;
    const raw = bytes.subarray(offset, end);
    assert.equal(crc32(raw.subarray(4, -4)), raw.readUInt32BE(raw.length - 4));
    result.push({ kind: raw.toString('ascii', 4, 8), data: raw.subarray(8, -4), raw });
    offset = end;
  }
  return result;
}

test('Web staging recompresses avatar PNG bytes without changing scanlines, metadata, URLs or source', (t) => {
  const own = fs.mkdtempSync(path.join(os.tmpdir(), 'png-delivery-'));
  t.after(() => fs.rmSync(own, { recursive: true, force: true }));
  const source = path.join(own, 'source');
  const destination = path.join(own, 'staged');
  const write = (name, bytes) => {
    const file = path.join(source, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  };
  appGlobalCssFiles.forEach((name) => {
    write(`public/vendor/app/${name}`, 'body{}');
  });
  write('.next/BUILD_ID', 'same-build');
  const header = Buffer.alloc(13);
  header.writeUInt32BE(16, 0);
  header.writeUInt32BE(16, 4);
  header[8] = 8;
  header[9] = 6;
  const compressed = deflateSync(Buffer.alloc(16 * (16 * 4 + 1)), { level: 0 });
  const png = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('tEXt', Buffer.from('Author\0source witness')),
    chunk('pHYs', Buffer.from('00000b1300000b1301', 'hex')),
    chunk('IDAT', compressed.subarray(0, 12)),
    chunk('IDAT', compressed.subarray(12)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const jpeg = Buffer.from('ffd8ffe000104a4649460001', 'hex');
  write('public/avatars/family/example.png', png);
  write('public/avatars/jpeg-with-png-name.png', jpeg);
  write('public/uploads/user.png', png);
  write('public/sw.js', 'source-derived cache revision');

  stageBuiltWeb(source, destination);

  const output = fs.readFileSync(path.join(destination, 'public/avatars/family/example.png'));
  assert.ok(output.length < png.length / 2, 'delivery PNG should use the stronger lossless compression');
  const before = parts(png);
  const after = parts(output);
  const imageData = (values) =>
    inflateSync(Buffer.concat(values.filter(({ kind }) => kind === 'IDAT').map(({ data }) => data)));
  assert.deepEqual(imageData(after), imageData(before));
  assert.deepEqual(
    after.filter(({ kind }) => kind !== 'IDAT').map(({ raw }) => raw),
    before.filter(({ kind }) => kind !== 'IDAT').map(({ raw }) => raw),
  );
  assert.deepEqual(fs.readFileSync(path.join(source, 'public/avatars/family/example.png')), png);
  assert.deepEqual(fs.readFileSync(path.join(destination, 'public/avatars/jpeg-with-png-name.png')), jpeg);
  assert.deepEqual(fs.readFileSync(path.join(destination, 'public/uploads/user.png')), png);
  assert.equal(fs.readFileSync(path.join(destination, 'public/sw.js'), 'utf8'), 'source-derived cache revision');
});
