/**
 * `release_packages` manual-release spec parser tests.
 *
 * The spec is the value of the reusable workflow's `release_packages`
 * input: a comma-separated list of package entries, each a name
 * optionally suffixed with `@<patch|minor|major>` or an explicit
 * `@<X.Y.Z>` semver. A bare name defaults to a patch bump. It lets a
 * consumer re-release named packages without any new code (e.g. after
 * a putitoutthere bug fix).
 */

import { describe, expect, it } from 'vitest';

import { parseReleasePackages } from './release-packages.js';

describe('parseReleasePackages: absent / empty', () => {
  it('returns null for undefined', () => {
    expect(parseReleasePackages(undefined)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseReleasePackages('')).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(parseReleasePackages('   ')).toBeNull();
  });
});

describe('parseReleasePackages: bare name', () => {
  it('defaults a bare name to a patch bump', () => {
    const out = parseReleasePackages('lib-core');
    expect(out).not.toBeNull();
    expect(out!.get('lib-core')).toEqual({ name: 'lib-core', bump: 'patch' });
  });
});

describe('parseReleasePackages: bump keyword', () => {
  it('parses @patch / @minor / @major', () => {
    const out = parseReleasePackages('a@patch, b@minor, c@major')!;
    expect(out.get('a')).toEqual({ name: 'a', bump: 'patch' });
    expect(out.get('b')).toEqual({ name: 'b', bump: 'minor' });
    expect(out.get('c')).toEqual({ name: 'c', bump: 'major' });
  });
});

describe('parseReleasePackages: explicit version', () => {
  it('parses an explicit semver', () => {
    const out = parseReleasePackages('lib-py@1.4.0')!;
    expect(out.get('lib-py')).toEqual({ name: 'lib-py', version: '1.4.0' });
  });
});

describe('parseReleasePackages: multiple entries', () => {
  it('parses a mixed list and tolerates surrounding whitespace', () => {
    const out = parseReleasePackages('  lib-core@minor , lib-py@1.4.0 ,lib-js ')!;
    expect(out.get('lib-core')).toEqual({ name: 'lib-core', bump: 'minor' });
    expect(out.get('lib-py')).toEqual({ name: 'lib-py', version: '1.4.0' });
    expect(out.get('lib-js')).toEqual({ name: 'lib-js', bump: 'patch' });
    expect([...out.keys()]).toEqual(['lib-core', 'lib-py', 'lib-js']);
  });
});

describe('parseReleasePackages: malformed input', () => {
  it('throws on an empty entry (double comma)', () => {
    expect(() => parseReleasePackages('a,,b')).toThrow(/release-packages/);
  });

  it('throws on a trailing comma', () => {
    expect(() => parseReleasePackages('a,')).toThrow(/release-packages/);
  });

  it('throws on an invalid package name', () => {
    expect(() => parseReleasePackages('bad name')).toThrow(/release-packages/);
  });

  it('throws on a duplicate package name', () => {
    expect(() => parseReleasePackages('a@minor, a@major')).toThrow(/duplicate/);
  });

  it('throws on an empty version spec after @', () => {
    expect(() => parseReleasePackages('a@')).toThrow(/release-packages/);
  });

  it('throws on a version spec that is neither a keyword nor a semver', () => {
    expect(() => parseReleasePackages('a@nope')).toThrow(/release-packages/);
  });

  it('throws on a non-strict semver', () => {
    expect(() => parseReleasePackages('a@1.2')).toThrow(/release-packages/);
  });
});
