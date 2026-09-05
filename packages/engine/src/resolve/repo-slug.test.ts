import { describe, expect, it } from 'vitest';

import { repoSlugFromRepositoryUrl } from './repo-slug.js';

describe('repoSlugFromRepositoryUrl', () => {
  it('parses the git+https form package.json uses', () => {
    expect(repoSlugFromRepositoryUrl('git+https://github.com/thekevinscott/putitoutthere.git'))
      .toBe('thekevinscott/putitoutthere');
  });

  it('parses a plain https URL without .git', () => {
    expect(repoSlugFromRepositoryUrl('https://github.com/owner/repo')).toBe('owner/repo');
  });

  it('parses the ssh form', () => {
    expect(repoSlugFromRepositoryUrl('git@github.com:owner/repo.git')).toBe('owner/repo');
  });

  it('tolerates a trailing slash', () => {
    expect(repoSlugFromRepositoryUrl('https://github.com/owner/repo/')).toBe('owner/repo');
  });

  it('throws on a URL it cannot derive owner/repo from', () => {
    expect(() => repoSlugFromRepositoryUrl('https://example.com/owner/repo')).toThrow(
      /cannot derive owner\/repo/,
    );
  });
});
