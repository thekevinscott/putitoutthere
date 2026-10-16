import { describe, expect, it } from 'vitest';

import { parseCargoCompressedBytes } from './parse-cargo-compressed-bytes.js';

function summary(compressed: string): string {
  return `   Packaging rust-lib v0.1.0 (/tmp/repo)\n    Packaged 7 files, 24.0KiB (${compressed} compressed)\n`;
}

describe('parseCargoCompressedBytes', () => {
  it.each([
    ['512B', 512],
    ['8.9KiB', Math.round(8.9 * 1024)],
    ['133.6MiB', Math.round(133.6 * 1024 ** 2)],
    ['1.5GiB', Math.round(1.5 * 1024 ** 3)],
    ['2TiB', 2 * 1024 ** 4],
  ])('reads %s', (compressed, bytes) => {
    expect(parseCargoCompressedBytes(summary(compressed))).toBe(bytes);
  });

  it('reads the compressed size, not the uncompressed one', () => {
    expect(parseCargoCompressedBytes('    Packaged 7 files, 24.0KiB (1.0KiB compressed)\n')).toBe(1024);
  });

  it('returns null when there is no Packaged summary line', () => {
    expect(parseCargoCompressedBytes('   Compiling rust-lib v0.1.0\n')).toBeNull();
  });

  it('returns null for an unrecognised unit', () => {
    expect(parseCargoCompressedBytes(summary('5.0ZB'))).toBeNull();
  });
});
