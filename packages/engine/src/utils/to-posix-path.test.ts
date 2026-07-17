import { describe, expect, it } from 'vitest';

import { toPosixPath } from './to-posix-path.js';

describe('toPosixPath', () => {
  it('rewrites Windows back-slashes to POSIX slashes', () => {
    expect(toPosixPath('artifacts\\demo\\package.json')).toBe(
      'artifacts/demo/package.json',
    );
  });

  it('leaves an already-POSIX path unchanged', () => {
    expect(toPosixPath('artifacts/demo/package.json')).toBe(
      'artifacts/demo/package.json',
    );
  });

  it('makes a Windows-style trailing segment match a `/<name>` test on any OS', () => {
    // The behavior `completeness.hasFile` relies on: after normalization a
    // back-slashed tail ends with `/package.json`, so a single-separator
    // check suffices and the per-platform OR disappears.
    expect(toPosixPath('C:\\build\\demo\\package.json').endsWith('/package.json')).toBe(
      true,
    );
  });
});
