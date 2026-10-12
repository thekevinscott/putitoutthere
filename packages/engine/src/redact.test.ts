import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { redact } from './redact.js';

function marker(v: string): string {
  return `[REDACTED:${createHash('sha256').update(v).digest('hex').slice(0, 8)}]`;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('redact', () => {
  it('replaces every occurrence with a SHA-256-prefix marker (#134)', () => {
    const src = { NPM_TOKEN: 'super-sensitive-value' };
    expect(redact('a super-sensitive-value b super-sensitive-value', [src])).toBe(
      `a ${marker('super-sensitive-value')} b ${marker('super-sensitive-value')}`,
    );
  });

  it('gives distinct tokens distinct markers', () => {
    const src = { A_TOKEN: 'first-token-value', B_TOKEN: 'second-token-value' };
    expect(redact('first-token-value then second-token-value', [src])).toBe(
      `${marker('first-token-value')} then ${marker('second-token-value')}`,
    );
  });

  it('redacts the longer secret whole when a shorter one is its substring', () => {
    const src = { A_TOKEN: 'abcdefgh', B_TOKEN: 'abcdefgh-longer' };
    expect(redact('x abcdefgh-longer y', [src])).toBe(`x ${marker('abcdefgh-longer')} y`);
  });

  it('leaves the string untouched when no scanned secret appears in it', () => {
    const src = { ABSENT_SECRET_TOKEN: 'never-in-any-logged-line' };
    expect(redact('a routine message', [src])).toBe('a routine message');
  });

  it('does not redact short or non-credential values', () => {
    const src = { CI: '1', SHORT_TOKEN: 'abc', PROJECT_NAME: 'example-lib' };
    expect(redact('status=1 abc example-lib', [src])).toBe('status=1 abc example-lib');
  });

  it('scans every supplied source', () => {
    const s = redact('one-secret-aaaa two-secret-bbbb', [
      { A_TOKEN: 'one-secret-aaaa' },
      { B_TOKEN: 'two-secret-bbbb' },
    ]);
    expect(s).toBe(`${marker('one-secret-aaaa')} ${marker('two-secret-bbbb')}`);
  });

  it('defaults to scanning process.env', () => {
    vi.stubEnv('REDACT_DEFAULT_TOKEN', 'process-env-secret');
    expect(redact('saw process-env-secret')).toBe(`saw ${marker('process-env-secret')}`);
  });
});
