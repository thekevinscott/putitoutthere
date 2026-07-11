/**
 * Version bumper tests. TDD-style.
 *
 * Semantics per plan.md §14.3, §14.4.
 *
 * Issue #8.
 */

import { describe, expect, it } from 'vitest';

import pkg from '../package.json' with { type: 'json' };
import { bump, firstVersion, parseSemver, USER_AGENT, VERSION } from './version.js';

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
    // Pre-release dist-tags (`-rc`, `-beta`, `-alpha`) are deferred
    // to v0.2 (plan.md §26.2). The parser should refuse to accept
    // them rather than silently drop the suffix.
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

describe('bump: patch', () => {
  it('0.1.0 → 0.1.1', () => {
    expect(bump('0.1.0', 'patch')).toBe('0.1.1');
  });

  it('0.0.9 → 0.0.10', () => {
    expect(bump('0.0.9', 'patch')).toBe('0.0.10');
  });

  it('2.3.4 → 2.3.5', () => {
    expect(bump('2.3.4', 'patch')).toBe('2.3.5');
  });
});

describe('bump: minor', () => {
  it('0.1.5 → 0.2.0 (zeros patch)', () => {
    expect(bump('0.1.5', 'minor')).toBe('0.2.0');
  });

  it('1.0.0 → 1.1.0', () => {
    expect(bump('1.0.0', 'minor')).toBe('1.1.0');
  });

  it('does not use pre-1.0 breaking-minor-bump convention', () => {
    // Plan.md §14.3 explicitly says we stay strict-semver pre-1.0.
    // 0.1.5 + minor is 0.2.0, not 1.0.0.
    expect(bump('0.1.5', 'minor')).toBe('0.2.0');
  });
});

describe('bump: major', () => {
  it('0.1.5 → 1.0.0 (zeros minor + patch)', () => {
    expect(bump('0.1.5', 'major')).toBe('1.0.0');
  });

  it('1.2.3 → 2.0.0', () => {
    expect(bump('1.2.3', 'major')).toBe('2.0.0');
  });
});

describe('bump: input validation', () => {
  it('rejects an invalid last version', () => {
    expect(() => bump('1.2', 'patch')).toThrow();
  });

  it('rejects an invalid bump type', () => {
    // @ts-expect-error — testing runtime guard
    expect(() => bump('1.0.0', 'huge')).toThrow();
  });
});

describe('firstVersion', () => {
  it('returns the package default when set', () => {
    expect(firstVersion({ first_version: '0.3.0' })).toBe('0.3.0');
  });

  it('returns the fallback 0.1.0 when unset', () => {
    expect(firstVersion({})).toBe('0.1.0');
  });

  it('rejects an invalid first_version value', () => {
    expect(() => firstVersion({ first_version: 'not-a-semver' })).toThrow();
  });
});

describe('VERSION + USER_AGENT (#147)', () => {
  it('VERSION reflects package.json at build time', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('USER_AGENT embeds the current version, not a hardcoded 0.0.1', () => {
    expect(USER_AGENT).toBe(`putitoutthere/${pkg.version}`);
    expect(USER_AGENT).toMatch(/^putitoutthere\/\d+\.\d+\.\d+$/);
  });
});
