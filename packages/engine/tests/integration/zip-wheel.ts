/**
 * A minimal, dependency-free zip writer for `.whl` test fixtures.
 *
 * The `verify wheel` (#450) and `verify bundle-cli` (#451) integration tiers
 * both need genuine **deflate-compressed** zips on disk: the engine reads
 * wheels with its own pure-Node zip reader, so a fixture built by stashing
 * stored (uncompressed) entries would not exercise the same path a real
 * build-tool wheel takes. Each of those suites carried a byte-identical copy
 * of this writer; the action-surface suite would have made a third, so it
 * lives here instead.
 *
 * Test-only. Not shipped, not reachable from `src/`.
 */

import { deflateRawSync } from 'node:zlib';

/** CRC-32 over `buf`, as the zip local/central headers store it. */
function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));}
  }
  return (~crc) >>> 0;
}

/** Build a deflate-compressed zip carrying `files` (path → utf8 content). */
export function zip(files: Record<string, string>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const comp = deflateRawSync(data);
    const crc = crc32(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(8, 8); // method: deflate
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(comp.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    const localOffset = offset;
    local.push(lfh, nameBuf, comp);
    offset += lfh.length + nameBuf.length + comp.length;
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(comp.length, 20);
    cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(localOffset, 42);
    central.push(cdh, nameBuf);
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  const n = Object.keys(files).length;
  eocd.writeUInt16LE(n, 8);
  eocd.writeUInt16LE(n, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, eocd]);
}
