'use strict';

/**
 * ZIP writer tests. There is no zip library available here, so these tests
 * verify the archive structurally: they walk it the way a real unzip tool
 * would (end-of-central-directory record -> central directory -> local file
 * headers) and check every name, CRC and byte.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const zip = require('../src/zip.js');

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Walk a zip produced by buildZip and return its entries (name, data, crc). */
function readZipBytes(bytes) {
  const total = bytes.length;

  // End of central directory: the final 22 bytes (we never write an archive comment).
  const eocd = new DataView(bytes.buffer, bytes.byteOffset + total - 22, 22);
  assert.equal(eocd.getUint32(0, true), 0x06054b50, 'EOCD signature');
  const count = eocd.getUint16(8, true);
  assert.equal(count, eocd.getUint16(10, true), 'per-disk and total entry counts must match');
  const cdOffset = eocd.getUint32(16, true);
  const cdSize = eocd.getUint32(12, true);
  assert.equal(total, cdOffset + cdSize + 22, 'archive must end exactly after the EOCD');

  const entries = [];
  let pos = cdOffset;
  for (let i = 0; i < count; i++) {
    const cd = new DataView(bytes.buffer, bytes.byteOffset + pos, 46);
    assert.equal(cd.getUint32(0, true), 0x02014b50, 'central directory signature ' + i);
    const nameLen = cd.getUint16(28, true);
    const crc = cd.getUint32(16, true);
    const size = cd.getUint32(24, true);
    const localOffset = cd.getUint32(42, true);
    const name = dec.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));

    const local = new DataView(bytes.buffer, bytes.byteOffset + localOffset, 30);
    assert.equal(local.getUint32(0, true), 0x04034b50, 'local header signature ' + i);
    assert.equal(local.getUint16(8, true), 0, 'method must be 0 (stored)');
    assert.equal(local.getUint32(14, true), crc, 'local and central CRC must agree ' + i);
    assert.equal(local.getUint32(22, true), size, 'uncompressed size must match ' + i);
    const localNameLen = local.getUint16(26, true);
    assert.equal(localNameLen, nameLen, 'local name length must match ' + i);

    const dataStart = localOffset + 30 + localNameLen;
    const data = bytes.subarray(dataStart, dataStart + size);
    entries.push({ name, data, crc });
    pos += 46 + nameLen;
  }
  assert.equal(pos, cdOffset + cdSize, 'central directory must be contiguous');
  return entries;
}

test('crc32 matches the standard check value', () => {
  // "123456789" -> 0xCBF43926 is the canonical CRC-32 test vector.
  assert.equal(zip.crc32(enc.encode('123456789')), 0xCBF43926);
  assert.equal(zip.crc32(new Uint8Array(0)), 0);
});

test('buildZip round-trips names, data and CRCs', () => {
  const files = [
    { name: 'a.txt', data: 'hello world\n' },
    { name: 'part-001.txt', data: '' },
    { name: 'ünicode-ñ-passwörd.txt', data: 'møtley crüe — passwörd ✓ with ünïcødé' },
    { name: 'deep/dir/with spaces.txt', data: new Uint8Array([0, 1, 2, 250, 255, 0, 42]) },
    { name: 'big.txt', data: 'x'.repeat(70000) },
  ];
  const bytes = zip.buildZip(files, new Date(2026, 8, 13, 12, 0, 0));
  const back = readZipBytes(bytes);

  assert.equal(back.length, files.length);
  back.forEach((e, i) => {
    assert.equal(e.name, files[i].name, 'entry ' + i + ' name');
    const expected = files[i].data instanceof Uint8Array ? files[i].data : enc.encode(files[i].data);
    assert.ok(bytesEqual(e.data, expected), 'entry ' + i + ' data must round-trip');
    assert.equal(e.crc, zip.crc32(expected), 'entry ' + i + ' crc must verify');
  });
});

test('buildZip is deterministic for a fixed date', () => {
  const d = new Date(2026, 0, 2, 3, 4, 5);
  const files = [{ name: 'one.txt', data: 'same bytes' }];
  assert.ok(bytesEqual(zip.buildZip(files, d), zip.buildZip(files, d)));
});

test('empty archive is still a valid zip', () => {
  const bytes = zip.buildZip([]);
  const back = readZipBytes(bytes);
  assert.equal(back.length, 0);
});
