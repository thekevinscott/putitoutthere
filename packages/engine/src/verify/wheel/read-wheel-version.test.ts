/**
 * `readWheelVersion` (#450): the METADATA `Version:` parser. `node:fs` and the
 * zip reader are mocked so this isolates the line-parsing / null-propagation
 * logic; the real zip decode is covered in `read-zip-entry.test.ts` and the
 * full round trip in the integration + e2e tiers.
 */

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readWheelVersion } from './read-wheel-version.js';
import { readZipEntry } from './read-zip-entry.js';

vi.mock('node:fs');
vi.mock('./read-zip-entry.js');

const readFileMock = vi.mocked(readFileSync);
const readZipMock = vi.mocked(readZipEntry);

const META = (v: string) => `Metadata-Version: 2.1\nName: demo\nVersion: ${v}\n`;

beforeEach(() => {
  vi.resetAllMocks();
  readFileMock.mockReturnValue(Buffer.from('wheel-bytes'));
});

describe('readWheelVersion', () => {
  it('reads the Version from a METADATA entry', () => {
    readZipMock.mockReturnValue(Buffer.from(META('1.2.3')));
    expect(readWheelVersion('demo-1.0.0-py3-none-any.whl')).toBe('1.2.3');
  });

  it('reads a different Version string', () => {
    readZipMock.mockReturnValue(Buffer.from(META('4.5.6')));
    expect(readWheelVersion('demo-1.0.0-py3-none-any.whl')).toBe('4.5.6');
  });

  it('ignores the Metadata-Version line (matches ^Version: only)', () => {
    // A METADATA whose only Version-ish line is Metadata-Version must not be
    // mistaken for the package version.
    readZipMock.mockReturnValue(Buffer.from('Metadata-Version: 2.1\nName: demo\n'));
    expect(readWheelVersion('demo-1.0.0-py3-none-any.whl')).toBeNull();
  });

  it('returns null when the wheel has no METADATA entry', () => {
    readZipMock.mockReturnValue(null);
    expect(readWheelVersion('demo-1.0.0-py3-none-any.whl')).toBeNull();
  });

  it('selects the zip entry by its `.dist-info/METADATA` suffix', () => {
    // Capture the predicate handed to the zip reader so the entry-matcher
    // arrow is actually invoked (matches METADATA, rejects RECORD).
    let matcher: ((name: string) => boolean) | undefined;
    readZipMock.mockImplementation((_buf, m) => {
      matcher = m;
      return Buffer.from(META('9.9.9'));
    });
    expect(readWheelVersion('demo-1.0.0-py3-none-any.whl')).toBe('9.9.9');
    expect(matcher!('demo-1.0.0.dist-info/METADATA')).toBe(true);
    expect(matcher!('demo-1.0.0.dist-info/RECORD')).toBe(false);
  });
});
