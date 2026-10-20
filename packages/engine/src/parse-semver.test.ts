import { describe, expect, it } from 'vitest';

import { parseSemver } from './parse-semver.js';

describe('parseSemver', () => {
  it('parses a plain semver', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('parses zero-valued semver', () => {
    expect(parseSemver('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0 });
  });

  it('parses large numbers', () => {
    expect(parseSemver('100.200.300')).toEqual({ major: 100, minor: 200, patch: 300 });
  });

  it('rejects too few components', () => {
    expect(() => parseSemver('1.2')).toThrow();
  });

  it('rejects too many components', () => {
    expect(() => parseSemver('1.2.3.4')).toThrow();
  });

  it('rejects a pre-release suffix in v0', () => {
    expect(() => parseSemver('1.2.3-rc.1')).toThrow();
  });

  it('rejects non-numeric components', () => {
    expect(() => parseSemver('1.x.3')).toThrow();
    expect(() => parseSemver('a.b.c')).toThrow();
  });

  it('rejects leading-zero components (not strict semver)', () => {
    expect(() => parseSemver('1.02.3')).toThrow();
  });

  it('rejects leading v prefix', () => {
    expect(() => parseSemver('v1.2.3')).toThrow();
  });

  it('rejects empty input', () => {
    expect(() => parseSemver('')).toThrow();
  });
});
