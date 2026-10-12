import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { redact } from './redact.js';
import { scanSource, type EnvSource } from './scan-source.js';

vi.mock('node:crypto');
vi.mock('./scan-source.js');

const createHashMock = vi.mocked(createHash);
const scanMock = vi.mocked(scanSource);

function scans(map: Map<EnvSource, string[]>): void {
  scanMock.mockImplementation((src) => map.get(src) ?? []);
}

beforeEach(() => {
  vi.resetAllMocks();
  createHashMock.mockImplementation(() => {
    let input = '';
    const hash = {
      update: (v: string) => {
        input = v;
        return hash;
      },
      digest: () => `${input.length.toString(16).padStart(4, '0')}ffffabcdef`,
    };
    return hash as unknown as ReturnType<typeof createHash>;
  });
});

describe('redact', () => {
  it('replaces every occurrence with an 8-char SHA-256 digest prefix (#134)', () => {
    const src = {};
    scans(new Map([[src, ['super-sensitive-value']]]));
    expect(redact('a super-sensitive-value b super-sensitive-value', [src])).toBe(
      'a [REDACTED:0015ffff] b [REDACTED:0015ffff]',
    );
    expect(createHashMock).toHaveBeenCalledWith('sha256');
  });

  it('redacts scanned values in the order scanSource returns them', () => {
    const src = {};
    scans(new Map([[src, ['abcdefgh-longer', 'abcdefgh']]]));
    expect(redact('x abcdefgh-longer y abcdefgh', [src])).toBe('x [REDACTED:000fffff] y [REDACTED:0008ffff]');
  });

  it('skips hashing a scanned secret absent from the string', () => {
    const src = {};
    scans(new Map([[src, ['never-in-any-logged-line']]]));
    expect(redact('a routine message', [src])).toBe('a routine message');
    expect(createHashMock).not.toHaveBeenCalled();
  });

  it('scans every supplied source', () => {
    const a = {};
    const b = {};
    scans(new Map([[a, ['one-secret-aaaa']], [b, ['two-secret-bbbbb']]]));
    expect(redact('one-secret-aaaa two-secret-bbbbb', [a, b])).toBe('[REDACTED:000fffff] [REDACTED:0010ffff]');
  });

  it('defaults to scanning process.env', () => {
    scans(new Map([[process.env, ['process-env-secret']]]));
    expect(redact('saw process-env-secret')).toBe('saw [REDACTED:0012ffff]');
    expect(scanMock).toHaveBeenCalledWith(process.env);
  });
});
