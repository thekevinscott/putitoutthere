import { describe, expect, it } from 'vitest';

import { ALLOWED_BUCKETS } from './allowed-buckets.js';
import { evaluateBullets } from './evaluate-bullets.js';
import type { Bullet } from './types.js';

const at = (line: number, text: string): Bullet => ({ line, text });

function evaluate(bullets: Bullet[], passed: (c: string) => boolean = () => true): string[] {
  return evaluateBullets({
    bullets,
    allowedBuckets: ALLOWED_BUCKETS,
    passedEvidence: passed,
    headSha: 'HEAD',
  });
}

describe('evaluateBullets', () => {
  it('flags a bullet with no trailing clause', () => {
    expect(evaluate([at(8, '- Fixed: no clause')])).toEqual([
      "CHANGELOG.md:8: missing trailing '(verified by: ...)' or '(no fixture: ...)' clause",
    ]);
  });

  it('accepts a `no fixture` bullet with a non-empty reason', () => {
    expect(evaluate([at(3, '- x (no fixture: pure refactor)')])).toEqual([]);
  });

  it('flags an empty `no fixture` reason', () => {
    expect(evaluate([at(11, '- x (no fixture: )')])).toEqual([
      "CHANGELOG.md:11: '(no fixture: ...)' requires a non-empty reason",
    ]);
  });

  it('flags the `<reason>` placeholder as an empty reason', () => {
    expect(evaluate([at(4, '- x (no fixture: <reason>)')])).toEqual([
      "CHANGELOG.md:4: '(no fixture: ...)' requires a non-empty reason",
    ]);
  });

  it('flags an unsupported evidence bucket', () => {
    expect(evaluate([at(9, '- x (verified by: bogus/thing)')])).toEqual([
      "CHANGELOG.md:9: unsupported evidence bucket 'bogus' in 'bogus/thing'",
    ]);
  });

  it('passes a verified-by bullet whose citation resolved successfully', () => {
    expect(evaluate([at(7, '- x (verified by: e2e/y)')], () => true)).toEqual([]);
  });

  it('flags a verified-by bullet whose citation never succeeded', () => {
    expect(evaluate([at(7, '- x (verified by: e2e/y)')], () => false)).toEqual([
      "CHANGELOG.md:7: no successful GitHub Actions run or job matched 'e2e/y' on HEAD",
    ]);
  });

  it('checks each comma-separated citation independently', () => {
    const passed = (c: string) => c === 'e2e/good';
    expect(
      evaluate([at(5, '- x (verified by: e2e/good, e2e/bad, bogus/x)')], passed),
    ).toEqual([
      "CHANGELOG.md:5: no successful GitHub Actions run or job matched 'e2e/bad' on HEAD",
      "CHANGELOG.md:5: unsupported evidence bucket 'bogus' in 'bogus/x'",
    ]);
  });
});
