/**
 * Tests for the tag-template helpers (`src/tag-template.ts`).
 *
 * Covers the default shape, the single-package `v{version}` shape, and
 * the edge cases that bit us before this was configurable — tags from
 * sibling packages that share a name prefix, non-semver noise, and
 * hyphen-bearing package names.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TAG_FORMAT,
  formatTag,
  parseTagVersion,
  tagGlob,
  validateTagFormat,
} from './tag-template.js';

describe('formatTag', () => {
  it('renders the default template', () => {
    expect(formatTag(DEFAULT_TAG_FORMAT, { name: 'pkg', version: '1.2.3' })).toBe('pkg-v1.2.3');
  });

  it('supports a single-package v-prefixed template without {name}', () => {
    expect(formatTag('v{version}', { name: 'ignored', version: '0.2.11' })).toBe('v0.2.11');
  });

  it('supports hyphenated package names', () => {
    expect(formatTag(DEFAULT_TAG_FORMAT, { name: 'my-pkg', version: '1.0.0' })).toBe('my-pkg-v1.0.0');
  });
});

describe('tagGlob', () => {
  it('produces a prefix+semver glob for the default template', () => {
    expect(tagGlob(DEFAULT_TAG_FORMAT, 'pkg')).toBe('pkg-v*.*.*');
  });

  it('produces a bare `v*.*.*` glob when {name} is absent', () => {
    expect(tagGlob('v{version}', 'pkg')).toBe('v*.*.*');
  });
});

describe('parseTagVersion', () => {
  it('extracts the version from a default-shaped tag', () => {
    expect(parseTagVersion(DEFAULT_TAG_FORMAT, 'pkg', 'pkg-v1.2.3')).toBe('1.2.3');
  });

  it('extracts the version from a bare `v{version}` tag', () => {
    expect(parseTagVersion('v{version}', 'ignored', 'v0.2.11')).toBe('0.2.11');
  });

  it("returns null when the tag doesn't match the template", () => {
    expect(parseTagVersion(DEFAULT_TAG_FORMAT, 'pkg', 'other-v1.2.3')).toBeNull();
  });

  it('rejects tags that match the shape but fail strict semver', () => {
    // parseSemver rejects leading zeros.
    expect(parseTagVersion(DEFAULT_TAG_FORMAT, 'pkg', 'pkg-v01.02.03')).toBeNull();
  });

  it('handles hyphenated names without confusing regex', () => {
    expect(parseTagVersion(DEFAULT_TAG_FORMAT, 'my-pkg', 'my-pkg-v2.0.0')).toBe('2.0.0');
    expect(parseTagVersion(DEFAULT_TAG_FORMAT, 'my', 'my-pkg-v2.0.0')).toBeNull();
  });
});

describe('validateTagFormat', () => {
  it('accepts the default', () => {
    expect(validateTagFormat(DEFAULT_TAG_FORMAT)).toBeNull();
  });

  it('accepts `v{version}`', () => {
    expect(validateTagFormat('v{version}')).toBeNull();
  });

  it('requires {version}', () => {
    expect(validateTagFormat('{name}-v')).toMatch(/must contain \{version\}/);
  });

  it('rejects unknown placeholders', () => {
    expect(validateTagFormat('{name}-{bogus}-v{version}')).toMatch(/unknown placeholder/);
  });
});
