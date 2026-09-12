/*
 * combo-sorter-web :: minimal ZIP writer (store method — no compression).
 *
 * Dependency-free, environment-free: the browser loads it as a classic script
 * (window.ComboZip) and the Node tests load the identical file via require().
 * This is what powers "split into N files -> download one .zip" without ever
 * uploading the list anywhere.
 *
 * The format written is plain vanilla ZIP (PKZip): local file headers, a
 * central directory, and an end-of-central-directory record. Entries are
 * stored uncompressed, so the archive opens in every unzip tool that exists.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; // node / tests
  if (root) root.ComboZip = api; // browser
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

  // ---------------------------------------------------------------- crc32
  // IEEE 802.3 polynomial, reflected — the CRC-32 that ZIP uses.
  const CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // ---------------------------------------------------------------- dos time
  // ZIP stores mod time as a pair of DOS-format 16-bit fields.
  function dosDateTime(d) {
    const date = (((d.getFullYear() - 1980) & 0x7F) << 9) | ((d.getMonth() + 1) & 0xF) << 5 | (d.getDate() & 0x1F);
    const time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F);
    return { date, time };
  }

  // ---------------------------------------------------------------- build
  /**
   * Build a ZIP archive from a list of files.
   *
   * @param {Array<{name: string, data: (string|Uint8Array)}>} files
   * @param {Date} [date] modification time stamped into every entry
   * @returns {Uint8Array} the complete .zip, ready for a Blob
   */
  function buildZip(files, date) {
    const when = dosDateTime(date instanceof Date && !isNaN(date.getTime()) ? date : new Date());
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const f of files) {
      const data = f && f.data instanceof Uint8Array ? f.data : encoder.encode(String(f && f.data != null ? f.data : ''));
      const name = encoder.encode(String(f && f.name != null ? f.name : ''));
      const crc = crc32(data);

      // Local file header (30 bytes) + name + data.
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);   // local header signature
      local.setUint16(4, 20, true);           // version needed to extract
      local.setUint16(6, 0x0800, true);       // flags: UTF-8 file names
      local.setUint16(8, 0, true);            // method: 0 = stored
      local.setUint16(10, when.time, true);
      local.setUint16(12, when.date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true); // compressed size
      local.setUint32(22, data.length, true); // uncompressed size
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);           // extra field length
      localParts.push(new Uint8Array(local.buffer), name, data);

      // Central directory header (46 bytes) + name.
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);      // central directory signature
      cd.setUint16(4, 20, true);              // version made by
      cd.setUint16(6, 20, true);              // version needed
      cd.setUint16(8, 0x0800, true);          // flags
      cd.setUint16(10, 0, true);              // method
      cd.setUint16(12, when.time, true);
      cd.setUint16(14, when.date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint16(30, 0, true);              // extra
      cd.setUint16(32, 0, true);              // comment
      cd.setUint16(34, 0, true);              // disk number
      cd.setUint16(36, 0, true);              // internal attrs
      cd.setUint32(38, 0, true);              // external attrs
      cd.setUint32(42, offset, true);         // local header offset
      centralParts.push(new Uint8Array(cd.buffer), name);

      offset += 30 + name.length + data.length;
    }

    const cdSize = centralParts.reduce((s, u) => s + u.length, 0);

    // End of central directory record (22 bytes, no archive comment).
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);               // this disk
    eocd.setUint16(6, 0, true);               // disk with central dir
    eocd.setUint16(8, files.length, true);    // entries on this disk
    eocd.setUint16(10, files.length, true);   // total entries
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, offset, true);         // central directory offset
    eocd.setUint16(20, 0, true);              // comment length

    const total = offset + cdSize + 22;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const u of localParts) { out.set(u, pos); pos += u.length; }
    for (const u of centralParts) { out.set(u, pos); pos += u.length; }
    out.set(new Uint8Array(eocd.buffer), pos);
    return out;
  }

  return { buildZip, crc32 };
});
