/**
 * `readZipEntry` (#450): the minimal pure-Node zip reader. Exercises both
 * stored (method 0) and deflate (method 8) entries, the not-a-zip and no-match
 * null paths, entry selection among several, and the case where a local
 * header's extra field differs from the central directory's (so the data
 * offset must be read from the local header).
 *
 * Unit-isolated: `node:zlib` is mocked so no real deflate stream is built —
 * fixtures store their bytes raw and the method-8 branch is exercised through
 * the mocked `inflateRawSync` (driven as an identity decode). Real deflate
 * round-tripping is covered in `test/integration/verify-wheel.integration.test.ts`
 * and `test/e2e/verify-wheel.e2e.test.ts`.
 */

import { inflateRawSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readZipEntry } from './read-zip-entry.js';

vi.mock('node:zlib');

beforeEach(() => {
  // The mocked inflate decodes a fixture's raw-stored bytes unchanged, so a
  // method-8 entry round-trips its content while node:zlib stays mocked.
  vi.mocked(inflateRawSync).mockImplementation((buf) => Buffer.from(buf as Buffer));
});

interface Entry {
  content: string;
  method?: 0 | 8;
  /** Bytes of extra field to place in the LOCAL header only. */
  localExtra?: number;
}

/**
 * Build a minimal zip; per-entry method + optional local-only extra field.
 * Entry bytes are stored raw regardless of the declared method — the reader's
 * deflate branch inflates them through the mocked (identity) `inflateRawSync`.
 */
function makeZip(files: Record<string, Entry>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, entry] of Object.entries(files)) {
    const method = entry.method ?? 8;
    const data = Buffer.from(entry.content, 'utf8');
    const comp = data;
    const nameBuf = Buffer.from(name, 'utf8');
    const localExtra = Buffer.alloc(entry.localExtra ?? 0);

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt32LE(comp.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(localExtra.length, 28);
    const localOffset = offset;
    local.push(lfh, nameBuf, localExtra, comp);
    offset += lfh.length + nameBuf.length + localExtra.length + comp.length;

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt32LE(comp.length, 20);
    cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    // Central-directory extra length intentionally 0 (differs from local).
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

describe('readZipEntry', () => {
  it('returns null when the buffer is not a zip', () => {
    expect(readZipEntry(Buffer.from('definitely not a zip file'), () => true)).toBeNull();
  });

  it('returns null when no entry name matches', () => {
    const buf = makeZip({ 'a.txt': { content: 'x' }, 'b.txt': { content: 'y' } });
    expect(readZipEntry(buf, (name) => name === 'missing.txt')).toBeNull();
  });

  it('reads a deflate-compressed (method 8) entry', () => {
    const buf = makeZip({ 'meta.txt': { content: 'hello deflate', method: 8 } });
    expect(readZipEntry(buf, (name) => name === 'meta.txt')?.toString('utf8')).toBe('hello deflate');
  });

  it('reads a stored (method 0) entry', () => {
    const buf = makeZip({ 'meta.txt': { content: 'hello stored', method: 0 } });
    expect(readZipEntry(buf, (name) => name === 'meta.txt')?.toString('utf8')).toBe('hello stored');
  });

  it('selects the matching entry among several', () => {
    const buf = makeZip({
      'a.txt': { content: 'first', method: 0 },
      'target.txt': { content: 'the payload', method: 0 },
      'c.txt': { content: 'third', method: 0 },
    });
    expect(readZipEntry(buf, (name) => name === 'target.txt')?.toString('utf8')).toBe('the payload');
  });

  it('honours the local header extra field when it differs from the central directory', () => {
    // Central-directory extra is 0 but the local header carries 7 bytes; the
    // reader must compute the data offset from the local header, not the CD.
    const buf = makeZip({ 'meta.txt': { content: 'offset-correct', method: 0, localExtra: 7 } });
    expect(readZipEntry(buf, (name) => name === 'meta.txt')?.toString('utf8')).toBe('offset-correct');
  });
});
