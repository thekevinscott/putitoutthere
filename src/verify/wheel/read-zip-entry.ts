/**
 * Extract the first zip entry whose name satisfies `matches`, returning its
 * decompressed bytes (or null if none matches) (#450).
 *
 * A minimal pure-Node zip reader for the stored (method 0) and deflate
 * (method 8) entries a wheel uses — enough to read `dist-info/METADATA`
 * without an `unzip` / `tar` subprocess, so `verify wheel` runs on every
 * platform the maturin matrix builds on (Windows included). Wheels are not
 * ZIP64 and carry no archive comment, so the common-case layout is all that
 * is handled.
 */

import { inflateRawSync } from 'node:zlib';

export function readZipEntry(buf: Buffer, matches: (name: string) => boolean): Buffer | null {
  // End Of Central Directory record: scan back for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    return null;
  }

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // central-directory offset
  // The EOCD gives the exact entry count, and central-directory headers are
  // contiguous, so read exactly `count` of them.
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const fnLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + fnLen);
    if (matches(name)) {
      // Data starts after the LOCAL header's own name + extra fields
      // (its extra length can differ from the central directory's).
      const lFnLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lFnLen + lExtraLen;
      const raw = buf.subarray(dataStart, dataStart + compSize);
      return method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    }
    p += 46 + fnLen + extraLen + commentLen;
  }
  return null;
}
