import { describe, expect, it } from 'vitest';

import { isSectionHeading } from './section-heading.js';

describe('isSectionHeading', () => {
  it('matches a "## " section heading', () => {
    expect(isSectionHeading('## v1.0.0')).toBe(true);
  });

  it('matches "## Unreleased" (also a section)', () => {
    expect(isSectionHeading('## Unreleased')).toBe(true);
  });

  it('matches hashes followed only by whitespace', () => {
    expect(isSectionHeading('## ')).toBe(true);
  });

  it('rejects no whitespace after the hashes', () => {
    expect(isSectionHeading('##v1.0.0')).toBe(false);
  });

  it('rejects three hashes', () => {
    expect(isSectionHeading('### Added')).toBe(false);
  });

  it('rejects a single hash', () => {
    expect(isSectionHeading('# Title')).toBe(false);
  });

  it('rejects a non-heading line', () => {
    expect(isSectionHeading('- a bullet')).toBe(false);
  });

  it('rejects a non-## line even when its third character is whitespace', () => {
    // Without the `##` guard, slice(2) of 'ab cd' is ' cd', whose leading
    // whitespace would wrongly satisfy the "section" test.
    expect(isSectionHeading('ab cd')).toBe(false);
  });
});
