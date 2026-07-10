/**
 * `readWheelVersion` + `readZipEntry` (#450). Exercises the pure-Node zip
 * reader against both stored (method 0) and deflate (method 8) entries,
 * plus the null paths (no such entry, not a zip, no Version line).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readWheelVersion } from './read-wheel-version.js';
import { readZipEntry } from './read-zip-entry.js';

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));}
  }
  return (~crc) >>> 0;
}

/** Build a zip; `method` 8 = deflate, 0 = stored. */
function makeZip(files: Record<string, string>, method: 0 | 8 = 8): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const comp = method === 8 ? deflateRawSync(data) : data;
    const crc = crc32(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(comp.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    const localOffset = offset;
    local.push(lfh, nameBuf, comp);
    offset += lfh.length + nameBuf.length + comp.length;
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(method, 10);
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

const META = (v: string) => `Metadata-Version: 2.1\nName: demo\nVersion: ${v}\n`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'piot-wheel-read-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function wheel(files: Record<string, string>, method: 0 | 8 = 8): string {
  const p = join(dir, 'demo-1.0.0-py3-none-any.whl');
  writeFileSync(p, makeZip(files, method));
  return p;
}

describe('readWheelVersion', () => {
  it('reads Version from a deflate-compressed METADATA', () => {
    expect(readWheelVersion(wheel({ 'demo-1.0.0.dist-info/METADATA': META('1.2.3') }))).toBe('1.2.3');
  });

  it('reads Version from a stored (uncompressed) METADATA', () => {
    expect(readWheelVersion(wheel({ 'demo-1.0.0.dist-info/METADATA': META('4.5.6') }, 0))).toBe('4.5.6');
  });

  it('ignores the Metadata-Version line (matches ^Version: only)', () => {
    // A METADATA whose only Version-ish line is Metadata-Version must not
    // be mistaken for the package version.
    const p = wheel({ 'demo-1.0.0.dist-info/METADATA': 'Metadata-Version: 2.1\nName: demo\n' });
    expect(readWheelVersion(p)).toBeNull();
  });

  it('returns null when the wheel has no METADATA entry', () => {
    expect(readWheelVersion(wheel({ 'demo/__init__.py': '\n' }))).toBeNull();
  });
});

describe('readZipEntry', () => {
  it('returns null for a buffer that is not a zip', () => {
    expect(readZipEntry(Buffer.from('not a zip at all'), () => true)).toBeNull();
  });

  it('returns null when no entry matches', () => {
    const buf = makeZip({ 'a.txt': 'x', 'b.txt': 'y' });
    expect(readZipEntry(buf, (n) => n === 'missing')).toBeNull();
  });

  it('finds a matching entry among several', () => {
    const buf = makeZip({ 'a.txt': 'first', 'target.txt': 'hit', 'c.txt': 'third' });
    expect(readZipEntry(buf, (n) => n === 'target.txt')?.toString('utf8')).toBe('hit');
  });
});
