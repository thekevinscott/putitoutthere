import { describe, expect, it } from 'vitest';

import { isUnreleasedHeading } from './unreleased-heading.js';

describe('isUnreleasedHeading', () => {
  it('matches "## Unreleased"', () => {
    expect(isUnreleasedHeading('## Unreleased')).toBe(true);
  });

  it('matches with multiple spaces after the hashes', () => {
    expect(isUnreleasedHeading('##   Unreleased')).toBe(true);
  });

  it('matches a tab after the hashes', () => {
    expect(isUnreleasedHeading('##\tUnreleased')).toBe(true);
  });

  it('matches trailing whitespace after the title', () => {
    expect(isUnreleasedHeading('## Unreleased   ')).toBe(true);
  });

  it('rejects when there is no whitespace after the hashes', () => {
    expect(isUnreleasedHeading('##Unreleased')).toBe(false);
  });

  it('rejects three hashes (### Unreleased)', () => {
    expect(isUnreleasedHeading('### Unreleased')).toBe(false);
  });

  it('rejects a single hash', () => {
    expect(isUnreleasedHeading('# Unreleased')).toBe(false);
  });

  it('rejects a different title', () => {
    expect(isUnreleasedHeading('## Released')).toBe(false);
  });

  it('rejects extra text after the title', () => {
    expect(isUnreleasedHeading('## Unreleased notes')).toBe(false);
  });

  it('rejects an empty line', () => {
    expect(isUnreleasedHeading('')).toBe(false);
  });

  it('rejects a non-## line whose remainder reads " Unreleased"', () => {
    // Without the `##` guard, slice(2) of '>> Unreleased' is ' Unreleased',
    // which would trim to exactly 'Unreleased' and wrongly match.
    expect(isUnreleasedHeading('>> Unreleased')).toBe(false);
  });
});
